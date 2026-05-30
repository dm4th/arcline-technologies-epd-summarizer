# PRD-05 — Master Summarizer Agent

<!-- status:
state: in-progress
owner: sonnet-2026-05-29-A1
updated: 2026-05-29T23:59:00Z
notes: Claimed for Wave D Master Summarizer build. All deps completed (00, 01, 04a, 04b, 06).
-->

## Goal
Generate the single weekly **Master EPD Weekly** report from approved Squad Weekly Summaries, with explicit cross-source/cross-squad synthesis and an honest report of citation coverage.

## Why this exists
This is the artifact a VP reads. Every other PRD exists to feed this one. If this row isn't trustworthy on Monday morning, the POC fails.

## Dependencies
- PRD-00, PRD-01, PRD-04a, PRD-04b, PRD-06 (approval state).

## Inputs
- All approved Squad Weekly Summary rows for the current `Week Of`.
- Previous week's Master EPD Weekly row (for trend voice).
- Comments + reactions on the previous Master row (VP feedback signal).
- Product Roadmap DB.

## Outputs
- One row in **Master EPD Weekly** per week:
  - `Executive Summary`: ≤ 200 words.
  - `Body`: sections — *Highlights*, *Risks & Blockers*, *Cross-Squad Dependencies*, *Roadmap Movement*, *Open Discrepancies* (the planted-tension call-outs).
  - `Citation Coverage %`: % of factual sentences in `Body` with a working citation (computed inline; PRD-08 also independently audits).
  - `Quorum Met`: true iff all 3 squads approved.
  - `Squads Approved`: relation to Squads.
  - `Status = awaiting-VP`.
- `Agent Run Log` row tagged `summarizer.master`.

## Design

### Soft quorum
- Trigger: all 3 squads approved → fire immediately.
- Fallback: at Monday 10:00AM, fire with whichever squads are approved provided **≥ 2/3** are in. Unapproved squad's section header gets a visual marker (e.g. "⚠ Unreviewed — provisional"). This is Dan's mitigation for single-point-of-failure approvals.
- Below quorum (≤ 1 approved): do NOT publish; write an `Agent Run Log` row with `outcome = skipped` and notify eng managers.

### Conflict-resolution policy (mirrors Customer Q #1)
Default rules baked in, customer-validatable:
- **Status of work** → Jira wins; PRs are signals of progress, not authority.
- **What code actually does** → GitHub PR wins over Jira description.
- **Decisions about design** → Figma wins over older PRD if dated newer.
- **Anything Slack-only** → flagged but never treated as authoritative; surfaced under *Open Discrepancies*.

The implementing session must surface this policy at the bottom of the Master row in a callout block so the VP sees the rules ("Editable — see SE for changes"). Teaches Arcline how to fish.

### Voice
- Crisp, executive-style, past-tense for shipped, present for in-flight, future-conditional for risks.
- Cite by inline mention to the originating Squad Weekly Summary (which itself cites the mirror row → 2-hop citation chain is fine and auditable).

## Acceptance Criteria
1. One Master row per week.
2. With all 3 fixture squads approved, `Quorum Met = true` and `Citation Coverage %` ≥ 85.
3. *Open Discrepancies* section contains all planted tensions from PRD-02.
4. Conflict-resolution callout block is present and matches the policy above.
5. With 2/3 squads approved, the row publishes with the unreviewed squad visibly marked provisional.
6. With 1/3 approved, no row is published; an `outcome = skipped` log row exists.

## Out of Scope
- VP feedback ingestion loop beyond reading previous-week comments (V2).
- Real-time staleness re-runs (V2 per `solution-intro.md`).

## Open Questions
- Where exactly does the VP "publish" gate live in the UX? Recommend a single "Publish to leadership" button (Notion automation or simple status change) — implementing session decides and documents in PRD-06 if it touches HITL.

## Verification
- `pnpm tsx scripts/run-week.ts --week=<W>` produces the Master row.
- Open Master EPD Weekly DB → newest row → all required sections present.
- Toggle one squad's approval off, re-run, observe provisional marker.
