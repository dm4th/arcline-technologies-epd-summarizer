# PRD-17 — Squad Summarizer + Master GTM Weekly Updates

<!-- status:
state: completed
owner: opus-review-2026-06-08
updated: 2026-06-08T16:45:00Z
notes: APPROVED by Opus review (8 ACs, 2 AC texts corrected per Dan). AC2 ✅ GTM Highlights 613 chars/~95 words, no IDs. AC3 ✅ "GTM Weekly — 2026-W21" row (379f…620e) Week Of 2026-05-18. AC4 ✅ all 4 body sections. AC6 ✅ single row (idempotent). AC7 ✅ coded. AC8 ✅ Quorum=true, coverage=0.9, master row intact. AC1 CORRECTED: Key Releases lives in the `## Key Releases` body section (the signal read_approved_summaries consumes) — property is empty on the live-agent path & unread; Dan's deliberate design. Non-blocking follow-up: populate-or-drop the unused property. AC5 CORRECTED: Atlas Key Releases correctly EXCLUDES AuthShield (didn't ship W21 — deliberate drift scenario, fact-check [BLOCK]); original AC premise was factually wrong. task_f88501eb (bulleted_list_item parser fragility) still tracked.
-->

## 🔁 Spec Update — GTM Weekly Briefs becomes a database (2026-06-08, Dan + review session)

> **Read this before touching `write_gtm_weekly_page` / `createOrUpdateGtmWeeklyPage`.**
> The artifact's *home* is changing from a page hierarchy to a database. The 4-section
> brief content is unchanged — only the container around it changes.

**What's changing:** `Revenue > GTM Weekly Briefs > GTM Weekly — {weekOf}` (a page
hierarchy, title-matched) becomes **one row per week in a new `GTM | Weekly Briefs`
database** (`NOTION_IDS.dbs.gtmWeeklyBriefs`), mirroring how `Master EPD Weekly` already
works. The brief's 4-section body (What Shipped / What It Means / Deals to Contact / How
to Use) lives in each row's page body exactly as it did in the sub-page — Notion renders
database-row pages identically to regular pages, so the CRO-facing read experience is
unchanged.

**Why:** (1) Consistency — `Master EPD Weekly` is already a database; the GTM "analog
produced alongside it" shouldn't be structurally different. (2) Structured metadata —
`Week Of` (date), `Status` (draft/published), `Deals Flagged` (number), `Flagged Deals`
(relation → `GTM | Opportunities`) turn the placeholder "See Release Bridge for
deal-specific outreach" into a real, traceable, clickable link. (3) Cleaner find-or-create
— `pages.create({ parent: { database_id }})` + a query on `Week Of`/`Title`, instead of
brittle title-matched page traversal. (4) Scale — 52 weeks of sub-pages have no
sort/filter; a database gets views for free.

**🐛 Bonus finding — this also fixes a live latent bug:** `REVENUE_PAGE_ID` is hardcoded
(`377fc8f4-554c-811e-…`) in both `workers/summarizer-master/src/index.ts` and
`scripts/generate-master.ts`. That page is **now archived** (confirmed via
`ntn api v1/search`, 2026-06-08 — verified zero live children). The "find existing GTM
Weekly Briefs page" search filters on `result.parent.page_id === REVENUE_PAGE_ID`, but the
*live* page's parent is a `block_id` (it's nested in a column layout, not a direct page
child) — so the match **always fails**, and the code falls through to
`pages.create({ parent: { page_id: REVENUE_PAGE_ID }})`, targeting an archived page. The
next `pnpm generate-master` run will likely error or create orphans. **The database
conversion fixes this for free** — `pages.create({ parent: { database_id:
NOTION_IDS.dbs.gtmWeeklyBriefs }})` needs no traversal, no search-by-title, and no
`REVENUE_PAGE_ID` at all. Delete the constant from both files as part of this rewrite.
Full investigation notes: `src/lib/notion-ids.ts` → `pages.revenue` comment block.

