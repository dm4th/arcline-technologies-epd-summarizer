# PRD-13 — GTM Workspace Schema Extension

<!-- status:
state: waiting
owner: -
updated: -
notes: -
-->

## Goal
Add 4 new databases and 2 new properties to existing databases so the GTM pipeline has a stable schema foundation, without touching any existing rows or schemas.

## Why this exists
The CRO's pitch requires a parallel GTM pipeline that reads meeting notes and opportunities alongside the engineering EPD pipeline. The schema must be defined before any fixture data is seeded or any worker is built. Establishing it here — via additive PATCH, never teardown — ensures the live Arcline workspace is never at risk.

## Reference Implementation — AI-Native GTM Hub
> **Prior art for the Meeting Notes schema.** See [`prds/REFERENCE-gtm-hub.md`](REFERENCE-gtm-hub.md).
> The `GTM | Meeting Notes` DB below is a simplified version of the Hub's proven "Meeting Notes"
> database, built by `buildMeetingNoteProperties()` in
> `personal-website/lib/projects/notion-meeting-intelligence/fieldMapping.ts`. The sentiment, stage,
> action-items, and buyer-roles columns carry over directly. Round 2 drops the per-agent fan-out
> (the Hub writes 6 linked Agent Analysis rows per meeting); confirm with Dan before adding that complexity.

## Dependencies
- PRD-01 (all existing databases and `src/lib/notion-ids.ts` must be complete).
- PRD-00 (Notion client, env vars).

## Inputs
- `BASE_NOTION_PAGE` from `.env.local` — parent page under which all new databases will be created.
- `src/lib/notion-ids.ts` — existing DB IDs; this PRD extends it with 4 new entries.
- PRD IDs for existing rows (AuthShield, FieldKit) — needed for the `Product Interest` relation in Opportunities.

## Outputs
- 4 new Notion databases under `BASE_NOTION_PAGE`:
  - `GTM | Meeting Notes`
  - `GTM | Opportunities`
  - `GTM | Daily Digest`
  - `GTM | Battle Cards`
- 2 new properties patched onto existing databases:
  - `Key Releases` (rich_text) on **Squad Weekly Summary**
  - `GTM Highlights` (rich_text) on **Master EPD Weekly**
- Updated `src/lib/notion-ids.ts` with 4 new `dbs.*` entries.
- New script: `scripts/patch-schema-round2.ts` — idempotent, additive only.

## Design

### New databases to create (under `BASE_NOTION_PAGE`)

All databases use the `ntn` CLI with `--notion-version 2022-06-28` for schema operations.
All relation properties must include `single_property: {}` (Notion API requirement — omitting it causes `validation_error`).

| DB | Display name | Purpose | Key properties |
|---|---|---|---|
| **GTM \| Meeting Notes** | One row per sales call | Captures rep call records, linked to an opportunity | `Title` (title), `Account` (rich_text), `Opportunity` (relation → GTM \| Opportunities), `Date` (date), `Rep` (select), `Stage` (select: discovery/technical-eval/negotiation/closed-won/closed-lost), `Sentiment` (select: positive/neutral/at-risk), `Action Items` (rich_text), `Summary` (rich_text), `Competitor Mentioned` (rich_text) |
| **GTM \| Opportunities** | Simulated Salesforce | Open deals with product-interest linkage to existing PRDs | `Title` (title), `Account` (rich_text), `Stage` (select: discovery/technical-eval/negotiation/closed-won/closed-lost), `ACV` (number), `Close Date` (date), `Product Interest` (relation → PRDs DB), `Rep` (select), `Health` (select: on-track/at-risk/churned) |
| **GTM \| Daily Digest** | One row per day | Output of the GTM Meeting Notes Summarizer | `Title` (title), `Date` (date), `Summary` (rich_text), `Deals Touched` (number), `Action Items` (rich_text), `Release Cross-Ref` (rich_text), `Status` (select: draft/published) |
| **GTM \| Battle Cards** | One row per competitor | Competitive intel updated by the Battle Card Updater | `Competitor` (title), `Last Updated` (date), `Their Strengths` (rich_text), `Our Differentiators` (rich_text), `Related Releases` (rich_text), `Source Squads` (relation → Squads DB) |

