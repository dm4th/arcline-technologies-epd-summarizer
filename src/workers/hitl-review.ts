import { isFullBlock, isFullPage } from "@notionhq/client";
import { getNotionClient } from "../lib/notion";
import { NOTION_IDS, getSquadPageId } from "../lib/notion-ids";
import { writeAgentRunLog, createMasterSummarizerTrigger } from "./lib/agent-run-log";
import type { SquadId } from "../types/core";

export type SummarySource =
  | "github"
  | "jira"
  | "slack"
  | "figma"
  | "roadmap"
  | "prd-fact-check";

export const ALL_SOURCES: SummarySource[] = [
  "github",
  "jira",
  "slack",
  "figma",
  "roadmap",
  "prd-fact-check",
];

export const ALL_SQUADS: SquadId[] = ["atlas", "lumen", "forge"];

const rtProp = (s: string) => [{ text: { content: s.substring(0, 1999) } }];

function richText(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if ("rich_text" in p && Array.isArray(p.rich_text))
    return (p.rich_text as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  if ("title" in p && Array.isArray(p.title))
    return (p.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  return "";
}

/**
 * Create or update a HITL Review Sessions row for a squad+week.
 * Idempotent: finds by (Squad, Week Of) and updates if found; creates otherwise.
 */
async function upsertReviewSession(opts: {
  squadId: SquadId;
  weekOf: string;
  status: "pending" | "in-review" | "approved" | "changes-requested";
  reviewedBy?: string;
  approvedAt?: string;
  notes?: string;
  summaryPageIds?: string[];
}): Promise<void> {
  const notion     = getNotionClient();
  const squadPageId = getSquadPageId(opts.squadId);
  const weekDate   = weekOfToDate(opts.weekOf);
  const squadName  = opts.squadId.charAt(0).toUpperCase() + opts.squadId.slice(1);

  const existing = await notion.databases.query({
    database_id: NOTION_IDS.dbs.hitlReviewSessions,
    filter: {
      and: [
        { property: "Squad",   relation: { contains: squadPageId } },
        { property: "Week Of", date:     { equals: weekDate } },
      ],
    },
    page_size: 5,
  });

  const props: Record<string, unknown> = {
    "Status": { select: { name: opts.status } },
  };
  if (opts.reviewedBy     !== undefined) props["Reviewed By"]            = { rich_text: rtProp(opts.reviewedBy) };
  if (opts.approvedAt     !== undefined) props["Approved At"]            = { date: { start: opts.approvedAt } };
  if (opts.notes          !== undefined) props["Notes"]                  = { rich_text: rtProp(opts.notes) };
  if (opts.summaryPageIds !== undefined) props["Squad Weekly Summaries"] = { relation: opts.summaryPageIds.map((id) => ({ id })) };

  if (existing.results.length > 0) {
    await notion.pages.update({
      page_id: existing.results[0].id,
      properties: props as Parameters<typeof notion.pages.update>[0]["properties"],
    });
  } else {
    await notion.pages.create({
      parent: { database_id: NOTION_IDS.dbs.hitlReviewSessions },
      properties: {
        "Title":   { title: rtProp(`${squadName} — ${opts.weekOf}`) },
        "Squad":   { relation: [{ id: squadPageId }] },
        "Week Of": { date: { start: weekDate } },
        ...props,
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });
  }
}

/** Parse "2026-W21" → "2026-05-18" (ISO Monday of that week). */
export function weekOfToDate(weekOf: string): string {
  const [yearStr, weekStr] = weekOf.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  // Jan 4 is always in ISO week 1 by definition
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7; // Mon=1 … Sun=7
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (dow - 1));
  const monday = new Date(week1Mon);
  monday.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().split("T")[0];
}

/** Query all SquadWeeklySummary rows matching a squad+week. */
async function getSquadWeeklySummaries(squadId: SquadId, weekOf: string) {
  const notion = getNotionClient();
  const squadPageId = getSquadPageId(squadId);
  const weekDate = weekOfToDate(weekOf);

  const response = await notion.databases.query({
    database_id: NOTION_IDS.dbs.squadWeeklySummary,
    filter: {
      and: [
        { property: "Squad", relation: { contains: squadPageId } },
        { property: "Week Of", date: { equals: weekDate } },
      ],
    },
  });

  return response.results.filter(isFullPage);
}

/**
 * Seed placeholder SquadWeeklySummary rows for one squad+week (idempotent).
 * Creates one row per source (6 total) with awaiting-review status and
 * placeholder body content. Real summaries come from PRD-04a/04b agents.
 */
export async function seedSquadWeeklySummaries(
  squadId: SquadId,
  weekOf: string,
): Promise<{ created: number; skipped: number }> {
  const notion = getNotionClient();
  const squadPageId = getSquadPageId(squadId);
  const weekDate = weekOfToDate(weekOf);
  let created = 0;
  let skipped = 0;
  const summaryPageIds: string[] = [];

  for (const source of ALL_SOURCES) {
    const existing = await notion.databases.query({
      database_id: NOTION_IDS.dbs.squadWeeklySummary,
      filter: {
        and: [
          { property: "Squad", relation: { contains: squadPageId } },
          { property: "Week Of", date: { equals: weekDate } },
          { property: "Source", select: { equals: source } },
        ],
      },
    });

    if (existing.results.length > 0) {
      summaryPageIds.push(existing.results[0].id);
      skipped++;
      continue;
    }

    const squadName = squadId.charAt(0).toUpperCase() + squadId.slice(1);
    const title = `${squadName} / ${source} — ${weekOf}`;

    const page = await notion.pages.create({
      parent: { database_id: NOTION_IDS.dbs.squadWeeklySummary },
      properties: {
        "Title":        { title: rtProp(title) },
        "Squad":        { relation: [{ id: squadPageId }] },
        "Week Of":      { date: { start: weekDate } },
        "Source":       { select: { name: source } },
        "Citations":    { rich_text: rtProp("[]") },
        "Status":       { select: { name: "pending" } },
        "Generated At": { date: { start: new Date().toISOString() } },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });

    // Summary goes in the page body per PRD-01 schema decision
    await notion.blocks.children.append({
      block_id: page.id,
      children: [
        {
          object: "block",
          type: "callout",
          callout: {
            rich_text: [{ type: "text", text: { content: "SEED placeholder — replace with PRD-04a/04b output" } }],
            color: "yellow_background",
          },
        },
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: [{ type: "text", text: { content: "Key Activity" } }] },
        },
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: [{ type: "text", text: { content: `Placeholder item for ${source} — ${squadName} squad` } }] },
        },
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: [{ type: "text", text: { content: "Placeholder item 2" } }] },
        },
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: [{ type: "text", text: { content: "Placeholder item 3" } }] },
        },
      ] as Parameters<typeof notion.blocks.children.append>[0]["children"],
    });

    summaryPageIds.push(page.id);
    console.log(`  [hitl-review/seed] created ${squadId}/${source}: ${page.id}`);
    created++;
  }

  // Create or reset the review session row with links to all 6 summary pages
  await upsertReviewSession({
    squadId,
    weekOf,
    status: "pending",
    summaryPageIds,
  });

  return { created, skipped };
}

