# PRD-14 — GTM Mock Fixtures

<!-- status:
state: waiting
owner: -
updated: -
notes: -
-->

## Goal
Seed realistic GTM fixture data into the 4 new GTM databases so every downstream worker has live rows to read during development and the live demo.

## Why this exists
The GTM pipeline workers (PRD-15, PRD-16, PRD-18) need existing data to demonstrate meaningful output. Without pre-seeded meeting notes and opportunities, the Release Bridge cannot flag any deals, the Daily Summarizer has nothing to summarize, and the Battle Card Updater has no competitive intel to update. The fixtures also tell the demo story: two enterprise deals are in flight, a key product just shipped, and a rep hasn't heard about it yet.

## Reference Implementation — AI-Native GTM Hub
> **Realism reference.** See [`prds/REFERENCE-gtm-hub.md`](REFERENCE-gtm-hub.md). For believable meeting
> note content (sentiment language, buyer-role phrasing, action-item style), mirror the structure the
> Hub produces via `buildMeetingNoteProperties()` and its `roleMap`
> (`personal-website/lib/projects/notion-meeting-intelligence/fieldMapping.ts`). The Hub's live demo
> template (`dm4th.notion.site/AI-Native-GTM-Hub-...`) is a good source of realistic sales-call tone.

## Dependencies
- PRD-13 (all 4 GTM databases must exist with correct schema before seeding).
- PRD-01 (PRDs DB rows for AuthShield and FieldKit — needed for `Product Interest` relation in Opportunities).

## Inputs
- `src/lib/notion-ids.ts` — must contain `gtmMeetingNotes`, `opportunities`, `gtmDailyDigest`, `battleCards` (from PRD-13).
- PRD page IDs from PRD-01 Implementation Notes:
  - AuthShield (Atlas): `36efc8f4-554c-81d2-87e9-efddab1762c8`
  - FieldKit (Forge): `36efc8f4-554c-81c5-84cc-ee35b20095d7`
- Squad row IDs from PRD-01: Atlas `36efc8f4-554c-81e7-a83b-c976963a5fab`, Forge `36efc8f4-554c-8102-b02e-d9def2d4a4da`
- `NOTION_API_KEY` from `.env.local`.

## Outputs
- 8 rows in **GTM | Opportunities**.
- 10 rows in **GTM | Meeting Notes** (linked to Opportunities).
- 3 rows in **GTM | Battle Cards** (competitor stubs).
- 1 row in **GTM | Daily Digest** (a seeded "prior day" row so the demo reset starts with something).
- New script: `scripts/seed-gtm-fixtures.ts` — idempotent upsert by `Title`.
- Updated `scripts/reset-data.ts` — add GTM DBs to the week-scoped reset flow.

## Design

### GTM | Opportunities fixture rows (8 rows)

Key narrative: AuthShield (Atlas squad, security platform) and FieldKit (Forge squad, mobile offline sync) are the two products that just shipped. Two deals are in the pipeline specifically interested in those products — that's what makes the Release Bridge demo compelling.

| Title | Account | Stage | ACV | Close Date | Product Interest | Rep | Health |
|---|---|---|---|---|---|---|---|
| Meridian Financial — Auth Upgrade | Meridian Financial | technical-eval | 120000 | 2026-08-15 | AuthShield (Atlas PRD) | Sarah Chen | on-track |
| Vantage Logistics — SSO Rollout | Vantage Logistics | negotiation | 85000 | 2026-07-01 | AuthShield (Atlas PRD) | Marcus Webb | at-risk |
| Orion Health — Mobile Field App | Orion Health | technical-eval | 95000 | 2026-09-30 | FieldKit (Forge PRD) | Sarah Chen | on-track |
| Apex Consulting — Platform Eval | Apex Consulting | discovery | 60000 | 2026-10-15 | (none) | Marcus Webb | on-track |
| Brightpath EDU — Collaboration | Brightpath EDU | discovery | 45000 | 2026-11-01 | (none) | Jordan Park | on-track |
| Crestwood Capital — Enterprise | Crestwood Capital | closed-won | 200000 | 2026-05-30 | AuthShield (Atlas PRD) | Sarah Chen | on-track |
| Nexus Manufacturing — Offline | Nexus Manufacturing | negotiation | 78000 | 2026-07-20 | FieldKit (Forge PRD) | Jordan Park | at-risk |
| Pinnacle Retail — Auth Migration | Pinnacle Retail | technical-eval | 55000 | 2026-08-01 | AuthShield (Atlas PRD) | Marcus Webb | on-track |

