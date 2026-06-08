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

const HITL_REVIEW_SESSIONS_DB  = "370fc8f4-554c-8113-a6dd-f893a84555ff";
const MASTER_EPD_WEEKLY_DB     = "36efc8f4-554c-8158-808b-d084ce4c4a16";
const AGENT_RUN_LOG_DB         = "36efc8f4-554c-814e-8c51-ea51792f5344";
// PRD-13 Addendum (2026-06-08): "GTM | Weekly Briefs" — one row per week, mirrors
// Master EPD Weekly's shape. Replaced the original page-hierarchy design (which
// hardcoded a now-archived REVENUE_PAGE_ID and a brittle title-search traversal —
// see Tool 6 below and PRD-17's "Spec Update" section for the full story).
const GTM_WEEKLY_BRIEFS_DB     = "379fc8f4-554c-803c-acbb-dccd29e576bf";

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

// ── Tool 1: read_prior_week_feedback ─────────────────────────────────────────
//
// Fetches VP comments from the previous week's Master EPD Weekly page.
// Call this first — before reading squad summaries — so the agent has context
// on any concerns the VP raised last week and can address them in the new report.
//
// Returns { hasFeedback, comments[], priorWeekOf, priorPageId }.
// If hasFeedback=false, the agent skips the VP Feedback Follow-up section.

worker.tool("read_prior_week_feedback", {
  title: "Read Prior Week VP Feedback",
  description:
    "Fetch any VP comments left on the previous week's Master EPD Weekly page. " +
    "Call this before read_approved_summaries. " +
    "If hasFeedback=false, pass an empty string for vpFeedbackFollowUp when calling write_master_summary. " +
    "If hasFeedback=true, compose a follow-up paragraph that quotes the VP verbatim and states " +
    "whether this week's data resolves, worsens, or is neutral to their concern.",
  hints: { readOnlyHint: true },
  schema: j.object({
    weekOf: j
      .string()
      .describe("Current week identifier, e.g. 2026-W21 — the tool derives the prior week automatically"),
  }),
  execute: async ({ weekOf }, { notion }) => {
    // Derive the prior week's Monday date by subtracting 7 days
    const currentMonday = weekOfToDate(weekOf);
    const priorDate     = new Date(currentMonday);
    priorDate.setUTCDate(priorDate.getUTCDate() - 7);
    const priorMonday   = priorDate.toISOString().split("T")[0];

    // Compute a human-readable prior weekOf label (e.g. "2026-W20")
    const priorYear   = priorDate.getUTCFullYear();
    const jan4        = new Date(Date.UTC(priorYear, 0, 4));
    const dow         = jan4.getUTCDay() || 7;
    const week1Mon    = new Date(jan4);
    week1Mon.setUTCDate(jan4.getUTCDate() - (dow - 1));
    const diffDays    = Math.round((priorDate.getTime() - week1Mon.getTime()) / 86400000);
    const priorWeekOf = `${priorYear}-W${String(Math.floor(diffDays / 7) + 1).padStart(2, "0")}`;

    // Look up the prior week's Master EPD Weekly row
    const masterRow = await notion.databases.query({
      database_id: MASTER_EPD_WEEKLY_DB,
      filter: { property: "Week Of", date: { equals: priorMonday } },
      page_size: 5,
    });

    if (masterRow.results.length === 0) {
      return { priorWeekOf, priorPageId: null, hasFeedback: false, comments: [] as Array<{ text: string; createdAt: string }> };
    }

    const priorPageId = masterRow.results[0].id;

    // Fetch all comments on that page
    const commentsResp = await notion.comments.list({ block_id: priorPageId });

    const comments = (commentsResp.results as Array<Record<string, unknown>>).map((c) => ({
      text: (c.rich_text as Array<{ plain_text: string }>).map((t) => t.plain_text).join(""),
      createdAt: c.created_time as string,
    })).filter((c) => c.text.trim().length > 0);

    return {
      priorWeekOf,
      priorPageId,
      hasFeedback: comments.length > 0,
      comments,
    };
  },
});

// ── Tool 2: read_approved_summaries ───────────────────────────────────────────
//
// Returns all HITL Review Sessions rows for the week, grouped by squad.
// The agent uses this to check quorum (Squad Approval Rate rollup) and load
// squad narratives for synthesis.

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
      keyReleases: string;
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

      // PRD-17 redesign (2026-06-06): Key Releases is no longer a separate
      // property write — it's read natively from the consolidated body's own
      // "## Key Releases" section (the squad consolidation agent writes it as
      // Section C, EM-reviewed at the same HITL gate as everything else).
      // `sections` already has every heading_2 → paragraph pair generically
      // parsed above, so this is a direct lookup — no extra DB query needed.
      const keyReleases = sections["Key Releases"]?.trim() || "(no releases this week)";

      bySquad[matchedSquad] = { notionPageId: page.id, status, content, citations, keyReleases };
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

