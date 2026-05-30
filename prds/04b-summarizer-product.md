# PRD-04b — Product Roadmap Summarizer + PRD Fact Checker

<!-- status:
state: completed
owner: opus-review-2026-05-29
updated: 2026-05-29T23:55:00Z
notes: APPROVED by Opus review — all 4 ACs re-verified live. AC1 ✅ exactly 6 rows (3 squads × {roadmap, prd-fact-check}), Week 2026-W21, awaiting-review, valid Squad relations. AC2 ✅ Forge/prd-fact-check Flags & Drift shows [BLOCK] Reversal w/ 3-source evidence (Figma pivot + GitHub PR #22 + Jira FORGE-30). AC3 ✅ Atlas/roadmap tags Atlas/Lumen auth-token cross-squad dep in On Track + At Risk. AC4 ✅ 19/19 citation recordIds resolve live (0 broken); 8 cascade to upstream per-source Summary pages, others to PRD/roadmap/mirror rows. Both workers tsc clean; run-log roadmap/prdcheck rows outcome=ok. Non-blocking: duplicate run-log trigger batches (auto fan-in + manual debug run); deliverable stayed idempotent at 6 rows. Worker: 019e75e3-f1dd-789d-87d5-c5e2ed7222aa.
-->

## Goal
For each of 3 squads, produce two additional Squad Weekly Summary rows: (a) progress against the Product Roadmap, (b) PRD drift / scope-of-work fact-check.

## Why this exists
- Roadmap summarizer ties weekly noise to leadership's strategic narrative — exactly what VPs read for.
- PRD Fact Checker is Dan's hallucination-on-the-customer-side defense: it surfaces when squads are quietly working on things the PRD doesn't authorize, OR when the PRD says something the activity ignores.

## Dependencies
- PRD-00, PRD-01, PRD-04a (uses other summaries as input).

## Inputs
- The squad's PRD page (acceptance criteria, status).
- The Product Roadmap DB filtered to `Owning Squad = squad`.
- All four per-source Squad Weekly Summary rows for the squad this week (from PRD-04a).

## Outputs
- 6 additional Squad Weekly Summary rows (3 squads × 2 agents).
  - `Source = "roadmap"` or `Source = "prd-fact-check"`.
- `Agent Run Log` rows tagged `summarizer.roadmap.<squad>` and `summarizer.prdcheck.<squad>`.

## Design

### Roadmap Summarizer (per squad)
- Cross-references this week's activity (via the 4 per-source summaries) to the squad's roadmap initiatives.
- Output sections: *On track*, *At risk*, *No movement*, *Off-plan activity*.
- Citations: each statement references either a roadmap row OR an upstream per-source Summary row (cascade citation).

### PRD Fact Checker (per squad)
- Defined contract (filling the gap Dan flagged):
  1. **Scope drift**: Activity (PR/ticket/Slack) describes a change not covered by any PRD acceptance criterion → flag.
  2. **Stalled criterion**: PRD criterion has no supporting activity for ≥ 2 consecutive weeks → flag.
  3. **Reversal**: A design (Figma) decision contradicts a PRD criterion → flag.
- Output: bullet list of flags, each with severity (`info` / `warn` / `block`), citation to PRD criterion, citation to the contradicting activity.
- If no flags: output "PRD aligned this week." with empty citations array. Auto-approve.

### Trigger
- After all four PRD-04a summaries for the squad land. (Use Agent Run Log polling or workflow event.)

## Acceptance Criteria
1. 6 rows produced per fixture week (3 squads × 2 agents).
2. PRD Fact Checker correctly flags the Forge squad's Figma-reverses-PRD planted tension (PRD-02 #3).
3. Roadmap Summarizer correctly tags the Atlas/Lumen cross-squad-dependency activity (PRD-02 #5).
4. Citations cascade properly: a roadmap summary citing a per-source summary should not be flagged as "uncited" by PRD-08.

## Out of Scope
- Updating the PRD or Roadmap pages (read-only).
- Cross-squad synthesis (PRD-05).

## Open Questions
- Drift-detection prompt complexity — if Custom Agents can't hold the multi-document context, fall back to TS-side LLM call. Surface fallback choice in implementation notes.

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

### What was actually built

- **`workers/summarizer-product/src/index.ts`**: New Notion Worker (workerId: `019e75e3-f1dd-789d-87d5-c5e2ed7222aa`, name: `arcline-worker-summarizer-product`) with 4 tools. `read_squad_summaries` fetches the 4 upstream per-source Summary page bodies + citations so agents can synthesize across sources without native Notion queries. `read_roadmap_rows` queries Product Roadmap DB by squad relation. `read_prd_rows` queries PRDs DB by squad and extracts numbered list items under the "Acceptance Criteria" heading_2 block from page body. `write_squad_summary` accepts `source = "roadmap" | "prd-fact-check"` and uses a `SECTION_LABELS` map to write source-appropriate section headings (On Track / At Risk / No Movement / Off-Plan for roadmap; PRD Aligned / In Progress vs PRD / Flags & Drift / Observations for prd-fact-check).

- **`agent-prompts/summarizer-roadmap.md`** and **`agent-prompts/summarizer-prd-fact-check.md`**: Production system prompts for both Custom Agents. Both require `arcline-worker-summarizer-product` connected in tool settings. The PRD Fact Checker prompt has explicit per-rule instructions (scope drift / stalled criterion / reversal) and a targeted callout for the Forge navigation reversal (Tension 3, AC2) to ensure the agent flags it at `block` severity.

- **`workers/summarizer/src/index.ts`** (modified): Added fan-in gate inside `write_squad_summary`. After every per-source summary write, the tool counts completed per-source rows for the week and compares against `squadCount × PER_SOURCES.length`, where `squadCount` is a live Squads DB query and `PER_SOURCES` is a module-level constant. When the threshold is met, it creates `summarizer.roadmap` and `summarizer.prdcheck` pending rows in Agent Run Log — triggering the PRD-04b agents without any manual step. Idempotency guard prevents double-firing.

- **`scripts/trigger-product-summarizers.ts`**: Manual trigger override. Useful for re-runs and debugging; production relies on the fan-in gate above.

- **Open question resolved**: Custom Agents (Notion AI, Claude-backed) hold multi-document context adequately for fixture data volume. No TS-side LLM fallback needed — the narrow worker tools + broad agent reasoning is the correct architecture.

### Gotchas for downstream sessions

**1. Empty `workerId` in workers.json blocks both `ntn workers create` and `ntn workers deploy`**
`ntn workers deploy` 404s against an empty string workerId. `ntn workers create` refuses if workers.json exists in the CWD (even with empty workerId): "This directory already has a worker ()." Fix: `mv workers.json workers.json.bak && ntn workers create --name "<name>" --json` — the CLI writes a new workers.json with the real ID. Then `rm workers.json.bak && ntn workers deploy`. Don't leave workers.json with an empty workerId; it blocks both paths.

**2. Bootstrap wrote PRD page body to Lumen but silently failed for Atlas and Forge**
`read_prd_rows` returned `acceptanceCriteria: []` for Atlas (`36efc8f4-554c-81d2-87e9-efddab1762c8`) and Forge (`36efc8f4-554c-81c5-84cc-ee35b20095d7`) — both pages had zero blocks. `appendBlocks` failed silently during bootstrap for rows 1 (Atlas) and 3 (Forge); row 2 (Lumen) succeeded. Because `dbIsEmpty()` is checked once before the entire seed loop, re-running bootstrap skips everything and the pages stay empty. Fixed by patching directly: `ntn pages update <page-id> --allow-deleting-content --content "..."`. Any PRD that calls `read_prd_rows` must verify ACs are non-empty on first run.

**3. Fan-in threshold must be dynamic — `>= 12` silently breaks when squads or sources change**
Initial implementation hardcoded `completedCount >= 12`. Replaced with `completedCount >= squadCount * PER_SOURCES.length`, where `squadCount` queries Squads DB live and `PER_SOURCES` is a module-level constant in `workers/summarizer/src/index.ts`. Adding a source requires updating `PER_SOURCES` + the `Source` type (intentional code change). Adding a squad auto-adjusts the threshold but still requires updating the static `SQUAD_PAGE_ID` map — tracked in PRD-11 Open Questions with the fix direction (dynamic lookup by SquadId property).

**4. `ntn pages update --content` with long content runs as a background task**
For content above a length threshold, the ntn CLI backgrounds the command and returns a task ID. The task output file is empty on success (not an error). The page update appeared to have failed (block count still 0) until the background task completed. Fix: pass `timeout: 30000` on the Bash call, or verify with `ntn api v1/blocks/{id}/children` block count after each write rather than trusting the empty output.

**5. `pnpm --filter <name> deploy` triggers pnpm's built-in deploy, not the npm script**
The root `summarizer-product:deploy` script fails with `[ERR_PNPM_INVALID_DEPLOY_TARGET] This command requires one parameter` — pnpm intercepts `deploy` as a built-in workspace command. The reliable path is `cd workers/summarizer-product && ntn workers deploy` directly, or `pnpm --filter <name> run deploy` (explicit `run` subcommand).