**New schema dependency:** `NOTION_IDS.dbs.gtmWeeklyBriefs` — added by the **PRD-13
Addendum** (`prds/13-gtm-workspace-schema.md`). Properties: `Title` (title), `Week Of`
(date), `Status` (select: draft/published), `Deals Flagged` (number), `Flagged Deals`
(relation → `GTM | Opportunities`).

**Does NOT block the in-progress build** — `write_key_releases` / `write_gtm_highlights`
(Changes 1 & 2's other halves) are unaffected. Only `write_gtm_weekly_page` /
`createOrUpdateGtmWeeklyPage` (Step C) needs rework before this PRD can move to in-review.

## Goal
Update two existing workers — the Squad Source Summarizer and the Master Summarizer — to extract "Key Releases" per squad and produce two GTM-facing outputs: a `GTM Highlights` property on the Master EPD row (internal), and a new row in the `GTM | Weekly Briefs` database (CRO-facing — see "Spec Update" above for why this is a database, not a page hierarchy).

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
- PRD-13 (`Key Releases` property on Squad Weekly Summary; `GTM Highlights` property on Master EPD Weekly; **and the PRD-13 Addendum's `gtmWeeklyBriefs` database** — must all already exist).
- PRD-04a (Squad Source Summarizer worker — `workers/summarizer/` — must be complete; this PRD modifies it).
- PRD-05 (Master Summarizer worker — `workers/summarizer-master/` — must be complete; this PRD modifies it).

## Inputs
- `workers/summarizer/src/index.ts` — existing source summarizer; add a `Key Releases` extraction pass.
- `workers/summarizer-master/src/index.ts` — existing master summarizer; add GTM output pass.
- `src/lib/notion-ids.ts` — must include `gtmWeeklyBriefs` (the database `write_gtm_weekly_page` writes rows into — see PRD-13 Addendum). **Do NOT use `REVENUE_PAGE_ID` / `NOTION_IDS.pages.revenue`** — that page is archived and stale (see "Spec Update" above and the comment block in `notion-ids.ts`).

## Outputs

**Change 1 — Squad Summarizer writes `Key Releases`:**
- Every Squad Weekly Summary row gains its Key Releases content as a `## Key Releases` section in the page body. This is the **single load-bearing contract** — the signal the master consumes and that EMs review in the HITL flow.
- **RESOLVED (2026-06-08):** The `Key Releases` rich_text property on Squad Weekly Summary was removed (not added to schema). The body section is the sole contract — no property write. See Implementation Notes for details.

**Change 2 — Master Summarizer writes two new artifacts:**
- `GTM Highlights` property on the Master EPD Weekly row (≤150 words, non-technical, internal).
- A new row in the `GTM | Weekly Briefs` database (`NOTION_IDS.dbs.gtmWeeklyBriefs`), `Title = "GTM Weekly — [weekOf]"`, with `Week Of` / `Status` properties populated and the 4-section brief content in the row's page body (CRO-facing).

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

**Step C — Create/update the GTM Weekly Briefs row:**

Add a new tool `write_gtm_weekly_page(weekOf, body)`:
- Queries `GTM | Weekly Briefs` (`NOTION_IDS.dbs.gtmWeeklyBriefs`) by `Week Of` (date, set to the Monday of `weekOf`) — Notion's `databases.query` filter, not a title search. This is the "find" half; it's exact-match on a structured property, not brittle title-matching.
- If a row for that week exists, update it (`pages.update` — refresh `Status`, `Week Of`, and overwrite the page body).
- If not, create one: `pages.create({ parent: { database_id: NOTION_IDS.dbs.gtmWeeklyBriefs }, properties: { Title: "GTM Weekly — {weekOf}", "Week Of": weekOfDate, Status: "draft" } })`.
- Writes the page body (the same 4-section content as before — see structure below) via `blocks.children.append` (handles the 100-block-per-append limit).
- Returns `{ pageId, url }`.
- **No `REVENUE_PAGE_ID`, no page-hierarchy traversal, no title search against archived pages** — this tool only ever touches `gtmWeeklyBriefs` (database) and `opportunities` (relation target). See "Spec Update" above for why the old traversal was already broken.

GTM Weekly Briefs row body structure (written via `blocks.children.append`) — **content unchanged from the original page-hierarchy design**, only the container changed:
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
- Finds-or-creates the CRO-facing weekly brief as a **row in `GTM | Weekly Briefs`** (query by `Week Of`, not title-search — see Step C).
- Returns `{ pageId, url }`.
- Writes a row to Agent Run Log with `Agent Name = "master-gtm-weekly-page"`.

### GTM Highlights is non-blocking
Both `write_gtm_highlights` and `write_gtm_weekly_page` are called AFTER the existing master publish flow completes. They do not affect the `Quorum Met` logic, the `Status = awaiting-VP` transition, or the citation coverage calculation. If either fails, the master summary is still published — the GTM output failure is logged but not fatal.

### `GTM | Weekly Briefs` database location
The database lives directly under `BASE_NOTION_PAGE` (created by the PRD-13 Addendum's
`patch-schema-round2.ts`, alongside the other 5 GTM databases — see PRD-13 for exactly
where in the live layout). `write_gtm_weekly_page` references it purely by ID
(`NOTION_IDS.dbs.gtmWeeklyBriefs`) — **no traversal, no "Revenue" page lookup, no
title-matching**:
```
GTM | Weekly Briefs  (database, NOTION_IDS.dbs.gtmWeeklyBriefs)
  ├── row: "GTM Weekly — 2026-W21"   Week Of: 2026-05-18   Status: published
  ├── row: "GTM Weekly — 2026-W22"   Week Of: 2026-05-25   Status: draft
  └── …                              ← one row per week, queryable/sortable/filterable
```
*(Supersedes the original `Revenue > GTM Weekly Briefs > GTM Weekly — {weekOf}` page-hierarchy diagram — see "Spec Update" at the top of this PRD for the full rationale and the `REVENUE_PAGE_ID` bug this also fixes.)*

## Acceptance Criteria
1. After the squad summarizer pipeline runs for 2026-W21, every Squad Weekly Summary row for that week carries its Key Releases content as a `## Key Releases` section in the **page body** — the signal the Master Summarizer's `read_approved_summaries` actually consumes (see Design note on the property/body duality below). The `Key Releases` rich_text *property* is the alternate landing spot written only by the `pnpm generate-summaries` SDK path; the canonical live Custom-Agent path emits the body section. Either path satisfies this AC — the **body section is the load-bearing contract** (Dan's deliberate design decision, 2026-06-08).
2. After running `pnpm generate-master` for 2026-W21, the Master EPD Weekly row has a non-empty `GTM Highlights` property (≤150 words, no ticket/PR numbers).
3. A row with `Title = "GTM Weekly — 2026-W21"` and `Week Of = 2026-05-18` exists in the `GTM | Weekly Briefs` database (`NOTION_IDS.dbs.gtmWeeklyBriefs`).
4. That row's page body contains the 4 sections: "What Shipped", "What It Means for Your Pipeline", "Deals to Contact This Week", "How to Use This Brief".
5. `Key Releases` for the Atlas squad reflects what **actually shipped** in W21 (billing API refactor, per-tenant rate limiting, auth-token migration to Lumen's `/api/auth/tokens/v2`) and correctly **excludes** AuthShield SSO Phase 1 — which did **not** ship that week (the deliberate PRD-vs-delivery drift scenario the fact-check agent flags `[BLOCK]`). Surfacing AuthShield as shipped would be a trust violation; its absence from Key Releases is the **correct** behavior. (Corrected 2026-06-08 — the original AC's premise that AuthShield "shipped in W21 fixture data" was factually wrong.)
6. Running `pnpm generate-master` a second time updates the existing W21 row (matched by `Week Of`) rather than creating a duplicate row.
7. If all squads have `Key Releases = "(no releases this week)"`, GTM Highlights = "No product releases this week." and the W21 row's body reflects this.
8. Existing master summary behavior is unchanged: Quorum gate still requires 100% approval, Citation Coverage % is still computed, conflict-resolution callout still present.

## Out of Scope
- Populating the "Deals to Contact This Week" section of the GTM Weekly Briefs row — that is PRD-16 (Release Bridge) which appends to the GTM Daily Digest, not this row directly. PRD-17 leaves a placeholder (though the new `Flagged Deals` relation property on `GTM | Weekly Briefs` gives Release Bridge a structured place to land its links later — see PRD-13 Addendum).
- Sending the GTM Weekly Briefs row to any external system (email, Slack) — output is Notion-only.
- Changing the master summarizer's quorum logic or citation scoring.

## Open Questions
- ~~Should the GTM Weekly page be created under a dedicated "Revenue" section separate from the EPD databases, or alongside them?~~ **RESOLVED (2026-06-08):** moot — the artifact is now a database row (`GTM | Weekly Briefs`, created directly under `BASE_NOTION_PAGE` by the PRD-13 Addendum, in the same live layout as the other 5 GTM databases), not a page requiring a parent-section decision. See "Spec Update" at the top of this PRD.

## Feature Request — Flagged for Opus Review

> Surfaced during the PRD-17 build (2026-06-06). NOT built in this session — this is new scope. Opus should judge the right home for it and update PRD-18 (or any other PRD) directly if warranted.

**Gap identified: the GTM pipeline only tells revenue teams what has *already* shipped — never what's *about to*.**

Today, everything PRD-17 produces is retrospective and source-grounded: `Key Releases` extracts only items "fully shipped this week" from raw mirror signals (merged PRs, Done/Released tickets, deploy announcements, approved-and-handed-off designs). `GTM Highlights` and the `GTM Weekly` page synthesize from that same backward-looking material. None of it tells a sales rep or the CRO **when** something not yet shipped will land — which is exactly the kind of forward signal a rep needs to set expectations with a prospect ("the SSO migration lands in Q3 — worth mentioning now to keep this deal warm").

**Proposed feature: an "Upcoming Releases" view — next month / next quarter — surfaced alongside the existing retrospective content.**

The goal of this project's GTM bridge should be twofold, not singular:
1. *(already covered by PRD-17)* Tell GTM what **has shipped** — retrospective, source-grounded, week-scoped.
2. *(the gap)* Tell GTM **when things will ship** — forward-looking, roadmap-grounded, month/quarter-scoped.

**Why this is out of PRD-17's natural scope (don't just bolt it on here):**
Forward-looking content requires an entirely different data source and extraction logic — the Product Roadmap DB filtered to `Status = Planning / In Progress / Planned` and `Target Quarter`, not raw per-source "what shipped" signals. Building it inside PRD-17 would mean rewriting this PRD's Design, Outputs, and Acceptance Criteria sections — effectively a different PRD wearing this one's number.

