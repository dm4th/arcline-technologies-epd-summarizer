# PRD-01 — Notion Workspace Schema

## Goal
Create every Notion database, relation, and seed page that downstream PRDs will read or write, so no later session has to invent schema on the fly.

## Why this exists
Schema drift between agents is the most common failure mode for fan-out/fan-in workflows. Define it once, here, with relations explicit. Also: this is the part of the demo the interviewer will literally click through — it has to *feel* like a polished Notion workspace.

## Dependencies
- PRD-00 (Notion client + env).

## Inputs
- `BASE_NOTION_PAGE` from `.env.local`.
- `SourceRecord` and friends from `src/types/core.ts`.

## Outputs
- A populated `src/lib/notion-ids.ts` with every created DB and page ID (committed; this is dev-environment-only IDs and is the canonical lookup for downstream PRDs).
- A `scripts/bootstrap-workspace.ts` that is **idempotent**: re-running it does not duplicate databases. Uses Notion search + a "schema marker" property to detect existing DBs.
- A `scripts/teardown-workspace.ts` for clean re-runs during dev (archives, doesn't hard-delete).
- Seed pages: 3 Squad pages, 3 PRD pages (one per squad), 1 Product Roadmap database with ~5 seeded initiatives.

## Design

### Databases to create (under `BASE_NOTION_PAGE`)

| DB | Purpose | Key properties (type) |
|---|---|---|
| **Mirror — GitHub** | Per-PR snapshot | `Title` (title), `PR Number` (number), `Squad` (relation → Squads), `Status` (select: open/merged/closed), `Author` (text), `URL` (url), `Last Updated` (date), `Body Excerpt` (text), `Linked Jira` (text), `Raw` (text) |
| **Mirror — Jira** | Per-ticket snapshot | `Title`, `Ticket Key` (text), `Squad` (relation), `Status` (select), `Assignee` (text), `URL`, `Last Updated`, `Acceptance Criteria` (text), `Raw` |
| **Mirror — Slack** | Per-thread snapshot | `Title`, `Channel` (text), `Squad` (relation), `Permalink` (url), `Last Updated`, `Excerpt` (text), `Participant Count` (number), `Raw` |
| **Mirror — Figma** | Per-file/comment snapshot | `Title`, `File Key` (text), `Squad` (relation), `URL`, `Last Updated`, `Comment Excerpt` (text), `Raw` |
| **Squads** | Catalog | `Name` (title), `SquadId` (text — must match `SquadId` literal in code), `EM` (text), `PM` (text), `Design Lead` (text) |
| **PRDs** | One per squad | `Title`, `Squad` (relation), `Acceptance Criteria` (text), `Status` (select), `Last Updated` (date) |
| **Product Roadmap** | Initiatives | `Title`, `Owning Squad` (relation), `Target Quarter` (select), `Status` (select), `Notes` (text) |
| **Squad Weekly Summary** | Output of PRD-04 | `Title`, `Squad` (relation), `Week Of` (date), `Source` (select: github/jira/slack/figma/roadmap/prd-fact-check), `Summary` (text — rich), `Citations` (text — JSON), `Status` (select: draft/awaiting-review/approved/rejected), `Generated At` (date) |
| **Master EPD Weekly** | Final VP report | `Title`, `Week Of` (date), `Executive Summary` (text), `Body` (text), `Citation Coverage %` (number), `Quorum Met` (checkbox), `Squads Approved` (relation → Squads), `Status` (select: draft/awaiting-VP/published) |
| **Agent Run Log** (PRD-07) | Observability | `Run Id` (title), `Agent Name` (select), `Squad` (relation, optional), `Started At`, `Completed At`, `Duration ms` (number), `Token Cost USD` (number), `Outcome` (select: ok/error/skipped), `Notes` (text) |

### Seed data
- 3 squads, names provisional: **Atlas** (platform), **Lumen** (frontend), **Forge** (mobile). The "interesting demo content" lives in PRD-02 fixtures; here just the catalog entries.
- 3 PRDs (one each) with 3-5 acceptance criteria each.
- ~5 roadmap initiatives across the 3 squads, mixed statuses.

### Idempotency
- Each DB created carries a hidden `schema_version` property = `"v1"` and a `marker` page property containing a known UUID. `bootstrap-workspace.ts` searches by these before creating.

## Acceptance Criteria
1. `pnpm tsx scripts/bootstrap-workspace.ts` succeeds from a clean workspace and writes `src/lib/notion-ids.ts`.
2. Running it a second time prints "all databases exist" and modifies nothing.
3. Every DB in the table above exists and is visible under `BASE_NOTION_PAGE`.
4. The Squads DB has exactly 3 rows whose `SquadId` values match the `SquadId` type union in code.
5. Visual check: opening `BASE_NOTION_PAGE` in Notion shows a tidy, polished hierarchy — this is also the demo surface.

## Out of Scope
- Any data ingestion. Mirror DBs start empty; PRD-03 fills them.
- HITL approval page templates — PRD-06.
- Views beyond default — but the implementing session should add **at least one** useful view per DB (e.g., "This Week" filter on Squad Weekly Summary). Demo polish matters here.

## Open Questions
- Should Mirror DBs live under each Squad page, or as top-level DBs filtered by Squad? Recommendation: top-level + a Squad-filtered linked view inside each Squad page. Best of both for the demo.
- Notion API enforces relation single/multi — confirm Squad relations are single-select where stated.

## Verification
- Open Notion, navigate to `BASE_NOTION_PAGE`, click each DB, confirm property list matches the table above.
- `cat src/lib/notion-ids.ts` shows IDs for every named DB.
- Re-run `bootstrap-workspace.ts` → exit code 0 with "no changes" message.
