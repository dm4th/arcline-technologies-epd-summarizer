/**
 * Manual trigger for the master summarizer agent.
 *
 * Run this for the Monday 10:00AM fallback when ≥2 squads are approved but
 * the automatic fan-in in hitl-review didn't fire (e.g., squads were approved
 * before this code was deployed), or for testing without running full HITL.
 *
 * Usage:
 *   pnpm master-summarizer                  # default week
 *   pnpm master-summarizer --week=2026-W21  # explicit week
 *
 * This creates an Agent Run Log row with:
 *   Agent Name = "summarizer.master"
 *   Outcome    = "pending"
 *   Notes      = "week=YYYY-Www approved=<comma-separated approved squads>"
 *
 * After running, open the Master Summarizer Custom Agent in Notion and start
 * a new session to process the pending trigger row.
 */

import { createMasterSummarizerTrigger } from "../src/workers/lib/agent-run-log";
import { getNotionClient } from "../src/lib/notion";
import { NOTION_IDS, getSquadPageId } from "../src/lib/notion-ids";
import { isFullPage } from "@notionhq/client";
import { ALL_SQUADS, ALL_SOURCES, weekOfToDate } from "../src/workers/hitl-review";
import type { SquadId } from "../src/types/core";

const args   = process.argv.slice(2);
const weekOf = args.find((a) => a.startsWith("--week="))?.split("=")[1] ?? "2026-W21";

async function run() {
  const notion   = getNotionClient();
  const weekDate = weekOfToDate(weekOf);

  console.log(`\nChecking squad approval status for week ${weekOf} (${weekDate})…`);

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
    const allApproved =
      pages.length >= ALL_SOURCES.length &&
      pages.every((p) => {
        const s = p.properties["Status"];
        return s?.type === "select" && s.select?.name === "approved";
      });

    const status = allApproved ? "✅ approved" : `❌ not fully approved (${pages.length} rows)`;
    console.log(`  ${sq.padEnd(8)} ${status}`);

    if (allApproved) approvedSquads.push(sq);
  }

  if (approvedSquads.length === 0) {
    console.log("\n⚠ No squads are fully approved — cannot trigger master summarizer.");
    process.exit(1);
  }

  console.log(`\n${approvedSquads.length}/3 squads approved: ${approvedSquads.join(", ")}`);

  if (approvedSquads.length < 2) {
    console.log("⚠ Quorum requires ≥2 squads. Creating trigger anyway for testing purposes.");
    console.log("  The master summarizer will handle the below-quorum case and write a skipped log.");
  }

  await createMasterSummarizerTrigger({ weekOf, approvedSquads });
  console.log(`\n✓ Trigger created — open the Master Summarizer agent in Notion to process.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
