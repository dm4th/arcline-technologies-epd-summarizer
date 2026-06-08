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

const SQUAD_WEEKLY_SUMMARY_DB  = "36efc8f4-554c-819e-b339-ec0bb2c97a76";
const HITL_REVIEW_SESSIONS_DB  = "370fc8f4-554c-8113-a6dd-f893a84555ff";
const AGENT_RUN_LOG_DB         = "36efc8f4-554c-814e-8c51-ea51792f5344";

// All sources the agent expects to see before declaring quorum
const ALL_SOURCES = ["github", "jira", "slack", "figma", "roadmap", "prd-fact-check"] as const;

type Squad = "atlas" | "lumen" | "forge";

// ── Helpers ───────────────────────────────────────────────────────────────────

const rt = (s: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += 1999)
    chunks.push({ type: "text", text: { content: s.slice(i, i + 1999) } });
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

// Reads the Sub-Summary Approval Rate rollup (average of Approval Rate 0/1 formula).
// Returns 0-1 fraction; treat >= 0.999 as 100%.
function rollupAverage(prop: unknown): number | null {
  if (!prop || typeof prop !== "object") return null;
  const p = prop as Record<string, unknown>;
  if (p.type !== "rollup") return null;
  const r = p.rollup as Record<string, unknown> | undefined;
  if (!r || r.type !== "number" || typeof r.number !== "number") return null;
  return r.number;
}

function blockText(arr: unknown): string {
  if (!Array.isArray(arr)) return "";
  return (arr as Array<{ plain_text?: string }>).map((t) => t.plain_text ?? "").join("");
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

// ── Tool 1: read_source_summaries ─────────────────────────────────────────────
//
// Returns all Squad Weekly Summary rows for a squad+week, plus the current
// Sources Approved count from the HITL Review Sessions row.
//
// The agent uses sourcesApproved to self-gate: if sourcesApproved < QUORUM (6),
// it should call write_squad_consolidation with skip=true and stop. Otherwise
// it proceeds to synthesize.

worker.tool("read_source_summaries", {
  title: "Read Source Summaries",
  description:
    "Return all Squad Weekly Summary rows for a squad and week, plus the Sources Approved " +
    "count from the HITL Review Sessions row. " +
    "Check quorumMet (Sub-Summary Approval Rate = 1.0) before synthesizing — if not met, " +
    "stop and do not call write_squad_consolidation.",
  hints: { readOnlyHint: true },
  schema: j.object({
    squad:  j.enum("atlas", "lumen", "forge").describe("Squad to consolidate"),
    weekOf: j.string().describe("Week identifier, e.g. 2026-W21"),
  }),
  execute: async ({ squad, weekOf }, { notion }) => {
    const squadPageId = SQUAD_PAGE_ID[squad as Squad];
    const weekDate    = weekOfToDate(weekOf);

    // Get HITL Review Sessions row to read Sources Approved and the session page ID
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

    const sessionPage = sessionResp.results.filter(isFullPage)[0];
    const reviewSessionId = sessionPage?.id ?? null;

    // Read Sub-Summary Approval Rate rollup (average of Approval Rate 0/1 across Squad Weekly Summaries).
    // This is always current regardless of whether approval came from the UI button or the CLI.
    const subSummaryApprovalRate =
      sessionPage ? rollupAverage(sessionPage.properties["Sub-Summary Approval Rate"]) : null;

    // Read all Squad Weekly Summary rows for this squad+week
    const summaryResp = await notion.databases.query({
      database_id: SQUAD_WEEKLY_SUMMARY_DB,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: squadPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
        ],
      },
      page_size: 20,
    });

    const summaries = [];
    for (const page of summaryResp.results.filter(isFullPage)) {
      const p      = page.properties as Record<string, unknown>;
      const source = selectName(p["Source"]);
      const status = selectName(p["Status"]);

      // Reconstruct page body sections
      const blocklist = await notion.blocks.children.list({ block_id: page.id });
      const sections: Record<string, string> = {};
      let currentHeading = "";
      for (const block of blocklist.results) {
        if (!("type" in block)) continue;
        const b = block as { type: string } & Record<string, unknown>;
        if (b.type === "heading_2")
          currentHeading = blockText((b.heading_2 as Record<string, unknown>)?.rich_text);
        else if (b.type === "paragraph" && currentHeading) {
          const text = blockText((b.paragraph as Record<string, unknown>)?.rich_text);
          if (text) sections[currentHeading] = text;
        }
      }
      const content = Object.entries(sections).map(([h, t]) => `## ${h}\n${t}`).join("\n\n");

      const citationsJson = richText(p["Citations"]);
      let citations: Array<{ recordId: string; sourceUrl: string; claim: string }> = [];
      try { citations = JSON.parse(citationsJson || "[]"); } catch { citations = []; }

      summaries.push({ notionPageId: page.id, source, status, content, citations });
    }

    return {
      squad,
      weekOf,
      subSummaryApprovalRate,
      quorumMet: subSummaryApprovalRate !== null && subSummaryApprovalRate >= 0.999,
      reviewSessionId,
      summaries,
    };
  },
});

