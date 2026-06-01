import { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { isFullPage } from "@notionhq/client";

const worker = new Worker();
export default worker;

// ── Stable workspace IDs ──────────────────────────────────────────────────────
// Written by scripts/bootstrap-workspace.ts — stable once the workspace exists.

const PRODUCT_ROADMAP_DB      = "36efc8f4-554c-818c-99ac-c63a7bdfb9fa";
const PRDS_DB                 = "36efc8f4-554c-81fc-87de-c7eb7e467521";
const SQUAD_WEEKLY_SUMMARY_DB = "36efc8f4-554c-819e-b339-ec0bb2c97a76";
const AGENT_RUN_LOG_DB        = "36efc8f4-554c-814e-8c51-ea51792f5344";
const HITL_REVIEW_SESSIONS_DB = "370fc8f4-554c-8113-a6dd-f893a84555ff";

const SQUAD_PAGE_ID: Record<Squad, string> = {
  atlas: "36efc8f4-554c-81e7-a83b-c976963a5fab",
  lumen: "36efc8f4-554c-81b6-8583-dd3634f0e7ad",
  forge: "36efc8f4-554c-8102-b02e-d9def2d4a4da",
};

type Squad         = "atlas" | "lumen" | "forge";
type ProductSource = "roadmap" | "prd-fact-check";

// Section headings differ by source so the page reads naturally in Notion.
const SECTION_LABELS: Record<ProductSource, [string, string, string, string]> = {
  "roadmap":        ["On Track",     "At Risk",           "No Movement",  "Off-Plan Activity"],
  "prd-fact-check": ["PRD Aligned",  "In Progress vs PRD","Flags & Drift", "Observations"],
};

// ── Notion rich-text chunked writer ──────────────────────────────────────────
// One element hard-caps at 2000 chars — chunk to allow arbitrarily long strings.
// See PRD-04a Gotcha 4.
const rt = (s: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += 1999) {
    chunks.push({ type: "text", text: { content: s.slice(i, i + 1999) } });
  }
  return chunks.length > 0 ? chunks : [{ type: "text" as const, text: { content: "" } }];
};

// ── Tiny property extractors ──────────────────────────────────────────────────