/**
 * Create or refresh the "Week of YYYY-MM-DD — Review" page under a squad page.
 * Idempotent: if the page already exists, its blocks are cleared and rewritten.
 * Returns the review page ID.
 */
export async function createReviewPage(squadId: SquadId, weekOf: string): Promise<string> {
  const notion = getNotionClient();
  const squadPageId = getSquadPageId(squadId);
  const weekDate = weekOfToDate(weekOf);
  const pageTitle = `Week of ${weekDate} — Review`;

  const summaryPages = await getSquadWeeklySummaries(squadId, weekOf);
  if (summaryPages.length === 0) {
    throw new Error(
      `No Squad Weekly Summary rows found for ${squadId}/${weekOf}.\n` +
      `Seed first: pnpm hitl-review --action=seed --squad=${squadId} --week=${weekOf}`,
    );
  }

  // Scan children of the squad page for an existing review page (with pagination)
  let existingPageId: string | null = null;
  let cursor: string | undefined;
  do {
    const childList = await notion.blocks.children.list({
      block_id: squadPageId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const block of childList.results) {
      if (
        isFullBlock(block) &&
        block.type === "child_page" &&
        block.child_page.title === pageTitle
      ) {
        existingPageId = block.id;
        break;
      }
    }
    cursor = childList.has_more ? (childList.next_cursor ?? undefined) : undefined;
  } while (cursor && !existingPageId);

  const approveCmd = `pnpm hitl-review --action=approve --squad=${squadId} --week=${weekOf}`;
  const rejectCmd  = `pnpm hitl-review --action=reject --squad=${squadId} --week=${weekOf} --source=<source> --comment="<reason>"`;
  const refreshCmd = `pnpm hitl-review --action=refresh-page --squad=${squadId} --week=${weekOf}`;

  // Build content blocks for the review page
  const blocks: Parameters<typeof notion.blocks.children.append>[0]["children"] = [
    {
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{ type: "text", text: { content: `Approve all ${summaryPages.length}: ${approveCmd}` } }],
        color: "green_background",
      },
    },
    {
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{ type: "text", text: { content: `Reject one: ${rejectCmd}` } }],
        color: "red_background",
      },
    },
    {
      object: "block",
      type: "callout",
      callout: {
        rich_text: [{ type: "text", text: { content: `Refresh page after re-run: ${refreshCmd}` } }],
        color: "blue_background",
      },
    },
    { object: "block", type: "divider", divider: {} },
  ] as Parameters<typeof notion.blocks.children.append>[0]["children"];

  for (const page of summaryPages) {
    const props = page.properties;

    const sourceProp = props["Source"];
    const source =
      sourceProp?.type === "select" ? (sourceProp.select?.name ?? "unknown") : "unknown";

    const statusProp = props["Status"];
    const status =
      statusProp?.type === "select" ? (statusProp.select?.name ?? "unknown") : "unknown";

    const citationsProp = props["Citations"];
    const citations =
      citationsProp?.type === "rich_text" &&
      Array.isArray(citationsProp.rich_text) &&
      citationsProp.rich_text.length > 0
        ? (citationsProp.rich_text[0] as { plain_text: string }).plain_text
        : "[]";

    const statusLabel =
      status === "approved" ? "[APPROVED]" :
      status === "rejected" ? "[REJECTED]" :
      "[PENDING]";

    (blocks as unknown[]).push(
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: `${statusLabel} ${source.toUpperCase()}` } }],
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: "Status: " }, annotations: { bold: true } },
            { type: "text", text: { content: status } },
            { type: "text", text: { content: "   |   Full summary: " }, annotations: { bold: true } },
            { type: "mention", mention: { type: "page", page: { id: page.id } } },
          ],
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: "Citations: " }, annotations: { bold: true, color: "gray" } },
            { type: "text", text: { content: citations }, annotations: { color: "gray" } },
          ],
        },
      },
      { object: "block", type: "divider", divider: {} },
    );
  }

  if (existingPageId) {
    // Clear all existing blocks from the review page then rewrite
    let childCursor: string | undefined;
    do {
      const existing = await notion.blocks.children.list({
        block_id: existingPageId,
        ...(childCursor ? { start_cursor: childCursor } : {}),
      });
      for (const b of existing.results) {
        await notion.blocks.delete({ block_id: b.id });
      }
      childCursor = existing.has_more ? (existing.next_cursor ?? undefined) : undefined;
    } while (childCursor);

    await notion.blocks.children.append({ block_id: existingPageId, children: blocks });
    console.log(`[hitl-review] Refreshed review page: ${existingPageId}`);
    return existingPageId;
  }

  const newPage = await notion.pages.create({
    parent: { page_id: squadPageId },
    properties: {
      title: { title: rtProp(pageTitle) },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });

  await notion.blocks.children.append({ block_id: newPage.id, children: blocks });
  console.log(`[hitl-review] Created review page: ${newPage.id}`);

  // Mark the squad as in-review once the EM opens the review page
  await upsertReviewSession({ squadId, weekOf, status: "in-review" });

  return newPage.id;
}

