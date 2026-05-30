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

const HITL_REVIEW_SESSIONS_DB = "370fc8f4-554c-8113-a6dd-f893a84555ff";
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

// Reads a rollup "percent checked" value from a Notion property.
// Notion API returns 0–100 for percent rollups; gate at >= 99.9 to absorb FP drift.
function rollupPercent(prop: unknown): number | null {
  if (!prop || typeof prop !== "object") return null;
  const p = prop as Record<string, unknown>;
  if (p.type !== "rollup") return null;
  const r = p.rollup as Record<string, unknown> | undefined;
  if (!r || r.type !== "number" || typeof r.number !== "number") return null;
  // Normalize: if value is <= 1 Notion may have returned a 0–1 fraction
  return r.number > 1 ? r.number : r.number * 100;
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
    "Return all HITL Review Sessions rows for a given week. " +
    "Each row contains the squad's consolidated narrative (written by the squad consolidation agent) " +
    "in the page body, plus citations stored in the Citations property. " +
    "A squad is 'approved' when its HITL Review Sessions Status = 'approved'. " +
    "The 'approvedSquadSlugs' field drives quorum — all 3 squads required to publish the master (100%).",
  hints: { readOnlyHint: true },
  schema: j.object({
    weekOf: j.string().describe("Week identifier, e.g. 2026-W21"),
  }),
  execute: async ({ weekOf }, { notion }) => {
    const weekDate = weekOfToDate(weekOf);

    const response = await notion.databases.query({
      database_id: HITL_REVIEW_SESSIONS_DB,
      filter: { property: "Week Of", date: { equals: weekDate } },
      page_size: 20,
    });

    type ConsolidatedEntry = {
      notionPageId: string;
      status: string;
      content: string;
      citations: Array<{ recordId: string; sourceUrl: string; claim: string }>;
    };

    const bySquad: Record<Squad, ConsolidatedEntry | null> = {
      atlas: null, lumen: null, forge: null,
    };

    for (const page of response.results.filter(isFullPage)) {
      const p = page.properties as Record<string, unknown>;

      // Identify squad via relation
      const squadRel = p["Squad"] as { relation?: Array<{ id: string }> } | undefined;
      const squadIds = squadRel?.relation?.map((r) => r.id) ?? [];
      const matchedSquad = ALL_SQUADS.find((sq) => squadIds.includes(SQUAD_PAGE_ID[sq]));
      if (!matchedSquad) continue;

      const status = selectName(p["Status"]);

      // Reconstruct consolidated body (written by squad consolidation agent)
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

      bySquad[matchedSquad] = { notionPageId: page.id, status, content, citations };
    }

    // A squad is approved when its session Status = "approved"
    const approvedSquadSlugs = ALL_SQUADS.filter(
      (sq) => bySquad[sq]?.status === "approved",
    );

    // Session page IDs for approved squads — passed to write_master_summary
    // to populate the Squad Consolidations relation on the master row
    const approvedSessionIds = approvedSquadSlugs
      .map((sq) => bySquad[sq]?.notionPageId)
      .filter((id): id is string => id !== undefined);

    // Read Squad Approval Rate rollup from the Master EPD Weekly row.
    // This rollup counts how many linked HITL Review Sessions rows are approved,
    // so quorum stays correct regardless of how many squads exist.
    const masterRow = await notion.databases.query({
      database_id: MASTER_EPD_WEEKLY_DB,
      filter: { property: "Week Of", date: { equals: weekDate } },
      page_size: 5,
    });

    let squadApprovalRate: number | null = null;
    if (masterRow.results.length > 0 && isFullPage(masterRow.results[0])) {
      const mp = masterRow.results[0].properties as Record<string, unknown>;
      squadApprovalRate = rollupPercent(mp["Squad Approval Rate"]);
    }

    return {
      squads: bySquad,
      approvedSquadSlugs,
      approvedSessionIds,
      squadApprovalRate,
      quorumMet: squadApprovalRate !== null && squadApprovalRate >= 99.9,
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
    "Enforces quorum: fewer than 3 approved squads → writes outcome=skipped log and returns without publishing. " +
    "All 3 approved → publishes the full master digest. " +
    "Upserts are idempotent — re-running overwrites the existing row body.",
  schema: j.object({
    weekOf:            j.string().describe("Week identifier, e.g. 2026-W21"),
    approvedSquads:    j
      .array(j.enum("atlas", "lumen", "forge"))
      .describe("Squads whose HITL Review Sessions row has Status = 'approved' this week"),
    approvedSessionIds: j
      .array(j.string())
      .describe("notionPageId of each approved HITL Review Sessions row — used to populate the Squad Consolidations relation on the master row"),
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
      weekOf, approvedSquads, approvedSessionIds, executiveSummary, highlights,
      risksBlockers, crossSquadDeps, roadmapMovement,
      openDiscrepancies, conflictPolicy, citationCoveragePct, citations,
    },
    { notion },
  ) => {
    const startedAt  = new Date();
    const weekDate   = weekOfToDate(weekOf);

    // ── Re-read Squad Approval Rate rollup as the authoritative quorum gate ──
    // This decouples quorum from a hardcoded squad count — the rollup denominator
    // adjusts automatically when squads are added or removed.
    const masterCheck = await notion.databases.query({
      database_id: MASTER_EPD_WEEKLY_DB,
      filter: { property: "Week Of", date: { equals: weekDate } },
      page_size: 5,
    });
    const squadApprovalRate =
      masterCheck.results.length > 0 && isFullPage(masterCheck.results[0])
        ? rollupPercent((masterCheck.results[0].properties as Record<string, unknown>)["Squad Approval Rate"])
        : null;

    // ── Quorum check: < 100% approved → skip ─────────────────────────────────
    if (squadApprovalRate === null || squadApprovalRate < 99.9) {
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
              `week=${weekOf} approved=${approvedSquads.join(",")} reason=below-quorum(squadApprovalRate=${squadApprovalRate ?? "null"},need=100)`,
            ),
          },
        } as Parameters<typeof notion.pages.create>[0]["properties"],
      });
      return {
        skipped: true,
        reason: "below-quorum",
        approvedCount: approvedSquads.length,
        squadApprovalRate,
        pageId: null,
        action: null,
        unapprovedSquads: null,
        quorumFull: false,
        citationCoveragePct: null,
        citationCount: null,
      };
    }

    // ── Find or create the Master EPD Weekly row ──────────────────────────────
    const existing = await notion.databases.query({
      database_id: MASTER_EPD_WEEKLY_DB,
      filter: { property: "Week Of", date: { equals: weekDate } },
      page_size: 5,
    });

    // ── Idempotency gate: first writer wins ───────────────────────────────────
    // Multiple HITL approval events can all pass the rollup gate before any
    // write lands. We gate on the "Citation Coverage %" number property — it
    // is only set by this function, so its presence means a master write has
    // already run. We intentionally do NOT gate on Status: a VP publish button
    // can set Status without a write having happened.
    if (existing.results.length > 0 && isFullPage(existing.results[0])) {
      const citationCov = (
        existing.results[0].properties as Record<string, unknown>
      )["Citation Coverage %"] as { number?: number | null } | undefined;
      if (citationCov?.number !== null && citationCov?.number !== undefined) {
        return {
          skipped: true, reason: "already-published",
          approvedCount: approvedSquads.length,
          squadApprovalRate,
          pageId: existing.results[0].id,
          action: null,
          unapprovedSquads: null,
          quorumFull: true,
          citationCoveragePct: null,
          citationCount: null,
        };
      }
    }

    let pageId: string;
    let action: "created" | "updated";

    const props = {
      "Title":                 { title: rt(`EPD Weekly — ${weekOf}`) },
      "Week Of":               { date: { start: weekDate } },
      "Quorum Met":            { checkbox: (squadApprovalRate ?? 0) >= 99.9 },
      "Citation Coverage %":   { number: Math.round(citationCoveragePct * 10) / 10 },
      "Squad Consolidations":  { relation: (approvedSessionIds as string[]).map((id) => ({ id })) },
      "Status":                { select: { name: "awaiting-VP" } },
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
          rich_text: rt(executiveSummary),
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
      squadApprovalRate,
      pageId,
      action,
      unapprovedSquads: null,
      quorumFull: (squadApprovalRate ?? 0) >= 99.9,
      citationCoveragePct: Math.round(citationCoveragePct * 10) / 10,
      citationCount: citations.length,
    };
  },
});