**Demo-critical rows:** Meridian Financial (Meridian wants AuthShield, deal is active, rep hasn't heard AuthShield shipped this week), Vantage Logistics (at-risk deal — combined with negative meeting sentiment this is the CRO's urgency signal), Orion Health (FieldKit buyer, active eval), Nexus Manufacturing (at-risk FieldKit deal).

### GTM | Meeting Notes fixture rows (10 rows)

Spread across 2 weeks (2026-W20 and 2026-W21). At least 4 rows link to specific Opportunities.

| Title | Account | Opportunity (linked) | Date | Rep | Stage | Sentiment | Competitor Mentioned | Action Items |
|---|---|---|---|---|---|---|---|---|
| Meridian — Technical Deep Dive | Meridian Financial | Meridian Financial — Auth Upgrade | 2026-06-02 | Sarah Chen | technical-eval | positive | — | Follow up with AuthShield SSO demo recording by Friday |
| Vantage — Stalled Renewal Call | Vantage Logistics | Vantage Logistics — SSO Rollout | 2026-06-03 | Marcus Webb | negotiation | at-risk | Linear | Need to show roadmap — they're evaluating Linear's new auth module |
| Orion — Field App Requirements | Orion Health | Orion Health — Mobile Field App | 2026-06-02 | Sarah Chen | technical-eval | positive | — | Share FieldKit offline sync benchmark results |
| Nexus — Procurement Review | Nexus Manufacturing | Nexus Manufacturing — Offline | 2026-06-03 | Jordan Park | negotiation | at-risk | Monday.com | Budget squeeze — Monday.com pitched lower price point |
| Apex — First Discovery Call | Apex Consulting | Apex Consulting — Platform Eval | 2026-06-01 | Marcus Webb | discovery | neutral | — | Schedule technical eval with their CTO next week |
| Brightpath — Intro Meeting | Brightpath EDU | Brightpath EDU — Collaboration | 2026-05-27 | Jordan Park | discovery | positive | Asana | Strong champion but IT director needs Asana comparison |
| Crestwood — Kickoff (Won) | Crestwood Capital | Crestwood Capital — Enterprise | 2026-05-30 | Sarah Chen | closed-won | positive | — | Schedule implementation kickoff with their eng team |
| Meridian — Exec Sponsor Intro | Meridian Financial | Meridian Financial — Auth Upgrade | 2026-05-28 | Sarah Chen | technical-eval | positive | — | Loop in CISO on AuthShield compliance documentation |
| Pinnacle — Requirements Gathering | Pinnacle Retail | Pinnacle Retail — Auth Migration | 2026-05-29 | Marcus Webb | technical-eval | neutral | Asana | They use Asana for project tracking — integration question |
| Vantage — Champion 1:1 | Vantage Logistics | Vantage Logistics — SSO Rollout | 2026-05-27 | Marcus Webb | negotiation | neutral | — | Internal champion is preparing exec summary for CRO sign-off |

**Demo-critical rows:** Vantage Logistics at-risk (2026-06-03) + Nexus at-risk (2026-06-03) show the "strapped team needs daily flags" story. Meridian positive (2026-06-02) is the "AuthShield buyer who doesn't know it just shipped" setup for the Release Bridge demo.

### GTM | Battle Cards fixture rows (3 rows)

Pre-seeded with competitor strengths. The `Our Differentiators` field is intentionally sparse — the Battle Card Updater (PRD-18) populates it with release-linked content.

