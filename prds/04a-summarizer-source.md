# PRD-04a — Per-Source Summarizer Agents

## Goal
Produce one **Squad Weekly Summary** row per (squad × source) — 12 total per week — each with a structured summary and verifiable citations back to mirror DB rows.

## Why this exists
Smaller agents with narrow context are Dan's mitigation for hallucination risk. This PRD operationalizes that bet and defines the citation contract that PRD-08 will measure.

## Dependencies
- PRD-00, PRD-01, PRD-03a/b/c/d (mirror DBs must be populated).

## Inputs
- Mirror DB row sets for one squad × one source.
- The squad's PRD page (for context only; summarizer should not rewrite PRD).
- Last week's summary for the same (squad, source) — for trend context.

## Outputs
- Notion pages in **Squad Weekly Summary** with:
  - `Squad`, `Week Of`, `Source` set.
  - `Summary` (rich text): markdown-shaped sections — *What shipped*, *In progress*, *Risks*, *Notable*.
  - `Citations` (text JSON): array of `{ recordId: notionPageId, sourceUrl: string, claim: string }`. Every factual statement in `Summary` must map to at least one citation.
  - `Status = awaiting-review`.
  - `Generated At` timestamp.
- One `Agent Run Log` row per agent invocation, tagged `summarizer.<source>.<squad>`.

## Design

### Citation contract (THIS is the critical bit — PRD-08 scores against it)
- Inline citation style in Notion: each factual sentence ends with one or more inline mentions linking to a mirror DB row (Notion's `@mention` block referencing the page).
- Parallel structured array in `Citations` property for machine parsing by PRD-08.
- A "factual statement" = any sentence containing a specific noun phrase referring to a PR, ticket, person, decision, or number. Vague summary sentences ("the team made progress on auth") are not required to cite.
- **Coverage target: ≥ 90% of factual sentences cited.** Measured by PRD-08.

### Trigger
- On completion of the corresponding `worker.<source>` Agent Run Log row (event-driven), OR on cron Mon 6:30AM (belt and suspenders).
- Reads the trailing N=4 weeks of summaries to detect trends (e.g., "this is the third week the Atlas team has carried over the search-perf ticket").

### Agent surface
- Built as Notion Custom Agents where supported. Each agent has a tightly scoped system prompt naming its source and squad — no agent sees > 1 source.
- Master summarizer (PRD-05) gets the cross-source view, not these.

### Failure modes
- If a mirror DB has zero records this week for a (squad, source): produce a summary with `Summary = "No activity this week."` and `Citations = []`. Mark `Status = approved` automatically (skips HITL).

## Acceptance Criteria
1. 12 summary rows produced per fixture week (4 sources × 3 squads).
2. Each summary's `Citations` JSON parses and references valid mirror DB page IDs.
3. Random spot-check: open any summary, click any inline mention — lands on a real mirror row whose content supports the cited claim.
4. Zero-activity summaries do not enter HITL.

## Out of Scope
- Product roadmap / PRD fact checking → PRD-04b.
- Cross-source synthesis → PRD-05.
- Evaluation of citation quality → PRD-08.

## Open Questions
- Notion Custom Agents prompt-length and tool-call constraints — implementing session must confirm a single agent can hold the system prompt + this week's mirror context. Fallback: TS-side LLM call writing into Notion via SDK. Either is acceptable; document the choice in the PRD when complete.

## Verification
- Open Squad Weekly Summary DB, filter `Week Of = <this week>`, expect 12 rows.
- For each row, parse `Citations`, assert all `recordId` values resolve in Notion.