/**
 * Create or update the Master EPD Weekly row for a week, linking ALL HITL
 * Review Sessions rows via Squad Consolidations. This pre-populates the
 * Squad Approval Rate rollup denominator so the master agent can gate on
 * 100% without hardcoding the squad count — add or remove a squad and the
 * rollup adjusts automatically.
 * Idempotent: finds by Week Of and updates if found; creates otherwise.
 */
export async function upsertMasterEpdWeekly(
  weekOf: string,
): Promise<{ pageId: string; action: "created" | "updated" }> {
  const notion = getNotionClient();
  const weekDate = weekOfToDate(weekOf);

  const sessions = await notion.databases.query({
    database_id: NOTION_IDS.dbs.hitlReviewSessions,
    filter: { property: "Week Of", date: { equals: weekDate } },
    page_size: 20,
  });
  const sessionRelation = sessions.results.map((p) => ({ id: p.id }));

  const existing = await notion.databases.query({
    database_id: NOTION_IDS.dbs.masterEpdWeekly,
    filter: { property: "Week Of", date: { equals: weekDate } },
    page_size: 5,
  });

  if (existing.results.length > 0) {
    const pageId = existing.results[0].id;
    await notion.pages.update({
      page_id: pageId,
      properties: {
        "Squad Consolidations": { relation: sessionRelation },
      } as Parameters<typeof notion.pages.update>[0]["properties"],
    });
    console.log(`[hitl-review] Updated Master EPD Weekly for ${weekOf}: ${pageId}`);
    return { pageId, action: "updated" };
  }

  const page = await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.masterEpdWeekly },
    properties: {
      "Title":                { title: rtProp(`EPD Weekly — ${weekOf}`) },
      "Week Of":              { date: { start: weekDate } },
      "Squad Consolidations": { relation: sessionRelation },
      "Status":               { select: { name: "pending" } },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });
  console.log(`[hitl-review] Created Master EPD Weekly for ${weekOf}: ${page.id}`);
  return { pageId: page.id, action: "created" };
}

