import { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { isFullPage } from "@notionhq/client";

const worker = new Worker();
export default worker;

// ── Stable workspace IDs ──────────────────────────────────────────────────────

const SQUAD_PAGE_ID: Record<Squad, string> = {
  atlas: "36efc8f4-554c-81e7-a83b-c976963a5fab",
  lumen: "36efc8f4-554c-81b6-8583-dd3634f0e7ad",
  forge: "36efc8f4-554c-8102-b02e-d9def2d4a4da",
};

const SQUAD_WEEKLY_SUMMARY_DB = "36efc8f4-554c-819e-b339-ec0bb2c97a76";
const MASTER_EPD_WEEKLY_DB    = "36efc8f4-554c-8158-808b-d084ce4c4a16";
const AGENT_RUN_LOG_DB        = "36efc8f4-554c-814e-8c51-ea51792f5344";

type Squad = "atlas" | "lumen" | "forge";
const ALL_SQUADS: Squad[] = ["atlas", "lumen", "forge"];

// ── Helpers ───────────────────────────────────────────────────────────────────

const rt = (s: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += 1999) {
    chunks.push({ type: "text", text: { content: s.slice(i, i + 1999) } });
  }
  return chunks.length > 0 ? chunks : [{ type: "text" as const, text: { content: "" } }];
};

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

function blockText(richTextArr: unknown): string {
  if (!Array.isArray(richTextArr)) return "";
  return (richTextArr as Array<{ plain_text?: string }>).map((t) => t.plain_text ?? "").join("");
}

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

// ── Tool 1: read_approved_summaries ───────────────────────────────────────────
//
// Returns all Squad Weekly Summary rows for the given week, grouped by squad.
// A squad is "fully approved" when every one of its 6 source rows has Status=approved.
// The agent uses this to determine quorum and to gather synthesis material.

worker.tool("read_approved_summaries", {
  title: "Read Approved Summaries",
  description:
    "Return all Squad Weekly Summary rows for a given week, grouped by squad. " +
    "Each squad entry lists its source summaries with page content and upstream citations. " +
    "The 'approvedSquadSlugs' field indicates which squads have all 6 source rows approved — " +
    "use this to determine quorum (≥2 required to publish) before calling write_master_summary.",
  hints: { readOnlyHint: true },
  schema: j.object({
    weekOf: j.string().describe("Week identifier, e.g. 2026-W21"),
  }),
  execute: async ({ weekOf }, { notion }) => {
    const weekDate = weekOfToDate(weekOf);

    const response = await notion.databases.query({
      database_id: SQUAD_WEEKLY_SUMMARY_DB,
      filter: {
        property: "Week Of",
        date: { equals: weekDate },
      },
      page_size: 100,
    });

    const EXPECTED_SOURCES = new Set(["github", "jira", "slack", "figma", "roadmap", "prd-fact-check"]);

    type SummaryEntry = {
      notionPageId: string;
      source: string;
      status: string;
      content: string;
      citations: Array<{ recordId: string; sourceUrl: string; claim: string }>;
    };

    const bySquad: Record<Squad, SummaryEntry[]> = {
      atlas: [], lumen: [], forge: [],
    };

    for (const page of response.results.filter(isFullPage)) {
      const p = page.properties as Record<string, unknown>;
      const source = selectName(p["Source"]);
      if (!EXPECTED_SOURCES.has(source)) continue;

      // Determine which squad this belongs to by checking the relation
      const squadRel = p["Squad"] as { relation?: Array<{ id: string }> } | undefined;
      const squadIds = squadRel?.relation?.map((r) => r.id) ?? [];
      const matchedSquad = ALL_SQUADS.find((sq) => squadIds.includes(SQUAD_PAGE_ID[sq]));
      if (!matchedSquad) continue;

      // Reconstruct page body
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

      const content = Object.entries(sections).map(([h, t]) => `## ${h}\n${t}`).join("\n\n");

      const citationsJson = richText(p["Citations"]);
      let citations: Array<{ recordId: string; sourceUrl: string; claim: string }> = [];
      try { citations = JSON.parse(citationsJson || "[]"); } catch { citations = []; }

      bySquad[matchedSquad].push({
        notionPageId: page.id,
        source,
        status: selectName(p["Status"]),
        content,
        citations,
      });
    }

    // A squad is fully approved when all expected sources are present AND all are approved.
    const approvedSquadSlugs = ALL_SQUADS.filter((sq) => {
      const rows = bySquad[sq];
      const sources = new Set(rows.map((r) => r.source));
      const allPresent = [...EXPECTED_SOURCES].every((s) => sources.has(s));
      const allApproved = rows.every((r) => r.status === "approved");
      return allPresent && allApproved;
    });

    return {
      squads: bySquad,
      approvedSquadSlugs,
      quorumMet: approvedSquadSlugs.length >= 2,
      weekOf,
    };
  },
});

