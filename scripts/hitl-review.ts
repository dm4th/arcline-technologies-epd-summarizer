/**
 * HITL Review CLI — manual trigger for per-squad review page operations.
 *
 * Usage:
 *   pnpm hitl-review --action=seed          [--squad=atlas|lumen|forge|all] [--week=2026-W21]
 *   pnpm hitl-review --action=create-page    --squad=atlas  --week=2026-W21
 *   pnpm hitl-review --action=approve        --squad=atlas  --week=2026-W21
 *   pnpm hitl-review --action=reject         --squad=atlas  --week=2026-W21  --source=github --comment="Needs more detail"
 *   pnpm hitl-review --action=refresh-page   --squad=atlas  --week=2026-W21
 */

import type { SquadId } from "../src/types/core";
import {
  seedSquadWeeklySummaries,
  upsertMasterEpdWeekly,
  createReviewPage,
  approveSquadWeek,
  rejectSummary,
  ALL_SOURCES,
  ALL_SQUADS,
  type SummarySource,
} from "../src/workers/hitl-review";

const VALID_ACTIONS = ["seed", "create-page", "approve", "reject", "refresh-page"] as const;
type Action = (typeof VALID_ACTIONS)[number];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (prefix: string) => args.find((a) => a.startsWith(prefix))?.split("=").slice(1).join("=");

  const action  = get("--action=") as Action | undefined;
  const squad   = get("--squad=");
  const weekArg = get("--week=");
  const source  = get("--source=") as SummarySource | undefined;
  const comment = get("--comment=");

  return { action, squad, weekOf: weekArg ?? "2026-W21", source, comment };
}

function requireSquad(squad: string | undefined): SquadId | "all" {
  if (!squad) {
    console.error("Error: --squad=<atlas|lumen|forge|all> is required for this action.");
    process.exit(1);
  }
  if (squad !== "all" && !ALL_SQUADS.includes(squad as SquadId)) {
    console.error(`Error: Invalid squad "${squad}". Valid: ${ALL_SQUADS.join(", ")}, all`);
    process.exit(1);
  }
  return squad as SquadId | "all";
}

function requireSingleSquad(squad: string | undefined): SquadId {
  const s = requireSquad(squad);
  if (s === "all") {
    console.error("Error: --squad=all is not supported for this action. Pick a specific squad.");
    process.exit(1);
  }
  return s;
}

function requireSource(source: SummarySource | undefined): SummarySource {
  if (!source) {
    console.error(`Error: --source=<source> is required. Valid: ${ALL_SOURCES.join(", ")}`);
    process.exit(1);
  }
  if (!ALL_SOURCES.includes(source)) {
    console.error(`Error: Invalid source "${source}". Valid: ${ALL_SOURCES.join(", ")}`);
    process.exit(1);
  }
  return source;
}

(async () => {
  const { action, squad, weekOf, source, comment } = parseArgs();

  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    console.error(
      `Error: --action is required. Valid: ${VALID_ACTIONS.join(", ")}\n\n` +
      "Examples:\n" +
      "  pnpm hitl-review --action=seed --squad=all --week=2026-W21\n" +
      "  pnpm hitl-review --action=create-page --squad=atlas --week=2026-W21\n" +
      "  pnpm hitl-review --action=approve --squad=atlas --week=2026-W21\n" +
      '  pnpm hitl-review --action=reject --squad=atlas --week=2026-W21 --source=github --comment="Needs citations"\n' +
      "  pnpm hitl-review --action=refresh-page --squad=atlas --week=2026-W21",
    );
    process.exit(1);
  }

  if (action === "seed") {
    const target = squad ?? "all";
    const squads: SquadId[] = target === "all" ? ALL_SQUADS : [requireSingleSquad(target)];

    console.log(`Seeding Squad Weekly Summaries for week ${weekOf} (squads: ${squads.join(", ")})\n`);
    let totalCreated = 0;
    let totalSkipped = 0;

    for (const s of squads) {
      const { created, skipped } = await seedSquadWeeklySummaries(s, weekOf);
      console.log(`  ${s}: ${created} created, ${skipped} skipped`);
      totalCreated += created;
      totalSkipped += skipped;
    }

    // Seed the Master EPD Weekly row, linking all squad sessions so the
    // Squad Approval Rate rollup has a denominator before any agent runs.
    const { pageId: masterPageId, action: masterAction } = await upsertMasterEpdWeekly(weekOf);
    console.log(`  master-epd-weekly: ${masterAction} (${masterPageId})`);

    console.log(`\nSeed complete — ${totalCreated} created, ${totalSkipped} skipped.`);
    return;
  }

  if (action === "create-page" || action === "refresh-page") {
    const squadId = requireSingleSquad(squad);
    console.log(`Creating review page for ${squadId} / ${weekOf} …`);
    const pageId = await createReviewPage(squadId, weekOf);
    console.log(`\nDone — review page ID: ${pageId}`);
    return;
  }

  if (action === "approve") {
    const squadId = requireSingleSquad(squad);
    console.log(`Approving all summaries for ${squadId} / ${weekOf} …`);
    const { approved, reviewPageId } = await approveSquadWeek(squadId, weekOf);
    console.log(`\nDone — approved ${approved} summaries.`);
    console.log(`Review page refreshed: ${reviewPageId}`);
    return;
  }

  if (action === "reject") {
    const squadId  = requireSingleSquad(squad);
    const src      = requireSource(source);
    const msg      = comment ?? "";

    if (!msg) {
      console.error("Error: --comment=<reason> is required for reject.");
      process.exit(1);
    }

    console.log(`Rejecting ${src} summary for ${squadId} / ${weekOf} …`);
    await rejectSummary(squadId, weekOf, src, msg);
    console.log("\nDone. Run --action=refresh-page to update the review page.");
    return;
  }
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
