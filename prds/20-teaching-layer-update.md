# PRD-20 — Teaching Layer Update (GTM + Day-2 Operations)

<!-- status:
state: waiting
owner: -
updated: -
notes: -
-->

## Goal
Extend the existing teaching hub with 4 new explainer pages covering the GTM pipeline and a "Day-2 Operations" guide, so Arcline's team can maintain and extend the system independently without needing ongoing Notion support.

## Why this exists
The existing 11-explainer hub (from PRD-10) covers the EPD pipeline thoroughly. Round 2 adds a parallel GTM pipeline with 4 new databases and 3 new workers — none of which are documented for a first-time reader. More importantly, the CRO's implicit objection ("who maintains this after the pilot?") is best answered not in conversation, but by pointing to a page that a non-engineer can follow. The Day-2 Operations explainer makes that answer tangible and clickable.

## Dependencies
- PRD-10 (existing hub page at `36ffc8f4-554c-81a8-9a77-c1abefc99d18` — new explainers are added as sub-pages here).
- PRD-13 through PRD-18 should be complete or near-complete so the explainers describe real, live databases and workers (not hypothetical ones).
- PRD-19 (the Day-2 Operations page is referenced from the Objection Prep page of the presentation deck).

## Inputs
- Teaching Hub page ID: `36ffc8f4-554c-81a8-9a77-c1abefc99d18` (from PRD-10 Implementation Notes).
- Existing worker code in `workers/gtm-meeting-summarizer/`, `workers/gtm-release-bridge/`, `workers/gtm-battle-card-updater/` (to describe what they actually do).
- `src/lib/notion-ids.ts` — for DB IDs referenced in the explainers.

## Outputs
4 new Notion pages as sub-pages of the existing Teaching Hub:
1. `GTM Pipeline Overview`
2. `GTM Daily Digest — How It Works`
3. `Release Bridge — How It Works`
4. `Day-2 Operations: How to Maintain This System`

## Design

### Content standard from PRD-10
Each explainer must be 150–300 words. Concise enough to read in under 90 seconds. No jargon without inline definition. Link to the live database or worker wherever possible — the reader should be able to click from the explainer to the thing it describes.

### Page 1: GTM Pipeline Overview

Content to cover:
- The EPD pipeline and GTM pipeline run in parallel in the same workspace, sharing the same Agent Run Log and observability.
- ASCII diagram showing the two-pipeline architecture with the Key Releases bridge connecting them:
  ```
  EPD Pipeline:              GTM Pipeline:
  Mirror DBs                 Meeting Notes
      ↓                          ↓
  Squad Summaries            Daily Digest
      ↓  [Key Releases]          ↓
  Master EPD ──────────► Release Bridge ──► Deals Flagged
      ↓                      
  GTM Weekly (CRO-facing)    Battle Cards ← Battle Card Updater
  ```
- One sentence on each of the 4 GTM databases and what they contain.
- Why daily (GTM) vs weekly (EPD): sales pipeline moves faster than a sprint — a deal can slip in a day.

### Page 2: GTM Daily Digest — How It Works

Content to cover:
- The GTM Meeting Notes Summarizer reads call records from the last 24 hours.
- Output structure: Deal Updates / Pipeline Health / Action Items / Flags for CRO.
- How to interpret the "at-risk" flag — what it means for a rep, what action it suggests.
- How to trigger a re-run (via the Notion Custom Agent or the `pnpm gtm-daily-digest` script).
- Link to the live GTM | Daily Digest database and the Agent Run Log filtered to `gtm-meeting-summarizer`.

### Page 3: Release Bridge — How It Works

Content to cover:
- The Release Bridge runs after the Master EPD publishes each week.
- It reads Key Releases from the master summary and matches them to open Opportunities via the `Product Interest` relation.
- An "at-risk" deal with a relevant release gets an URGENT flag — reps should act within 24 hours.
- The schema linking: `Opportunity → PRDs DB → Squad Weekly Summary (Key Releases) → Master EPD`.
- Link to GTM | Daily Digest (Release Cross-Ref section) and GTM | Opportunities database.

