# PRD-12 — Demo Reset Infrastructure & Historical Data (W19/W20)

<!-- status:
state: completed
owner: sonnet-2026-05-30
updated: 2026-05-30T00:00:00Z
notes: Built and verified in a single session. All 6 deliverables shipped: reset-data.ts (live dry-run confirmed 190 rows identified), 24 W19/W20 fixture files, 2 ground truth reports, demo-week.ts (compiles + runs clean), evals/run.ts week-aware ground truth path, summarizer-master.md VP feedback section. pnpm typecheck pre-existing error in validate-fixtures.ts (import.meta module option mismatch) is unrelated to this PRD's changes.
-->

## Goal

Solve two demo-blocking gaps: (1) no reliable single-command reset to "6AM Monday morning" state for re-running the pipeline cleanly, and (2) only one week of fixture data exists, making it impossible to demonstrate ongoing-basis operation, eval score stability over time, or the VP-feedback-to-next-week loop.

## Why this exists

The system is functionally complete for W21 but hard to demo:
- Resetting between demo runs requires manually archiving rows across 8 databases and clearing idempotency state. There is no `pnpm reset`.
- Without historical data, reviewers can only see a single point in time. The "ongoing EPD digest" narrative requires at least 3 weeks to be credible.
- The VP feedback loop (prior week's VP comments shaping the next week's master summary) is designed but has never been exercised — no prior-week data existed.

## Dependencies

- PRD-03 (all 4 source workers must exist and accept `--week` flag)
- PRD-05 (Master EPD Weekly must exist to receive VP comments)
- PRD-08 (eval harness must exist to score W19/W20 runs)

## Inputs

- Existing W21 fixtures and eval harness
- `src/workers/hitl-review.ts` — `approveSquadWeek`, `seedSquadWeeklySummaries`, `upsertMasterEpdWeekly`, `weekOfToDate`, `ALL_SQUADS`
- `src/workers/lib/source-worker.ts` — `runSourceWorker`
- `src/lib/notion-ids.ts` — all 12 DB IDs including `hitlReviewSessions`

## Outputs

- **`scripts/reset-data.ts`** — week-scoped data reset (clears data-DB rows, preserves schemas and config DBs)
- **`scripts/demo-week.ts`** — end-to-end weekly pipeline runner (workers → seed → approve → VP feedback comment)
- **24 fixture JSON files** — W19 and W20 across all 4 sources and all 3 squads
- **`fixtures/ground-truth-w19.md`** and **`fixtures/ground-truth-w20.md`** — authoritative ground truth for eval scoring
- **`evals/run.ts`** (1-line change) — week-aware `GROUND_TRUTH_PATH` resolution
- **`agent-prompts/summarizer-master.md`** (new section) — VP feedback loop via Notion comments
- **`package.json`** — `pnpm reset-data` and `pnpm demo-week` aliases

## Design

### Reset architecture

Three filter strategies are needed because DBs use different date fields:
- **`week-of`**: DBs with a `Week Of` date property (`squadWeeklySummary`, `masterEpdWeekly`, `hitlReviewSessions`, `deliveryPipeline`) — filter by exact Monday date
- **`notes-contains`**: `agentRunLog` — no `Week Of` property, but every row's `Notes` field embeds the week string (e.g. `week=2026-W21`); uses `rich_text.contains` filter
- **`last-updated`**: Mirror DBs — filter by `Last Updated` date range covering the 7-day window; picks up both new rows created and existing rows updated during that week

Without a `--week` flag, all rows are cleared across all weeks (full wipe).

### Demo-week orchestration

Sequence (with dependencies):
1. Run all 4 source workers
2. Seed Squad Weekly Summary rows for all squads
3. Create Master EPD Weekly row (links to HITL Review Sessions for rollup)
4. Auto-approve squads with **800ms stagger** between each — prevents simultaneous status flips that can confuse Notion's Custom Agent trigger system
5. (If `--vp-feedback`) Post a Notion comment on the previous week's master page

`approveSquadWeek()` already fires the master summarizer trigger internally (with dedup guard), so `demo-week.ts` does NOT call `createMasterSummarizerTrigger` separately.

