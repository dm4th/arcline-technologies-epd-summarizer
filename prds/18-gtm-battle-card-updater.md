# PRD-18 — GTM Battle Card Updater Worker

<!-- status:
state: ready
owner: -
updated: 2026-06-08T16:50:00Z
notes: Deps all completed (13, 14, 17, 01) — PRD-17 approval unblocked this. READY to claim (Wave R2-C). Reads Key Releases + Product Roadmap, updates Our Differentiators on Battle Cards.
-->

## Goal
A new `ntn` Worker (`workers/gtm-battle-card-updater`) that reads the current week's Key Releases from Master EPD and the existing Product Roadmap, compares them against each competitor's known strengths, and updates the `Our Differentiators` section of each GTM | Battle Card with newly-released capabilities in customer-facing language.

## Why this exists
The Director of Sales Enablement's pain: battle cards are always out of date when a rep needs them. Every time engineering ships a feature, someone has to manually update the competitive positioning docs — and it never happens fast enough. This worker automates the loop: ship → battle card updated same week. It's the "automate competitive intelligence" use case that the Dir of Sales Enablement will immediately recognize.

## Reference Implementation — AI-Native GTM Hub
> **Borrow before you build.** See [`prds/REFERENCE-gtm-hub.md`](REFERENCE-gtm-hub.md). The competitive
> reasoning here should reuse the Hub's `product` agent prompt — specifically its COMPETITIVE
> INTELLIGENCE section (`personal-website/lib/projects/notion-meeting-intelligence/prompts.ts`) and the
> `ProductAnalysis.competitive_gaps[]` output shape (`types.ts`). That prompt already knows how to
> compare a product's capabilities against named competitors and surface gaps — adapt it to compare
> *this week's releases* against each competitor's known strengths.

## Dependencies
- PRD-13 (GTM | Battle Cards database must exist with correct schema).
- PRD-14 (3 competitor rows must be seeded in Battle Cards — Asana, Monday.com, Linear).
- PRD-17 (Master Summarizer must write `Key Releases` content into Master EPD and Squad Weekly Summaries before this worker can read meaningful release data).
- PRD-01 (Product Roadmap DB must be populated — provides strategic context about what's in progress beyond the current week's releases).

## Inputs
- **Master EPD Weekly** DB ID: `NOTION_IDS.dbs.masterEpdWeekly` — source for Key Releases.
- **Product Roadmap** DB ID: `NOTION_IDS.dbs.productRoadmap` — for "what's coming" competitive context.
- **GTM | Battle Cards** DB ID: `NOTION_IDS.dbs.battleCards`.
- **Agent Run Log** DB ID: `NOTION_IDS.dbs.agentRunLog`.
- `weekOf` parameter (ISO week string).

## Outputs
- `Our Differentiators` and `Related Releases` properties updated on each GTM | Battle Card row where this week's releases are relevant.
- `Last Updated` date property set to the current date.
- One **Agent Run Log** row per invocation.

## Design

### Worker location and structure
Create `workers/gtm-battle-card-updater/` following the existing worker pattern from `workers/summarizer/`. Export `tools` array and `execute()` function.

### Tools provided by this worker

**`read_key_releases_for_week(weekOf: string)`**
- Queries Master EPD Weekly for the published row with `Week Of = weekOf`.
- Reads the page body and extracts the `## Key Releases This Week` section text.
- Also reads `Key Releases` property from all Squad Weekly Summary rows for the same week (for per-squad granularity).
- Returns: `{ weekOf, keyReleasesText: string, perSquad: { squadId, releases: string }[] }`.
- Returns `null` if no published Master EPD exists for the week.

**`read_product_roadmap(status?: 'in-progress' | 'shipped' | 'planned')`**
- Queries Product Roadmap DB filtered by status.
- Returns: `{ pageId, title, owningSqaud, targetQuarter, status, notes }[]`.

**`read_battle_cards()`**
- Fetches all rows in GTM | Battle Cards.
- Returns: `{ pageId, competitor, theirStrengths, ourDifferentiators, relatedReleases, lastUpdated }[]`.

**`update_battle_card(pageId: string, ourDifferentiators: string, relatedReleases: string, lastUpdated: string)`**
- PATCHes `Our Differentiators`, `Related Releases`, and `Last Updated` on the given Battle Card row.
- Does NOT overwrite `Their Strengths` — that field is manually maintained.
- Uses `PATCH /v1/pages/{pageId}` with `--notion-version 2022-06-28`.

**`write_agent_run_log(agentName, squadId, startedAt, completedAt, durationMs, outcome, notes)`**
- Standard Agent Run Log write. Notes should include: competitor count updated, releases referenced.

