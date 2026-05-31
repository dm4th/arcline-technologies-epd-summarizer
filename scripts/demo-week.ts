/**
 * demo-week.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * End-to-end weekly pipeline runner for demos and testing.
 *
 * Automates the setup phase of the weekly pipeline:
 *   1. Run all 4 source workers (ingest fixture → Mirror DBs)
 *   2. Seed Squad Weekly Summary placeholder rows for all squads
 *   3. Create the Master EPD Weekly row (links HITL Review Sessions)
 *
 * Approval and master trigger fire SEPARATELY via approve-week.ts, which
 * gates on squad consolidation content being present. This prevents the
 * master summarizer from running against empty placeholder pages.
 *
 * Full automated pipeline (no Notion agents needed):
 *   pnpm demo-week --week=2026-W19          # setup
 *   pnpm generate-summaries --week=2026-W19  # generate squad content
 *   pnpm approve-week --week=2026-W19        # HITL approval + master trigger
 *   pnpm generate-master --week=2026-W19     # generate master report
 *   pnpm eval --week=2026-W19               # score it
 *
 * Or use Notion agents for the generation/summarization steps.
 *
 * Usage:
 *   pnpm demo-week --week=2026-W19
 *   pnpm demo-week --week=2026-W20
 *   pnpm demo-week --week=2026-W21
 *   pnpm demo-week --week=2026-W21 --dry-run
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { loadEnv } from "../src/lib/env";
import {
  seedSquadWeeklySummaries,
  upsertMasterEpdWeekly,
  ALL_SQUADS,
} from "../src/workers/hitl-review";
import { runSourceWorker } from "../src/workers/lib/source-worker";
import { githubWorkerConfig } from "../src/workers/github";
import { jiraWorkerConfig } from "../src/workers/jira";
import { slackWorkerConfig } from "../src/workers/slack";
import { figmaWorkerConfig } from "../src/workers/figma";
import type { SquadId } from "../src/types/core";

const args    = process.argv.slice(2);
const weekOf  = args.find((a) => a.startsWith("--week="))?.split("=")[1];
const DRY_RUN = args.includes("--dry-run");

async function main(): Promise<void> {
  loadEnv();

  if (!weekOf) {
    console.error("Usage: pnpm demo-week --week=YYYY-Www [--vp-feedback='...'] [--dry-run]");
    console.error("  Example: pnpm demo-week --week=2026-W21");
    process.exit(1);
  }

  const dryLabel = DRY_RUN ? " (DRY RUN — workers will still run; approvals skipped)" : "";
  console.log("═".repeat(60));
  console.log(`Arcline Demo Week — ${weekOf}${dryLabel}`);
  console.log("═".repeat(60));

  // ── Step 1: Source workers ─────────────────────────────────────────────────

  console.log(`\n[1/3] Running source workers for ${weekOf}…`);
  const workerConfigs = [githubWorkerConfig, jiraWorkerConfig, slackWorkerConfig, figmaWorkerConfig];

  for (const config of workerConfigs) {
    console.log(`  → ${config.source} worker…`);
    if (!DRY_RUN) {
      await runSourceWorker(config, weekOf);
    } else {
      console.log(`     [dry] skipping`);
    }
  }
  console.log(`[1/3] ✓ Source workers complete.`);

  // ── Step 2: Seed Squad Weekly Summary placeholder rows ────────────────────

  console.log(`\n[2/3] Seeding Squad Weekly Summary rows…`);
  for (const squad of ALL_SQUADS as SquadId[]) {
    if (!DRY_RUN) {
      const { created, skipped } = await seedSquadWeeklySummaries(squad, weekOf);
      console.log(`  → ${squad}: ${created} created, ${skipped} skipped`);
    } else {
      console.log(`  → ${squad}: [dry] skipping`);
    }
  }
  console.log(`[2/3] ✓ HITL seed complete.`);

  // ── Step 3: Upsert Master EPD Weekly row ──────────────────────────────────

  console.log(`\n[3/3] Creating Master EPD Weekly row for ${weekOf}…`);
  if (!DRY_RUN) {
    const { action } = await upsertMasterEpdWeekly(weekOf);
    console.log(`[3/3] ✓ Master EPD Weekly row ${action}.`);
  } else {
    console.log(`[3/3] [dry] skipping master EPD row creation.`);
  }

  // ── Summary and next steps ────────────────────────────────────────────────

  console.log("\n" + "─".repeat(60));
  console.log(`✓  ${weekOf} workspace setup complete.`);
  console.log("─".repeat(60));
  console.log("\n  NEXT STEPS (choose one path):\n");
  console.log("  PATH A — Fully automated (no Notion agents needed):");
  console.log(`     pnpm generate-summaries --week=${weekOf}`);
  console.log(`     pnpm approve-week --week=${weekOf}`);
  console.log(`     pnpm generate-master --week=${weekOf}`);
  console.log(`     pnpm eval --week=${weekOf}`);
  console.log("\n  PATH B — Notion agents (production flow):");
  console.log("     1. Run source summarizer agents (×12: 4 sources × 3 squads)");
  console.log("     2. Run squad consolidation agents (×3: one per squad)");
  console.log(`     3. Review HITL sessions in Notion, then: pnpm approve-week --week=${weekOf}`);
  console.log("     4. Run master summarizer agent (×1) OR:");
  console.log(`        pnpm generate-master --week=${weekOf}`);
  console.log(`     5. pnpm eval --week=${weekOf}`);
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
