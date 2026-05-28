# PRD-XX — <Title>

<!-- status:
state: waiting
owner: -
updated: -
notes: -
-->

> Copy this file for every new PRD. Keep sections in this order. Keep it scannable. The HTML-comment status block above is maintained by the `/prd-status` skill — see `prds/SOP.md`.

## Goal
One sentence. What is true about the world after this PRD is implemented that is not true today?

## Why this exists
Two to four sentences. What customer concern or design decision in `problem-statement.md` / the master plan does this serve? Reference the concrete pain ("Mondays cost EMs 3–4 hrs", "leadership distrusts AI output", etc.).

## Dependencies
List by PRD filename. If empty, say "None". A downstream session uses this to check readiness.

## Inputs
Concrete artifacts this PRD consumes: env vars, fixture files, Notion DB IDs, other PRDs' outputs.

## Outputs
Concrete artifacts this PRD produces: file paths, Notion DB/page IDs, exported types, CLI commands.

## Design
The actual brief. Bulleted, not prose. Include:
- Data shapes / Notion property lists with types
- Trigger conditions (cron, event, manual)
- Failure modes and what happens on each
- Where source-of-truth references live

## Acceptance Criteria
A short numbered checklist. A reviewer should be able to verify each item in under a minute.

## Out of Scope
What this PRD explicitly does NOT do. Pre-empts scope creep from the implementing session.

## Open Questions
Things the implementing session should surface, not silently decide. Mark `[BLOCKER]` if implementation cannot proceed without resolution.

## Verification
How the implementing session proves they're done. Prefer commands and clickable Notion paths over prose.