### Existing database patches (additive only)

Use `ntn api v1/databases/{id} --notion-version 2022-06-28 -X PATCH` to add properties.

| Database | New property | Type | Notes |
|---|---|---|---|
| **Squad Weekly Summary** (`squadWeeklySummary` ID from `notion-ids.ts`) | `Key Releases` | rich_text | Extracted by the Squad Summarizer after PRD-17 lands; empty until then |
| **Master EPD Weekly** (`masterEpdWeekly` ID) | `GTM Highlights` | rich_text | Written by Master Summarizer after PRD-17 lands; ≤150 words, non-technical |

### `notion-ids.ts` extension

Add to the `dbs` object in `src/lib/notion-ids.ts`:
```typescript
gtmMeetingNotes:  "<id>",  // "GTM | Meeting Notes"
opportunities:    "<id>",  // "GTM | Opportunities"
gtmDailyDigest:   "<id>",  // "GTM | Daily Digest"
battleCards:      "<id>",  // "GTM | Battle Cards"
```

And extend the `NotionIds` interface accordingly.

### `scripts/patch-schema-round2.ts`

- Creates the 4 new DBs (idempotent — search by title before creating).
- Patches `Key Releases` onto Squad Weekly Summary (skip if property already exists).
- Patches `GTM Highlights` onto Master EPD Weekly (skip if property already exists).
- Writes the 4 new DB IDs into `src/lib/notion-ids.ts`.
- Exits 0 on clean run; 1 on any API error.

### Naming convention
All new GTM databases use the `GTM | X` naming style, consistent with the existing `GitHub | Mirror` convention from PRD-01. This visually groups them in the sidebar.

### Idempotency
Before creating any DB, search the workspace by exact title. If it already exists, skip creation and just capture the ID. Patch operations on existing DBs also check for property existence first (`GET /v1/databases/{id}` and inspect `properties` key before PATCHing).

## Acceptance Criteria
1. `pnpm tsx scripts/patch-schema-round2.ts` exits 0 and prints the 4 new DB IDs.
2. Running it a second time prints "all GTM databases exist, no changes" and exits 0.
3. All 4 new databases are visible in Notion under `BASE_NOTION_PAGE` with the exact property lists from the design table.
4. `src/lib/notion-ids.ts` contains `gtmMeetingNotes`, `opportunities`, `gtmDailyDigest`, `battleCards` with non-empty UUID strings.
5. `pnpm tsx scripts/bootstrap-workspace.ts` still exits 0 (existing schema unaffected).
6. Squad Weekly Summary DB has a `Key Releases` property of type `rich_text`.
7. Master EPD Weekly DB has a `GTM Highlights` property of type `rich_text`.
8. No existing rows in Squad Weekly Summary or Master EPD Weekly were modified (verify by spot-checking row count and existing property values before and after).

## Out of Scope
- Seeding any rows into the new databases — that is PRD-14.
- Building any workers that write to these databases — that is PRD-15 through PRD-18.
- Adding views or filters within the databases — adding at least one useful default view per DB is encouraged but not required.
- Updating `scripts/demo-week.ts` or `scripts/reset-data.ts` — those are updated in PRD-14 and the infrastructure update pass.

## Open Questions
- Should `GTM | Meeting Notes` and `GTM | Opportunities` live in a dedicated "Revenue" sub-page under `BASE_NOTION_PAGE`, or as top-level siblings alongside the EPD databases? Recommendation: create a "Revenue" sub-page and nest the GTM databases under it, to reinforce the cross-org visibility story (GTM data lives in a separate section from EPD data).

## Verification
```bash
# Run the patch script
pnpm tsx scripts/patch-schema-round2.ts

# Verify no re-creation on second run
pnpm tsx scripts/patch-schema-round2.ts

# Confirm IDs landed in notion-ids.ts
grep -E "(gtmMeetingNotes|opportunities|gtmDailyDigest|battleCards)" src/lib/notion-ids.ts

# Confirm existing schema unaffected
pnpm tsx scripts/bootstrap-workspace.ts
```

Open Notion → navigate to `BASE_NOTION_PAGE` → confirm 4 new GTM databases visible with correct property lists. Open Squad Weekly Summary and Master EPD Weekly → confirm new properties present.
