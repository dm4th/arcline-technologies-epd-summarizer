/**
 * seed-week.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates the structural scaffolding for a weekly pipeline run:
 *   1. Seeds Squad Weekly Summary placeholder rows for all squads × sources
 *   2. Creates the HITL Review Session page for each squad
 *   3. Upserts the Master EPD Weekly row (links to the HITL sessions)
 *
 * This is the seeding half of demo-week.ts, extracted as its own script so it
 * can run on a separate cron schedule (e.g. 6:30AM Monday) — after the mirror
 * data scrapers have ingested fresh data (6AM) and before the Notion source
 * summarizer agents fire (7AM).
 *
 * Idempotent: rows that already exist are skipped, not duplicated. Safe to
 * re-run if the cron fires twice or if a partial run needs to be retried.
 *
 * Usage:
 *   pnpm seed-week --week=2026-W21
 *   pnpm seed-week --week=2026-W19 --dry-run
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { loadEnv } from "../src/lib/env";
import {
  seedSquadWeeklySummaries,
  upsertMasterEpdWeekly,
  ALL_SQUADS,
} from "../src/workers/hitl-review";
import type { SquadId } from "../src/types/core";

const args    = process.argv.slice(2);
const weekOf  = args.find((a) => a.startsWith("--week="))?.split("=")[1];
const DRY_RUN = args.includes("--dry-run");

async function main(): Promise<void> {
  loadEnv();

  if (!weekOf) {
    console.error("Usage: pnpm seed-week --week=YYYY-Www [--dry-run]");
    console.error("  Example: pnpm seed-week --week=2026-W21");
    process.exit(1);
  }

  const dryLabel = DRY_RUN ? " (DRY RUN — no writes)" : "";
  console.log("═".repeat(60));
  console.log(`Arcline Seed Week — ${weekOf}${dryLabel}`);
  console.log("═".repeat(60));
  console.log("  Creates Squad Weekly Summary rows, HITL Review Sessions,");
  console.log("  and the Master EPD Weekly row. Skips existing rows.\n");

  // ── Step 1: Squad Weekly Summary placeholder rows ─────────────────────────

  console.log(`[1/2] Seeding Squad Weekly Summary rows…`);
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const squad of ALL_SQUADS as SquadId[]) {
    if (DRY_RUN) {
      console.log(`  → ${squad}: [dry] skipping`);
      continue;
    }
    const { created, skipped } = await seedSquadWeeklySummaries(squad, weekOf);
    console.log(`  → ${squad}: ${created} created, ${skipped} skipped`);
    totalCreated += created;
    totalSkipped += skipped;
  }

  if (!DRY_RUN) {
    console.log(`[1/2] ✓ ${totalCreated} rows created, ${totalSkipped} already existed.\n`);
  } else {
    console.log(`[1/2] [dry] skipped.\n`);
  }

  // ── Step 2: Master EPD Weekly row ─────────────────────────────────────────

  console.log(`[2/2] Upserting Master EPD Weekly row for ${weekOf}…`);
  if (DRY_RUN) {
    console.log(`[2/2] [dry] skipping.`);
  } else {
    const { action } = await upsertMasterEpdWeekly(weekOf);
    console.log(`[2/2] ✓ Master EPD Weekly row ${action}.`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n" + "─".repeat(60));
  if (!DRY_RUN) {
    console.log(`✓  ${weekOf} seeding complete.`);
    console.log("─".repeat(60));
    console.log("\n  NEXT STEP:");
    console.log("  Run Notion source summarizer agents (×12) in the Notion UI,");
    console.log("  or generate content directly via Claude:");
    console.log(`\n     pnpm generate-summaries --week=${weekOf}`);
  } else {
    console.log(`[dry] No changes made. Remove --dry-run to seed.`);
  }
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
