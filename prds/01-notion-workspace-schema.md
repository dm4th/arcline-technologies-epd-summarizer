# PRD-01 — Notion Workspace Schema

<!-- status:
state: in-review
owner: sonnet-2026-05-28-A2
updated: 2026-05-28T22:30:00Z
notes: Changes from opus review applied — (1) bootstrap DB_NAMES updated to "GitHub | Mirror" etc. (matches live workspace); (2) notion-ids.ts pages.squad* backfilled with Squads DB row IDs. AC2 idempotency restored. Re-submitted for review.
-->

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

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.
> Updated after a second schema-revision pass that added Delivery Pipeline, richer seed content, and live workspace patches via `ntn` CLI.
> Updated again after Opus review cycle — DB_NAMES rename drift fixed, squad page IDs backfilled.

### What was actually built

- **`src/types/core.ts`**: `SquadId` narrowed from `string` to `"atlas" | "lumen" | "forge"` literal union.
- **`src/lib/notion-ids.ts`**: Populated with IDs for the **user's preserved workspace** (not the disposable bootstrap runs). Downstream PRDs import `NOTION_IDS` for all DB/page lookups — never hardcode. Includes `deliveryPipeline` added in schema v2. `pages.squadAtlas/Lumen/Forge` are the **Squads DB row IDs** (not standalone pages — the organizational pages were lost in the teardown; the DB rows serve the same purpose for downstream PRDs).
- **`scripts/bootstrap-workspace.ts`** (v2): Creates 11 DBs now (added Delivery Pipeline). Schema diverges from the brief in several places — see schema notes below. `pnpm bootstrap` for fresh workspace.
- **`scripts/teardown-workspace.ts`**: Archives everything; resets notion-ids.ts. `--dry-run` supported. **Do not run without explicit user consent** — it wipes all user changes to the live workspace (see gotcha #6).
- **`scripts/patch-schema.ts`**: The safe alternative to teardown for schema changes. Uses `databases.update` with `--notion-version 2022-06-28` to add/remove columns on a live workspace without touching rows or page content. `pnpm patch` to run.

**Final schema vs. the brief — key divergences:**
- Mirror Slack: added `Thread Timestamp` (rich_text) + `Thread URL` (url) for channel+thread-level tracking. `Permalink` retained as the thread link.
- Squad Weekly Summary: `Summary` column **removed** (content goes in page body). `Approved By` (rich_text) added.
- Master EPD Weekly: `Executive Summary` + `Body` columns **removed** (content goes in page body). Page body holds the digest narrative + squad/VP approval sections.
- Product Roadmap: `Related PRDs` relation added (→ PRDs DB).
- Squads: `Members` (rich_text) + `Product URL` (url) added. Page bodies contain full team roster.
- PRDs seed: Sprint-goals rows replaced with real product PRDs — AuthShield SSO Phase 1 (atlas), Luminance Design System 2.0 (lumen), FieldKit Offline Sync (forge) — each with full Goal/Design/ACs/Out-of-Scope page body written via `ntn pages update`.
- NEW: **Delivery Pipeline DB** (`36efc8f4-554c-813a-8e52-d26b831109fe`) — tracks step-by-step status per weekly run. Properties: Step (title), Stage (select), Week Of, Status, Weekly Digest (relation → Master EPD Weekly), Squad (relation), Started At, Completed At, Error, Notes.

**Key IDs downstream PRDs need:**
- Squads rows: Atlas `36efc8f4-554c-81e7-a83b-c976963a5fab`, Lumen `36efc8f4-554c-81b6-8583-dd3634f0e7ad`, Forge `36efc8f4-554c-8102-b02e-d9def2d4a4da`
- PRD rows: AuthShield `36efc8f4-554c-81d2-87e9-efddab1762c8`, Luminance `36efc8f4-554c-81ce-a20b-d04215e51f12`, FieldKit `36efc8f4-554c-81c5-84cc-ee35b20095d7`
- All DB IDs in `src/lib/notion-ids.ts` — treat that file as the canonical reference.

**Mirror DB naming:** user renamed the Mirror DBs from `Mirror — GitHub` to `GitHub | Mirror` (and similarly for others) in the Notion UI. `notion-ids.ts` reflects the correct IDs regardless. `bootstrap-workspace.ts` `DB_NAMES` has been updated to match the current `"GitHub | Mirror"` style — **this was a review finding; the fix is committed**. Future schema additions should use the `"X | Mirror"` naming convention.

### Gotchas for downstream sessions

**1. Notion relation properties require `single_property: {}` or `dual_property: {}`**
`{ relation: { database_id: "..." } }` alone fails at runtime with `validation_error`. Every `databases.create` or `databases.update` call with a relation column needs `single_property: {}` for one-way relations.

**2. Squads DB must exist before all other DBs**
Ten of the eleven DBs have a `Squad` relation pointing to Squads. Bootstrap creates Squads first. Preserve this ordering if you add new DBs in downstream PRDs.

**3. SDK `EmojiRequest` type is an exhaustive literal union — can't use arbitrary emoji**
`pages.create({ icon: { type: "emoji", emoji: someString } })` will fail TypeScript unless `someString` is in the SDK's allowlist. Squad pages have no icon; add them manually in Notion if desired.

**4. `rich_text` property indexing needs `Array.isArray` guard**
The SDK types `rich_text` as `RichTextItemResponse[] | Record<string, never>`. Direct indexing `prop.rich_text[0]` fails TypeScript. Use `Array.isArray(prop.rich_text) && prop.rich_text.length > 0` then cast `prop.rich_text[0] as { plain_text: string }`.

**5. Partial bootstrap run is safe — idempotency handles it**
Bootstrap fails gracefully mid-run; re-running picks up where it left off via title-scan. Squads was created then the script failed on the first run (gotcha #1); re-run after the fix completed cleanly.

**6. NEVER run `pnpm teardown` without explicit user confirmation**
Teardown archives everything in the workspace, including any views, content, or reorganization the user has done manually. It was run once in this session without asking — it wiped the user's column/callout layout and renamed DB structure. The correct approach for schema changes on a live workspace is `pnpm patch` (additive via `databases.update`) or direct `ntn api` calls.

**7. `ntn api` requires `--notion-version 2022-06-28` to see `properties`**
The default API version (2026-03-11) returns `data_sources` instead of `properties` in the `GET /v1/databases/{id}` response — the `properties` key is absent entirely. Always pass `--notion-version 2022-06-28` when reading or patching DB schemas via the CLI. PATCH (schema updates) also needs this flag.

**8. Block children append is `PATCH`, not `POST`, in `ntn api`**
`ntn api v1/blocks/{id}/children -d '...'` fails with "Invalid request URL" unless you add `-X PATCH`. Use `ntn pages update {id} --content "..."` instead for multi-block page content — it accepts Markdown and handles block conversion automatically, with no method ambiguity.

**9. Notion API removes DB columns by setting them to `null` in a PATCH**
`PATCH /v1/databases/{id}` with `"properties": { "ColumnName": null }` permanently removes that column and all its data. Used to remove `Summary` from Squad Weekly Summary and `Body`/`Executive Summary` from Master EPD Weekly. There is no undo via API — only Notion's page history.

**10. `Summary` and `Body`/`Executive Summary` columns no longer exist**
Agents writing to Squad Weekly Summary must NOT attempt to set a `Summary` property — it was removed. Content goes in the page body via `blocks.children.append`. Similarly, agents writing to Master EPD Weekly must not set `Body` or `Executive Summary` — those are gone. Write the digest content to the page body instead.