### Page 4: Day-2 Operations — How to Maintain This System

This is the most important page for the CRO's objection. It must answer: "My team can maintain this without needing Notion's help." Content should be scannable with toggle blocks or numbered sections.

**Four common maintenance operations, each as a toggle:**

**1. Adding a new data source to the EPD pipeline**
- Create a new Mirror DB (or use an existing one) with the standard schema: Title, Squad relation, Status, URL, Last Updated, Body Excerpt, Raw.
- Add a worker script to `src/workers/` that reads from the new source and writes to the Mirror DB.
- Configure a Notion Custom Agent to call the worker, targeting the new source.
- Update the Squad Summarizer prompt to include the new source in its summary.
- Estimated time: 2–3 hours for a developer familiar with the codebase.

**2. Adding a new squad**
- Add a row to the Squads DB in Notion (Name, SquadId, EM, PM, Design Lead).
- Add fixture files under `fixtures/{source}/squad-{id}/` following the existing format.
- Run `pnpm seed-gtm-fixtures` (or the equivalent for EPD fixtures) to create the Mirror rows.
- The existing workers pick up the new squad automatically on next run.
- No code changes required.

**3. Adding a new GTM agent (e.g., Win/Loss Analyzer)**
- Open Notion's Custom Agent UI.
- Name the agent, describe its job in plain language, select which databases it can access.
- Set a trigger (manual, scheduled, or on database event).
- That's it. No code deployment needed.
- To add custom data-processing tools (e.g., a complex query that Notion's built-in access doesn't support), deploy a new `ntn worker` following the pattern in `workers/gtm-meeting-summarizer/`.

**4. Editing an existing agent's behavior**
- Open the Notion Custom Agent page in the Notion UI.
- Edit the instructions in plain language — e.g., "also include the deal's ACV in the Flags for CRO section."
- Save. The change takes effect on the next run. No code deployment, no PR.
- For worker-level changes (changing how data is queried or written), edit the TypeScript in the relevant `workers/` directory and run `ntn workers deploy`.

**Escalation path (when something breaks):**
1. Check Agent Run Log — filter by `Outcome = error`. The Notes field describes what failed.
2. If a worker errored: check the worker's deployment status with `ntn workers list`.
3. If a schema issue: verify DB properties with `ntn api v1/databases/{id} --notion-version 2022-06-28`.
4. If a quorum issue: check that all 3 squads have `Status = approved` in Squad Weekly Summary.

## Acceptance Criteria
1. All 4 new pages exist as sub-pages of the Teaching Hub (`36ffc8f4-554c-81a8-9a77-c1abefc99d18`).
2. Each explainer is 150–300 words (verify with word count).
3. The GTM Pipeline Overview contains a visible ASCII architecture diagram showing both pipelines and the Key Releases connection.
4. The Day-2 Operations page has all 4 maintenance operations as toggle blocks (or numbered sections), each self-contained and actionable without prior context.
5. The Day-2 Operations page includes the escalation path section.
6. Each explainer links to at least one live Notion database or page that it describes.
7. No existing Teaching Hub explainer pages were modified (new additions only).

## Out of Scope
- Updating the existing 11 EPD explainer pages — those are complete from PRD-10 and should not be touched.
- Adding views or database filters — not required for explainers.
- Writing a setup guide for a brand-new Arcline workspace — the Day-2 Operations page assumes the initial setup has already been completed.

## Open Questions
- Should the Day-2 Operations page be linked prominently from the main Notion workspace sidebar, or only accessible from the Teaching Hub? Recommendation: add it to the sidebar as a pinned page — it's the first thing a new Arcline admin would look for. Implementing session decides.

## Verification
```bash
# Confirm hub page exists and is reachable
ntn api v1/pages/36ffc8f4-554c-81a8-9a77-c1abefc99d18 --notion-version 2022-06-28 | jq '.properties.title'
```

Open Notion → Teaching Hub → confirm 4 new sub-pages appear alongside the existing 11. Open "Day-2 Operations" → confirm 4 toggle sections are present and readable by a non-engineer. Word-count each new page (target: 150–300 words).