| Competitor | Their Strengths | Our Differentiators (stub) | Related Releases |
|---|---|---|---|
| Asana | Strong project management, large template library, broad integrations, competitive pricing at mid-market, well-known brand | (placeholder — to be updated by Battle Card Updater) | (placeholder) |
| Monday.com | Visual workflow builder, strong sales team, aggressive pricing, better mobile experience historically, CRM add-on | (placeholder — to be updated by Battle Card Updater) | (placeholder) |
| Linear | Developer-friendly, fast UI, strong GitHub integration, growing mindshare in engineering orgs | (placeholder — to be updated by Battle Card Updater) | (placeholder) |

Set `Last Updated` to `2026-05-01` for all 3 rows so it's visibly stale — the updater sets it to the current week after running.

### GTM | Daily Digest fixture row (1 row)

One pre-seeded row for W20 (the "prior week") so the demo workspace doesn't start empty:

| Title | Date | Status | Deals Touched | Summary stub |
|---|---|---|---|---|
| GTM Daily Digest — 2026-05-30 | 2026-05-30 | published | 3 | (brief stub summary — 2 positive meetings, 1 neutral, no at-risk flags that day) |

### `scripts/seed-gtm-fixtures.ts`

- Upserts by `Title` (skip if title already exists in the DB).
- Creates Opportunity rows first (no dependencies), then Meeting Notes rows (need Opportunity page IDs for the relation).
- Uses `NOTION_IDS.dbs.opportunities`, `NOTION_IDS.dbs.gtmMeetingNotes`, etc. from `src/lib/notion-ids.ts`.
- Relation between Meeting Notes and Opportunities: set by looking up the just-created Opportunity page ID by title.
- Relation between Opportunities and PRDs: use hardcoded PRD IDs from PRD-01 Implementation Notes.
- Logs each created row with its title and page ID.
- `--dry-run` flag: print what would be created without calling the API.

### `scripts/reset-data.ts` update

Extend the existing week-scoped reset to also archive:
- GTM | Daily Digest rows where `Date` falls within the reset week.
- GTM | Meeting Notes rows where `Date` falls within the reset week.
- Do NOT reset GTM | Opportunities or GTM | Battle Cards — those are persistent records, not weekly data.

Add a `--scope=eng` or `--scope=gtm` flag to reset only one pipeline's weekly data.

## Acceptance Criteria
1. `pnpm tsx scripts/seed-gtm-fixtures.ts` exits 0 and creates exactly 8 Opportunity rows, 10 Meeting Notes rows, 3 Battle Card rows, 1 Daily Digest row (on a clean workspace).
2. Running it a second time exits 0 with "X rows already exist, skipping" and creates no duplicates.
3. Meridian Financial — Auth Upgrade opportunity has `Product Interest` linked to the AuthShield PRD row.
4. Orion Health — Mobile Field App opportunity has `Product Interest` linked to the FieldKit PRD row.
5. Vantage Logistics — SSO Rollout meeting note (2026-06-03) has `Sentiment = at-risk` and `Competitor Mentioned = Linear`.
6. All 3 Battle Cards have `Last Updated = 2026-05-01` and empty/stub `Our Differentiators`.
7. `pnpm tsx scripts/reset-data.ts --week=2026-W21 --yes` archives GTM Daily Digest and Meeting Notes rows for that week without touching Opportunities or Battle Cards.

## Out of Scope
- Running any workers or agents against the fixtures — that is PRD-15 through PRD-18.
- Creating additional fixture weeks (W19/W20 style) for the GTM pipeline — the single demo week is sufficient.
- Seeding the `GTM | Daily Digest` body with rich content — just a title/date/status stub is sufficient.

## Open Questions
- None. All design decisions can be made by the implementing session.

## Verification
```bash
pnpm tsx scripts/seed-gtm-fixtures.ts

# Verify idempotency
pnpm tsx scripts/seed-gtm-fixtures.ts

# Check specific row counts via ntn CLI
ntn api v1/databases/${NOTION_IDS.dbs.opportunities}/query --notion-version 2022-06-28 | jq '.results | length'
# Expected: 8

ntn api v1/databases/${NOTION_IDS.dbs.gtmMeetingNotes}/query --notion-version 2022-06-28 | jq '.results | length'
# Expected: 10
```

Open Notion → GTM | Meeting Notes → Vantage Logistics row → confirm `Sentiment = at-risk` and Opportunity relation is populated.