function richText(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if ("rich_text" in p && Array.isArray(p.rich_text))
    return (p.rich_text as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  if ("title" in p && Array.isArray(p.title))
    return (p.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  return "";
}

function selectName(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const s = (prop as Record<string, unknown>).select;
  if (s && typeof s === "object") return ((s as Record<string, unknown>).name as string) ?? "";
  return "";
}

function dateStart(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const d = (prop as Record<string, unknown>).date;
  if (d && typeof d === "object") return ((d as Record<string, unknown>).start as string) ?? "";
  return "";
}

// Read the numeric value from a rollup property whose function = "average".
// Returns 0–1 fraction; treat >= 0.999 as 100%.
function rollupAverage(prop: unknown): number | null {
  if (!prop || typeof prop !== "object") return null;
  const p = prop as Record<string, unknown>;
  if (p.type !== "rollup") return null;
  const r = p.rollup as Record<string, unknown> | undefined;
  if (!r || r.type !== "number" || typeof r.number !== "number") return null;
  return r.number;
}

// Extract plain text from a Notion rich_text array embedded in a block
function blockText(richTextArr: unknown): string {
  if (!Array.isArray(richTextArr)) return "";
  return (richTextArr as Array<{ plain_text?: string }>)
    .map((t) => t.plain_text ?? "")
    .join("");
}

// Parse "2026-W21" → "2026-05-18" (Monday of that ISO week)
function weekOfToDate(weekOf: string): string {
  const [yearStr, weekStr] = weekOf.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow  = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (dow - 1));
  const monday = new Date(week1Mon);
  monday.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().split("T")[0];
}

// ── Tool 1: read_squad_summaries ──────────────────────────────────────────────
//
// Returns the 4 per-source (github/jira/slack/figma) Squad Weekly Summary rows
// for the given squad + week. Each row includes:
//   - notionPageId: the cascade citation target — use this as recordId when
//     citing an upstream summary in write_squad_summary
//   - content: the structured page body (## section headings + text)
//   - citations: the upstream citations array, for tracing the evidence chain
//
// Only returns source = github | jira | slack | figma (never roadmap/prd-fact-check).

worker.tool("read_squad_summaries", {
  title: "Read Squad Summaries",
  description:
    "Return the 4 per-source Squad Weekly Summary rows for a squad and week, " +
    "including page body content and upstream citations. " +
    "notionPageId from each row is the cascade citation target — use it as recordId " +
    "when citing upstream evidence in write_squad_summary.",
  hints: { readOnlyHint: true },
  schema: j.object({
    squad:  j.enum("atlas", "lumen", "forge").describe("Squad whose summaries to return"),
    weekOf: j.string().describe("Week identifier, e.g. 2026-W21"),
  }),
  execute: async ({ squad, weekOf }, { notion }) => {
    const squadPageId = SQUAD_PAGE_ID[squad as Squad];
    const weekDate    = weekOfToDate(weekOf);

    // ── Quorum check via HITL Review Sessions rollup ──────────────────────────
    // Non-Product Approval Rate = average of the per-row formula across linked
    // Squad Weekly Summary rows, where product rows (roadmap/prd-fact-check)
    // always contribute 1 and non-product rows contribute 1 only when approved.
    // Reaches 1.0 only when all 4 source rows (github/jira/slack/figma) are approved.
    const sessionResp = await notion.databases.query({
      database_id: HITL_REVIEW_SESSIONS_DB,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: squadPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
        ],
      },
      page_size: 5,
    });
    const sessionPage          = sessionResp.results.filter(isFullPage)[0];
    const nonProductApprovalRate =
      sessionPage ? rollupAverage(sessionPage.properties["Non-Product Approval Rate"]) : null;
    const nonProductQuorumMet  =
      nonProductApprovalRate !== null && nonProductApprovalRate >= 0.999;

    // ── Read per-source summary rows ──────────────────────────────────────────
    const response = await notion.databases.query({
      database_id: SQUAD_WEEKLY_SUMMARY_DB,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: squadPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
        ],
      },
      page_size: 20,
    });

    const PER_SOURCE_SOURCES = new Set(["github", "jira", "slack", "figma"]);
    const summaries = [];

    for (const page of response.results.filter(isFullPage)) {
      const p      = page.properties as Record<string, unknown>;
      const source = selectName(p["Source"]);
      if (!PER_SOURCE_SOURCES.has(source)) continue;

      // Reconstruct page body into structured text
      const blocklist = await notion.blocks.children.list({ block_id: page.id });
      const sections: Record<string, string> = {};
      let currentHeading = "";

      for (const block of blocklist.results) {
        if (!("type" in block)) continue;
        const b = block as { type: string } & Record<string, unknown>;

        if (b.type === "heading_2") {
          currentHeading = blockText((b.heading_2 as Record<string, unknown>)?.rich_text);
        } else if (b.type === "paragraph" && currentHeading) {
          const text = blockText((b.paragraph as Record<string, unknown>)?.rich_text);
          if (text) sections[currentHeading] = text;
        }
      }

      const content = Object.entries(sections)
        .map(([h, t]) => `## ${h}\n${t}`)
        .join("\n\n");

      // Parse upstream citations (may be multi-chunk rich_text)
      const citationsJson = richText(p["Citations"]);
      let citations: Array<{ recordId: string; sourceUrl: string; claim: string }> = [];
      try { citations = JSON.parse(citationsJson || "[]"); } catch { citations = []; }

      summaries.push({
        notionPageId: page.id,
        source,
        status:      selectName(p["Status"]),
        generatedAt: dateStart(p["Generated At"]),
        content,
        citations,
      });
    }

    return {
      summaries,
      totalSummaries: summaries.length,
      squad,
      weekOf,
      nonProductApprovalRate,
      nonProductQuorumMet,
    };
  },
});

// ── Tool 2: begin_summary ─────────────────────────────────────────────────────
//
// Called after the quorum check passes, before composing content. Flips the
// pre-seeded placeholder row from "pending" → "generating-review" so the row
// shows live status in Notion while the agent reasons.
//
// Returns { started: true } when the flip succeeded.
// Returns { started: false, currentStatus } when the row is already in progress
// or done — the agent should exit to avoid duplicate work.

