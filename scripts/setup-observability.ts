/**
 * Creates or refreshes the "Weekly Pipeline Dashboard" page.
 *
 * Queries the Agent Run Log for the target week, computes summary stats,
 * then writes a prose overview to the dashboard page under BASE_NOTION_PAGE.
 * Linked-database view blocks are appended by the /prd-07 setup flow after
 * this script runs (the Notion public API has no linked-database block type).
 *
 * Usage:
 *   pnpm tsx scripts/setup-observability.ts              # current week (ISO)
 *   pnpm tsx scripts/setup-observability.ts --week=2026-W21
 *   pnpm tsx scripts/setup-observability.ts --all        # all time (no date filter)
 */

import { isFullPage, isFullBlock } from "@notionhq/client";
import { getNotionClient } from "../src/lib/notion";
import { extractPageId } from "../src/lib/notion";
import { loadEnv } from "../src/lib/env";
import { NOTION_IDS } from "../src/lib/notion-ids";

// ── helpers ──────────────────────────────────────────────────────────────────

function isoWeekBounds(weekOf: string): { start: string; end: string } {
  const [yearStr, weekStr] = weekOf.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (dow - 1));
  const monday = new Date(week1Mon);
  monday.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: monday.toISOString().split("T")[0],
    end: sunday.toISOString().split("T")[0],
  };
}

