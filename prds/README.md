# PRDs — Notion SE Take-Home

This directory is the **work-breakdown** for the Arcline EPD Weekly Digest POC. Each numbered file is a self-contained brief that a fresh Claude session (or human) can pick up and execute.

Background context lives in (read these first if you're new):
- `../problem-statement.md` — Arcline's ask, frozen.
- `../round-2-problem-statement.md` — Round 2 ask (CRO + Sales Enablement stakeholders). Drives PRDs 13–20.
- `../solution-intro.md` — Dan's first-pass narrative, frozen. Superseded by these PRDs where they conflict.
- `~/.claude/plans/i-am-applying-for-swirling-allen.md` — the Round 1 master plan that produced PRDs 00–12.
- `~/.claude/plans/we-made-it-to-encapsulated-gosling.md` — the Round 2 master plan that produced PRDs 13–20.
- `REFERENCE-gtm-hub.md` — **read before building any GTM PRD (13–20).** Index of reusable assets from Dan's existing AI-Native GTM Hub (`~/Develop/personal-website`) — agent prompts, output types, Notion field-mapping. Borrow the domain logic; do not copy its Lambda/DynamoDB architecture.

## Locked decisions (do not relitigate without checking with Dan)
- Build scope: all 4 data sources (GitHub, Jira, Slack, Figma).
- Data: mocked JSON fixtures, committed.
- Squads simulated: **3** (not the prompt's 8).
- Notion tier: Workers + Custom Agents available.
- HITL: per-squad consolidated review → 3 approvals/week → master.
- Submission: single HTML, layered hook (backtest accuracy → live-trigger video → teaching workspace).
- Eval is its own PRD (PRD-08).

### Round 2 locked decisions (PRDs 13–20)
- Agents are **native Notion Custom Agents** (Feb 2026 feature) — NOT an Agent Library DB, NOT the GTM Hub's Anthropic-SDK-on-Lambda pattern. Workers provide tools; Custom Agents provide reasoning.
- GTM pipeline runs **daily** (vs EPD's weekly) and writes to the same Agent Run Log.
- Each new worker adds a `package.json` script alias following the existing convention (e.g. `"gtm-daily-digest": "tsx --env-file=.env.local scripts/..."` and `"<worker>:deploy": "pnpm --filter <pkg> deploy"`). Build sessions: add the alias when you create the script.
- PRD-19 Part B (candidate agents) is a **practice guide Dan builds himself** — the implementing session writes the guide pages, never creates the agents.

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

Round 2 dependency graph:
01 ─► 13 ─► 14 ─┬─► 15
                ├─► 16
                └─► 18
13 ──────────────► 17 (also needs 04a, 05)
13 ──────────────► 19 (can start after 13 is clear)
15, 16, 17, 18 ─► 20
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
| **R2-A** | **13** | **GTM schema foundation** |
| **R2-B** | **14, 17** | **GTM data + EPD pipeline updates** |
| **R2-C** | **15, 16, 18, 19** | **GTM workers + presentation deck** |
| **R2-D** | **20** | **Teaching layer (requires R2-C complete)** |

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
| 09 | completed | dan-2026-06-06 | 2026-06-06T00:00:00Z | COMPLETED per Dan — Round 1 sign-off. AC1-11 ✅ (364KB self-contained HTML, 18 sections, 7 Loom embeds, base64 Lucid diagram, inline master report + citations, all external links verified live). AC12 accepted as-is (hand-authored, no build script — submit file directly). |
| 10 | completed | opus-review-2026-05-29 | 2026-05-29T12:25:00Z | APPROVED by Opus — AC1 ✅ 11/11 DB explainers. AC2 ✅ 4 PRD-03 worker agents + HITL + Dashboard explainers (PRD-04/05 agents future). AC4 ✅ all 17 explainers 137–245 words (<300). AC3 caveat: hub uses ASCII code-block diagram (renders inline), not the PRD-09 SVG — PRD-09 not yet built, acceptable V1. Hub: 36ffc8f4-554c-81a8-9a77-c1abefc99d18. |
| 11 | completed | dan-2026-06-06 | 2026-06-06T00:00:00Z | COMPLETED per Dan — Round 1 sign-off. AC1/2/3/4 ✅ — 5 skill files: SKILL.md + instructions.md + question-bank.md (36q) + grading-rubric.md + session-log.md. Cross-session score tracking added post-initial-build. PRD-09 dep waived by Dan. |
| 12 | completed | sonnet-2026-05-30 | 2026-05-30T00:00:00Z | Demo reset infrastructure + W19/W20 historical data. Ships: reset-data.ts (week-scoped, 3 filter strategies), demo-week.ts (800ms-staggered auto-approve + VP comment injection), 24 fixture files, 2 ground truth reports, week-aware eval path, summarizer-master VP feedback section. Dry-run verified live (190 W21 rows). |
| 13 | completed | opus-review-2026-06-08 | 2026-06-08T00:00:00Z | ADDENDUM (page→database) REVIEWED & APPROVED by Opus 2026-06-08 — GTM \| Weekly Briefs DB (379…803c) live, schema correct. ⚠️ Carry-over (PRD-17's to fix, not a PRD-13 defect): live REVENUE_PAGE_ID in summarizer-master + generate-master points at archived page 377…811e → do NOT run generate-master until PRD-17 rewrite lands. ⚠️ patch-schema-round2.ts retains the fork blind-spot (forked twice) — hardening chip filed. PRIOR: APPROVED by Opus re-review 2026-06-06. GTM schema correct — ACs 1-8 verified live vs canonical 36efc8f4… IDs (4 GTM DBs w/ exact props under Revenue page; Key Releases + GTM Highlights on populated EPD DBs; canonical data intact 27/54/3/100). Workspace fork remediated (notion-ids reverted to populated set); 11 orphaned 377… shadow DBs archived w/ Dan's OK (verified archived=True; canonical+GTM live). Re-review CAUGHT + corrected a fabricated 'shadow DBs already archived/404' claim. Caveat: AC5 typecheck has 2 pre-existing unrelated tsc errors (validate-fixtures.ts). |
| 14 | completed | opus-review-2026-06-06 | 2026-06-06T20:00:00Z | APPROVED by Opus re-review — all 7 ACs re-verified live. AC1 8/17/3/4; AC2 idempotent (skip=32); AC3 Meridian→AuthShield; AC4 Orion→FieldKit; AC5 Vantage at-risk/Linear; AC6 3 cards @2026-05-01+stub; AC7 W22→6 (1 digest+5 mn), W23→5 (5 mn), no-scope sweeps EPD too, Opps+Battle Cards structurally excluded (never archived). Relation coverage 17/17. Prior AC7 W21-empty defect resolved via W22-prior/W23-current + W19-21 historical. Non-blocking caveat: Verification block still says "Expected: 10" mn (stale, now 17). |
| 15 | completed | opus-review-2026-06-08 | 2026-06-08T16:30:00Z | APPROVED by Opus review — all 7 ACs re-verified live. AC1/AC2 worker 019e9eda… live + 06-07 digest produced by the real Custom Agent (status=draft via at-risk gate). AC3 ✅ all 4 Summary sections. AC4 ✅ Vantage + Nexus both in "Flags for CRO". AC5 ✅ one row per date (06-07/06-06/01-01 each single). AC6 ✅ run-log outcome=ok, dur=5160ms, notes=notesProcessed=2/atRisk=2/dealsTouched=2. AC7 ✅ 2026-01-01 published "No meetings" row + matching outcome=skipped log ("no meeting notes for date=2026-01-01"). Non-blocking cleanup: archive the 06-06 trigger-script row + 01-01 stub before the CRO demo. |
| 16 | ready | - | 2026-06-08T16:50:00Z | Deps complete (13,14,17) → READY (Wave R2-C). PRD-17 approval unblocked it. workers/gtm-release-bridge — reads Key Releases from Master EPD, flags open deals with matching Product Interest. |
| 17 | completed | opus-review-2026-06-08 | 2026-06-08T16:45:00Z | APPROVED by Opus review — 8 ACs re-verified live; AC1 & AC5 texts corrected per Dan (deliberate design). AC2 ✅ GTM Highlights 613 chars/~95w no-IDs. AC3 ✅ row 379f…620e Week Of 2026-05-18. AC4 ✅ 4 body sections. AC6 ✅ single row. AC8 ✅ Quorum=true/coverage=0.9. AC1: Key Releases lives in `## Key Releases` body section (what read_approved_summaries consumes); rich_text property empty on live-agent path & unread — non-blocking follow-up to populate-or-drop. AC5: Atlas Key Releases correctly EXCLUDES AuthShield (didn't ship W21 — deliberate drift/[BLOCK] scenario); original AC premise was wrong. task_f88501eb (parser fragility) still open. |
| 18 | ready | - | 2026-06-08T16:50:00Z | Deps complete (13,14,17,01) → READY (Wave R2-C). PRD-17 approval unblocked it. workers/gtm-battle-card-updater — reads Key Releases + Product Roadmap, updates Our Differentiators on Battle Cards. |
| 19 | ready | - | 2026-06-06T17:03:59Z | Dep PRD-13 completed → READY (can start in parallel w/ R2-B). Round 2: Notion presentation deck — Agenda, What We Heard, Discovery Questions, Live Demo Flow (7 steps), Objection Prep, Candidate Agents practice guide for Dan. |
| 20 | waiting | - | 2026-06-05 | Round 2: Teaching layer update — 4 new GTM explainers + Day-2 Operations / How to Maintain This page. |
