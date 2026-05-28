# PRD-02 — Mock Fixtures

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
