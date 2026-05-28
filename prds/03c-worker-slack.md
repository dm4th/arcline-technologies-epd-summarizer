# PRD-03c — Slack Mirror Worker

## Goal
Populate **Mirror — Slack** with one row per thread per squad per week.

## Why this exists
Slack is the lowest-structure source. Demonstrating that Notion can ingest and summarize it is a credibility moment for the POC. It's also where the "blocker that never made it to Jira" tension lives.

## Dependencies
- PRD-00, PRD-01, PRD-02, PRD-03.

## Inputs
- `fixtures/slack/<squad>/<week>.json` (each entry = thread with messages array)
- `notion-ids.mirrorSlackDbId`

## Outputs
- One row per thread, dedupe by `Permalink`.
- `Agent Run Log` rows tagged `worker.slack`.

## Design
- `normalize`: `summary` = first message + " — " + last message, ≤280 chars total. `Participant Count` = unique authors in the thread.
- `Excerpt` (Notion text property): full concatenated thread, truncated to ~2k chars. Summarizer can pull `raw` for full content if needed.

## Acceptance Criteria
1. Mirror — Slack has one row per fixture thread × squad.
2. `Participant Count` matches the unique author count in the fixture.
3. Threads with > 2k char total are visibly truncated in `Excerpt` with a `…` suffix and full content still present in `Raw`.

## Out of Scope
- Real Slack API or SCIM ingestion.

## Open Questions
- Should Slack threads be linked by relation to Jira/GitHub rows when the fixture indicates a cross-reference? Recommend: parse a `linked_records` field in the fixture and populate a Notion relation. Implementing session decides if PRD-01 schema needs to add `Cross-Refs` properties; if so, raise as `[BLOCKER]` and update PRD-01 first.
