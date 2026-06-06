# PRD-15 — GTM Meeting Notes Daily Summarizer Worker

<!-- status:
state: waiting
owner: -
updated: -
notes: -
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