/**
 * Approve all Squad Weekly Summaries for a squad+week.
 * Updates all matching rows to Status=approved and writes an Agent Run Log entry.
 * Refreshes the review page automatically.
 */
export async function approveSquadWeek(
  squadId: SquadId,
  weekOf: string,
): Promise<{ approved: number; reviewPageId: string }> {
  const notion = getNotionClient();
  const startedAt = new Date();

  const summaryPages = await getSquadWeeklySummaries(squadId, weekOf);
  if (summaryPages.length === 0) {
    throw new Error(`No Squad Weekly Summary rows found for ${squadId}/${weekOf}.`);
  }

  for (const page of summaryPages) {
    await notion.pages.update({
      page_id: page.id,
      properties: {
        "Status":      { select: { name: "approved" } },
        "Approved By": { rich_text: rtProp("hitl-review worker") },
      } as Parameters<typeof notion.pages.update>[0]["properties"],
    });
  }

  const completedAt = new Date();
  await writeAgentRunLog({
    agentName: `approval.squad.${squadId}`,
    startedAt,
    completedAt,
    outcome: "ok",
    notes: `Approved ${summaryPages.length} summaries for ${squadId} week ${weekOf}`,
  });

  // Refresh review page so statuses are reflected immediately
  const reviewPageId = await createReviewPage(squadId, weekOf);

  // ── Fan-in: trigger master summarizer when ≥2 squads are fully approved ────
  //
  // "Fully approved" = every source row for that squad has Status=approved.
  // We check all 3 squads so the trigger fires on the 2nd OR 3rd approval,
  // whichever comes first (dedup guard prevents double-fire).
  const weekDate = weekOfToDate(weekOf);
  const approvedSquads: SquadId[] = [];

  for (const sq of ALL_SQUADS) {
    const sqPageId = getSquadPageId(sq);
    const sqRows = await notion.databases.query({
      database_id: NOTION_IDS.dbs.squadWeeklySummary,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: sqPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
        ],
      },
      page_size: 20,
    });

    const pages = sqRows.results.filter(isFullPage);
    if (
      pages.length >= ALL_SOURCES.length &&
      pages.every((p) => {
        const s = p.properties["Status"];
        return s?.type === "select" && s.select?.name === "approved";
      })
    ) {
      approvedSquads.push(sq);
    }
  }

  if (approvedSquads.length >= 1) {
    // Dedup: only block if a PENDING trigger exists — a completed/skipped run should
    // allow re-firing when more squads approve (e.g. 1/3 skipped → 2/3 should publish).
    const existingTrigger = await notion.databases.query({
      database_id: NOTION_IDS.dbs.agentRunLog,
      filter: {
        and: [
          { property: "Agent Name", select: { equals: "summarizer.master" } },
          { property: "Outcome",    select: { equals: "pending" } },
        ],
      },
      page_size: 10,
    });

    const alreadyFired = existingTrigger.results.filter(isFullPage).some((p) => {
      const notes = richText(p.properties["Notes"]);
      return notes.includes(`week=${weekOf}`);
    });

    if (!alreadyFired) {
      await createMasterSummarizerTrigger({ weekOf, approvedSquads });
      console.log(
        `[hitl-review] Master summarizer trigger created for ${weekOf} ` +
        `(${approvedSquads.length}/3 squads approved: ${approvedSquads.join(", ")})`,
      );
    }
  }

  // Update review session: approved, with source count and timestamp
  await upsertReviewSession({
    squadId,
    weekOf,
    status: "approved",
    approvedAt: new Date().toISOString(),
  });

  return { approved: summaryPages.length, reviewPageId };
}