// ── Tool 2: begin_consolidation ───────────────────────────────────────────────
//
// Called after quorum is confirmed, before composing the squad narrative. Flips
// the HITL Review Sessions row from "pending" → "generating-summary" so the row
// shows live status in Notion while the agent reasons.
//
// Returns { started: true } when the flip succeeded (row was "pending").
// Returns { started: false, currentStatus } when the row is already in progress
// or done — the agent should stop immediately to avoid duplicate work.

worker.tool("begin_consolidation", {
  title: "Begin Squad Consolidation",
  description:
    "Mark the HITL Review Sessions row as 'generating-summary' before composing the squad narrative. " +
    "Call this immediately after read_source_summaries confirms quorumMet=true, " +
    "before synthesizing any content. " +
    "If started=false the row is already being processed or done — stop immediately.",
  schema: j.object({
    squad:  j.enum("atlas", "lumen", "forge").describe("Squad to consolidate"),
    weekOf: j.string().describe("Week identifier, e.g. 2026-W21"),
  }),
  execute: async ({ squad, weekOf }, { notion }) => {
    const squadPageId = SQUAD_PAGE_ID[squad as Squad];
    const weekDate    = weekOfToDate(weekOf);

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

    if (sessionResp.results.length === 0) {
      return {
        started: false, reason: "row not found",
        currentStatus: null, sessionId: null, squad, weekOf,
      };
    }

    const page = sessionResp.results[0];
    if (!isFullPage(page)) {
      return {
        started: false, reason: "row not full page",
        currentStatus: null, sessionId: null, squad, weekOf,
      };
    }

    const currentStatus = selectName((page.properties as Record<string, unknown>)["Status"]);

    // Only flip from "pending" — any other status means another run is in progress or done
    if (currentStatus !== "pending") {
      return {
        started: false, reason: "already processed",
        currentStatus, sessionId: null, squad, weekOf,
      };
    }

    await notion.pages.update({
      page_id: page.id,
      properties: {
        "Status": { select: { name: "generating-summary" } },
      } as Parameters<typeof notion.pages.update>[0]["properties"],
    });

    return {
      started: true, reason: null,
      currentStatus: "generating-summary", sessionId: page.id, squad, weekOf,
    };
  },
});

// ── Tool 3: write_squad_consolidation ─────────────────────────────────────────
//
// Writes the consolidated squad narrative to the HITL Review Sessions page body
// and updates Status to "awaiting-squad-review".
//
// Quorum gate (enforced here as a second check):
//   sourcesApproved < quorum  → write outcome=skipped run log, return { skipped: true }
//   sourcesApproved >= quorum → write consolidation, return { skipped: false }
//
// The consolidation sections map to the master summarizer's input sections —
// the master reads these page bodies directly when generating the EPD Weekly.

