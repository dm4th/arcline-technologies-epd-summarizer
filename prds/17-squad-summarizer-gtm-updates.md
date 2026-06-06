# PRD-17 — Squad Summarizer + Master GTM Weekly Updates

<!-- status:
state: waiting
owner: -
updated: -
notes: -
-->

## Goal
Update two existing workers — the Squad Source Summarizer and the Master Summarizer — to extract "Key Releases" per squad and produce two GTM-facing outputs: a `GTM Highlights` property on the Master EPD row (internal), and a standalone "GTM Weekly" page under a new Revenue section (CRO-facing).

## Why this exists
The EPD pipeline produces a rich VP-level digest, but the CRO needs a non-technical weekly view of what shipped and what it means for the pipeline — with no ticket numbers, no PR references, just customer impact. By adding a `Key Releases` extraction pass to the existing Squad Summarizer and a `GTM Highlights` + standalone GTM Weekly output to the Master Summarizer, the EPD pipeline directly feeds the revenue org without any extra human effort. This is the "does this improve how we communicate product updates to customers?" answer.

## Reference Implementation — AI-Native GTM Hub
> **Borrow before you build.** See [`prds/REFERENCE-gtm-hub.md`](REFERENCE-gtm-hub.md). The GTM Weekly
> page and GTM Highlights writing benefit from the Hub's `product` agent prompt FEATURE RESONANCE
> framing and its `ProductAnalysis` fields — `resonated_features[]`, `notable_quotes[]`,
> `product_team_insight` (`personal-website/lib/projects/notion-meeting-intelligence/prompts.ts` +
> `types.ts`). These are tuned to translate technical work into customer-facing language, which is
> exactly what the ≤150-word GTM Highlights and the non-technical GTM Weekly page require.

## Dependencies
- PRD-13 (`Key Releases` property on Squad Weekly Summary; `GTM Highlights` property on Master EPD Weekly must already exist).
- PRD-04a (Squad Source Summarizer worker — `workers/summarizer/` — must be complete; this PRD modifies it).
- PRD-05 (Master Summarizer worker — `workers/summarizer-master/` — must be complete; this PRD modifies it).

## Inputs
- `workers/summarizer/src/index.ts` — existing source summarizer; add a `Key Releases` extraction pass.
- `workers/summarizer-master/src/index.ts` — existing master summarizer; add GTM output pass.
- `src/lib/notion-ids.ts` — must include `gtmDailyDigest` (for finding/creating the GTM Weekly page parent).
- `BASE_NOTION_PAGE` or a new "Revenue" page ID — parent for the GTM Weekly page (see Design).

## Outputs

**Change 1 — Squad Summarizer writes `Key Releases` property:**
- Every Squad Weekly Summary row gains a populated `Key Releases` rich_text value (alongside the existing page-body summary).

**Change 2 — Master Summarizer writes two new artifacts:**
- `GTM Highlights` property on the Master EPD Weekly row (≤150 words, non-technical, internal).
- A standalone Notion page titled `"GTM Weekly — [weekOf]"` under a new `Revenue > GTM Weekly Briefs` sub-page.

## Design

### Change 1: Squad Summarizer `Key Releases` extraction

**File:** `workers/summarizer/src/index.ts`

After the existing per-source summary is written to the Squad Weekly Summary page body, add a second LLM pass that reads the just-written summary and extracts only the shipped items:

Add to the system prompt (appended to the existing squad summarizer prompt — do not replace it):
```
After completing your main summary, extract a "Key Releases" section.
Include ONLY items that are fully shipped this week:
- Merged PRs with a clear release tag or "merged to main"
- Jira tickets with status "Done" or "Released" (not "In Progress")
Exclude: in-progress work, blocked items, design changes not yet implemented.
Format as a bulleted list. Use customer-facing language — no internal ticket IDs or PR numbers.
If nothing shipped this week for this squad, output: "(no releases this week)"
```

Write the extracted `Key Releases` text to the `Key Releases` property on the Squad Weekly Summary row using a new tool `write_key_releases(summaryPageId, keyReleasesText)`.

**New tool to add to `workers/summarizer`:**

`write_key_releases(summaryPageId: string, keyReleasesText: string)`
- PATCHes the `Key Releases` rich_text property on the given Squad Weekly Summary page.
- Called once per summary row, after the main summary body is written.
- Truncates to 2000 characters if needed (Notion rich_text limit per element).

### Change 2: Master Summarizer `GTM Highlights` + GTM Weekly page

**File:** `workers/summarizer-master/src/index.ts`

After the existing master summary is written, add a GTM output pass:

**Step A — Collect Key Releases from squad summaries:**
Extend `read_approved_summaries` (existing tool) to also return the `Key Releases` property value from each squad's rows. No schema change needed — `Key Releases` is already added to Squad Weekly Summary in PRD-13.

**Step B — Synthesize GTM Highlights property (≤150 words):**
Additional LLM call with this prompt:
```
You are writing a GTM Highlights brief for the CRO of Arcline Technologies.
Based on the Key Releases from all three engineering squads this week,
write a ≤150 word summary of what shipped and what it means for the business.
Rules:
- No Jira ticket numbers, PR numbers, or internal identifiers.
- Use customer-facing product names only.
- Structure: "What shipped / What it means for pipeline / What reps should know"
- If nothing shipped across all squads, write: "No product releases this week."
```

Write the output to `GTM Highlights` on the Master EPD Weekly row using a new tool `write_gtm_highlights(masterPageId, highlightsText)`.

