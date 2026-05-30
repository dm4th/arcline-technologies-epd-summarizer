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
        "Status":       { select: { name: "awaiting-review" } },
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

    console.log(`  [hitl-review/seed] created ${squadId}/${source}: ${page.id}`);
    created++;
  }

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
  return newPage.id;
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

  if (approvedSquads.length >= 2) {
    // Dedup: only create the trigger once per week
    const existingTrigger = await notion.databases.query({
      database_id: NOTION_IDS.dbs.agentRunLog,
      filter: { property: "Agent Name", select: { equals: "summarizer.master" } },
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

  console.log(`[hitl-review] Rejected ${source} for ${squadId}/${weekOf}`);
  console.log(`[hitl-review] Reason logged to Agent Run Log: "${comment}"`);
  console.log(`[hitl-review] Re-run signal: Agent Run Log entry → approval.squad.${squadId}.${source}`);
}
