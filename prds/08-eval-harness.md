# PRD-08 — Eval Harness (citation + hallucination + regression)

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