worker.tool("begin_summary", {
  title: "Begin Summary Generation",
  description:
    "Mark a Squad Weekly Summary row as 'generating-review' before composing content. " +
    "Call this after read_squad_summaries confirms nonProductQuorumMet=true, " +
    "before reading roadmap or PRD rows. " +
    "If started=false the row is already being processed or complete — stop immediately.",
  schema: j.object({
    squad:  j.enum("atlas", "lumen", "forge").describe("Squad this summary belongs to"),
    source: j.enum("roadmap", "prd-fact-check").describe("Product analysis type"),
    weekOf: j.string().describe("Week identifier, e.g. 2026-W21"),
  }),
  execute: async ({ squad, source, weekOf }, { notion }) => {
    const squadPageId = SQUAD_PAGE_ID[squad as Squad];
    const weekDate    = weekOfToDate(weekOf);

    const existing = await notion.databases.query({
      database_id: SQUAD_WEEKLY_SUMMARY_DB,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: squadPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
          { property: "Source",  select:   { equals: source } },
        ],
      },
      page_size: 5,
    });

    if (existing.results.length === 0) {
      return { started: false, reason: "row not found", currentStatus: null, pageId: null, squad, source, weekOf };
    }

    const page = existing.results[0];
    if (!isFullPage(page)) {
      return { started: false, reason: "row not full page", currentStatus: null, pageId: null, squad, source, weekOf };
    }

    const currentStatus = selectName((page.properties as Record<string, unknown>)["Status"]);

    // Only flip from "pending" — any other status means another run is in progress or done
    if (currentStatus !== "pending") {
      return { started: false, reason: "already processed", currentStatus, pageId: null, squad, source, weekOf };
    }

    await notion.pages.update({
      page_id: page.id,
      properties: {
        "Status": { select: { name: "generating-review" } },
      } as Parameters<typeof notion.pages.update>[0]["properties"],
    });

    return { started: true, reason: null, currentStatus: "generating-review", pageId: page.id, squad, source, weekOf };
  },
});

// ── Tool 3: read_roadmap_rows ─────────────────────────────────────────────────
//
// Returns every Product Roadmap row owned by the given squad.
// notionPageId is the citation target for roadmap-level claims.

worker.tool("read_roadmap_rows", {
  title: "Read Roadmap Rows",
  description:
    "Return all Product Roadmap rows owned by the given squad. " +
    "notionPageId is the citation target when your summary references a roadmap initiative.",
  hints: { readOnlyHint: true },
  schema: j.object({
    squad: j.enum("atlas", "lumen", "forge").describe("Squad whose roadmap rows to return"),
  }),
  execute: async ({ squad }, { notion }) => {
    const squadPageId = SQUAD_PAGE_ID[squad as Squad];

    const response = await notion.databases.query({
      database_id: PRODUCT_ROADMAP_DB,
      filter: {
        property: "Owning Squad",
        relation: { contains: squadPageId },
      },
      page_size: 50,
    });

    const rows = response.results.filter(isFullPage).map((page) => {
      const p = page.properties as Record<string, unknown>;
      return {
        notionPageId:  page.id,
        title:         richText(p["Title"]),
        status:        selectName(p["Status"]),
        targetQuarter: selectName(p["Target Quarter"]),
        notes:         richText(p["Notes"]),
      };
    });

    return { rows, totalRows: rows.length, squad };
  },
});

// ── Tool 4: read_prd_rows ─────────────────────────────────────────────────────
//
// Returns all PRD rows for the given squad with their acceptance criteria.
// The acceptance criteria are extracted from the page body (numbered list items
// under the "Acceptance Criteria" heading).
// notionPageId is the citation target for PRD-level claims.

