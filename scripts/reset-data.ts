/**
 * reset-data.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  DESTRUCTIVE — archives Notion row pages from data databases.
 *
 * Unlike teardown-workspace.ts (which archives the databases themselves),
 * this script archives only the *rows* within data databases. DB schemas,
 * notion-ids.ts, and config databases (Squads, PRDs, Product Roadmap) are
 * never touched.
 *
 * With --week=YYYY-Www: clears only rows belonging to that week.
 * Without --week:        clears all rows across all weeks (full data wipe).
 *
 * SAFETY GATE: you must pass --yes or --dry-run explicitly.
 *
 * Usage:
 *   pnpm reset-data --week=2026-W21 --yes      ← clear W21 rows only
 *   pnpm reset-data --week=2026-W21 --dry-run  ← safe preview
 *   pnpm reset-data --yes                      ← full data wipe (all weeks)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getNotionClient } from "../src/lib/notion";
import { loadEnv } from "../src/lib/env";
import { NOTION_IDS } from "../src/lib/notion-ids";
import { weekOfToDate } from "../src/workers/hitl-review";

const DRY_RUN = process.argv.includes("--dry-run");
const YES     = process.argv.includes("--yes");
const weekArg = process.argv.find((a) => a.startsWith("--week="))?.split("=")[1];

// Notion's practical rate limit is ~3 req/s; 3 parallel archives is safe
const ARCHIVE_CONCURRENCY = 3;

// ── DB registry with filter strategies ───────────────────────────────────────
//
// Three strategies because different DBs use different date fields:
//   "week-of"         — "Week Of" date property (exact match on week's Monday)
//   "notes-contains"  — "Notes" rich_text contains the weekOf string
//                       (Agent Run Log lacks Week Of; the week appears in Notes)
//   "last-updated"    — "Last Updated" date range covering the 7-day window
//                       (Mirror DBs store the fixture's lastUpdated timestamp)

type FilterStrategy = "week-of" | "notes-contains" | "last-updated";

type DbEntry = {
  id: string;
  label: string;
  strategy: FilterStrategy;
};

const DATA_DBS: DbEntry[] = [
  // Week-keyed DBs — have an explicit "Week Of" date property
  { id: NOTION_IDS.dbs.squadWeeklySummary, label: "Squad Weekly Summary", strategy: "week-of" },
  { id: NOTION_IDS.dbs.masterEpdWeekly,   label: "Master EPD Weekly",    strategy: "week-of" },
  { id: NOTION_IDS.dbs.hitlReviewSessions, label: "HITL Review Sessions", strategy: "week-of" },
  { id: NOTION_IDS.dbs.deliveryPipeline,  label: "Delivery Pipeline",    strategy: "week-of" },
  // Agent Run Log — no Week Of, but every row's Notes contains the week string
  { id: NOTION_IDS.dbs.agentRunLog,       label: "Agent Run Log",        strategy: "notes-contains" },
  // Mirror DBs — use Last Updated date range (reflects the fixture week, not run date)
  { id: NOTION_IDS.dbs.mirrorGithub,      label: "GitHub | Mirror",      strategy: "last-updated" },
  { id: NOTION_IDS.dbs.mirrorJira,        label: "Jira | Mirror",        strategy: "last-updated" },
  { id: NOTION_IDS.dbs.mirrorSlack,       label: "Slack | Mirror",       strategy: "last-updated" },
  { id: NOTION_IDS.dbs.mirrorFigma,       label: "Figma | Mirror",       strategy: "last-updated" },
];

// ── Filter builders ───────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

type NotionFilter = Parameters<ReturnType<typeof getNotionClient>["databases"]["query"]>[0]["filter"];

function buildFilter(entry: DbEntry, weekOf: string | undefined): NotionFilter | undefined {
  if (!weekOf) return undefined; // no week → clear all rows

  const weekDate = weekOfToDate(weekOf);

  switch (entry.strategy) {
    case "week-of":
      return { property: "Week Of", date: { equals: weekDate } };

    case "notes-contains":
      // Every Agent Run Log row embeds the week string in Notes, e.g.:
      //   "week=2026-W21 created=27 ..."  or  "week=2026-W21"
      return { property: "Notes", rich_text: { contains: weekOf } };

    case "last-updated": {
      // Mirror rows have "Last Updated" set to the fixture's lastUpdated date.
      // Records touched in this week have timestamps within [weekStart, weekEnd].
      const weekEnd = addDays(weekDate, 6);
      return {
        and: [
          { property: "Last Updated", date: { on_or_after: weekDate } },
          { property: "Last Updated", date: { on_or_before: weekEnd } },
        ],
      };
    }
  }
}

// ── Core archive loop ─────────────────────────────────────────────────────────

async function clearDatabase(entry: DbEntry, filter: NotionFilter | undefined): Promise<number> {
  const notion = getNotionClient();
  let total = 0;
  let cursor: string | undefined;

  do {
    const resp = await notion.databases.query({
      database_id: entry.id,
      page_size: 100,
      ...(filter ? { filter } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    for (let i = 0; i < resp.results.length; i += ARCHIVE_CONCURRENCY) {
      const batch = resp.results.slice(i, i + ARCHIVE_CONCURRENCY);
      if (!DRY_RUN) {
        await Promise.all(
          batch.map((p) => notion.pages.update({ page_id: p.id, archived: true })),
        );
      }
      total += batch.length;
    }

    cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return total;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  if (!DRY_RUN && !YES) {
    console.error("\n" + "█".repeat(60));
    console.error("  SAFETY GATE — reset-data requires --yes or --dry-run");
    console.error("█".repeat(60));
    console.error("\n  Archives data rows in the live Notion workspace.");
    console.error("  DB schemas, config data (Squads, PRDs, Roadmap), and");
    console.error("  rows from other weeks are never touched.\n");
    if (weekArg) {
      console.error(`  Scope: week ${weekArg} only\n`);
    } else {
      console.error("  ⚠️  No --week flag — will wipe ALL rows across ALL weeks.\n");
    }
    console.error("  To proceed:");
    const suffix = weekArg ? ` --week=${weekArg}` : "";
    console.error(`    pnpm reset-data${suffix} --yes`);
    console.error(`    pnpm reset-data${suffix} --dry-run   ← safe preview\n`);
    process.exit(1);
  }

  const scopeLabel = weekArg ? `week ${weekArg}` : "ALL WEEKS";
  const modeLabel  = DRY_RUN ? " (DRY RUN)" : " (--yes confirmed)";
  console.log("─".repeat(60));
  console.log(`Arcline Data Reset — ${scopeLabel}${modeLabel}`);
  console.log("─".repeat(60));

  if (!weekArg && !DRY_RUN) {
    console.log("⚠️  No --week flag — wiping all rows across all weeks.\n");
  }

  let grandTotal = 0;
  const errors: string[] = [];

  for (const entry of DATA_DBS) {
    try {
      const filter = buildFilter(entry, weekArg);
      const count  = await clearDatabase(entry, filter);
      const pad    = " ".repeat(Math.max(0, 24 - entry.label.length));
      const verb   = DRY_RUN ? "would archive" : "archived";
      console.log(`  [${entry.label}]${pad} ${verb} ${count} rows`);
      grandTotal += count;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [${entry.label}]  ⚠️  error — ${msg}`);
      errors.push(`${entry.label}: ${msg}`);
    }
  }

  console.log("─".repeat(60));
  if (DRY_RUN) {
    console.log(`Dry run complete — would archive ${grandTotal} rows. No changes made.`);
  } else {
    console.log(`✓  Reset complete — archived ${grandTotal} rows total.`);
    if (weekArg) {
      console.log(`\n   Next: pnpm workers --week=${weekArg}   (re-ingest fresh data)`);
    }
  }
  if (errors.length > 0) {
    console.log(`\n   ⚠️  ${errors.length} DB(s) errored (see above). Partial reset.`);
  }
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
