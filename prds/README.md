# PRDs — Notion SE Take-Home

This directory is the **work-breakdown** for the Arcline EPD Weekly Digest POC. Each numbered file is a self-contained brief that a fresh Claude session (or human) can pick up and execute.

Background context lives in (read these first if you're new):
- `../problem-statement.md` — Arcline's ask, frozen.
- `../solution-intro.md` — Dan's first-pass narrative, frozen. Superseded by these PRDs where they conflict.
- `~/.claude/plans/i-am-applying-for-swirling-allen.md` — the master plan that produced this directory, including critique of `solution-intro.md`.

## Locked decisions (do not relitigate without checking with Dan)
- Build scope: all 4 data sources (GitHub, Jira, Slack, Figma).
- Data: mocked JSON fixtures, committed.
- Squads simulated: **3** (not the prompt's 8).
- Notion tier: Workers + Custom Agents available.
- HITL: per-squad consolidated review → 3 approvals/week → master.
- Submission: single HTML, layered hook (backtest accuracy → live-trigger video → teaching workspace).
- Eval is its own PRD (PRD-08).

## Dependency graph

```
00 ─► 01 ─┬─► 03a/b/c/d ─► 04a ─┐
          │                    ├─► 05 ─► 09 ─► 11
          ├─► 02 ──────────────┘
          ├─► 04b ──────────────┘
          ├─► 06 ───────────────┘
          ├─► 07
          ├─► 08 ───────────────► 09
          └─► 10
```

## Recommended parallel waves
| Wave | PRDs in parallel | Unblocks |
|---|---|---|
| A | 01, 02 | data plane |
| B | 03a, 03b, 03c, 03d, 06, 07, 10 | reasoning plane |
| C | 04a, 04b, 08 | synthesis, eval |
| D | 05 | submission |
| E | 09 | submission HTML |
| F | 11 | interview prep (post-submission) |

## Deferred / Post-POC backlog (NOT in this submission)
Captured so the idea isn't lost; explicitly **out of scope** for the 30-day POC submission. Do not build for the current deliverable.

- **Full reinforcement / closed-loop prompt improvement.** Today PRD-08 is a *regression guard* — its golden-set replay gates prompt changes in CI (catches when a change made scores worse) but nothing *drives* improvement. The deferred capability is the complete loop: run the eval harness → feed scored weaknesses (missing tensions, alignment failures, backtest gaps) back into a tuning step that proposes prompt edits → replay against the golden set → promote only if scores improve. Effectively eval-output-as-training-signal for the summarizer / fact-check agents, closing the loop that is currently done by hand. Candidate **PRD-12** for a follow-on engagement. (Surfaced 2026-05-30 during the PRD-05/08 review when the master's tension-recall gaps were patched manually.)

## Conventions
- Every PRD follows `_template.md` exactly, including the `<!-- status: ... -->` block immediately under the title.
- "Dependencies" lists PRD filenames; a session is ready when all listed PRDs are marked `completed` in this README's status table.
- Notion DB and page IDs produced by a PRD must be written back into that PRD's "Outputs" section so downstream PRDs can reference them.
- No PRD should introduce a new top-level concept (DB, agent, page type) without updating PRD-01 (schema) first.
- **Lifecycle**: PRD state transitions follow `SOP.md`. Use `/prd-status` to make and audit transitions; manual edits are allowed but must update both this table and the PRD file's status block in sync.

## Status (canonical source of truth — keep in sync with each PRD's `<!-- status: ... -->` block)

States: `waiting`, `ready`, `in-progress`, `in-review`, `completed`, `blocked`. See `SOP.md` for the full state machine.

| PRD | State | Owner | Updated | Notes |
|---|---|---|---|---|
| 00 | completed | opus-review-2026-05-28 | 2026-05-28T19:30:00Z | APPROVED by Opus review — all 6 ACs re-verified live (probe, env-fail, worker id 019e6ff1-ede4-7081-a976-8bfa40c9f50a, tsc, types, Quickstart) |
| 01 | completed | opus-review-2026-05-28 | 2026-05-28T23:30:00Z | APPROVED by Opus review (3rd cycle / hardening). Verified in code: teardown gated behind --yes + exit(1) banner, pnpm alias removed; dbIsEmpty() guards all 5 seed blocks; bootstrap loud "ntn-first" header; resetNotionIds covers deliveryPipeline + renamed Mirror labels. AC5 + optional live no-op rerun = human confidence check. |
| 02 | completed | opus-review-2026-05-28 | 2026-05-28T22:15:00Z | APPROVED by Opus review — AC1 validate-fixtures 12/12 (live), AC2 README lists all 5 tensions w/ record IDs, AC3 ground-truth references all 5 w/ scoring, AC4 word count <30k. Volume within spec. |
| 03 | completed | opus-review-2026-05-29 | 2026-05-29T12:45:00Z | ROLLUP RESOLVED — all four workers 03a/03b/03c/03d are completed, so the worker-pattern culmination is satisfied (Dan's ruling: completes when 03a–d all land). No separate build artifact. |
| 03a | completed | opus-review-2026-05-29 | 2026-05-29T12:00:00Z | APPROVED by Opus review — all 4 ACs re-verified live: 27 rows in Mirror GitHub (10 atlas + 9 lumen + 8 forge); Agent Run Log audit trail confirms create=27, idempotent re-run skipped=27, body-edit updated=1. Idempotent upsert keyed on Source ID. |
| 03b | completed | opus-review-2026-05-29 | 2026-05-29T12:10:00Z | APPROVED by Opus — 34 rows live; AC2 Acceptance Criteria verbatim-match verified on live rows; idempotent re-run skipped=34; Status constrained to valid select options; run-log non-zero duration, outcome=ok. |
| 03c | completed | opus-review-2026-05-29 | 2026-05-29T12:40:00Z | APPROVED by Opus after Opus-applied fix (implementing session unresponsive). AC2 fix landed: slack.ts now computes Participant Count = unique authors from messages; 6 drifted rows backfilled; all 18 live rows now match unique authors (verified). AC1 ✅ 18 rows. AC3 idempotent ✅; >2k truncation path remains unexercised (max excerpt 1072 chars) — code correct by inspection. NOTE: upsert change-detection keys only on Raw JSON, so derived-property logic fixes don't auto-propagate on re-run (re-run skipped=18); follow-up flagged. slack.ts edit not yet committed. |
| 03d | completed | opus-review-2026-05-29 | 2026-05-29T12:10:00Z | APPROVED by Opus — 10 rows live (1 per fixture thread); idempotent re-run skipped=10; dedupe on unique Source ID supports multi-thread-per-file (AC2 satisfied by design; no current fixture has 2 threads/file, and note's shared-File-Key example was inaccurate — distinct keys). Comment Excerpt ≤1.5k. |
| 04a | completed | opus-review-2026-05-29 | 2026-05-29T22:30:00Z | APPROVED by Opus review — all 4 ACs re-verified live. AC1 ✅ exactly 12 in-scope rows (github/jira/slack/figma × 3 squads) awaiting-review. AC2 ✅ 12/12 Citations JSON parse, all bare-UUID recordIds. AC3 ✅ sampled 12/12: every recordId resolves to a real mirror row in the correct source DB supporting the claim — zero cross-source contamination. AC4 ✅ zero-activity→approved (code index.ts:204 + 2 live auto-approved rows). 6 extra live rows (roadmap/prd-fact-check) are 04b scope. |
| 04b | completed | opus-review-2026-05-29 | 2026-05-29T23:55:00Z | APPROVED by Opus review — all 4 ACs re-verified live. AC1 ✅ exactly 6 rows (3 squads × {roadmap, prd-fact-check}), W21, awaiting-review, valid Squad relations. AC2 ✅ Forge/prd-fact-check [BLOCK] Reversal w/ 3-source evidence (Figma + GitHub PR #22 + Jira FORGE-30). AC3 ✅ Atlas/roadmap tags Atlas/Lumen auth-token cross-squad dep (On Track + At Risk). AC4 ✅ 19/19 citation recordIds resolve live, 0 broken; 8 cascade to upstream per-source Summary pages. Both workers tsc clean; run-log outcome=ok. Non-blocking: duplicate run-log trigger batches; deliverable idempotent at 6 rows. Worker: 019e75e3-f1dd-789d-87d5-c5e2ed7222aa. |
| 05 | completed | opus-review-2026-05-30 | 2026-05-30T23:25:00Z | APPROVED by Opus review. AC1/2/4 ✅ verified live (1 row for 2026-W21, Quorum Met=true, Citation Coverage 100%, conflict-resolution callout matches policy). AC5/6 ✅ per Dan's 2026-05-30 full-approval (100%) quorum decision — PRD §Quorum/AC5/Verification + worker header comment updated to match (execute() + agent prompt already enforced 100%; below-100% → outcome=skipped). AC3 ⚠ non-blocking: Lumen Slack-only tension (T2) not surfaced in Open Discrepancies; flagged as a content/prompt follow-up. |
| 06 | completed | opus-review-2026-05-29 | 2026-05-29T12:25:00Z | APPROVED by Opus — AC1 ✅ Atlas review page shows 6 source sections (live). AC2 ✅ approval.squad.atlas log "Approved 6 summaries" (one-command). AC3 ✅ github rejected, other 5 approved/untouched + re-run signal logged. AC4 refresh mechanism present; end-to-end re-run awaits PRD-04 (permitted by PRD-06 deps). 18 summary rows live. |
| 07 | completed | opus-review-2026-05-29 | 2026-05-29T12:25:00Z | APPROVED by Opus — AC1 ✅ all run-log writes via writeAgentRunLog helper, grep confirms zero direct DB writes. AC2 ✅ dashboard renders 5 embedded views. AC3 ✅ prose matches live rollup exactly (11 runs / 1.9 min / 0 errors / 2 approvals / $0.00). |
| 08 | completed | opus-review-2026-05-30 | 2026-05-31T00:45:00Z | APPROVED by Opus review. AC1 ✅ run.ts writes JSON+MD (require.main guard). AC2 ✅ MD §2 tables all 12 sampled claims w/ verdict+reason; 'unrelated' failure also in Weaknesses (minor: cited row embedded in claim text, not a discrete column). AC3 ✅ Trust 81% (cov 100/align 71/backtest 62) — honestly reported, not gamed. AC4 ⚠ CAVEAT (Dan-approved): golden-replay gate verified runnable live (re-ran green, within tolerance) + exits(1) on regression, but NOT wired into CI (no .github/workflows). CI wiring deferred; "CI replay passes" overstates the literal AC. Judge=haiku-4-5. |
| 09 | in-progress | sonnet-2026-05-30-E1 | 2026-05-30T15:00:00Z | claimed for Wave E submission HTML build |
| 10 | completed | opus-review-2026-05-29 | 2026-05-29T12:25:00Z | APPROVED by Opus — AC1 ✅ 11/11 DB explainers. AC2 ✅ 4 PRD-03 worker agents + HITL + Dashboard explainers (PRD-04/05 agents future). AC4 ✅ all 17 explainers 137–245 words (<300). AC3 caveat: hub uses ASCII code-block diagram (renders inline), not the PRD-09 SVG — PRD-09 not yet built, acceptable V1. Hub: 36ffc8f4-554c-81a8-9a77-c1abefc99d18. |
| 11 | waiting | — | — | deps: 09 |
| 12 | completed | sonnet-2026-05-30 | 2026-05-30T00:00:00Z | Demo reset infrastructure + W19/W20 historical data. Ships: reset-data.ts (week-scoped, 3 filter strategies), demo-week.ts (800ms-staggered auto-approve + VP comment injection), 24 fixture files, 2 ground truth reports, week-aware eval path, summarizer-master VP feedback section. Dry-run verified live (190 W21 rows). |