### Sprint arc (fixture story)

Three consecutive weeks form a coherent sprint arc:

- **W19 (May 4–10)**: Sprint 14 kickoff. PRs open/draft, Jira tickets To Do/In Progress, Figma in early design review.
  - **Planted T1**: ATLS-42 assigned to `jordan-lee` in Jira; `sarah-chen` announced she's "taking point" on it in the sprint kickoff Slack thread.
  - **Planted T2**: Atlas blocked on Lumen auth v2, but Lumen's PM hasn't signed off on the scopes schema yet — "end of sprint" is optimistic.
- **W20 (May 11–17)**: Mid-sprint. Some PRs merge (NPE fix, Lumen dark mode, Lumen data-grid perf, Forge memory leak + iOS 16 crash + haptics). Main features still in review.
  - **Planted T3**: Rate limiting PR (#48) in review but Figma has no 429 error state designed — design lag noted in Slack, unresolved in Figma.
  - **Planted T4**: EU read replica lag (800ms) observed during billing refactor load test, mentioned in Slack, **no ticket filed**.
- **W21 (May 18–24)**: Sprint end (existing data). PRs merged, Lumen ships auth v2 (unblocks Atlas), tickets Done.

Source IDs carrying through all three weeks (e.g. `atlas-pr-048` as open in W19, in-review in W20, merged in W21) demonstrate the idempotency/change-detection mechanism: the upsert logs `updated` when `raw` JSON changes, and `skipped` when it hasn't.

### VP feedback loop

`demo-week.ts --vp-feedback="..."` posts a Notion comment (via `notion.comments.create()`) on the previous week's master page. This is the correct Notion primitive: comments represent reviewer feedback, not page content authored by the agent. The updated `summarizer-master.md` instructs the agent to read prior-week comments and include a "VP Feedback Follow-up" section in the report.

## Acceptance Criteria

1. `pnpm reset-data --week=2026-W21 --dry-run` correctly identifies all W21 rows across all 9 data DBs without touching W19/W20 rows once those exist.
2. `pnpm reset-data --yes` (full wipe) leaves all 9 data DBs at 0 rows; config DBs (Squads, PRDs, Product Roadmap) are untouched.
3. `pnpm workers --week=2026-W19` succeeds (creates rows from new fixture files).
4. `pnpm demo-week --week=2026-W20 --vp-feedback="..."` completes without error, posts a Notion comment on the W19 master page, and prints the manual steps for Notion agent runs.
5. `pnpm eval --week=2026-W19` scores against `fixtures/ground-truth-w19.md` (not the W21 fallback).
6. Running all three weeks sequentially (W19 → W20 → W21) produces 3 master EPD rows, each scoreable by `pnpm eval`.

## Out of Scope

- Automated Notion agent execution (Custom Agents cannot be CLI-invoked; human must run them in the Notion UI)
- Multi-week eval comparison dashboards (score data is in `evals/reports/` JSON; visualization is a manual step)
- Automated CI wiring for W19/W20 golden-set replay (deferred, same as W21's CI caveat in PRD-08)

## Verification

```bash
# Verify reset works
pnpm reset-data --week=2026-W21 --dry-run   # should list ~190 rows (W21 only)

# Verify W19 workers parse new fixtures
pnpm workers --week=2026-W19                # should log created=N for each source

# Verify eval picks up week-specific ground truth
pnpm eval --week=2026-W19                   # should load fixtures/ground-truth-w19.md

# Full demo sequence
pnpm reset-data --yes
pnpm demo-week --week=2026-W19
# [manual: run Notion agents for W19]
pnpm eval --week=2026-W19

pnpm demo-week --week=2026-W20 --vp-feedback="Track Atlas/Lumen auth v2 dep"
# [manual: run Notion agents for W20]
pnpm eval --week=2026-W20

pnpm demo-week --week=2026-W21
# [manual: run Notion agents for W21]
pnpm eval --week=2026-W21 --save-golden
pnpm eval:golden --week=2026-W21
```

## Implementation Notes

> Written same-session as the build. Read this before any session that extends the eval harness, adds more historical weeks, or modifies the reset flow.

### What was actually built

**`scripts/reset-data.ts`**
- 9 data DBs cleared; 3 config DBs never touched.
- Three filter strategies (`week-of`, `notes-contains`, `last-updated`) handle the schema differences across DBs.
- `agentRunLog` uses `notes-contains` because it has no `Week Of` property — every row's `Notes` field embeds the week string in one of these formats: `week=YYYY-Www ...`, `week=YYYY-Www`, `Approved N summaries for <squad> week YYYY-Www`.
- Archive concurrency is capped at 3 to stay under Notion's ~3 req/s rate limit.
- Verified live: `--dry-run` correctly identified 190 rows for W21.

**`scripts/demo-week.ts`**
- `ALL_SQUADS` from `hitl-review.ts` drives the squad loop — adding a 4th squad requires no change here.
- The 800ms inter-squad stagger is implemented with a simple `sleep()` utility.
- `injectVpFeedback()` uses `notion.comments.create()` — the `@notionhq/client` v2 SDK exposes this natively.
- `decrementWeek()` handles the simple case (week > 1). Edge case (week = 1) returns `{year-1}-W52`, which is correct for our demo years.

**Fixture files (24 new files)**
- File path: `fixtures/{source}/{squad}/{weekOf}.json` — same pattern as W21; `fixture-loader.ts` already resolves this path, so zero code changes to workers.
- Source IDs carrying through W19→W20→W21: all W21 PR/ticket/thread IDs appear in W19/W20 at earlier states. W20 adds a few records first seen in W20 (e.g. `atlas-pr-053`, `atlas-pr-054`, `forge-pr-023`).
- Timestamps for `lastUpdated` are within the correct week range for each file.

**`evals/run.ts` change**
- Module-level `GROUND_TRUTH_PATH` constant (line 37) replaced by a comment.
- Local const declared inside `main()` after `weekOf` is parsed: tries `fixtures/ground-truth-${weekOf}.md` first, falls back to `fixtures/ground-truth-report.md` for backward compatibility.
- `fs` and `path` already imported at module level — no new imports needed.

**`agent-prompts/summarizer-master.md`**
- New "Prior Week VP Feedback" section added before the Operational Steps section.
- Instructs the agent to call `GET /v1/comments?block_id={prevWeekPageId}` (or `read_comments` tool) and include a "VP Feedback Follow-up" section if comments exist.
- Section is gated on comment presence — silently omitted if no prior week or no comments.

### Gotchas for downstream sessions

**1. `agentRunLog` filter is text-match, not date-range**
The `notes-contains: weekOf` filter works because all current log-writing code embeds the week string. If a future session adds a log-writing path that doesn't include the week string in Notes, those rows will be missed by the week-scoped reset. The long-term fix is to add a `Week Of` date property to the Agent Run Log DB schema (additive PATCH via `pnpm patch`).

**2. `approveSquadWeek` fires the master trigger at ≥1 squad approved**
`demo-week.ts` calls `approveSquadWeek` for all 3 squads. The first approval (atlas) fires the master trigger. The second and third approvals skip trigger creation due to the dedup guard (checks for an existing `pending` trigger with `week=...` in Notes). This is correct behavior for demos — do not add a separate `createMasterSummarizerTrigger` call.

**3. W19/W20 mirror rows share sourceIds with W21**
After running W19 workers, the mirror DBs contain 190 rows. Running W20 workers will UPDATE some of those rows (changed state, same sourceId) and create new ones — the Agent Run Log will show `updated=N`. Running W21 workers then updates them again to final state. The Mirror DB always reflects the most-recently-ingested state per record.

**4. VP feedback comments require `comments:write` integration scope**
The Notion integration token must have `comments:write` scope for `notion.comments.create()` to work. If you get a 403 on the comment injection step, check the integration's capabilities at notion.so/my-integrations.

**5. W19/W20 eval Trust Scores will differ from W21**
The W19/W20 master reports (once generated by Notion agents) will score against their respective ground-truth files. Do not freeze W19/W20 goldens until the agents have run and the reports look reasonable — the first run is exploratory.
