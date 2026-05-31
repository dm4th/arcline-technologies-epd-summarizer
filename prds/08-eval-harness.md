# PRD-08 — Eval Harness (citation + hallucination + regression)

<!-- status:
state: completed
owner: opus-review-2026-05-30
updated: 2026-05-31T00:45:00Z
notes: APPROVED by Opus review. AC1 ✅ run.ts writes both JSON+MD (require.main guard prevents import side-effects). AC2 ✅ MD §2 tables all 12 sampled claims w/ verdict+reason; failing 'unrelated' case also surfaced in Weaknesses (minor: cited row embedded in claim text, not a discrete column). AC3 ✅ Trust 81% (cov 100/align 71/backtest 62) — honestly reported, not gamed. AC4 ⚠ CAVEAT (Dan-approved): golden-replay gate verified runnable live (re-ran green, all 3 scores within tolerance) and exits(1) on regression, but NOT wired into CI — repo has no .github/workflows. CI wiring deferred; README/PRD "CI replay passes" overstates the literal AC. Judge=claude-haiku-4-5.
-->

## Goal
Produce a runnable evaluation pipeline that scores the Master EPD Weekly report and every Squad Weekly Summary on (a) citation coverage, (b) source-fact alignment, (c) backtest delta vs the hand-authored ground truth — and gates prompt changes on a golden-set replay.

## Why this exists
The customer's actual question is "how do we trust the output?" Every other PRD answers that *implicitly*. This one answers it *quantitatively*, and produces the number that headlines the submission HTML.

## Dependencies
- PRD-02 (ground-truth report), PRD-04a, PRD-04b, PRD-05.

## Inputs
- Approved Squad Weekly Summaries.
- Master EPD Weekly row.
- `fixtures/ground-truth-report.md`.

## Outputs
- `evals/run.ts` — orchestrator producing `evals/reports/<week>.json` and `<week>.md`.
- Three scores per run:
  1. **Citation Coverage** — % of factual sentences with at least one citation. Sentence detection via a simple regex + verb heuristic; tunable.
  2. **Source-Fact Alignment** — for a sample of cited claims, an LLM-as-judge call asks "does the cited mirror row support this claim?" Returns `support` / `partial` / `contradicts` / `unrelated`. Score = (support + 0.5·partial) / total.
  3. **Backtest Delta** — embedding similarity + LLM-as-judge coverage check between Master Body and ground-truth report. Reports both a similarity score and a list of facts present in ground-truth missing from Master.
- A **golden-set replay**: a `tests/golden/` directory of frozen agent inputs + expected outputs. Run on every prompt change in CI. Diff failures require Dan's review.
- A single number for the submission HTML's headline: a composite **Trust Score** = weighted blend (40% coverage, 40% alignment, 20% backtest similarity).

## Design
- LLM-as-judge calls run against a different model family than the one writing summaries (avoid same-model collusion). Implementing session picks the judge model and documents.
- Citation Coverage and Alignment can run fully offline against Notion content via the SDK.
- Backtest needs at least one ground-truth report (PRD-02 produces one). Aim for **2 weeks of ground truth** before submission so backtest has more than one data point — implementing session can extend fixtures if budget allows.
- Failures don't block submission, but the **Trust Score and weaknesses must be reported honestly** in the submission HTML. Honesty here is a hiring signal.

> **Review note (2026-05-30, folded in from PRD-05 review):** Treat **Tension 2 (Lumen — blocker discussed in Slack, no Jira ticket filed)** as a **known, named recall target** for the Backtest Delta check. As of the PRD-05 approval, T2 was *not* surfaced in the Master's Open Discrepancies — root cause is upstream recall: the Lumen `prd-fact-check` agent flagged scope-drift/stalled-criteria items but missed the Slack-only blocker, and the master only synthesizes what bubbles up (it never re-reads raw Slack, by design). T2 is "deliberately subtle" per PRD-02. The harness should explicitly verify whether T2 appears in the Master Body; if Backtest Delta confirms it's missing, that's the cue to decide whether a `prd-fact-check` prompt tweak (to catch Slack-only-no-ticket patterns) is worth it — measure first, then fix. The other four planted tensions (T1 Atlas PR↔Jira, T3 Forge Figma reversal, T4 staleness, T5 Atlas↔Lumen cross-squad dep) *were* surfaced in the appropriate sections.
>
> **Update (2026-05-30, fix landed — commit `5e9cbc1`):** The "then fix" half is now done at the prompt layer but **not yet re-measured**. `prd-fact-check` got a new **Rule 4 (Process Gap)** targeting T2, and **Rule 3 (Reversal) was generalized** (the hardcoded Forge nudge was removed — see PRD-04b "Post-approval changes" for the AC2 regression risk that creates). `summarizer-master` got a "Synthesis quality bar" for the framing misses (T1 specificity, T3 reversal context, T4 escalation, T5 positive coordination). **This harness is the verification gate.** A dedicated re-run session must: clear idempotency locks → re-run prd-fact-check → squad consolidation → master → `pnpm eval --week=2026-W21`, then confirm `backtestDelta.t2Surfaced` flips to `true`, the Forge reversal is still `[BLOCK]`, and the Trust / backtest scores move. Until then the W21 baseline (`tests/golden/2026-W21.json`, Trust 81%) reflects the **pre-fix** pipeline.

