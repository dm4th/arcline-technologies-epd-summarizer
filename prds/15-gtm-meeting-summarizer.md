# PRD-15 — GTM Meeting Notes Daily Summarizer Worker

<!-- status:
state: completed
owner: opus-review-2026-06-08
updated: 2026-06-08T16:30:00Z
notes: APPROVED by Opus review — all 7 ACs re-verified live. AC1/AC2 worker 019e9eda… live + 06-07 digest produced by the real Custom Agent (draft via at-risk gate). AC3 4 Summary sections. AC4 Vantage + Nexus in "Flags for CRO". AC5 one row/date. AC6 run-log outcome=ok dur=5160ms notes=notesProcessed=2/atRisk=2/dealsTouched=2. AC7 2026-01-01 published "No meetings" row + outcome=skipped log. Non-blocking: archive 06-06 trigger-row + 01-01 stub before CRO demo.
-->

## Goal
A new `ntn` Worker (`workers/gtm-meeting-summarizer`) that reads recent meeting notes from the GTM | Meeting Notes database and writes one GTM | Daily Digest row per day, so the CRO's team has a daily view of pipeline health without manually checking every rep's notes.

## Why this exists
The CRO's first concern is that his GTM team is already spread thin. A daily digest surfaces at-risk deals, competitor mentions, and rep action items every morning — the same "surface issues before they compound" value prop as the EPD weekly digest, but at a daily cadence appropriate for a sales pipeline.

## Reference Implementation — AI-Native GTM Hub
> **Borrow before you build.** See [`prds/REFERENCE-gtm-hub.md`](REFERENCE-gtm-hub.md). This worker's
> summarization logic should reuse the Hub's `sales` and `summary` agent prompts
> (`personal-website/lib/projects/notion-meeting-intelligence/prompts.ts`) and the deterministic
> sentiment / stage-advancement rules in `metadata.ts` (sentiment from a 1–10 score; at-risk
> flagging via an ICP-tier + score decision tree — no extra LLM call). The Hub's `SalesAnalysis` and
> `SummaryAnalysis` output shapes (`types.ts`) inform the digest's structure. Do NOT copy the Hub's
> Lambda/DynamoDB async architecture — this is a single `ntn` Worker called by a native Notion Custom Agent.

## Dependencies
- PRD-13 (GTM | Meeting Notes, GTM | Daily Digest databases must exist with correct schema).
- PRD-14 (fixture data must be seeded so the worker has rows to read during development).
- PRD-00 (worker deployment tooling — `ntn workers` must be configured).

## Inputs
- **GTM | Meeting Notes** DB ID: `NOTION_IDS.dbs.gtmMeetingNotes` from `src/lib/notion-ids.ts`.
- **GTM | Daily Digest** DB ID: `NOTION_IDS.dbs.gtmDailyDigest` from `src/lib/notion-ids.ts`.
- **Agent Run Log** DB ID: `NOTION_IDS.dbs.agentRunLog` — for observability.
- `NOTION_API_KEY` from environment (injected by `ntn workers` platform).

## Outputs
- One **GTM | Daily Digest** row per run, keyed on `Date` (upsert — no duplicates if run twice in a day).
- One **Agent Run Log** row per invocation with `Agent Name = "gtm-meeting-summarizer"`, started/completed timestamps, duration, and `outcome = ok | error | skipped`.
- Agent Run Log `Notes` field contains: number of meeting notes processed, number of at-risk deals flagged, number of action items extracted.

## Design

### Worker location and structure
Follow the existing worker pattern established in `workers/summarizer/`. Create a new worker sub-project at `workers/gtm-meeting-summarizer/` with its own `package.json` and `src/index.ts`.

Worker pattern reference: `workers/summarizer/src/index.ts` — study this before implementing. Key conventions:
- Export a `tools` array and an `execute()` function.
- `execute()` is the entry point called by the Notion Custom Agent.
- Each tool has `name`, `description`, `inputSchema`, and a handler.
- Write to Agent Run Log at start AND end of every execution.

### Tools provided by this worker

