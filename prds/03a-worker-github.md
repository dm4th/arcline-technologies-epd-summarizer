# PRD-03a — GitHub Mirror Worker

## Goal
Populate **Mirror — GitHub** with one row per PR per squad per week, normalized to `SourceRecord`.

## Why this exists
GitHub PRs are the highest-signal source for "what shipped" and are the easiest data source to demo with — start the parallel-wave momentum here.

## Dependencies
- PRD-00, PRD-01, PRD-02, PRD-03 (pattern).

## Inputs
- `fixtures/github/<squad>/<week>.json`
- `notion-ids.mirrorGithubDbId`

## Outputs
- One Notion row per PR, dedupe by `PR Number` + `Squad`.
- `Agent Run Log` rows tagged `worker.github`.

## Design
- `normalize`: map fixture PR fields → `SourceRecord`. `summary` = PR body's first paragraph, truncated to 280 chars. `raw` = the original fixture object.
- `propertyMapper`: title = `#NN — <PR title>`, populate Linked Jira if the fixture has `linked_jira_key`.
- Cron: Mon 6AM. Manual trigger via `scripts/trigger-workers.ts --source=github`.

## Acceptance Criteria
1. After running, Mirror — GitHub contains one row per fixture PR across all 3 squads.
2. Re-running with no fixture changes leaves DB untouched (zero updates).
3. Editing a fixture's `body` and re-running updates `Body Excerpt` and `Last Updated` on exactly that row.
4. `Agent Run Log` shows one `worker.github` row per run with non-zero `Duration ms`.

## Out of Scope
- Real GitHub API calls.
- Summarization (PRD-04a).

## Open Questions
None expected; pattern is fully specified in PRD-03.