// ── Tool 3: begin_master_summary ──────────────────────────────────────────────
//
// Called after quorum is confirmed, before composing the master narrative.
// Flips the Master EPD Weekly row Status from "pending" → "generating-summary"
// so the row shows live status in Notion while the agent reasons.
//
// Returns { started: true }  — row claimed; proceed to synthesis.
// Returns { started: false } — row is already generating or published; stop.
//
// This is the write-side lock against concurrent master agent triggers:
// only the first agent to flip "pending" → "generating-summary" proceeds.

worker.tool("begin_master_summary", {
  title: "Begin Master Summary",
  description:
    "Mark the Master EPD Weekly row as 'generating-summary' before composing the master narrative. " +
    "Call this immediately after read_approved_summaries confirms quorumMet=true, " +
    "before synthesizing any content. " +
    "If started=false the row is already being processed or has already been published — stop immediately.",
  schema: j.object({
    weekOf: j.string().describe("Week identifier, e.g. 2026-W21"),
  }),
  execute: async ({ weekOf }, { notion }) => {
    const weekDate = weekOfToDate(weekOf);

    const masterRow = await notion.databases.query({
      database_id: MASTER_EPD_WEEKLY_DB,
      filter: { property: "Week Of", date: { equals: weekDate } },
      page_size: 5,
    });

    if (masterRow.results.length === 0) {
      return {
        started: false, reason: "row not found",
        currentStatus: null, masterPageId: null, weekOf,
      };
    }

    const page = masterRow.results[0];
    if (!isFullPage(page)) {
      return {
        started: false, reason: "row not full page",
        currentStatus: null, masterPageId: null, weekOf,
      };
    }

    const currentStatus = selectName((page.properties as Record<string, unknown>)["Status"]);

    // Only flip from "pending" — any other status means another run has claimed
    // the row (generating-summary) or already published it (awaiting-VP, published).
    if (currentStatus !== "pending") {
      return {
        started: false, reason: "already-claimed-or-published",
        currentStatus, masterPageId: null, weekOf,
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
      currentStatus: "generating-summary", masterPageId: page.id, weekOf,
    };
  },
});

// ── Tool 4: write_master_summary ──────────────────────────────────────────────
//
// Creates or updates the Master EPD Weekly row for the given week.
//
// Quorum rule (enforced here so the agent cannot accidentally bypass it):
//   all 3 squads approved (Squad Approval Rate >= 99.9) → publish row
//   anything below 100%                                 → do NOT publish; write outcome=skipped run log and return
// (Decision 2026-05-30: full-approval quorum — no 2/3 provisional fallback. See PRD-05 §Quorum.)
//
// The body is structured as:
//   [callout]  Executive Summary
//   ## VP Feedback Follow-up   ← only present if prior-week VP comment found
//   ## Highlights
//   ## Risks & Blockers
//   ## Cross-Squad Dependencies
//   ## Roadmap Movement
//   ## Open Discrepancies
//   [callout]  Conflict-Resolution Policy (editable)

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
    vpFeedbackFollowUp: j
      .string()
      .describe(
        "Composed VP Feedback Follow-up section. " +
        "Pass empty string if read_prior_week_feedback returned hasFeedback=false — the section will be omitted. " +
        "Otherwise: quote the VP comment verbatim, state whether this week's data resolves / worsens / is neutral " +
        "to their concern, and cite the specific notionPageId(s) that support your conclusion.",
      ),
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
        "Fraction of factual sentences in the body that have a citation entry " +
        "(computed by agent as cited_sentences / total_factual_sentences × 100, expressed as a " +
        "0–100 percentage). The worker divides by 100 before writing to Notion so the property " +
        "stores a decimal (e.g. 0.85 not 85). AC2 requires ≥85.",
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
      openDiscrepancies, vpFeedbackFollowUp, conflictPolicy, citationCoveragePct, citations,
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
      "Citation Coverage %":   { number: citationCoveragePct / 100 },
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

      // VP Feedback Follow-up — only present when prior-week VP comments found
      ...(vpFeedbackFollowUp.trim() ? [
        { type: "heading_2" as const, heading_2: { rich_text: rt("VP Feedback Follow-up") } },
        { type: "paragraph"  as const, paragraph:  { rich_text: rt(vpFeedbackFollowUp) } },
        { type: "divider"    as const, divider: {} },
      ] : []),

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

// ── Tool 5: write_gtm_highlights ──────────────────────────────────────────────
//
// Called after write_master_summary succeeds. PATCHes the GTM Highlights property
// on the Master EPD Weekly row — a ≤150-word CRO-facing brief synthesized from
// Key Releases across all three squads.
//
// Non-blocking: if this fails, the master summary is still published. The agent
// should catch errors and log them rather than aborting the pipeline.

worker.tool("write_gtm_highlights", {
  title: "Write GTM Highlights",
  description:
    "PATCH the GTM Highlights property on a Master EPD Weekly row. " +
    "Call this after write_master_summary succeeds (skipped=false). " +
    "highlightsText must be ≤150 words, non-technical, and contain no ticket or PR numbers. " +
    "If this tool fails, log the error but do not abort — the master summary is already published.",
  schema: j.object({
    masterPageId: j
      .string()
      .describe("Notion page ID of the Master EPD Weekly row — the pageId returned by write_master_summary"),
    highlightsText: j
      .string()
      .describe(
        "≤150 word GTM brief for the CRO. Structure: what shipped / what it means for pipeline / what reps should know. " +
        "No Jira ticket numbers, PR numbers, or internal identifiers. Customer-facing product names only. " +
        "If no releases across all squads, write: 'No product releases this week.'",
      ),
  }),
  execute: async ({ masterPageId, highlightsText }, { notion }) => {
    await notion.pages.update({
      page_id: masterPageId,
      properties: {
        "GTM Highlights": { rich_text: rt(highlightsText) },
      } as Parameters<typeof notion.pages.update>[0]["properties"],
    });

    const now = new Date();
    await notion.pages.create({
      parent: { database_id: AGENT_RUN_LOG_DB },
      properties: {
        "Run Id":       { title: rt(`master-gtm-highlights-${now.toISOString()}`) },
        "Agent Name":   { select: { name: "master-gtm-highlights" } },
        "Started At":   { date: { start: now.toISOString() } },
        "Completed At": { date: { start: now.toISOString() } },
        "Duration ms":  { number: 0 },
        "Outcome":      { select: { name: "ok" } },
        "Notes": {
          rich_text: rt(`masterPageId=${masterPageId} chars=${highlightsText.length}`),
        },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });

    return { masterPageId, highlightsLength: highlightsText.length };
  },
});

// ── Tool 6: write_gtm_weekly_page ─────────────────────────────────────────────
//
// Finds-or-creates the CRO-facing "GTM Weekly — {weekOf}" brief as a ROW in the
// `GTM | Weekly Briefs` DATABASE (GTM_WEEKLY_BRIEFS_DB) — one row per week,
// queryable/sortable by `Week Of`, exactly mirroring how Master EPD Weekly itself
// works (see Tool 4 write_master_summary's find-or-create above, which this copies).
//
// PRD-13 ADDENDUM (2026-06-08) REDESIGN: this replaced the original page-hierarchy
// design (`Revenue > GTM Weekly Briefs > GTM Weekly — {weekOf}`, a page with
// sub-pages found via brittle title-search traversal). Dan reviewed the live
// workspace and asked "shouldn't this be a database?" — yes: structured rows give
// Release Bridge (PRD-16) a `Flagged Deals` relation property to land deal-specific
// outreach links on directly, instead of a placeholder sentence. See PRD-13's
// "➕ Addendum" and PRD-17's "🔁 Spec Update" sections for full rationale.
//
// 🐛 Bonus: this also fixes a live latent bug for free. The old traversal matched
// on `result.parent.page_id === REVENUE_PAGE_ID`, but (a) that page was archived
// and (b) the live databases' parent was actually a column `block_id`, not a page
// — so the match always failed and execution fell through to `pages.create`
// against an archived page. An exact-match `databases.query` on a structured
// `Week Of` date property has no such traversal to get wrong.
//
// Database shape (one row per week):
//   GTM | Weekly Briefs  (GTM_WEEKLY_BRIEFS_DB, lives directly under BASE_NOTION_PAGE
//                         alongside the other 4 GTM databases — no "Revenue" parent)
//     ├── row: "GTM Weekly — 2026-W21"   Week Of: 2026-05-18   Status: draft
//     └── …
//
// Idempotent — re-running clears and rewrites the existing row's body rather than
// creating a duplicate.
//
// Non-blocking: called after write_master_summary succeeds. Failures are logged
// but should not abort the pipeline.

worker.tool("write_gtm_weekly_page", {
  title: "Write GTM Weekly Page",
  description:
    "Create or update the CRO-facing GTM Weekly brief as a row in the GTM | Weekly Briefs database " +
    "(found/matched by its Week Of date property — not a title search). " +
    "Idempotent — re-running updates the existing week's row rather than creating a duplicate. " +
    "Returns { pageId, url }. Writes an Agent Run Log entry with Agent Name = 'master-gtm-weekly-page'.",
  schema: j.object({
    weekOf: j.string().describe("Week identifier, e.g. 2026-W21"),
    body: j
      .string()
      .describe(
        "Full markdown body of the GTM Weekly brief. Must contain all 4 required sections: " +
        "'What Shipped This Week', 'What It Means for Your Pipeline', 'Deals to Contact This Week', 'How to Use This Brief'.",
      ),
  }),
  execute: async ({ weekOf, body }, { notion }) => {
    const pageTitle = `GTM Weekly — ${weekOf}`;
    const weekDate  = weekOfToDate(weekOf);
    const startedAt = new Date();

    // ── Find or create the week's row by exact-match `Week Of` query ─────────
    // Structured-property lookup, not title-matching — see header comment.
    const existing = await notion.databases.query({
      database_id: GTM_WEEKLY_BRIEFS_DB,
      filter: { property: "Week Of", date: { equals: weekDate } },
      page_size: 5,
    });

    const props = {
      "Title":   { title: rt(pageTitle) },
      "Week Of": { date: { start: weekDate } },
      // Always (re)write as "draft" — fresh content needs a CRO/SE look before
      // going out, the same way a master-summary rewrite resets the EPD row to
      // "awaiting-VP" rather than preserving a stale "approved"/"published" state.
      "Status":  { select: { name: "draft" } },
    } as Parameters<typeof notion.pages.create>[0]["properties"];

    let pageId: string;
    let action: "created" | "updated";

    if (existing.results.length > 0 && isFullPage(existing.results[0])) {
      pageId = existing.results[0].id;
      action = "updated";

      // Clear existing blocks before rewriting (idempotency)
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
    } else {
      const created = await notion.pages.create({
        parent: { database_id: GTM_WEEKLY_BRIEFS_DB },
        properties: props,
      });
      pageId = created.id;
      action = "created";
    }

    // ── Parse markdown body into Notion block objects ─────────────────────────
    const lines  = body.split("\n");
    const blocks: Parameters<typeof notion.blocks.children.append>[0]["children"] = [];
    for (const line of lines) {
      if (line.startsWith("# ")) {
        blocks.push({ type: "heading_1" as const, heading_1: { rich_text: rt(line.slice(2).trim()) } });
      } else if (line.startsWith("## ")) {
        blocks.push({ type: "heading_2" as const, heading_2: { rich_text: rt(line.slice(3).trim()) } });
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        blocks.push({ type: "bulleted_list_item" as const, bulleted_list_item: { rich_text: rt(line.slice(2).trim()) } });
      } else if (line.trim() && line.trim() !== "---") {
        blocks.push({ type: "paragraph" as const, paragraph: { rich_text: rt(line.trim()) } });
      }
    }

    // Notion API accepts max 100 blocks per append call
    for (let i = 0; i < blocks.length; i += 100) {
      await notion.blocks.children.append({
        block_id: pageId,
        children: blocks.slice(i, i + 100) as Parameters<typeof notion.blocks.children.append>[0]["children"],
      });
    }

    const pageUrl     = `https://www.notion.so/${pageId.replace(/-/g, "")}`;
    const completedAt = new Date();

    await notion.pages.create({
      parent: { database_id: AGENT_RUN_LOG_DB },
      properties: {
        "Run Id":       { title: rt(`master-gtm-weekly-page-${startedAt.toISOString()}`) },
        "Agent Name":   { select: { name: "master-gtm-weekly-page" } },
        "Started At":   { date: { start: startedAt.toISOString() } },
        "Completed At": { date: { start: completedAt.toISOString() } },
        "Duration ms":  { number: completedAt.getTime() - startedAt.getTime() },
        "Outcome":      { select: { name: "ok" } },
        "Notes": {
          rich_text: rt(`week=${weekOf} action=${action} pageId=${pageId}`),
        },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });

    return { pageId, url: pageUrl };
  },
});