**`read_recent_meeting_notes(daysBack: number)`**
- Queries GTM | Meeting Notes where `Date >= today - daysBack days`.
- Returns an array of: `{ pageId, title, account, opportunityTitle, date, rep, stage, sentiment, actionItems, summary, competitorMentioned }`.
- Default `daysBack = 1` (yesterday's meetings). The agent can call with `daysBack = 2` to catch weekends.

**`read_opportunity(opportunityId: string)`**
- Fetches a single Opportunity row by page ID.
- Returns: `{ title, account, stage, acv, closeDate, health, rep }`.
- Used to enrich meeting context with deal size and health when summarizing.

**`write_gtm_daily_digest(date: string, summary: string, dealsTouched: number, actionItems: string, releaseCrossRef: string)`**
- Upserts a GTM | Daily Digest row keyed on `Date`.
- If a row already exists for that date, updates the `Summary`, `Deals Touched`, `Action Items`, and `Status = draft` fields.
- Sets `Status = draft` on write (the Notion Custom Agent flips to `published` after review, or it can auto-publish if there are no at-risk flags).
- Returns the page ID of the upserted row.

**`write_agent_run_log(agentName, squadId, startedAt, completedAt, durationMs, outcome, notes)`**
- Same signature as in existing workers. Always write at end of execution.

### Prompt strategy for the Notion Custom Agent

The Notion Custom Agent that calls this worker should use the following instructions (for reference — the agent is configured natively in Notion's Custom Agent UI, not in code):

```
You are the GTM Daily Digest agent for Arcline Technologies. Your job is to read yesterday's
sales meeting notes and produce a concise daily brief for the CRO.

Steps:
1. Call read_recent_meeting_notes(daysBack=1). If it's Monday, use daysBack=3 to catch the weekend.
2. For each meeting note with an opportunity linked, call read_opportunity to get deal context.
3. Write a structured daily digest using write_gtm_daily_digest with these sections:
   - Deal Updates: one line per meeting — "Account (Stage): [key takeaway]"
   - Pipeline Health: total meetings / positive / neutral / at-risk counts
   - Action Items Due ≤48h: bulleted list of rep-specific follow-ups
   - Flags for CRO: any at-risk deals or competitor mentions that need attention

Keep the Summary under 300 words. Be direct and specific — no filler language.
4. Call write_agent_run_log at the end.
```

### Output structure
The `Summary` field on GTM | Daily Digest is rich_text, written as markdown:

```
## Deal Updates
- Meridian Financial (technical-eval): Exec sponsor engaged, CISO meeting requested. Positive momentum.
- Vantage Logistics (negotiation): AT-RISK — evaluating Linear's auth module. Rep needs competitive response by EOD.

## Pipeline Health
3 meetings | 1 positive | 1 neutral | 1 at-risk

## Action Items Due ≤48h
- Marcus Webb: Send Linear competitive comparison to Vantage Logistics by 2026-06-04
- Sarah Chen: Forward AuthShield SSO demo recording to Meridian Financial

## Flags for CRO
⚠ Vantage Logistics (SSO Rollout, $85k, negotiation): Competitor mention — Linear. Marcus Webb is on it.
```

### Daily vs. weekly cadence
This worker is designed to run daily (the Notion Custom Agent is set to a daily morning schedule in the Notion UI). This contrasts with the EPD pipeline's weekly cadence and is the key differentiator for the GTM pitch: "your sales team gets a morning brief every day, not a report every Monday."

### Zero-meetings case
If `read_recent_meeting_notes` returns 0 rows, write a digest row with `Summary = "No meetings recorded for [date]."` and `Status = published` (nothing to review). Log `outcome = skipped` in Agent Run Log with `notes = "no meeting notes for date"`.

## Acceptance Criteria
1. Worker deploys successfully: `cd workers/gtm-meeting-summarizer && ntn workers deploy` exits 0.
2. When called by a Notion Custom Agent with the fixture data from PRD-14, the worker produces a GTM | Daily Digest row for the current date within 30 seconds.
3. The `Summary` field contains all 4 sections: Deal Updates, Pipeline Health, Action Items, Flags for CRO.
4. The Vantage Logistics at-risk meeting (from PRD-14 fixtures) appears in "Flags for CRO" section.
5. Running twice on the same date produces exactly one row (upsert — no duplicates).
6. Agent Run Log has one row with `Agent Name = "gtm-meeting-summarizer"`, `outcome = ok`, and a non-zero duration.
7. Zero-meetings case: an empty-input test produces a `Status = published` row with the "No meetings" message and `outcome = skipped` in the run log.

## Out of Scope
- Enriching the daily digest with release cross-reference data — that is PRD-16 (Release Bridge).
- Writing a battle card update — that is PRD-18.
- Reading from external Salesforce — the GTM | Opportunities DB is the simulated Salesforce.

## Open Questions
- Should the daily digest auto-publish (`Status = published`) or require a manual review step? Recommendation: auto-publish if no at-risk flags; leave as `draft` for human review if at-risk flags are present. Implementing session decides and documents this logic.

## Verification
```bash
# Deploy the worker
cd workers/gtm-meeting-summarizer && ntn workers deploy

# Trigger manually (or via a Notion Custom Agent run)
# Open GTM | Daily Digest in Notion → confirm 1 new row for today
# Open Agent Run Log → confirm 1 row with outcome=ok and agent name gtm-meeting-summarizer

# Test zero-meetings case by running with a date that has no fixture data
# Expected: one published row with "No meetings recorded"
```

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

### What was actually built

- **`workers/gtm-meeting-summarizer/`**: New `ntn` Worker sub-project (package.json, tsconfig.json, workers.json, `src/index.ts`) following the `workers/summarizer/` pattern exactly. Deployed live — **worker ID `019e9eda-b299-70bd-8619-3454f1fb4f0e`**, name `arcline-worker-gtm-meeting-summarizer`. All 4 tools from the brief shipped: `read_recent_meeting_notes`, `read_opportunity`, `write_gtm_daily_digest`, `write_agent_run_log`.
- **`write_gtm_daily_digest` gained an `atRiskCount` parameter** (not in the brief's literal signature) — this resolves the PRD's Open Question. Logic: `atRiskCount = 0 → Status = published` (auto-publish, no review needed), `atRiskCount > 0 → Status = draft` (CRO reviews before it goes live). The Custom Agent computes this count from its own analysis and passes it through; the worker just applies the gate.
- **`write_agent_run_log` dropped the brief's `squadId` parameter** — the shared Agent Run Log schema has no such field (verified against the live `summarizer` worker's usage); `Agent Name` is the sole discriminator across all EPD and GTM agents. Matched the existing convention rather than the PRD's literal signature.
- **`read_recent_meeting_notes` resolves `opportunityTitle` inline** via one extra `pages.retrieve` per linked note (N+1, acceptable at fixture scale of 10–17 rows — flag for revisit if data volume grows into the hundreds).
- **`agent-prompts/gtm-daily-digest.md`**: Full Custom Agent prompt written in the same operational-steps format as `agent-prompts/summarizer-github.md` / `summarizer-master.md`. Includes day-of-week-aware lookback logic (`Monday → daysBack=3`, else `daysBack=1`), all 4 digest sections with formatting rules, and the auto-publish/draft decision table.
- **`scripts/trigger-gtm-daily-digest.ts`** + root `package.json` aliases `gtm-daily-digest` / `gtm-meeting-summarizer:deploy`: A standalone simulation script (mirrors `generate-summaries.ts`) that calls the Anthropic SDK + Notion API directly — useful for demo runs, backfill, and testing without going through the live Custom Agent. Supports `--dry-run`, `--days-back=N`, `--date=YYYY-MM-DD`.

### Gotchas for downstream sessions

**1. `JSONValue` strict-typing rejects `undefined` in union return shapes**
The first `read_opportunity` draft returned `{ error, opportunityId }` on the not-found branch and a full property object on success — TypeScript inferred a union with `title?: undefined` etc., which fails the worker SDK's `JSONValue` constraint (`undefined` isn't a valid JSON value). Fix: return the **same flat shape** on both branches with a `found: boolean` discriminator and empty-string/zero defaults instead of optional fields. Any tool returning a union (success vs. not-found vs. error) will hit this — design the return type as one flat shape from the start.

**2. `ntn workers deploy` requires `--name` on first deploy of a brand-new worker**
Running `ntn workers deploy` in a fresh worker directory fails non-interactively with "A worker name is required to create a new worker." Fix: `ntn workers deploy --name "gtm-meeting-summarizer"`. The `workers.json` does **not** need a `workerId` seeded — `ntn` creates the worker and writes the ID back into `workers.json` automatically on first successful deploy.

**3. "Today" drifted mid-session, producing a misleading-looking note count during live testing**
I recommended testing with `daysBack=4` assuming "today" was 2026-06-06 (per the session's `currentDate` context). By the time Dan ran the live Custom Agent, real wall-clock time had advanced to 2026-06-07, shifting the `on_or_after` cutoff from `2026-06-02` to `2026-06-03` — which correctly excluded the Meridian/Orion notes (dated 06-02) and returned only Vantage + Nexus (06-03). The agent reported "only 2 of 4 expected meetings found" and (incorrectly) speculated the missing notes "don't appear in the database for that range" — when in fact they simply fell outside the date filter. **The worker's `on_or_after` filter is correct**; the confusion was a one-day calibration error in the *test prompt*, surfaced by a date that rolled over during the session. Future sessions giving date-relative test instructions against fixture data should compute the cutoff explicitly (`today - daysBack`) rather than eyeballing "today," and should expect the agent to sometimes misdiagnose filter exclusions as missing data.

**4. Three test/demo artifacts now live in GTM | Daily Digest — clean up before the CRO demo**
This session's verification runs created three rows that are not part of the PRD-14 seed set:
- `2026-06-06` (pageId `377fc8f4-554c-8139-8513-c8090aa024ae`, status=draft) — created by `pnpm gtm-daily-digest --days-back=4` trigger-script runs (AC-2/3/4/5 verification)
- `2026-06-07` (pageId `378fc8f4-554c-814f-b751-c7457e59adf5`, status=draft) — created by the **live Custom Agent** run (the canonical AC-2 proof)
- `2026-01-01` (pageId `377fc8f4-554c-811b-9541-ed492bc22ac8`, status=published) — zero-meetings/`outcome=skipped` test stub (AC-7 proof)

These are real, valid rows (not corrupted data) — but they'll clutter the Daily Digest view during the live CRO demo. Recommend archiving the `2026-01-01` stub and the `2026-06-06` trigger-script row before the interview, keeping the `2026-06-07` live-agent row as the authentic "agent ran this morning" artifact.