**Step C — Create/update the standalone GTM Weekly page:**

Add a new tool `write_gtm_weekly_page(weekOf, body)`:
- Checks if a page titled `"GTM Weekly — {weekOf}"` already exists under a page called `"GTM Weekly Briefs"` (which itself lives under `BASE_NOTION_PAGE`).
- If the `"GTM Weekly Briefs"` page doesn't exist, creates it.
- Creates or updates the `"GTM Weekly — {weekOf}"` child page.
- Writes the page body using `ntn pages update {id} --content "{markdown}"` style (Markdown content).
- Returns the page ID.

GTM Weekly page body structure (Markdown written via `blocks.children.append` or `ntn pages update`):
```markdown
# GTM Weekly — [Week Of]
_Prepared by the Arcline AI Digest pipeline. For questions, contact [VP Eng name]._

## What Shipped This Week
[Bullet list of Key Releases in plain language]

## What It Means for Your Pipeline
[2-3 sentences connecting releases to active deal categories]

## Deals to Contact This Week
[Populated by GTM Release Bridge (PRD-16) — if Release Bridge has not run yet, this section reads "See Release Bridge for deal-specific outreach."]

## How to Use This Brief
- Forward to your reps before Monday standup.
- Flag any listed release to an active deal — the Release Bridge agent can generate a tailored outreach suggestion.
```

**New tools to add to `workers/summarizer-master`:**

`write_gtm_highlights(masterPageId: string, highlightsText: string)`
- PATCHes `GTM Highlights` property on Master EPD Weekly row.

`write_gtm_weekly_page(weekOf: string, body: string)`
- Creates or updates the CRO-facing GTM Weekly page.
- Returns `{ pageId, url }`.
- Writes a row to Agent Run Log with `Agent Name = "master-gtm-weekly-page"`.

### GTM Highlights is non-blocking
Both `write_gtm_highlights` and `write_gtm_weekly_page` are called AFTER the existing master publish flow completes. They do not affect the `Quorum Met` logic, the `Status = awaiting-VP` transition, or the citation coverage calculation. If either fails, the master summary is still published — the GTM output failure is logged but not fatal.

### Revenue section page structure
A new top-level section under `BASE_NOTION_PAGE`:
```
BASE_NOTION_PAGE/
  ├── [existing EPD databases]
  └── Revenue/          ← new page, created by write_gtm_weekly_page on first run
        └── GTM Weekly Briefs/    ← created on first run
              └── GTM Weekly — 2026-W21    ← created each week
```

## Acceptance Criteria
1. After running `pnpm generate-summaries` for 2026-W21, all Squad Weekly Summary rows for that week have a non-empty `Key Releases` property.
2. After running `pnpm generate-master` for 2026-W21, the Master EPD Weekly row has a non-empty `GTM Highlights` property (≤150 words, no ticket/PR numbers).
3. A Notion page titled `"GTM Weekly — 2026-W21"` exists under `Revenue > GTM Weekly Briefs`.
4. The GTM Weekly page body contains the 4 sections: "What Shipped", "What It Means for Your Pipeline", "Deals to Contact This Week", "How to Use This Brief".
5. `Key Releases` for Atlas squad mentions AuthShield (the shipped PRD in W21 fixture data).
6. Running `pnpm generate-master` a second time updates the existing GTM Weekly page rather than creating a duplicate.
7. If all squads have `Key Releases = "(no releases this week)"`, GTM Highlights = "No product releases this week." and the GTM Weekly page reflects this.
8. Existing master summary behavior is unchanged: Quorum gate still requires 100% approval, Citation Coverage % is still computed, conflict-resolution callout still present.

## Out of Scope
- Populating the "Deals to Contact This Week" section of the GTM Weekly page — that is PRD-16 (Release Bridge) which appends to the GTM Daily Digest, not this page directly. PRD-17 leaves a placeholder.
- Sending the GTM Weekly page to any external system (email, Slack) — output is Notion-only.
- Changing the master summarizer's quorum logic or citation scoring.

## Open Questions
- Should the GTM Weekly page be created under a dedicated "Revenue" section separate from the EPD databases, or alongside them? Recommendation: dedicated "Revenue" sub-page, to reinforce the cross-org visibility story during the demo (engineering data and revenue data are separate but connected). This is the implementing session's call if the recommendation needs adjustment.

## Verification
```bash
# Run full pipeline for W21
pnpm reset-data --week=2026-W21 --yes
pnpm demo-week --week=2026-W21
pnpm generate-summaries
pnpm approve-week
pnpm generate-master

# Verify Key Releases on squad summaries
ntn api v1/databases/${NOTION_IDS.dbs.squadWeeklySummary}/query \
  --notion-version 2022-06-28 \
  -d '{"filter":{"property":"Week Of","date":{"equals":"2026-05-19"}}}' \
  | jq '[.results[].properties["Key Releases"].rich_text[0].plain_text]'
# Expected: 3 non-empty strings (one per squad)

# Verify GTM Highlights on Master EPD row
ntn api v1/databases/${NOTION_IDS.dbs.masterEpdWeekly}/query \
  --notion-version 2022-06-28 \
  | jq '.results[0].properties["GTM Highlights"].rich_text[0].plain_text | length'
# Expected: >0 and <=150 words

# Open Notion → Revenue > GTM Weekly Briefs → GTM Weekly — 2026-W21
# Confirm page exists with 4 sections
```
