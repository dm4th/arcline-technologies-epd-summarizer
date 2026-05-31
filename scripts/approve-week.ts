/**
 * approve-week.ts
 *
 * Gated HITL approval: verifies squad consolidations exist before approving
 * and firing the master summarizer trigger.
 *
 * This is the step the user (or eng manager) runs AFTER reviewing the
 * squad consolidations in the Notion HITL Review Sessions.
 *
 * Safety gate: exits with an error if any squad's HITL Review Session does
 * not have a "Consolidated At" timestamp — meaning generate-summaries (or
 * the Notion squad consolidation agent) hasn't written content yet.
 *
 * Usage:
 *   pnpm approve-week --week=2026-W19
 *   pnpm approve-week --week=2026-W20 --vp-feedback="Track Atlas/Lumen auth v2 dep"
 *   pnpm approve-week --week=2026-W19 --skip-content-check   (override for edge cases)
 */

import { isFullPage } from "@notionhq/client";
import { getNotionClient } from "../src/lib/notion";
import { loadEnv } from "../src/lib/env";
import { NOTION_IDS, getSquadPageId } from "../src/lib/notion-ids";
import {
  approveSquadWeek,
  weekOfToDate,
  ALL_SQUADS,
} from "../src/workers/hitl-review";
import type { SquadId } from "../src/types/core";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args           = process.argv.slice(2);
const weekOf         = args.find((a) => a.startsWith("--week="))?.split("=")[1];
const vpFeedbackArg  = args.find((a) => a.startsWith("--vp-feedback="))?.split("=").slice(1).join("=");
const skipContentCheck = args.includes("--skip-content-check");
const SQUAD_STAGGER_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function previousWeek(weekOfStr: string): string {
  const [yearStr, weekStr] = weekOfStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  if (week === 1) return `${year - 1}-W52`;
  return `${year}-W${String(week - 1).padStart(2, "0")}`;
}

// ── Content gate: check HITL sessions have consolidation content ──────────────

async function checkConsolidationExists(squad: SquadId, weekOf: string): Promise<boolean> {
  const notion      = getNotionClient();
  const squadPageId = getSquadPageId(squad);
  const weekDate    = weekOfToDate(weekOf);

  const resp = await notion.databases.query({
    database_id: NOTION_IDS.dbs.hitlReviewSessions,
    filter: {
      and: [
        { property: "Squad",   relation: { contains: squadPageId } },
        { property: "Week Of", date:     { equals: weekDate } },
      ],
    },
    page_size: 5,
  });

  const session = resp.results.filter(isFullPage)[0];
  if (!session) return false;

  // Consolidated At is set by write_squad_consolidation (worker tool) or
  // generate-summaries.ts. Its presence means real content has been written.
  const consolidatedAt = session.properties["Consolidated At"] as
    | { date?: { start?: string } }
    | undefined;

  return !!(consolidatedAt?.date?.start);
}

// ── VP feedback: post Notion comment on previous week's master page ───────────

async function injectVpFeedback(currentWeekOf: string, feedbackText: string): Promise<void> {
  const notion      = getNotionClient();
  const prevWeek    = previousWeek(currentWeekOf);
  const prevWeekDate = weekOfToDate(prevWeek);

  console.log(`\n[vp-feedback] Looking for ${prevWeek} master page (${prevWeekDate})…`);

  const resp = await notion.databases.query({
    database_id: NOTION_IDS.dbs.masterEpdWeekly,
    filter: { property: "Week Of", date: { equals: prevWeekDate } },
    page_size: 5,
  });

  if (resp.results.length === 0) {
    console.warn(`[vp-feedback] No master page found for ${prevWeek} — skipping.`);
    return;
  }

  const prevPageId = resp.results[0].id;
  await notion.comments.create({
    parent: { page_id: prevPageId },
    rich_text: [{ type: "text", text: { content: `VP Feedback (→ ${currentWeekOf}): ${feedbackText}` } }],
  });

  console.log(`[vp-feedback] ✓ Comment posted on ${prevWeek} master page.`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  if (!weekOf) {
    console.error("Usage: pnpm approve-week --week=YYYY-Www [--vp-feedback='...'] [--skip-content-check]");
    process.exit(1);
  }

  console.log("═".repeat(60));
  console.log(`Arcline Approve Week — ${weekOf}`);
  console.log("═".repeat(60));

  // ── Content gate ──────────────────────────────────────────────────────────
  if (!skipContentCheck) {
    console.log("\n[gate] Checking squad consolidations exist…");
    const missing: SquadId[] = [];

    for (const squad of ALL_SQUADS as SquadId[]) {
      const hasContent = await checkConsolidationExists(squad, weekOf);
      if (hasContent) {
        console.log(`  ✓ ${squad}: consolidation content present`);
      } else {
        console.log(`  ✗ ${squad}: NO consolidation content (Consolidated At is unset)`);
        missing.push(squad);
      }
    }

    if (missing.length > 0) {
      console.error(
        `\n[BLOCKED] ${missing.join(", ")} missing consolidation content.\n` +
        `\nOptions:\n` +
        `  A) Run Anthropic-based generation:  pnpm generate-summaries --week=${weekOf}\n` +
        `  B) Run Notion squad consolidation agents in the Notion UI\n` +
        `  C) Override gate (not recommended): pnpm approve-week --week=${weekOf} --skip-content-check`,
      );
      process.exit(1);
    }

    console.log("[gate] ✓ All squads have consolidation content.\n");
  } else {
    console.log("[gate] Content check skipped (--skip-content-check).\n");
  }

  // ── Approve squads with 800ms stagger ─────────────────────────────────────
  console.log(`Approving squads (${SQUAD_STAGGER_MS}ms stagger)…`);
  for (let i = 0; i < ALL_SQUADS.length; i++) {
    const squad = ALL_SQUADS[i] as SquadId;
    if (i > 0) await sleep(SQUAD_STAGGER_MS);

    const { approved } = await approveSquadWeek(squad, weekOf);
    const label = i === 0 ? " ← master trigger fired" : "";
    console.log(`  ✓ ${squad}: ${approved} summaries approved${label}`);
  }

  // ── VP feedback comment ───────────────────────────────────────────────────
  if (vpFeedbackArg) {
    await injectVpFeedback(weekOf, vpFeedbackArg);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log(`✓  ${weekOf} approved. Master summarizer trigger created.`);
  console.log("─".repeat(60));
  console.log("\n  NEXT STEP:");
  console.log(`  The master summarizer trigger is pending in the Agent Run Log.`);
  console.log(`\n  Option A — Use Notion agent (as designed):`);
  console.log(`    Open the Agent Run Log in Notion and run the master summarizer agent.`);
  console.log(`\n  Option B — Fully automated (no Notion agent):`);
  console.log(`    pnpm generate-master --week=${weekOf}`);
  console.log(`\n  After master report is written:`);
  console.log(`    pnpm eval --week=${weekOf}`);
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
