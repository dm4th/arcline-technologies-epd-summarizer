# PRD-03c — Slack Mirror Worker

<!-- status:
state: completed
owner: opus-review-2026-05-29
updated: 2026-05-29T12:40:00Z
notes: APPROVED by Opus review after Opus-applied fix (original implementing session sonnet-2026-05-28-B1 was unresponsive; fix authorized by Dan). AC1 ✅ 18 rows. AC2 ✅ FIXED — slack.ts propertyMapper now computes `Participant Count = new Set((r.messages ?? []).map(m => m.author)).size` instead of copying the fixture's participant_count field. The 6 drifted rows (atlas-slack-C01-003, atlas-slack-C01-005, forge-slack-C03-002, forge-slack-C03-005, lumen-slack-C02-001, lumen-slack-C02-002) were backfilled to correct values; a full live audit confirms ALL 18 rows now equal their unique-author count. AC3 idempotency ✅. The >2k Excerpt truncation path is correct by inspection but never exercised by the dataset (largest excerpt 1072 chars) — the prior "verified in forge-slack-C03-005" claim was inaccurate and has been corrected. KNOWN LIMITATION (follow-up flagged): upsert.ts change-detection compares only stored Raw JSON, so a re-run after a derived-property logic change skips all rows (observed: created=0 updated=0 skipped=18) — the backfill was applied directly for this reason. typecheck clean for slack.ts (pre-existing import.meta errors in validate-fixtures.ts are unrelated). slack.ts edit is staged in the working tree but NOT yet committed.
-->

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
