# PRD-03b — Jira Mirror Worker

<!-- status:
state: completed
owner: opus-review-2026-05-29
updated: 2026-05-29T12:10:00Z
notes: APPROVED by Opus review — all ACs re-verified live. AC1 ✅ 34 rows. AC2 ✅ Acceptance Criteria verbatim-match confirmed on live rows. AC3 ✅ idempotent re-run skipped=34. Status constrained to valid select options; worker.jira run-log non-zero duration, outcome=ok.
-->

## Goal
Populate **Mirror — Jira** with one row per ticket per squad per week.

## Why this exists
Jira holds the squad's intended scope; the master summarizer's "PR ↔ Jira mismatch" tension cannot fire without it.

## Dependencies
- PRD-00, PRD-01, PRD-02, PRD-03.

## Inputs
- `fixtures/jira/<squad>/<week>.json`
- `notion-ids.mirrorJiraDbId`

## Outputs
- One Notion row per ticket, dedupe by `Ticket Key`.
- `Agent Run Log` rows tagged `worker.jira`.

## Design
- `normalize`: standard mapping. `summary` = `description` first paragraph, ≤280 chars. `Acceptance Criteria` populated verbatim from fixture's `acceptance_criteria` field (multi-line text).
- Status select values constrained to: `Backlog`, `In Progress`, `In Review`, `Done`, `Blocked`.

## Acceptance Criteria
1. Mirror — Jira has one row per fixture ticket × squad.
2. Acceptance Criteria preserved exactly (whitespace tolerant).
3. Idempotent re-runs.

## Out of Scope
- Real Jira API integration.

## Open Questions
None.