### Prompt strategy for the Notion Custom Agent

```
You are the Battle Card Updater for Arcline Technologies' GTM team.
Your job is to refresh the competitive battle cards every week based on what engineering just shipped.

Steps:
1. Call read_key_releases_for_week(weekOf) to get what shipped this week.
   - If nothing shipped (no published Master EPD), log skipped and stop.
2. Call read_product_roadmap(status="shipped") to get recently shipped roadmap items for context.
3. Call read_battle_cards() to get current competitor data.
4. For each competitor (Asana, Monday.com, Linear), compare their "Their Strengths" against this week's releases:
   - Which releases directly address a gap vs. this competitor?
   - Which roadmap items (in-progress or planned) strengthen our position further?
5. Call update_battle_card for each competitor with an updated "Our Differentiators" section.
6. Call write_agent_run_log.

"Our Differentiators" format:
- Use customer-facing language only. No ticket numbers or PR references.
- Lead with what WE now do, not what the competitor lacks.
- Include a "[NEW THIS WEEK]" tag for capabilities that just shipped.
- Example: "[NEW THIS WEEK] AuthShield: enterprise SSO with SOC2 compliance — directly addresses Vantage Logistics' security requirements that [Competitor] cannot meet without third-party add-ons."
```

### Example output — `Our Differentiators` for "Linear" battle card

```
[NEW THIS WEEK] AuthShield Phase 1 shipped: native enterprise SSO with granular permission scoping. Linear's auth is developer-centric with no enterprise SCIM provisioning — position this in any security-focused evaluation.

[NEW THIS WEEK] FieldKit Offline Sync v2.1: field teams can work without connectivity and sync with zero data loss. Linear has no offline mode for mobile — strong differentiator for logistics and field service accounts.

Coming soon (Q3): Luminance Design System 2.0 — unified component library will accelerate customer onboarding velocity. Competitive signal: Linear relies on third-party design tools.
```

### Competitor-to-release relevance mapping
The Notion Custom Agent infers relevance based on the competitor's known strengths and the release description. There is no hardcoded mapping — the LLM makes this judgment. The implementing session should test that Vantage Logistics' at-risk deal context (Linear is the competitor) surfaces AuthShield as a differentiator in the Linear battle card.

### Idempotency
Running the worker twice in the same week overwrites the same `Our Differentiators` field with the same content (deterministic given the same input). No duplicate rows are created.

### What does NOT change
`Their Strengths` is never modified by this worker. It is a manually maintained field — the competitor's actual capabilities, not Arcline's perspective. The worker only writes to `Our Differentiators`, `Related Releases`, and `Last Updated`.

## Acceptance Criteria
1. Worker deploys: `cd workers/gtm-battle-card-updater && ntn workers deploy` exits 0.
2. After running with W21 fixture data (AuthShield shipped by Atlas), the Linear battle card's `Our Differentiators` contains a `[NEW THIS WEEK]` entry referencing AuthShield.
3. `Last Updated` on all 3 battle cards is set to a date in the current week.
4. `Their Strengths` on all 3 battle cards is unchanged from the fixture values seeded in PRD-14.
5. Running twice produces the same output (idempotent — no duplicate content appended).
6. Agent Run Log has one row with `Agent Name = "gtm-battle-card-updater"`, `outcome = ok`.
7. No-releases case (no published Master EPD): worker logs `outcome = skipped`, no battle cards modified.

## Out of Scope
- Fetching live competitor data from the web — the `Their Strengths` field is manually maintained.
- Generating rep-facing battle card PDFs or Slack messages — output is Notion only.
- Updating the Product Roadmap DB — this worker reads it, never writes to it.

## Open Questions
- Should the worker update ALL 3 battle cards every week, or only the ones where this week's releases are directly relevant? Recommendation: update all 3 every week — even a "no relevant releases this week" entry keeps the `Last Updated` timestamp current and signals to reps that the card was reviewed.

## Verification
```bash
# Deploy
cd workers/gtm-battle-card-updater && ntn workers deploy

# Trigger via Notion Custom Agent (or manually simulate after pnpm generate-master)
# Open GTM | Battle Cards → Linear row → confirm "Our Differentiators" has [NEW THIS WEEK] AuthShield entry
# Confirm Last Updated = today's date
# Confirm Their Strengths unchanged from PRD-14 seed values

# Check Agent Run Log
ntn api v1/databases/${NOTION_IDS.dbs.agentRunLog}/query \
  --notion-version 2022-06-28 \
  -d '{"filter":{"property":"Agent Name","select":{"equals":"gtm-battle-card-updater"}}}' \
  | jq '.results[0].properties.Outcome'
```