worker.tool("read_prd_rows", {
  title: "Read PRD Rows",
  description:
    "Return all PRDs for the given squad, including the acceptance criteria extracted " +
    "from each PRD page body. notionPageId is the citation target when your fact-check " +
    "references a specific PRD criterion.",
  hints: { readOnlyHint: true },
  schema: j.object({
    squad: j.enum("atlas", "lumen", "forge").describe("Squad whose PRDs to return"),
  }),
  execute: async ({ squad }, { notion }) => {
    const squadPageId = SQUAD_PAGE_ID[squad as Squad];

    const response = await notion.databases.query({
      database_id: PRDS_DB,
      filter: {
        property: "Squad",
        relation: { contains: squadPageId },
      },
      page_size: 20,
    });

    const prds = [];
    for (const page of response.results.filter(isFullPage)) {
      const p      = page.properties as Record<string, unknown>;
      const title  = richText(p["Title"]);
      const status = selectName(p["Status"]);

      // Extract acceptance criteria from page body
      const blocklist = await notion.blocks.children.list({ block_id: page.id });
      const acs: string[] = [];
      let inAcSection = false;

      for (const block of blocklist.results) {
        if (!("type" in block)) continue;
        const b = block as { type: string } & Record<string, unknown>;

        if (b.type === "heading_2") {
          const heading = blockText((b.heading_2 as Record<string, unknown>)?.rich_text);
          inAcSection = heading === "Acceptance Criteria";
        } else if (inAcSection && b.type === "numbered_list_item") {
          const text = blockText((b.numbered_list_item as Record<string, unknown>)?.rich_text);
          if (text) acs.push(text);
        } else if (inAcSection && b.type === "divider") {
          break; // end of AC section
        }
      }

      prds.push({ notionPageId: page.id, title, status, acceptanceCriteria: acs });
    }

    return { prds, totalPrds: prds.length, squad };
  },
});

// ── Tool 5: write_squad_summary ───────────────────────────────────────────────
//
// Identical contract to the per-source worker's write_squad_summary, but:
//   - source enum is "roadmap" | "prd-fact-check"
//   - Section headings are source-appropriate (On Track / At Risk / … for roadmap;
//     PRD Aligned / … / Flags & Drift / … for prd-fact-check)
//   - Agent Run Log entry is tagged summarizer.roadmap.<squad> or summarizer.prdcheck.<squad>
//
// Citations can reference:
//   - A Product Roadmap row notionPageId (from read_roadmap_rows)
//   - A PRD row notionPageId (from read_prd_rows)
//   - A Squad Weekly Summary row notionPageId (from read_squad_summaries) — cascade citation