// ── Tool 2: write_master_summary ──────────────────────────────────────────────
//
// Creates or updates the Master EPD Weekly row for the given week.
//
// Quorum rules (enforced here so the agent cannot accidentally bypass them):
//   approvedSquads.length >= 2  → publish row (with provisional markers for missing squads)
//   approvedSquads.length <= 1  → do NOT publish; write outcome=skipped run log and return
//
// The body is structured as:
//   [callout] Executive Summary
//   ## Highlights
//   ## Risks & Blockers
//   ## Cross-Squad Dependencies
//   ## Roadmap Movement
//   ## Open Discrepancies
//   [callout] Conflict-Resolution Policy (editable)

worker.tool("write_master_summary", {
  title: "Write Master Summary",
  description:
    "Create or update the Master EPD Weekly row for the given week. " +
    "Enforces quorum: ≤1 approved squad → writes outcome=skipped log and returns without publishing. " +
    "≥2 approved → publishes with provisional markers for unapproved squads. " +
    "Upserts are idempotent — re-running overwrites the existing row body.",
  schema: j.object({
    weekOf:            j.string().describe("Week identifier, e.g. 2026-W21"),
    approvedSquads:    j
      .array(j.enum("atlas", "lumen", "forge"))
      .describe("Squads whose summaries are fully approved this week"),
    executiveSummary:  j.string().describe("≤200 words — one-paragraph VP-level summary of the week"),
    highlights:        j.string().describe("Markdown — shipped work across all squads worth calling out"),
    risksBlockers:     j.string().describe("Markdown — cross-squad risks, hard blockers, open items"),
    crossSquadDeps:    j.string().describe("Markdown — explicit dependencies between squads this week"),
    roadmapMovement:   j.string().describe("Markdown — initiative progress vs. plan; at-risk initiatives"),
    openDiscrepancies: j.string().describe("Markdown — planted tensions and data-source conflicts surfaced"),
    conflictPolicy:    j
      .string()
      .describe(
        "Markdown — the four conflict-resolution rules displayed in a callout at the bottom " +
        "(Jira wins for status; GitHub wins for code truth; Figma wins for newer design decisions; " +
        "Slack is signal only, never authoritative)",
      ),
    citationCoveragePct: j
      .number()
      .describe(
        "Percentage of factual sentences in the body that have a citation entry " +
        "(computed by agent as cited_sentences / total_factual_sentences × 100). AC2 requires ≥85.",
      ),
    citations: j
      .array(
        j.object({
          recordId:  j.string().describe("notionPageId of the Squad Weekly Summary row being cited"),
          sourceUrl: j.string().describe("Upstream source URL from that summary's citation chain, or empty"),
          claim:     j.string().describe("Verbatim factual sentence this citation supports"),
        }),
      )
      .describe(
        "One entry per factual sentence in the body that names a specific event, metric, or decision. " +
        "AC2 requires coverage ≥85%. Cascade citation: Squad Summary → Mirror row → source URL.",
      ),
  }),
  execute: async (
    {
      weekOf, approvedSquads, executiveSummary, highlights,
      risksBlockers, crossSquadDeps, roadmapMovement,
      openDiscrepancies, conflictPolicy, citationCoveragePct, citations,
    },
    { notion },
  ) => {
    const startedAt  = new Date();
    const weekDate   = weekOfToDate(weekOf);
    const allSquads: Squad[] = ["atlas", "lumen", "forge"];
    const unapprovedSquads   = allSquads.filter((s) => !(approvedSquads as string[]).includes(s));

    // ── Quorum check: ≤1 approved → skip ─────────────────────────────────────
    if (approvedSquads.length <= 1) {
      const completedAt = new Date();
      await notion.pages.create({
        parent: { database_id: AGENT_RUN_LOG_DB },
        properties: {
          "Run Id":       { title: rt(`summarizer.master-${weekOf}-skipped-${startedAt.toISOString()}`) },
          "Agent Name":   { select: { name: "summarizer.master" } },
          "Started At":   { date: { start: startedAt.toISOString() } },
          "Completed At": { date: { start: completedAt.toISOString() } },
          "Duration ms":  { number: completedAt.getTime() - startedAt.getTime() },
          "Outcome":      { select: { name: "skipped" } },
          "Notes": {
            rich_text: rt(
              `week=${weekOf} approved=${approvedSquads.join(",")} reason=below-quorum(need>=2,got=${approvedSquads.length})`,
            ),
          },
        } as Parameters<typeof notion.pages.create>[0]["properties"],
      });
      return {
        skipped: true,
        reason: "below-quorum",
        approvedCount: approvedSquads.length,
        quorumRequired: 2,
        pageId: null,
        action: null,
        unapprovedSquads: null,
        quorumFull: null,
        citationCoveragePct: null,
        citationCount: null,
      };
    }

    // ── Build provisional header if any squad is unapproved ───────────────────
    const provisionalNote = unapprovedSquads.length > 0
      ? `\n\n⚠ Provisional — the following squad(s) had not completed HITL review at publish time: **${unapprovedSquads.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ")}**. Their data is absent from this digest. Full report will be re-issued once approved.`
      : "";

    const approvedSquadIds = (approvedSquads as Squad[]).map((sq) => ({ id: SQUAD_PAGE_ID[sq] }));

    // ── Find or create the Master EPD Weekly row ──────────────────────────────
    const existing = await notion.databases.query({
      database_id: MASTER_EPD_WEEKLY_DB,
      filter: { property: "Week Of", date: { equals: weekDate } },
      page_size: 5,
    });

    let pageId: string;
    let action: "created" | "updated";

    const props = {
      "Title":                { title: rt(`EPD Weekly — ${weekOf}`) },
      "Week Of":              { date: { start: weekDate } },
      "Quorum Met":           { checkbox: approvedSquads.length === 3 },
      "Citation Coverage %":  { number: Math.round(citationCoveragePct * 10) / 10 },
      "Squads Approved":      { relation: approvedSquadIds },
      "Status":               { select: { name: "awaiting-VP" } },
    } as Parameters<typeof notion.pages.create>[0]["properties"];

    if (existing.results.length === 0) {
      const page = await notion.pages.create({
        parent: { database_id: MASTER_EPD_WEEKLY_DB },
        properties: props,
      });
      pageId = page.id;
      action = "created";
    } else {
      pageId = existing.results[0].id;
      action = "updated";

      // Clear existing blocks before rewriting
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

      await notion.pages.update({ page_id: pageId, properties: props });
    }

    // ── Write body blocks ─────────────────────────────────────────────────────
    const blocks: Parameters<typeof notion.blocks.children.append>[0]["children"] = [
      // Executive Summary callout (prominent at top — what the VP reads first)
      {
        type: "callout",
        callout: {
          rich_text: rt(executiveSummary + provisionalNote),
          color: "blue_background",
        },
      },
      { type: "divider", divider: {} },

      { type: "heading_2", heading_2: { rich_text: rt("Highlights") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(highlights) } },
      { type: "divider", divider: {} },

      { type: "heading_2", heading_2: { rich_text: rt("Risks & Blockers") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(risksBlockers) } },
      { type: "divider", divider: {} },

      { type: "heading_2", heading_2: { rich_text: rt("Cross-Squad Dependencies") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(crossSquadDeps) } },
      { type: "divider", divider: {} },

      { type: "heading_2", heading_2: { rich_text: rt("Roadmap Movement") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(roadmapMovement) } },
      { type: "divider", divider: {} },

      { type: "heading_2", heading_2: { rich_text: rt("Open Discrepancies") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(openDiscrepancies) } },
      { type: "divider", divider: {} },

      // Conflict-resolution policy callout — editable by SE per PRD-05 design
      {
        type: "callout",
        callout: {
          rich_text: rt("Conflict-Resolution Policy (Editable — see SE for changes)\n\n" + conflictPolicy),
          color: "yellow_background",
        },
      },

      // Observability footer
      {
        type: "callout",
        callout: {
          rich_text: rt(
            `Generated by summarizer.master · Week ${weekOf} · ` +
            `Squads approved: ${approvedSquads.join(", ")} · ` +
            `Citation coverage: ${Math.round(citationCoveragePct)}% · ` +
            `${citations.length} citation${citations.length === 1 ? "" : "s"}`,
          ),
          color: "gray_background",
        },
      },
    ] as Parameters<typeof notion.blocks.children.append>[0]["children"];

    await notion.blocks.children.append({ block_id: pageId, children: blocks });

    // ── Agent Run Log ─────────────────────────────────────────────────────────
    const completedAt = new Date();
    await notion.pages.create({
      parent: { database_id: AGENT_RUN_LOG_DB },
      properties: {
        "Run Id":       { title: rt(`summarizer.master-${startedAt.toISOString()}`) },
        "Agent Name":   { select: { name: "summarizer.master" } },
        "Started At":   { date: { start: startedAt.toISOString() } },
        "Completed At": { date: { start: completedAt.toISOString() } },
        "Duration ms":  { number: completedAt.getTime() - startedAt.getTime() },
        "Outcome":      { select: { name: "ok" } },
        "Notes": {
          rich_text: rt(
            `week=${weekOf} action=${action} ` +
            `approved=${approvedSquads.join(",")} ` +
            `citations=${citations.length} ` +
            `coverage=${Math.round(citationCoveragePct)}% ` +
            `status=awaiting-VP`,
          ),
        },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });

    return {
      skipped: false,
      reason: null,
      approvedCount: approvedSquads.length,
      quorumRequired: 2,
      pageId,
      action,
      unapprovedSquads,
      quorumFull: approvedSquads.length === 3,
      citationCoveragePct: Math.round(citationCoveragePct * 10) / 10,
      citationCount: citations.length,
    };
  },
});
