# PRD-03d — Figma Mirror Worker

## Goal
Populate **Mirror — Figma** with one row per relevant file/comment thread per squad per week.

## Why this exists
Design context is the easiest thing for a Monday-morning report to miss. The Forge squad's "Figma comment reverses a PRD decision" tension lives here.

## Dependencies
- PRD-00, PRD-01, PRD-02, PRD-03.

## Inputs
- `fixtures/figma/<squad>/<week>.json` (each entry = file + comment thread)
- `notion-ids.mirrorFigmaDbId`

## Outputs
- One Notion row per file/comment thread, dedupe by `File Key` + first comment id.
- `Agent Run Log` rows tagged `worker.figma`.

## Design
- `normalize`: `summary` = top-level comment first 280 chars. `Comment Excerpt` = full thread, truncated to ~1.5k chars.
- One row per *thread*, not per comment — a file can have multiple threads → multiple rows sharing `File Key`.

## Acceptance Criteria
1. Mirror — Figma has one row per fixture thread × squad.
2. Multiple threads in the same file produce multiple rows.
3. Idempotent re-runs.

## Out of Scope
- Real Figma API.
- Image previews (out of scope for V1; mention as easy V2 win in the submission HTML).

## Open Questions
None.