worker.tool("write_squad_summary", {
  title: "Write Squad Summary",
  description:
    "Upsert a Squad Weekly Summary row for source=roadmap or source=prd-fact-check. " +
    "Replaces body with structured sections using source-appropriate headings. " +
    "Set Status to 'awaiting-review', or 'approved' when citations is empty " +
    "(PRD aligned — auto-approve).",
  schema: j.object({
    squad:       j.enum("atlas", "lumen", "forge").describe("Squad this summary belongs to"),
    source:      j.enum("roadmap", "prd-fact-check").describe("Product analysis type"),
    weekOf:      j.string().describe("Week identifier, e.g. 2026-W21"),
    section1:    j.string().describe("On Track (roadmap) or PRD Aligned (prd-fact-check)"),
    section2:    j.string().describe("At Risk (roadmap) or In Progress vs PRD (prd-fact-check)"),
    section3:    j.string().describe("No Movement (roadmap) or Flags & Drift (prd-fact-check)"),
    section4:    j.string().describe("Off-Plan Activity (roadmap) or Observations (prd-fact-check)"),
    citations: j
      .array(
        j.object({
          recordId:  j.string().describe("notionPageId — roadmap row, PRD row, or upstream summary row"),
          sourceUrl: j.string().describe("URL or empty string for internal Notion references"),
          claim:     j.string().describe("Verbatim factual sentence this citation supports"),
        }),
      )
      .describe(
        "One entry per factual sentence. Empty only when no issues found (PRD Fact Check) " +
        "or no activity (Roadmap) — causes auto-approval.",
      ),
  }),
  execute: async (
    { squad, source, weekOf, section1, section2, section3, section4, citations },
    { notion },
  ) => {
    const squadPageId   = SQUAD_PAGE_ID[squad as Squad];
    const weekDate      = weekOfToDate(weekOf);
    const startedAt     = new Date();
    const generatedAt   = startedAt.toISOString();
    const citationsJson = JSON.stringify(citations);
    const noActivity    = citations.length === 0;
    const status        = noActivity ? "approved" : "awaiting-review";
    const squadName     = squad.charAt(0).toUpperCase() + squad.slice(1);

    const [h1, h2h, h3, h4] = SECTION_LABELS[source as ProductSource];

    // Agent Run Log name: summarizer.roadmap.atlas, summarizer.prdcheck.forge, etc.
    const agentSlug = source === "roadmap"
      ? `summarizer.roadmap.${squad}`
      : `summarizer.prdcheck.${squad}`;

    // Find existing placeholder row (seeded by HITL worker or a prior run)
    const existing = await notion.databases.query({
      database_id: SQUAD_WEEKLY_SUMMARY_DB,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: squadPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
          { property: "Source",  select:   { equals: source } },
        ],
      },
    });

    const blocks = [
      {
        type: "callout" as const,
        callout: {
          rich_text: rt(
            `Generated by ${agentSlug} · Week ${weekOf} · ${citations.length} citation${citations.length === 1 ? "" : "s"}`,
          ),
          color: "purple_background" as const,
        },
      },
      { type: "divider" as const, divider: {} },
      { type: "heading_2" as const, heading_2: { rich_text: rt(h1) } },
      { type: "paragraph"  as const, paragraph:  { rich_text: rt(section1) } },
      { type: "divider" as const, divider: {} },
      { type: "heading_2" as const, heading_2: { rich_text: rt(h2h) } },
      { type: "paragraph"  as const, paragraph:  { rich_text: rt(section2) } },
      { type: "divider" as const, divider: {} },
      { type: "heading_2" as const, heading_2: { rich_text: rt(h3) } },
      { type: "paragraph"  as const, paragraph:  { rich_text: rt(section3) } },
      { type: "divider" as const, divider: {} },
      { type: "heading_2" as const, heading_2: { rich_text: rt(h4) } },
      { type: "paragraph"  as const, paragraph:  { rich_text: rt(section4) } },
    ];

    let pageId: string;
    let action: "created" | "updated";

    if (existing.results.length === 0) {
      const page = await notion.pages.create({
        parent: { database_id: SQUAD_WEEKLY_SUMMARY_DB },
        properties: {
          "Title":        { title: rt(`${squadName} / ${source} — ${weekOf}`) },
          "Squad":        { relation: [{ id: squadPageId }] },
          "Week Of":      { date: { start: weekDate } },
          "Source":       { select: { name: source } },
          "Citations":    { rich_text: rt(citationsJson) },
          "Status":       { select: { name: status } },
          "Generated At": { date: { start: generatedAt } },
        } as Parameters<typeof notion.pages.create>[0]["properties"],
      });
      pageId = page.id;
      action = "created";
    } else {
      pageId = existing.results[0].id;
      action = "updated";

      // Clear old blocks before rewriting
      let cursor: string | undefined;
      do {
        const childList = await notion.blocks.children.list({
          block_id: pageId,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        for (const block of childList.results) {
          await notion.blocks.delete({ block_id: block.id });
        }
        cursor = childList.has_more ? (childList.next_cursor ?? undefined) : undefined;
      } while (cursor);

      await notion.pages.update({
        page_id: pageId,
        properties: {
          "Citations":    { rich_text: rt(citationsJson) },
          "Status":       { select: { name: status } },
          "Generated At": { date: { start: generatedAt } },
          "Approved By":  { rich_text: rt("") },
        } as Parameters<typeof notion.pages.update>[0]["properties"],
      });
    }

    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks as Parameters<typeof notion.blocks.children.append>[0]["children"],
    });

    // Agent Run Log entry for observability
    const completedAt = new Date();
    await notion.pages.create({
      parent: { database_id: AGENT_RUN_LOG_DB },
      properties: {
        "Run Id":       { title: rt(`${agentSlug}-${startedAt.toISOString()}`) },
        "Agent Name":   { select: { name: agentSlug } },
        "Started At":   { date: { start: startedAt.toISOString() } },
        "Completed At": { date: { start: completedAt.toISOString() } },
        "Duration ms":  { number: completedAt.getTime() - startedAt.getTime() },
        "Outcome":      { select: { name: "ok" } },
        "Notes": {
          rich_text: rt(
            `week=${weekOf} citations=${citations.length} action=${action} status=${status}`,
          ),
        },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });

    return { pageId, action, citationCount: citations.length, status, agentSlug };
  },
});
