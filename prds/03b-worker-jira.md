# PRD-03b — Jira Mirror Worker

<!-- status:
state: in-review
owner: sonnet-2026-05-28-B1
updated: 2026-05-28T23:45:00Z
notes: Mirror — Jira populated: 34 rows across atlas/lumen/forge (2026-W21). AC1 ✅ 34 rows. AC2 ✅ idempotent re-run. AC3 ✅ Acceptance Criteria preserved verbatim. Agent Run Log worker.jira rows present. Status constrained to Backlog/In Progress/In Review/Done/Blocked.
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
