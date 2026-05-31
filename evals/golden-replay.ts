/**
 * PRD-08 — Golden-Set Replay
 *
 * Loads frozen inputs from tests/golden/<week>.json (produced by
 * `evals/run.ts --save-golden`) and re-runs the scoring without touching
 * Notion. Fails with exit(1) if any score regresses beyond TOLERANCE.
 *
 * Designed for CI: runs on every prompt change and requires Dan's review to
 * update the golden baseline when regressions are detected.
 *
 * Usage:
 *   pnpm tsx evals/golden-replay.ts --week=2026-W21
 *
 * To update the golden after a deliberate improvement:
 *   pnpm tsx evals/run.ts --week=2026-W21 --save-golden
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

import {
  computeCitationCoverage,
  computeSourceFactAlignment,
  computeBacktestDelta,
} from "./run";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

// Per-check tolerances (how much a score can drop before CI fails):
//   - Coverage: deterministic — tight tolerance
//   - Alignment: LLM with frozen inputs — moderate variance expected
//   - Backtest: LLM with long context — haiku can swing ±20pp between runs
const TOL_COVERAGE  = 0.05;
const TOL_ALIGNMENT = 0.10;
const TOL_BACKTEST  = 0.20;
const GOLDEN_DIR  = path.resolve(process.cwd(), "tests/golden");

interface GoldenFile {
  week: string;
  frozenAt: string;
  judgeModel: string;
  inputs: {
    masterBody: string;
    groundTruth: string;
    citations: Array<{ recordId: string; sourceUrl: string; claim: string }>;
    squadConsolidationBodies: string[];
    alignmentSample: Array<{ recordId: string; sourceUrl: string; claim: string; sourceContent: string }>;
  };
  baselineScores: {
    citationCoverage: number;
    sourceFactAlignment: number;
    backtestDelta: number;
    trustScore: number;
    t2Surfaced: boolean;
  };
}

function fmtPct(n: number) { return `${Math.round(n * 100)}%`; }
function pass(label: string) { console.log(`  ✅ ${label}`); }
function fail(label: string) { console.error(`  ❌ ${label}`); }

async function runGoldenReplay(weekOf: string) {
  const goldenPath = path.join(GOLDEN_DIR, `${weekOf}.json`);
  if (!fs.existsSync(goldenPath)) {
    console.error(`Golden file not found: ${goldenPath}`);
    console.error(`Run: pnpm tsx evals/run.ts --week=${weekOf} --save-golden`);
    process.exit(1);
  }

  const golden: GoldenFile = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));
  const { inputs, baselineScores } = golden;

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Need a dummy Notion client for the function signature; it won't be called
  // because we pass frozenSources and the alignment function skips live fetches
  const dummyNotion = {} as Parameters<typeof computeSourceFactAlignment>[0];

  console.log(`\n━━━ PRD-08 Golden Replay · ${weekOf} ━━━`);
  console.log(`Frozen: ${golden.frozenAt} · Judge: ${golden.judgeModel}`);
  console.log(`Baseline: cov=${fmtPct(baselineScores.citationCoverage)} align=${fmtPct(baselineScores.sourceFactAlignment)} backtest=${fmtPct(baselineScores.backtestDelta)} trust=${fmtPct(baselineScores.trustScore)}`);
  console.log(`Tolerance: cov=±${fmtPct(TOL_COVERAGE)} align=±${fmtPct(TOL_ALIGNMENT)} backtest=±${fmtPct(TOL_BACKTEST)}\n`);

  const failures: string[] = [];

  // ── 1. Citation Coverage — deterministic, no LLM ─────────────────────────

  console.log("Checking citation coverage (deterministic)…");
  const newCoverage = computeCitationCoverage(inputs.masterBody, inputs.citations, inputs.squadConsolidationBodies);
  const covDiff     = newCoverage.score - baselineScores.citationCoverage;
  console.log(`  baseline=${fmtPct(baselineScores.citationCoverage)} current=${fmtPct(newCoverage.score)} Δ=${covDiff >= 0 ? "+" : ""}${fmtPct(covDiff)} (tol ±${fmtPct(TOL_COVERAGE)})`);

  if (newCoverage.score < baselineScores.citationCoverage - TOL_COVERAGE) {
    fail(`Citation coverage regressed: ${fmtPct(baselineScores.citationCoverage)} → ${fmtPct(newCoverage.score)}`);
    failures.push(`citation-coverage: ${fmtPct(baselineScores.citationCoverage)} → ${fmtPct(newCoverage.score)}`);
  } else {
    pass(`Citation coverage within tolerance`);
  }

  // ── 2. Source-Fact Alignment — uses frozen source content, no Notion ──────

  console.log("\nChecking source-fact alignment (frozen sources, LLM judge)…");
  const newAlignment = await computeSourceFactAlignment(
    dummyNotion,
    anthropic,
    inputs.alignmentSample,
    inputs.alignmentSample, // pass same as frozenSources so live fetch is skipped
  );
  const alignDiff = newAlignment.score - baselineScores.sourceFactAlignment;
  console.log(`  baseline=${fmtPct(baselineScores.sourceFactAlignment)} current=${fmtPct(newAlignment.score)} Δ=${alignDiff >= 0 ? "+" : ""}${fmtPct(alignDiff)} (tol ±${fmtPct(TOL_ALIGNMENT)})`);

  if (newAlignment.score < baselineScores.sourceFactAlignment - TOL_ALIGNMENT) {
    fail(`Source-fact alignment regressed: ${fmtPct(baselineScores.sourceFactAlignment)} → ${fmtPct(newAlignment.score)}`);
    failures.push(`source-fact-alignment: ${fmtPct(baselineScores.sourceFactAlignment)} → ${fmtPct(newAlignment.score)}`);
  } else {
    pass(`Source-fact alignment within tolerance`);
  }

  // ── 3. Backtest Delta — frozen master body + ground truth, LLM judge ──────

  console.log("\nChecking backtest delta (frozen inputs, LLM judge)…");
  const newBacktest  = await computeBacktestDelta(anthropic, inputs.masterBody, inputs.groundTruth);
  const btDiff       = newBacktest.score - baselineScores.backtestDelta;
  console.log(`  baseline=${fmtPct(baselineScores.backtestDelta)} current=${fmtPct(newBacktest.score)} Δ=${btDiff >= 0 ? "+" : ""}${fmtPct(btDiff)} (tol ±${fmtPct(TOL_BACKTEST)})`);
  console.log(`  T2 surfaced: baseline=${baselineScores.t2Surfaced} current=${newBacktest.t2Surfaced}`);

  if (newBacktest.score < baselineScores.backtestDelta - TOL_BACKTEST) {
    fail(`Backtest delta regressed: ${fmtPct(baselineScores.backtestDelta)} → ${fmtPct(newBacktest.score)}`);
    failures.push(`backtest-delta: ${fmtPct(baselineScores.backtestDelta)} → ${fmtPct(newBacktest.score)}`);
  } else {
    pass(`Backtest delta within tolerance`);
  }

  // T2 regression is a soft warning, not a hard failure (it's a known gap)
  if (baselineScores.t2Surfaced && !newBacktest.t2Surfaced) {
    console.warn(`  ⚠  T2 was surfaced in baseline but not in current run — prompt regression?`);
  }

  // ── Final verdict ─────────────────────────────────────────────────────────

  console.log("\n" + "─".repeat(50));
  if (failures.length > 0) {
    console.error("\n❌ GOLDEN REPLAY FAILED — regressions detected:");
    for (const f of failures) console.error(`   • ${f}`);
    console.error("\nTo update the golden (after Dan's review): pnpm tsx evals/run.ts --week=" + weekOf + " --save-golden");
    process.exit(1);
  }

  console.log("\n✅ Golden replay passed — no score regressions detected.\n");
}

const args   = process.argv.slice(2);
const weekOf = args.find((a) => a.startsWith("--week="))?.split("=")[1];
if (!weekOf) {
  console.error("Usage: pnpm tsx evals/golden-replay.ts --week=2026-W21");
  process.exit(1);
}

runGoldenReplay(weekOf).catch((err) => {
  console.error(err);
  process.exit(1);
});
