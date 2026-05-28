# PRD-04b — Product Roadmap Summarizer + PRD Fact Checker

## Goal
For each of 3 squads, produce two additional Squad Weekly Summary rows: (a) progress against the Product Roadmap, (b) PRD drift / scope-of-work fact-check.

## Why this exists
- Roadmap summarizer ties weekly noise to leadership's strategic narrative — exactly what VPs read for.
- PRD Fact Checker is Dan's hallucination-on-the-customer-side defense: it surfaces when squads are quietly working on things the PRD doesn't authorize, OR when the PRD says something the activity ignores.

## Dependencies
- PRD-00, PRD-01, PRD-04a (uses other summaries as input).

## Inputs
- The squad's PRD page (acceptance criteria, status).
- The Product Roadmap DB filtered to `Owning Squad = squad`.
- All four per-source Squad Weekly Summary rows for the squad this week (from PRD-04a).

## Outputs
- 6 additional Squad Weekly Summary rows (3 squads × 2 agents).
  - `Source = "roadmap"` or `Source = "prd-fact-check"`.
- `Agent Run Log` rows tagged `summarizer.roadmap.<squad>` and `summarizer.prdcheck.<squad>`.

## Design

### Roadmap Summarizer (per squad)
- Cross-references this week's activity (via the 4 per-source summaries) to the squad's roadmap initiatives.
- Output sections: *On track*, *At risk*, *No movement*, *Off-plan activity*.
- Citations: each statement references either a roadmap row OR an upstream per-source Summary row (cascade citation).

### PRD Fact Checker (per squad)
- Defined contract (filling the gap Dan flagged):
  1. **Scope drift**: Activity (PR/ticket/Slack) describes a change not covered by any PRD acceptance criterion → flag.
  2. **Stalled criterion**: PRD criterion has no supporting activity for ≥ 2 consecutive weeks → flag.
  3. **Reversal**: A design (Figma) decision contradicts a PRD criterion → flag.
- Output: bullet list of flags, each with severity (`info` / `warn` / `block`), citation to PRD criterion, citation to the contradicting activity.
- If no flags: output "PRD aligned this week." with empty citations array. Auto-approve.

### Trigger
- After all four PRD-04a summaries for the squad land. (Use Agent Run Log polling or workflow event.)

## Acceptance Criteria
1. 6 rows produced per fixture week (3 squads × 2 agents).
2. PRD Fact Checker correctly flags the Forge squad's Figma-reverses-PRD planted tension (PRD-02 #3).
3. Roadmap Summarizer correctly tags the Atlas/Lumen cross-squad-dependency activity (PRD-02 #5).
4. Citations cascade properly: a roadmap summary citing a per-source summary should not be flagged as "uncited" by PRD-08.

## Out of Scope
- Updating the PRD or Roadmap pages (read-only).
- Cross-squad synthesis (PRD-05).

## Open Questions
- Drift-detection prompt complexity — if Custom Agents can't hold the multi-document context, fall back to TS-side LLM call. Surface fallback choice in implementation notes.
