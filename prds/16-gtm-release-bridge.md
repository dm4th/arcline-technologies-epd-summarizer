# PRD-16 — Release → Opportunity Cross-Reference (Bridge Worker)

<!-- status:
state: ready
owner: -
updated: 2026-06-08T16:50:00Z
notes: Deps all completed (13, 14, 17) — PRD-17 approval unblocked this. READY to claim (Wave R2-C). Reads Key Releases from Master EPD, flags open deals with matching Product Interest.
-->

## Goal
A new `ntn` Worker (`workers/gtm-release-bridge`) that reads the `Key Releases` section from the current week's Master EPD Weekly row and identifies open Opportunities whose `Product Interest` matches the releasing squad's PRDs, then writes proactive outreach suggestions into the current GTM | Daily Digest row.

## Why this exists
This is the CRO's "AHA" moment in the demo: engineering ships AuthShield this week, and within minutes the sales team is alerted that three open enterprise deals are actively evaluating that product — and none of those reps have been told about the release yet. This directly answers the CRO's first question ("does this improve our ability to communicate product updates to customers faster?") with a live, traceable example.

## Dependencies
- PRD-13 (GTM | Opportunities, GTM | Daily Digest schemas).
- PRD-14 (fixture data — Opportunities must exist with `Product Interest` relations to PRDs).
- PRD-17 (Squad Summarizer must write `Key Releases` to Squad Weekly Summary; Master Summarizer must collect these into Master EPD Weekly body). PRD-16 can be built before PRD-17 is complete, but the end-to-end flow requires PRD-17 to produce the `Key Releases` content.

## Inputs
- **Master EPD Weekly** DB ID: `NOTION_IDS.dbs.masterEpdWeekly` from `src/lib/notion-ids.ts`.
- **GTM | Opportunities** DB ID: `NOTION_IDS.dbs.opportunities`.
- **GTM | Daily Digest** DB ID: `NOTION_IDS.dbs.gtmDailyDigest`.
- **PRDs DB** ID: `NOTION_IDS.dbs.prds` — needed to resolve PRD title from relation ID.
- **Agent Run Log** DB ID: `NOTION_IDS.dbs.agentRunLog`.
- `weekOf` parameter (ISO week string, e.g. `"2026-W21"`) — passed by the Notion Custom Agent.

## Outputs
- `Release Cross-Ref` property on the current **GTM | Daily Digest** row is updated with markdown-formatted outreach suggestions.
- One **Agent Run Log** row with `Agent Name = "gtm-release-bridge"`, outcome, and a notes field containing the count of releases found, opportunities matched, and deals flagged.

## Design

### Worker location and structure
Create `workers/gtm-release-bridge/` following the same pattern as `workers/summarizer/` and `workers/gtm-meeting-summarizer/` (PRD-15). Export `tools` array and `execute()` function.

### Tools provided by this worker

**`read_master_epd_releases(weekOf: string)`**
- Queries Master EPD Weekly where `Week Of = weekOf` and `Status = published`.
- Returns the `GTM Highlights` property text AND reads the page body to extract the `## Key Releases This Week` section.
- Returns: `{ pageId, weekOf, keyReleasesText, gtmHighlights, squadsPRDIds: string[] }`.
- If no published Master EPD exists for the week: returns `null` and the agent logs `outcome = skipped`.

**`read_opportunities_by_prd(prdIds: string[])`**
- Queries GTM | Opportunities filtered by `Product Interest` relation — finds Opportunities whose `Product Interest` contains any of the given PRD page IDs.
- Filters to active deals only: `Stage NOT IN (closed-won, closed-lost)`.
- Returns: `{ pageId, title, account, stage, acv, rep, health, productInterestTitles }[]`.

**`read_gtm_daily_digest_today()`**
- Fetches the GTM | Daily Digest row for today's date (today = ISO date at run time).
- Returns `{ pageId, date, status }` or `null` if no row exists for today.
- If null, the agent should prompt the meeting summarizer to run first, or create a minimal stub row.

**`write_release_crossref(digestPageId: string, crossRefMarkdown: string)`**
- Patches the `Release Cross-Ref` rich_text property on the specified GTM | Daily Digest page.
- Does NOT overwrite existing content — appends to existing `Release Cross-Ref` value with a newline separator.
- Returns the updated page ID.

**`write_agent_run_log(agentName, squadId, startedAt, completedAt, durationMs, outcome, notes)`**
- Same signature as existing workers.

### Prompt strategy for the Notion Custom Agent