worker.tool("write_squad_consolidation", {
  title: "Write Squad Consolidation",
  description:
    "Write the consolidated squad narrative to the HITL Review Sessions page body. " +
    "Call this only after begin_consolidation returns started=true. " +
    "Enforces quorum as a second check: Sub-Summary Approval Rate < 1.0 → writes outcome=skipped and returns. " +
    "= 1.0 → writes consolidation and sets Status to 'awaiting-squad-review'. " +
    "Idempotent — re-running overwrites the existing page body.",
  schema: j.object({
    squad:             j.enum("atlas", "lumen", "forge"),
    weekOf:            j.string().describe("Week identifier, e.g. 2026-W21"),
    sourcesApproved:   j.number().describe("Count of approved sources (for display in observability footer)"),
    executiveSummary:  j.string().describe("≤150 words — squad-level summary for the VP digest"),
    highlights:        j.string().describe("Markdown — what shipped this week across all sources"),
    keyReleases:       j.string().describe(
      "Markdown — bulleted, customer-facing rollup of the squad's Key Releases sections " +
      "from its 4 approved per-source summaries (github/jira/slack/figma). No ticket/PR " +
      "numbers. Use '(no releases this week)' if all 4 sources reported none. This is the " +
      "EM-reviewed source of truth the GTM pipeline reads — not a separate side-channel write " +
      "(PRD-17 redesign).",
    ),
    risksBlockers:     j.string().describe("Markdown — blockers, risks, open questions"),
    crossSquadDeps:    j.string().describe("Markdown — dependencies on or from other squads"),
    openFlags:         j.string().describe("Markdown — [BLOCK]/[WARN] flags from prd-fact-check, design reversals, data conflicts"),
    citationCoveragePct: j.number().describe("Cited sentences / total factual sentences × 100. AC requires ≥85."),
    citations: j.array(
      j.object({
        recordId:  j.string().describe("notionPageId of the Squad Weekly Summary row being cited"),
        sourceUrl: j.string().describe("Upstream source URL from that row's citation chain, or empty"),
        claim:     j.string().describe("Verbatim sentence this citation supports"),
      }),
    ).describe("One entry per factual sentence. Empty only if all sources had zero activity."),
  }),
  execute: async (
    { squad, weekOf, sourcesApproved, executiveSummary, highlights, keyReleases,
      risksBlockers, crossSquadDeps, openFlags, citationCoveragePct, citations },
    { notion },
  ) => {
    const startedAt   = new Date();
    const squadPageId = SQUAD_PAGE_ID[squad as Squad];
    const weekDate    = weekOfToDate(weekOf);
    const squadName   = squad.charAt(0).toUpperCase() + squad.slice(1);
    const agentSlug   = `summarizer.squad-consolidation.${squad}`;

    // ── Re-read Sub-Summary Approval Rate rollup as the authoritative quorum gate ──
    // Decouples quorum from a hardcoded source count — rollup adjusts automatically
    // if sources are added/removed, and is accurate for both UI-button and CLI approvals.
    const sessionCheck = await notion.databases.query({
      database_id: HITL_REVIEW_SESSIONS_DB,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: squadPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
        ],
      },
      page_size: 5,
    });
    const sessionCheckPage = sessionCheck.results.filter(isFullPage)[0];
    const subSummaryApprovalRate = sessionCheckPage
      ? rollupAverage(sessionCheckPage.properties["Sub-Summary Approval Rate"])
      : null;

    // ── Quorum gate ───────────────────────────────────────────────────────────
    if (subSummaryApprovalRate === null || subSummaryApprovalRate < 0.999) {
      const completedAt = new Date();
      await notion.pages.create({
        parent: { database_id: AGENT_RUN_LOG_DB },
        properties: {
          "Run Id":       { title: rt(`${agentSlug}-${weekOf}-skipped-${startedAt.toISOString()}`) },
          "Agent Name":   { select: { name: agentSlug } },
          "Started At":   { date: { start: startedAt.toISOString() } },
          "Completed At": { date: { start: completedAt.toISOString() } },
          "Duration ms":  { number: completedAt.getTime() - startedAt.getTime() },
          "Outcome":      { select: { name: "skipped" } },
          "Notes":        { rich_text: rt(`week=${weekOf} squad=${squad} reason=below-quorum(subSummaryApprovalRate=${subSummaryApprovalRate ?? "null"},need=1.0)`) },
        } as Parameters<typeof notion.pages.create>[0]["properties"],
      });
      return {
        skipped: true, reason: "below-quorum",
        sourcesApproved, subSummaryApprovalRate,
        reviewSessionId: null, action: null,
        citationCoveragePct: null, citationCount: null,
      };
    }

    // ── Find the HITL Review Sessions row ─────────────────────────────────────
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

    if (sessionResp.results.length === 0) {
      throw new Error(
        `No HITL Review Sessions row found for ${squad}/${weekOf}. ` +
        `Run seed first: pnpm hitl-review --action=seed --squad=${squad} --week=${weekOf}`,
      );
    }

    const sessionId      = sessionResp.results[0].id;

    // ── Idempotency gate: first writer wins ───────────────────────────────────
    // Multiple agent triggers can all pass the rollup gate before any write
    // lands. `Consolidated At` is the write-side lock — it is ONLY set by this
    // function, so its presence means consolidation has already run.
    // We intentionally do NOT gate on Status: the CLI and EM approval buttons
    // can set Status = "approved" without ever writing consolidation content,
    // which would produce a false-positive skip.
    const sessionPage = sessionResp.results.filter(isFullPage)[0];
    const existingConsolidatedAt = sessionPage
      ? (sessionPage.properties["Consolidated At"] as { date?: { start?: string } } | undefined)?.date?.start
      : undefined;
    if (existingConsolidatedAt) {
      return {
        skipped: true, reason: "already-consolidated",
        sourcesApproved, subSummaryApprovalRate,
        reviewSessionId: sessionId, action: null,
        citationCoveragePct: null, citationCount: null,
      };
    }
    const consolidatedAt = startedAt.toISOString();
    const citationsJson  = JSON.stringify(citations);

    // Update DB properties on the session row
    await notion.pages.update({
      page_id: sessionId,
      properties: {
        "Status":         { select:     { name: "awaiting-squad-review" } },
        "Consolidated At":{ date:       { start: consolidatedAt } },
        "Citations":      { rich_text:  rt(citationsJson) },
      } as Parameters<typeof notion.pages.update>[0]["properties"],
    });

    // Clear existing blocks so re-runs are clean
    let cursor: string | undefined;
    do {
      const childList = await notion.blocks.children.list({
        block_id: sessionId,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const block of childList.results)
        await notion.blocks.delete({ block_id: block.id });
      cursor = childList.has_more ? (childList.next_cursor ?? undefined) : undefined;
    } while (cursor);

    // Write consolidated body blocks
    await notion.blocks.children.append({
      block_id: sessionId,
      children: [
        {
          type: "callout",
          callout: {
            rich_text: rt(executiveSummary),
            color: "blue_background" as const,
          },
        },
        { type: "divider", divider: {} },
        { type: "heading_2", heading_2: { rich_text: rt("Highlights") } },
        { type: "paragraph",  paragraph:  { rich_text: rt(highlights) } },
        { type: "divider", divider: {} },
        { type: "heading_2", heading_2: { rich_text: rt("Key Releases") } },
        { type: "paragraph",  paragraph:  { rich_text: rt(keyReleases) } },
        { type: "divider", divider: {} },
        { type: "heading_2", heading_2: { rich_text: rt("Risks & Blockers") } },
        { type: "paragraph",  paragraph:  { rich_text: rt(risksBlockers) } },
        { type: "divider", divider: {} },
        { type: "heading_2", heading_2: { rich_text: rt("Cross-Squad Dependencies") } },
        { type: "paragraph",  paragraph:  { rich_text: rt(crossSquadDeps) } },
        { type: "divider", divider: {} },
        { type: "heading_2", heading_2: { rich_text: rt("Open Flags") } },
        { type: "paragraph",  paragraph:  { rich_text: rt(openFlags) } },
        { type: "divider", divider: {} },
        {
          type: "callout",
          callout: {
            rich_text: rt(
              `${squadName} consolidation · Week ${weekOf} · ` +
              `${sourcesApproved}/${ALL_SOURCES.length} sources · ` +
              `${citations.length} citations · ` +
              `coverage ${Math.round(citationCoveragePct)}%`,
            ),
            color: "gray_background" as const,
          },
        },
      ] as Parameters<typeof notion.blocks.children.append>[0]["children"],
    });

    // Agent Run Log
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
            `week=${weekOf} squad=${squad} ` +
            `sources=${sourcesApproved} citations=${citations.length} ` +
            `coverage=${Math.round(citationCoveragePct)}% status=awaiting-squad-review`,
          ),
        },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });

    return {
      skipped: false, reason: null,
      sourcesApproved, subSummaryApprovalRate,
      reviewSessionId: sessionId,
      action: "updated" as const,
      citationCoveragePct: Math.round(citationCoveragePct * 10) / 10,
      citationCount: citations.length,
    };
  },
});