function currentIsoWeek(): string {
  const now = new Date();
  const jan4 = new Date(Date.UTC(now.getUTCFullYear(), 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (dow - 1));
  const diff = now.getTime() - week1Mon.getTime();
  const week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${now.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const rt = (s: string) => [{ text: { content: s.substring(0, 1999) } }];

// ── query log ────────────────────────────────────────────────────────────────

type RunRow = {
  agentName: string;
  outcome: string;
  durationMs: number;
  tokenCostUsd: number;
  startedAt: string;
};

async function queryRunLog(
  weekBounds: { start: string; end: string } | null
): Promise<RunRow[]> {
  const notion = getNotionClient();
  const filter = weekBounds
    ? {
        and: [
          {
            property: "Started At",
            date: { on_or_after: weekBounds.start },
          },
          {
            property: "Started At",
            date: { on_or_before: weekBounds.end },
          },
        ],
      }
    : undefined;

  const results: RunRow[] = [];
  let cursor: string | undefined;
  do {
    const resp = await notion.databases.query({
      database_id: NOTION_IDS.dbs.agentRunLog,
      ...(filter ? { filter: filter as Parameters<typeof notion.databases.query>[0]["filter"] } : {}),
      sorts: [{ property: "Started At", direction: "ascending" }],
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    for (const page of resp.results) {
      if (!isFullPage(page)) continue;
      const p = page.properties;
      const agentSel = p["Agent Name"]?.type === "select" ? p["Agent Name"].select?.name ?? "unknown" : "unknown";
      const outcomeSel = p["Outcome"]?.type === "select" ? p["Outcome"].select?.name ?? "" : "";
      const dur = p["Duration ms"]?.type === "number" ? (p["Duration ms"].number ?? 0) : 0;
      const cost = p["Token Cost USD"]?.type === "number" ? (p["Token Cost USD"].number ?? 0) : 0;
      const started = p["Started At"]?.type === "date" ? (p["Started At"].date?.start ?? "") : "";
      results.push({ agentName: agentSel, outcome: outcomeSel, durationMs: dur, tokenCostUsd: cost, startedAt: started });
    }
    cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return results;
}

// ── create / refresh page ────────────────────────────────────────────────────

async function findDashboardPage(rootPageId: string): Promise<string | null> {
  const notion = getNotionClient();
  const title = "Weekly Pipeline Dashboard";
  let cursor: string | undefined;
  do {
    const list = await notion.blocks.children.list({
      block_id: rootPageId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const block of list.results) {
      if (
        isFullBlock(block) &&
        block.type === "child_page" &&
        block.child_page.title === title
      ) {
        return block.id;
      }
    }
    cursor = list.has_more ? (list.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return null;
}

async function buildBlocks(
  rows: RunRow[],
  weekLabel: string
): Promise<Parameters<typeof import("@notionhq/client").Client.prototype.blocks.children.append>[0]["children"]> {
  const totalMs = rows.reduce((s, r) => s + r.durationMs, 0);
  const totalCost = rows.reduce((s, r) => s + r.tokenCostUsd, 0);
  const errors = rows.filter((r) => r.outcome === "error").length;
  const approvals = rows.filter((r) => r.agentName.includes("approval")).length;
  const totalRuns = rows.length;

  const totalMin = (totalMs / 60000).toFixed(1);
  const costStr = totalCost === 0 ? "$0.00" : `$${totalCost.toFixed(4)}`;
  const proseLine =
    `This week's pipeline (${weekLabel}) ran ${totalRuns} agent invocations in ` +
    `${totalMin} minutes total, cost ${costStr}, with ${approvals} approval(s) and ${errors} error(s).`;

  // Breakdown by agent
  const byAgent: Record<string, { count: number; totalMs: number }> = {};
  for (const r of rows) {
    byAgent[r.agentName] ??= { count: 0, totalMs: 0 };
    byAgent[r.agentName].count++;
    byAgent[r.agentName].totalMs += r.durationMs;
  }

  const agentLines = Object.entries(byAgent)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .map(([name, s]) => `${name}: ${s.count} run(s), ${(s.totalMs / 1000).toFixed(1)}s`)
    .join("\n");

  return [
    {
      object: "block" as const,
      type: "callout" as const,
      callout: {
        rich_text: [{ type: "text" as const, text: { content: proseLine } }],
        icon: { type: "emoji" as const, emoji: "📊" },
        color: "blue_background" as const,
      },
    },
    {
      object: "block" as const,
      type: "heading_2" as const,
      heading_2: {
        rich_text: [{ type: "text" as const, text: { content: "This Week at a Glance" } }],
      },
    },
    {
      object: "block" as const,
      type: "bulleted_list_item" as const,
      bulleted_list_item: {
        rich_text: rt(`Total agent runs: ${totalRuns}`),
      },
    },
    {
      object: "block" as const,
      type: "bulleted_list_item" as const,
      bulleted_list_item: {
        rich_text: rt(`Total wall time: ${totalMin} min`),
      },
    },
    {
      object: "block" as const,
      type: "bulleted_list_item" as const,
      bulleted_list_item: {
        rich_text: rt(`Total cost: ${costStr}`),
      },
    },
    {
      object: "block" as const,
      type: "bulleted_list_item" as const,
      bulleted_list_item: {
        rich_text: rt(`Errors: ${errors}`),
      },
    },
    {
      object: "block" as const,
      type: "bulleted_list_item" as const,
      bulleted_list_item: {
        rich_text: rt(`Approvals: ${approvals}`),
      },
    },
    {
      object: "block" as const,
      type: "heading_2" as const,
      heading_2: {
        rich_text: [{ type: "text" as const, text: { content: "By Agent" } }],
      },
    },
    {
      object: "block" as const,
      type: "code" as const,
      code: {
        rich_text: rt(agentLines || "(no runs this week)"),
        language: "plain text" as const,
      },
    },
    {
      object: "block" as const,
      type: "divider" as const,
      divider: {},
    },
    {
      object: "block" as const,
      type: "heading_2" as const,
      heading_2: {
        rich_text: [{ type: "text" as const, text: { content: "Agent Run Log Views" } }],
      },
    },
    {
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: {
        rich_text: rt(
          "The five live views below are embedded from the Agent Run Log database. " +
          "Use them to drill into latency, cost, and errors across the pipeline."
        ),
      },
    },
  ] as Parameters<typeof import("@notionhq/client").Client.prototype.blocks.children.append>[0]["children"];
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  const notion = getNotionClient();
  const env = loadEnv();
  const rootPageId = extractPageId(env.BASE_NOTION_PAGE);

  const args = process.argv.slice(2);
  const allTime = args.includes("--all");
  const weekArg = args.find((a) => a.startsWith("--week="))?.split("=")[1];
  const weekOf = weekArg ?? currentIsoWeek();
  const weekBounds = allTime ? null : isoWeekBounds(weekOf);
  const weekLabel = allTime ? "all time" : weekOf;

  console.log(`Querying Agent Run Log for ${weekLabel}...`);
  const rows = await queryRunLog(weekBounds);
  console.log(`  Found ${rows.length} run(s).`);

  const totalMs = rows.reduce((s, r) => s + r.durationMs, 0);
  const totalCost = rows.reduce((s, r) => s + r.tokenCostUsd, 0);
  const errors = rows.filter((r) => r.outcome === "error").length;
  const approvals = rows.filter((r) => r.agentName.includes("approval")).length;
  console.log(`  Total: ${(totalMs / 60000).toFixed(1)} min | $${totalCost.toFixed(4)} | ${errors} error(s) | ${approvals} approval(s)`);

  const blocks = await buildBlocks(rows, weekLabel);

  // Find or create dashboard page
  let dashPageId = await findDashboardPage(rootPageId);

  if (dashPageId) {
    console.log(`\nRefreshing existing dashboard page: ${dashPageId}`);
    // Clear existing blocks
    let cursor: string | undefined;
    do {
      const existing = await notion.blocks.children.list({
        block_id: dashPageId,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const b of existing.results) {
        await notion.blocks.delete({ block_id: b.id });
      }
      cursor = existing.has_more ? (existing.next_cursor ?? undefined) : undefined;
    } while (cursor);
  } else {
    console.log("\nCreating new Weekly Pipeline Dashboard page...");
    const newPage = await notion.pages.create({
      parent: { page_id: rootPageId },
      icon: { type: "emoji", emoji: "📊" },
      properties: {
        title: { title: rt("Weekly Pipeline Dashboard") },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });
    dashPageId = newPage.id;
    console.log(`  Created: ${dashPageId}`);
  }

  await notion.blocks.children.append({
    block_id: dashPageId,
    children: blocks,
  });

  console.log(`\nDashboard page updated: https://notion.so/${dashPageId.replace(/-/g, "")}`);
  console.log("\nNext step: embed the 5 Agent Run Log views into this page via the Notion MCP.");
  console.log(`  Dashboard page ID: ${dashPageId}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
