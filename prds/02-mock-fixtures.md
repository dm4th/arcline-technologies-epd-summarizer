# PRD-02 — Mock Fixtures

<!-- status:
state: in-review
owner: sonnet-2026-05-28-A3
updated: 2026-05-28T20:30:00Z
notes: all 4 ACs passed — 12/12 fixture files valid, 5 tensions planted, ground-truth report written, 26,883 words (<30k)
-->

## Goal
Produce one realistic week of mock data per source × per squad, with **intentional cross-source tensions** baked in, so the summarizer and master agents have something genuinely interesting to reason about during demos.

## Why this exists
The headline customer concern is hallucination and trust. A demo that runs against bland fixtures cannot showcase a master summarizer catching a discrepancy between Jira and a PR — which is exactly the moment where Notion's value lands. Fixtures are the script of the demo.

## Dependencies
- PRD-00 (types).

## Outputs
- `fixtures/github/{squad}.json`, `fixtures/jira/{squad}.json`, `fixtures/slack/{squad}.json`, `fixtures/figma/{squad}.json` for each of 3 squads = 12 files.
- `fixtures/ground-truth-report.md` — a hand-authored "what the perfect VP report would say given this fixture week." Used by PRD-08 as the eval target.
- `fixtures/schemas/*.json` — JSON Schema for each source. Validation runs in CI / pre-commit.
- `scripts/validate-fixtures.ts`.
- `fixtures/README.md` documenting the planted tensions (so demo narration is consistent).

## Design

### Planted tensions (the demo moments)
Each squad's fixtures should contain at least one of these, distributed so the master summarizer has 3 distinct "interesting things" to surface:

1. **PR ↔ Jira mismatch (Atlas)** — A merged PR claims to "complete" a Jira ticket whose status is still "In Progress." Master summary should flag.
2. **Slack-only blocker (Lumen)** — A blocker is discussed in Slack but never made it to Jira. PRD Fact Checker should notice the scope-of-acceptance-criteria gap.
3. **Figma divergence (Forge)** — A Figma comment from a designer reverses a decision documented in the squad PRD. Roadmap summarizer / PRD fact checker flags drift.
4. **Stale data (any squad)** — At least one record with `lastUpdated` ~3 days old to give the data-staleness narrative something to point to (V2 hook).
5. **Cross-squad dependency (Atlas ↔ Lumen)** — Atlas PR references a Lumen API change; master summary should call out the synergy/dependency.

### Volume per squad per week
- GitHub: 8–12 PRs
- Jira: 10–15 tickets
- Slack: 6–10 threads, each with 3–8 messages
- Figma: 3–6 files with comments

Not huge, but enough to look real. Determinism via a seeded fixture generator (`scripts/generate-fixtures.ts`) — implementing session decides whether to generate procedurally or hand-author. **Recommendation: hand-author for demo polish.** Procedural generators tend to produce uncanny text.

### Shape
All fixtures normalize cleanly into `SourceRecord` (PRD-00). Source-specific fields live under `raw`.

## Acceptance Criteria
1. `pnpm tsx scripts/validate-fixtures.ts` passes for all 12 fixture files.
2. `fixtures/README.md` lists every planted tension with the squad and source records involved.
3. `fixtures/ground-truth-report.md` exists and references the planted tensions.
4. Total fixture word count is < 30k (keeps demos performant; keeps eval costs sane).

## Out of Scope
- Connecting fixtures to mirror DBs — that's PRD-03 (workers).
- Real API integration — explicitly mocked per locked decision.

## Open Questions
- Should fixture file names include a week-of date so multi-week backtests are possible? Recommend yes: `fixtures/<source>/<squad>/2026-W21.json`. Implementing session: commit to a convention and document in `fixtures/README.md`.

## Verification
- `pnpm tsx scripts/validate-fixtures.ts` → exit 0.
- Spot-read `fixtures/github/atlas/<week>.json` — visibly reads as a plausible PR list.
- Read `fixtures/README.md` and find every planted tension explicitly listed.

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

### What was actually built

- **`fixtures/<source>/<squad>/2026-W21.json` (12 files, 89 total records):** The Open Question about file naming was resolved: week-scoped paths (`2026-W21.json`) are committed as the convention. Squads: `atlas`, `lumen`, `forge` (lowercase, matching what PRD-01 mints). All files are hand-authored — the `generate-fixtures.ts` script mentioned in the brief was not created; the PRD's own recommendation against procedural generation was followed.
- **`fixtures/schemas/{github,jira,slack,figma}.json`:** Full JSON Schema (Draft-07) for each source, validating both the outer `SourceRecord` envelope and the `raw` object shape. `additionalProperties: false` is set everywhere so schema drift is caught at the boundary. The `github.json` schema declares `merged_at` as `["string", "null"]` to handle open/closed PRs.
- **`scripts/validate-fixtures.ts`:** Uses `ajv` + `ajv-formats` (both added to `devDependencies`). Iterates all 12 `<source>/<squad>/2026-W21.json` paths deterministically, exits 0 if all pass. A `pnpm validate-fixtures` convenience script was added to `package.json`.
- **`fixtures/README.md`:** Catalogues all 5 tensions with exact record IDs, expected agent behaviour, and supporting cross-source signals. This is the demo narration script — narrators should read it before a live walkthrough.
- **`fixtures/ground-truth-report.md`:** Structured as an actual VP-addressed memo (squad sections, action table). Includes a scoring note at the top for PRD-08: which findings are must-surface vs. should-surface vs. bonus.

### Gotchas for downstream sessions

**1. `ajv` was not in the original `package.json` — it is now**
`ajv@^8.20.0` and `ajv-formats@^3.0.1` were added to `devDependencies`. If you see a "Cannot find module 'ajv'" error after a fresh clone, run `pnpm install` from the repo root.

**2. The Slack tension (Tension 2) is deliberately subtle — not a clean "no ticket exists"**
The blocker ticket (LMNE-28) does exist in the Jira fixture, but it was filed late, is in `"To Do"` status with no sprint assignment, and has no blocker link to LMNE-25. A naive "does a Jira ticket exist for the keyword?" check would miss it. The agent needs to notice the combination: unlinked, unscheduled, and filed after the blocker was already resolved via Slack. PRD-08 eval criteria should test for this nuance.

**3. Squad IDs are lowercase strings — not yet a TypeScript union**
`src/types/core.ts` declares `SquadId = string` (a placeholder note says PRD-01 will narrow it to a literal union). All fixtures use `"atlas"`, `"lumen"`, `"forge"`. Once PRD-01 ships its final `notion-ids.ts`, the `SquadId` type should be tightened to `"atlas" | "lumen" | "forge"` and the fixture schemas' `enum` values already match that.

**4. The Figma tension (Tension 3) has blast-radius information built in**
Downstream PRD-04a (source summarizer) and PRD-05 (master summarizer) should report that FORGE-30, FORGE-36, and the offline mode nav indicator are all at risk (~13 story points of rework). This multi-record blast-radius signal is in the ground-truth report's Forge section — PRD-08 can use it as a "did the agent quantify the impact?" scoring criterion.

**5. Total word count: 26,883 — 10% headroom before the 30k limit**
If a future session adds a fourth squad or a second fixture week, budget accordingly.