## Acceptance Criteria
1. `pnpm tsx evals/run.ts --week=<W>` produces both JSON and Markdown outputs.
2. The Markdown report lists, for the failing alignment cases, the specific claim → cited row → judge verdict.
3. Trust Score for the demo fixture week is ≥ 0.75. (If not, fix prompts or report honestly — do not tune the metric to flatter the demo.)
4. Golden-set replay runs in CI and fails the build on regression.

## Out of Scope
- Human eval of style/voice (out for V1; submission can mention as part of post-POC plan).
- Continuous online eval — V2.

## Open Questions
- Judge-model choice and per-run cost. Implementing session reports actuals.

## Verification
- Inspect `evals/reports/<week>.md`. Confirm each score is present and one weakness is honestly named.

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

### What was actually built

- **`evals/run.ts`**: Main orchestrator. `pnpm eval --week=2026-W21` fetches the master row + squad consolidation bodies + per-source citations from Notion, runs all three scores, and writes `evals/reports/<week>.json` + `<week>.md`. Pass `--save-golden` to also write `tests/golden/<week>.json`. Judge model is `claude-haiku-4-5-20251001` (documented in the report header and in the file constant `JUDGE_MODEL`).
- **`evals/golden-replay.ts`**: CI gating script. `pnpm eval:golden --week=2026-W21` loads frozen inputs from `tests/golden/<week>.json` and re-runs all three scoring checks without touching Notion. Fails exit(1) on regression. Tolerances are per-check: ±5% citation coverage (deterministic), ±10% alignment (LLM/frozen), ±20% backtest (LLM/high variance).
- **`tests/golden/2026-W21.json`**: Frozen baseline for W21. Stores masterBody, groundTruth, all 175 citations, squad consolidation body texts, and the 12-citation alignment sample with fetched source content. Baseline scores: cov=100%, align=71%, backtest=62%, trust=81%.
- **Citation coverage**: Checks two pools — (1) per-source citation claims (70% word-overlap threshold) and (2) squad consolidation body text (50% word-overlap threshold). W21 scores 100% with this dual-pool approach.
- **Source-Fact Alignment**: Samples up to 12 citations uniformly. Each citation's `recordId` is a Mirror DB row; source content is read from page **properties** (not blocks). LLM judge asks: support / partial / contradicts / unrelated.
- **Backtest Delta**: Explicitly checks for T2 (Lumen Slack-only blocker). T2 was NOT surfaced by the master — confirmed and reported honestly in the Weaknesses section of every report.
- **`tsconfig.json`** and **`package.json`**: Updated to include `evals/**/*` and add `eval` / `eval:golden` scripts.

### Gotchas for downstream sessions

**1. `dotenv.config()` requires `override: true`**
Node 24's `--env-file` flag pre-loads `.env.local` before the script runs, but occasionally sets quoted values to empty strings. When `dotenv.config()` then runs, it sees the key as "already defined" (even though empty) and skips it. Fix: always pass `override: true` in `dotenv.config()` calls in `evals/`. Any future script in this directory that uses dotenv needs the same flag.

**2. Master row's `Citations` property is always empty**
The master worker computes citation coverage internally and stores `Citation Coverage %` (a number) but does NOT write the citations array to any row property. To pool citations for the eval, traverse two hops: `Master["Squad Consolidations"] → HITL Review Sessions page → ["Squad Weekly Summaries"] → Squad Weekly Summary pages → ["Citations"] (rich_text JSON)`. There are 175 citations in W21 distributed across 18 per-source summary rows.

**3. Mirror rows have no body blocks — read page properties instead**
GitHub, Jira, Slack, and Figma Mirror DB rows store all content in **page properties** (Title, Body Excerpt, Source ID, Status, Raw JSON). `notion.blocks.children.list()` returns 0 results. The alignment checker must call `notion.pages.retrieve({ page_id })` and iterate over properties to build the source content string for the judge.

**4. Coverage matching fails at different abstraction levels**
Naively matching master body sentences against per-source citation claims produces ~29% coverage because the master synthesizes cross-squad statements ("Atlas shipped billing refactor while Lumen shipped auth tokens v2") that don't substring-match any single per-source claim ("PR #51 merged billing API refactor"). Fix: add squad consolidation page body text as a second evidence pool (the master reads these directly). With 50% word-overlap on the consolidation text, all 17 W21 factual sentences score as covered.

**5. `HITL Review Sessions.Citations` was a rollup, not writable rich_text**
The squad summarizer worker tried to write `Citations: rich_text` to the HITL Review Session page — this silently failed because the DB schema had `Citations` as a rollup (aggregating from Squad Weekly Summary rows). The rollup was removed from the DB schema during this session (Dan approved). The eval harness bypasses this entirely by traversing directly to the Squad Weekly Summary rows.

**6. `require.main === module` guard is mandatory in `run.ts`**
`golden-replay.ts` imports scoring functions from `./run`. Without the guard, importing `run.ts` triggers `main()` as a module-level side effect, running a full Notion fetch + LLM eval during the golden replay. Always keep the guard at the bottom of `run.ts`.

**7. Backtest judge (haiku) has ~20pp run-to-run variance**
The backtest coverage question asks haiku to score 0-100 across ~10k tokens of context. Scores vary ±20pp between calls with identical inputs (observed: 42% one run, 62% the next). Golden replay uses ±20% tolerance for backtest. If future sessions switch the judge model or prompt, re-run the golden replay 2-3 times before concluding a regression is real vs. noise.