**Where the groundwork already exists — likely candidate for expansion: PRD-18.**
PRD-18 (GTM Battle Card Updater, currently `waiting`) already specs a `read_product_roadmap(status?: 'in-progress' | 'shipped' | 'planned')` tool returning `{ targetQuarter, status, notes, ... }`, and its own design explicitly frames the Product Roadmap DB as being there "for 'what's coming' competitive context" (see `prds/18-gtm-battle-card-updater.md` lines ~32, 56-58, 85). The forward-looking roadmap-read plumbing is *already planned* — it's just funneled narrowly into Battle Cards' "Our Differentiators" messaging, never surfaced as a standalone digest section for reps.

**Recommendation for Opus:**
- Most likely a new follow-on PRD (e.g. PRD-21, mirroring how `prds/README.md`'s Deferred/Post-POC backlog captured the PRD-12 idea) that reuses/extends PRD-18's `read_product_roadmap(status)` tool rather than duplicating roadmap-read plumbing, and surfaces "what's landing next month / next quarter" as a forward-looking section in either the GTM Weekly page (this PRD's artifact) or the GTM Daily Digest (PRD-15's artifact).
- Alternatively, Opus may judge that PRD-18's scope should simply expand to emit this directly, since it already reads the roadmap with status filtering.
- Either way: **the framing must stay distinct from Key Releases** — "what to tease to a prospect" (forward, roadmap-confidence-qualified) vs. "what already shipped" (retrospective, source-confirmed). Conflating the two would undermine the trust story this whole pipeline is built on (an unshipped feature presented as shipped is worse than no signal at all).

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

# Verify the W21 row exists in GTM | Weekly Briefs (queried by Week Of, not title-search)
ntn api "v1/databases/${NOTION_IDS.dbs.gtmWeeklyBriefs}/query" \
  --notion-version 2022-06-28 \
  -d '{"filter":{"property":"Week Of","date":{"equals":"2026-05-18"}}}' \
  | jq '.results[0] | {title: .properties.Title.title[0].plain_text, status: .properties.Status.select.name, weekOf: .properties["Week Of"].date.start}'
# Expected: { title: "GTM Weekly — 2026-W21", status: "draft"|"published", weekOf: "2026-05-18" }

# Open Notion → GTM | Weekly Briefs → "GTM Weekly — 2026-W21" row
# Confirm the row's page body contains all 4 sections
```

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

> ✅ **REWORK COMPLETED (2026-06-08)** — the warning that previously lived here
> ("REWORK REQUIRED — Tool 6 / `createOrUpdateGtmWeeklyPage` still target the archived
> page-hierarchy design") has been resolved. Both writers were rewritten to query
> `GTM | Weekly Briefs` by `Week Of` and create/update a row in the database (see the
> new "What was actually built" bullets and Gotcha #4 below for the full story, and the
> "Spec Update" section at the top of this PRD for the database schema). The original
> page-hierarchy bullets immediately below (Tool 6, `createOrUpdateGtmWeeklyPage`,
> `REVENUE_PAGE_ID`, `pages.revenue`) describe the **first build pass** and are kept as
> historical record — that code no longer exists in the live files, but the gotchas it
> produced (esp. #1–#3) are still valid for anything touching these scripts.

### What was actually built

- **`workers/summarizer/src/index.ts`**: Key Releases is now a `## Key Releases` **body section** written as part of `write_squad_summary` (no separate property tool). The body section is reviewed by EMs in the HITL flow and parsed natively by `read_approved_summaries` as the single contract. The `Key Releases` rich_text property was never added to the schema (see **Property Removal Resolution** below).

- **`workers/summarizer-master/src/index.ts`**: Added constants `SQUAD_WEEKLY_SUMMARY_DB` and `REVENUE_PAGE_ID` (hardcoded to match `notion-ids.ts`). Extended `read_approved_summaries` (Tool 1) to query Squad Weekly Summary rows per squad and aggregate `keyReleases` into each `ConsolidatedEntry`. Added Tool 5 `write_gtm_highlights` (PATCHes `GTM Highlights` on Master EPD row) and Tool 6 `write_gtm_weekly_page` (finds or creates the `Revenue > GTM Weekly Briefs` hierarchy, then creates/updates the week page). The GTM page writer handles the 100-block-per-append limit from the Notion API.

- **`src/lib/notion-ids.ts`**: Added `revenue` to the `pages` interface and object (`377fc8f4-554c-811e-af04-ef340c18ec34`). Required because `write_gtm_weekly_page` needs a stable parent page ID as its traversal root.

- **`agent-prompts/summarizer-{github,jira,slack,figma}.md`**: All four updated — added `write_key_releases` to the Required Tools table (now 4 tools each), and added a Step 3.E for Key Releases extraction with source-specific rules (GitHub: merged PRs only; Jira: Done/Released tickets; Slack: unambiguous deploy announcements only; Figma: approved/handed-off designs only).

- **`agent-prompts/summarizer-master.md`**: Updated to 6 tools (`read_approved_summaries`, `write_master_summary`, `begin_master_summary`, `write_vp_feedback`, `write_gtm_highlights`, `write_gtm_weekly_page`). Updated `read_approved_summaries` return shape to include `keyReleases` per squad. Added Step 7 (GTM Output Pass, explicitly non-blocking): 7A synthesizes GTM Highlights using FEATURE RESONANCE framing from the AI-Native GTM Hub; 7B composes the 4-section GTM Weekly page.

- **`scripts/generate-summaries.ts`**: Added `extractKeyReleases(source, squad, whatShipped)` (Haiku call, source-specific rules) and `writeKeyReleasesToNotion(notion, pageId, text)` called after each source summary in the main loop. Output header now shows `key-releases: ✓` per source.

- **`scripts/generate-master.ts`**: Added `fixJsonStrings` + `safeParseJson` (same 3-stage pattern as `generate-summaries.ts`). Removed `Citation` interface entirely; changed `MasterOutput.citations: Citation[]` → `MasterOutput.citationCount: number` (see Gotcha #2 below). Added `REVENUE_PAGE_ID` constant and GTM helpers: `readSquadKeyReleases`, `synthesizeGtmHighlights`, `writeGtmHighlightsToNotion`, `createOrUpdateGtmWeeklyPage`. Main function runs GTM pass in a non-blocking `try/catch` after master write succeeds.

---

#### Rework pass (2026-06-08) — GTM Weekly Briefs database redesign

After the bullets above shipped, Dan reviewed the live workspace, asked "shouldn't this be a database?", and PRD-13 was amended (see "Spec Update" at the top of this file) to replace the page-hierarchy design with a proper `GTM | Weekly Briefs` database — one row per week, mirroring `Master EPD Weekly`'s shape (`NOTION_IDS.dbs.gtmWeeklyBriefs`, `379fc8f4-554c-803c-acbb-dccd29e576bf`, created live by Dan in the Notion UI). This rework is what moved the PRD from "blocked on rework" to in-review:

- **`workers/summarizer-master/src/index.ts`**: Removed the `REVENUE_PAGE_ID` constant entirely and replaced it with `GTM_WEEKLY_BRIEFS_DB`. Completely rewrote Tool 6 `write_gtm_weekly_page` (was ~155 lines of `notion.search`/title-matching/`briefsPageId`/`weekPageId` traversal) to the same find-or-create-by-`Week Of` idiom already proven by `write_master_summary`: `databases.query({ filter: { property: "Week Of", date: { equals: weekOfToDate(weekOf) } } })`, then `pages.update` (clear + rewrite blocks, refresh `Title`/`Week Of`/`Status`) or `pages.create` against `parent: { database_id: GTM_WEEKLY_BRIEFS_DB }`. `Status` is always written as `"draft"` — every brief needs CRO/SE review before publish. Redeployed live (`cd workers/summarizer-master && ntn workers deploy`); confirmed the worker's tool list now exposes `write_gtm_weekly_page` against the new schema.

- **`scripts/generate-master.ts`**: Rewrote `createOrUpdateGtmWeeklyPage` (was ~110 lines of `briefsPageId`/`weekPageId` traversal) to the identical find-by-`Week Of` pattern, reusing the already-imported `NOTION_IDS.dbs.gtmWeeklyBriefs` and `weekOfToDate` helper. Replaced the `REVENUE_PAGE_ID` constant with an explanatory comment (no replacement constant needed). Fixed a stale `console.log` that still said "created/updated under Revenue > GTM Weekly Briefs" → now reports "row created/updated in GTM | Weekly Briefs". Both the worker tool and this SDK twin typechecked clean (`npx tsc --noEmit -p .`) on the first attempt — the rewrite was modeled directly on `write_master_summary`'s proven implementation.

- **`agent-prompts/summarizer-master.md`**: Updated the Tool 6 row in the Required Tools table and the Step 7B description to describe database row semantics ("Creates or updates this week's row in the `GTM | Weekly Briefs` database, found by `Week Of`") instead of page-hierarchy creation, and added a "PRD-13 Addendum (2026-06-08)" callout documenting the exact-match query, idempotent overwrite, and `Status = "draft"` default.

- **`src/lib/notion-ids.ts`**: Rewrote the `pages.revenue` comment block from a prospective `⚠️ STALE — FIX:` note into a retrospective `✅ FIXED (2026-06-08)` note documenting that `REVENUE_PAGE_ID` has been removed from both files and that `pages.revenue` itself is now an unused historical marker (kept for context, not wired to any live code path).

- **The `REVENUE_PAGE_ID` bug this rework fixes for free**: the old traversal matched on `result.parent.page_id === REVENUE_PAGE_ID`, but the live page's parent was a column `block_id`, not a page — the match always failed and execution fell through to `pages.create` against an **archived** page (`377fc8f4-554c-811e-af04-ef340c18ec34`), meaning `generate-master` would have errored or created orphaned pages on every run. The new exact-match `databases.query` on a structured `Week Of` date property eliminates this entire class of traversal bug — there is no longer a parent-page identity to get wrong.

- **Live verification (via the actual Notion Custom Agents, not the SDK bypass scripts)**: Dan ran all 4 per-source summarizer agents → both squad consolidation agents → the master summarizer agent end-to-end for `2026-W21` through the live UI. I audited the result directly against `ntn api` (not `generate-summaries.ts`/`generate-master.ts`) and confirmed all 3 PRD-17 acceptance criteria pass: (1) all 18 Squad Weekly Summary rows for the week have non-empty `## Key Releases` sections; (2) the Master EPD Weekly row's `GTM Highlights` property is populated (613 chars, FEATURE RESONANCE framing, no ticket/PR numbers); (3) a new row `"GTM Weekly — 2026-W21"` (`379fc8f4-554c-8190-bcaf-fa004618620e`) exists in `GTM | Weekly Briefs` with `Week Of = 2026-05-18`, `Status = draft`, and all 4 required body sections correctly composed and de-duplicated. This is the direct live proof that the Tool 6 rewrite works end-to-end through the real agent pipeline — the constraint that blocked this PRD from in-review.

### Gotchas for downstream sessions

**1. Worker deploy command diverges from pnpm filter pattern**
The pnpm script convention (`pnpm --filter <pkg> deploy`) does not work for `ntn workers` — it triggers `ERR_PNPM_INVALID_DEPLOY_TARGET`. Deploy workers by changing into the worker directory and running `ntn workers deploy` directly:
```bash
cd workers/summarizer && ntn workers deploy
cd workers/summarizer-master && ntn workers deploy
```
This applies to any future worker added under `workers/`. The `package.json` `:deploy` alias is for documentation only.

**2. `citations: Citation[]` removed from MasterOutput — replaced with `citationCount: number`**
The original PRD spec envisioned the master script emitting a full `citations` array (verbatim claim strings + record IDs). This reliably broke JSON parsing: LLM-generated claim strings contain nested double-quotes (e.g., `"EU read replica lag issue"`) that survive neither `JSON.parse` nor the `fixJsonStrings` escaper when they appear inside a JSON string value. The fix was to remove the array entirely. The eval harness reads `Citation Coverage %` from the Notion `Master EPD Weekly` row directly — the script never needed to re-parse verbatim claims. Any future downstream PRD that expects a `citations[]` array from `generate-master.ts` should instead read coverage from the Notion row via `ntn api` or `read_approved_summaries`. The `citationCount` integer (sourced from the already-stored Notion property) is still emitted for logging.

**3. FEATURE RESONANCE framing source**
The GTM Highlights and GTM Weekly synthesis prompts borrow the `FEATURE RESONANCE` framing from `~/Develop/personal-website/lib/projects/notion-meeting-intelligence/prompts.ts` (the AI-Native GTM Hub). The key pattern: translate technical shipment names → customer-facing impact language, then connect to pipeline categories (e.g., "AuthShield token migration → security-sensitive enterprise deals"). Future sessions refining the GTM output quality should start there, not in the agent prompts directly.

**4. `read_approved_summaries` / `read_source_summaries` only parse `paragraph` blocks under a `heading_2` — `bulleted_list_item` bodies silently produce empty sections**
Both readers use a generic `sections: Record<string, string>` body parser: walk the page's blocks, capture `heading_2` text as `currentHeading`, then capture **only the immediately-following `paragraph` block's** text into `sections[currentHeading]`. During the live-agent test-run audit (2026-06-08) I found Atlas's HITL Review Session consolidation page had **all 5 sections — including `## Key Releases`** — written as `heading_2 → bulleted_list_item` instead of `heading_2 → paragraph`. Block-forensics showed the legitimate writer (`write_squad_consolidation`, which always emits `paragraph` blocks per its hardcoded array at `workers/summarizer-squad/src/index.ts` lines ~414–454) ran at `04:25` under bot identity `36efc8f4-…`, but a *second* edit pass at `15:20` under a *different* identity (`370fc8f4-…`) reformatted the blocks to bulleted lists — with **no corresponding Agent Run Log entry**, i.e. it bypassed the tool entirely (manual UI "convert to bulleted list," or a native agent edit — the same failure class as PRD-04a's gotcha #1). The parser silently returns `""` for any section shaped this way; `sections["Key Releases"]` would be empty and the master/squad-consolidation steps that depend on it (`read_approved_summaries` line ~62, `read_source_summaries` ~line 152 — both make the same paragraph-only assumption, and the latter is now load-bearing for the new single-pass `## Key Releases` sections too) would silently degrade rather than error. **This run's actual output was unaffected** — the Master EPD row and GTM brief both contain accurate, specific Atlas detail, meaning either the read happened before the reformat or the agent compensated by reading natively — so this is *not* a blocker for this PRD's transition. But the parser itself remains fragile for future runs where the timing is less lucky. Tracked as a non-blocking follow-up: spawned background task `task_f88501eb` ("Harden `read_approved_summaries` against `bulleted_list_item` bodies") with the full forensic trail and a recommended fix — extend the section-parsing loop in both readers to fold consecutive `bulleted_list_item` blocks following a `heading_2` into the section text, not just a single trailing `paragraph`.

**5. Manually testing cron-driven Custom Agents requires explicitly naming the target week**
The per-source summarizer agents (github/jira/slack/figma) are cron-driven — their prompts say "You run on a Monday morning cron at 7AM. You have no triggering row — compute the week to summarize from the current date." On `2026-06-08` (today), that auto-derivation would compute the *current* week, not `2026-W21` (the seeded fixture week the rest of the pipeline — mirrors, HITL sessions, Master EPD row — is keyed to). Manually invoking these agents from the Notion UI without overriding that instruction would silently summarize the wrong week and produce a pipeline-wide week mismatch that's easy to miss until much later (e.g. `read_approved_summaries` returning empty for `2026-W21`). The fix when testing manually: explicitly tell each cron-driven agent which week to target (e.g. "Summarize 2026-W21") rather than letting it derive "today's" week. The squad-consolidation and master-summarizer agents don't have this issue — they're row-triggered ("triggered by a change to a row in...") and derive the week from the triggering row's `Week Of` property.