/**
 * Reject a single source summary for a squad+week.
 * Sets Status=rejected and writes an Agent Run Log entry.
 * The rejection comment is the signal for PRD-04's re-run agent.
 */
export async function rejectSummary(
  squadId: SquadId,
  weekOf: string,
  source: SummarySource,
  comment: string,
): Promise<void> {
  const notion = getNotionClient();
  const squadPageId = getSquadPageId(squadId);
  const weekDate = weekOfToDate(weekOf);
  const startedAt = new Date();

  const result = await notion.databases.query({
    database_id: NOTION_IDS.dbs.squadWeeklySummary,
    filter: {
      and: [
        { property: "Squad", relation: { contains: squadPageId } },
        { property: "Week Of", date: { equals: weekDate } },
        { property: "Source", select: { equals: source } },
      ],
    },
  });

  if (result.results.length === 0) {
    throw new Error(`No ${source} summary found for ${squadId}/${weekOf}.`);
  }

  const page = result.results[0];
  await notion.pages.update({
    page_id: page.id,
    properties: {
      "Status": { select: { name: "rejected" } },
    } as Parameters<typeof notion.pages.update>[0]["properties"],
  });

  const completedAt = new Date();
  await writeAgentRunLog({
    agentName: `approval.squad.${squadId}.${source}`,
    startedAt,
    completedAt,
    outcome: "ok",
    notes: `Rejected ${source} for ${squadId} week ${weekOf}. Reason: ${comment}`,
  });

  await upsertReviewSession({
    squadId,
    weekOf,
    status: "changes-requested",
    notes: `${source} rejected: ${comment}`,
  });

  console.log(`[hitl-review] Rejected ${source} for ${squadId}/${weekOf}`);
  console.log(`[hitl-review] Reason logged to Agent Run Log: "${comment}"`);
  console.log(`[hitl-review] Re-run signal: Agent Run Log entry → approval.squad.${squadId}.${source}`);
}