```
You are the GTM Release Bridge for Arcline Technologies. Your job is to connect this week's
engineering releases to open sales opportunities that should hear about them.

Steps:
1. Call read_master_epd_releases(weekOf) for the current week.
   - If no published Master EPD exists, log the run as skipped and stop.
2. Call read_opportunities_by_prd with the PRD IDs referenced in the key releases.
3. For each matched opportunity, check if it is active (not closed).
4. Write a release cross-reference using write_release_crossref with this format:
   "## Release Alerts — [Week]
   [Release name]: shipped this week.
   → [N] open deals should hear about this:
     - [Account] ([Stage], $[ACV]k) — [Rep] — [recommended outreach action]"
5. Call write_agent_run_log.
```

### Example output in `Release Cross-Ref` field

```markdown
## Release Alerts — 2026-W21

AuthShield SSO Phase 1: shipped this week (Atlas squad — merged, all ACs met).
→ 3 open deals should hear about this:
  - Meridian Financial (technical-eval, $120k) — Sarah Chen — Forward AuthShield release notes; offer updated SSO demo
  - Vantage Logistics (negotiation, $85k) ⚠ AT-RISK — Marcus Webb — URGENT: Linear comparison is their blocker; AuthShield just shipped the feature they need
  - Pinnacle Retail (technical-eval, $55k) — Marcus Webb — Proactive outreach: let them know the auth migration timeline is now confirmed

FieldKit Offline Sync: shipped this week (Forge squad — v2.1 released).
→ 2 open deals should hear about this:
  - Orion Health (technical-eval, $95k) — Sarah Chen — Share FieldKit v2.1 release notes with their mobile team
  - Nexus Manufacturing (negotiation, $78k) ⚠ AT-RISK — Jordan Park — Monday.com pricing concern; FieldKit now matches their offline requirements — update your pitch
```

### Trigger
This worker fires **after** Master EPD Weekly status transitions to `published`. In the demo this is manual: the CRO demo moment is "let me show you what happens the moment engineering publishes the digest." The Notion Custom Agent can be triggered manually or set to watch the Master EPD Weekly DB for status changes via a Notion Automation.

### No-match case
If `read_opportunities_by_prd` returns 0 matches, write `Release Cross-Ref = "No open deals flagged for this week's releases."` and log `outcome = skipped`.

### PRD ID resolution
The `read_master_epd_releases` tool returns PRD IDs from the relation. The agent must also resolve PRD titles (for readable output) by calling the Notion API on each PRD page. The worker can either expose a `read_prd(prdId)` tool, or the implementing session can resolve titles inside `read_master_epd_releases` directly.

## Acceptance Criteria
1. Worker deploys: `cd workers/gtm-release-bridge && ntn workers deploy` exits 0.
2. With PRD-14 fixtures and a published Master EPD Weekly row (from PRD-17's demo run), the worker writes a `Release Cross-Ref` section to today's GTM | Daily Digest.
3. The output contains Meridian Financial and Vantage Logistics flagged under AuthShield.
4. Vantage Logistics is marked with an "URGENT" or "⚠ AT-RISK" indicator (because its `Health = at-risk` in the fixture data).
5. No closed-won or closed-lost opportunities appear in the output.
6. Zero-match case: worker runs cleanly with `outcome = skipped` and a "No open deals flagged" message.
7. Agent Run Log has one row with `Agent Name = "gtm-release-bridge"`, `outcome = ok`, and `Notes` contains "X releases found, Y opportunities matched".

## Out of Scope
- Sending actual emails or Slack messages to reps — output is a Notion page property only.
- Reading external Salesforce API — GTM | Opportunities is the simulated Salesforce.
- Automatic scheduling — trigger is manual or via Notion Automation status watch; no cron setup required.

## Open Questions
- Should the Release Bridge write to the same GTM | Daily Digest row as the Meeting Summarizer (PRD-15), or create its own separate row? Recommendation: write to the same row (append to `Release Cross-Ref` property). This keeps the daily brief cohesive. Implementing session decides and documents.

## Verification
```bash
# Deploy
cd workers/gtm-release-bridge && ntn workers deploy

# Run manually via a Notion Custom Agent, or trigger via CLI:
# 1. Ensure a published Master EPD Weekly row exists for 2026-W21 (use pnpm generate-master)
# 2. Trigger the bridge worker via the Notion Custom Agent
# 3. Open GTM | Daily Digest → today's row → Release Cross-Ref property
# Expected: AuthShield and FieldKit release alerts with matched opportunities

# Check Agent Run Log for the run record
ntn api v1/databases/${NOTION_IDS.dbs.agentRunLog}/query \
  --notion-version 2022-06-28 \
  -d '{"filter":{"property":"Agent Name","select":{"equals":"gtm-release-bridge"}}}' \
  | jq '.results[0].properties.Outcome'
# Expected: "ok"
```
