# PRD-04a — Per-Source Summarizer Agents

<!-- status:
state: completed
owner: opus-review-2026-05-29
updated: 2026-05-29T22:30:00Z
notes: APPROVED by Opus review — all 4 ACs re-verified live. AC1 ✅ exactly 12 in-scope rows (github/jira/slack/figma × 3 squads), all awaiting-review. AC2 ✅ 12/12 Citations JSON parse, all bare-UUID recordIds. AC3 ✅ sampled one citation per row (12/12): every recordId resolves to a real mirror row in the CORRECT source DB whose title supports the claim — zero cross-source contamination. AC4 ✅ zero-activity → approved confirmed in code (index.ts:204) and live (2 auto-approved 0-citation rows). rt() chunking + @notionhq/client@2.3.0 pin verified in source. Note: 6 extra live rows (roadmap/prd-fact-check) are PRD-04b scope, not 04a.
-->

## Goal
Produce one **Squad Weekly Summary** row per (squad × source) — 12 total per week — each with a structured summary and verifiable citations back to mirror DB rows.

## Why this exists
Smaller agents with narrow context are Dan's mitigation for hallucination risk. This PRD operationalizes that bet and defines the citation contract that PRD-08 will measure.

## Dependencies
- PRD-00, PRD-01, PRD-03a/b/c/d (mirror DBs must be populated).

## Inputs
- Mirror DB row sets for one squad × one source.
- The squad's PRD page (for context only; summarizer should not rewrite PRD).
- Last week's summary for the same (squad, source) — for trend context.

## Outputs
- Notion pages in **Squad Weekly Summary** with:
  - `Squad`, `Week Of`, `Source` set.
  - `Summary` (rich text): markdown-shaped sections — *What shipped*, *In progress*, *Risks*, *Notable*.
  - `Citations` (text JSON): array of `{ recordId: notionPageId, sourceUrl: string, claim: string }`. Every factual statement in `Summary` must map to at least one citation.
  - `Status = awaiting-review`.
  - `Generated At` timestamp.
- One `Agent Run Log` row per agent invocation, tagged `summarizer.<source>.<squad>`.

## Design

### Citation contract (THIS is the critical bit — PRD-08 scores against it)
- Inline citation style in Notion: each factual sentence ends with one or more inline mentions linking to a mirror DB row (Notion's `@mention` block referencing the page).
- Parallel structured array in `Citations` property for machine parsing by PRD-08.
- A "factual statement" = any sentence containing a specific noun phrase referring to a PR, ticket, person, decision, or number. Vague summary sentences ("the team made progress on auth") are not required to cite.
- **Coverage target: ≥ 90% of factual sentences cited.** Measured by PRD-08.

### Trigger
- On completion of the corresponding `worker.<source>` Agent Run Log row (event-driven), OR on cron Mon 6:30AM (belt and suspenders).
- Reads the trailing N=4 weeks of summaries to detect trends (e.g., "this is the third week the Atlas team has carried over the search-perf ticket").

### Agent surface
- Built as Notion Custom Agents where supported. Each agent has a tightly scoped system prompt naming its source and squad — no agent sees > 1 source.
- Master summarizer (PRD-05) gets the cross-source view, not these.

### Failure modes
- If a mirror DB has zero records this week for a (squad, source): produce a summary with `Summary = "No activity this week."` and `Citations = []`. Mark `Status = approved` automatically (skips HITL).

## Acceptance Criteria
1. 12 summary rows produced per fixture week (4 sources × 3 squads).
2. Each summary's `Citations` JSON parses and references valid mirror DB page IDs.
3. Random spot-check: open any summary, click any inline mention — lands on a real mirror row whose content supports the cited claim.
4. Zero-activity summaries do not enter HITL.

## Out of Scope
- Product roadmap / PRD fact checking → PRD-04b.
- Cross-source synthesis → PRD-05.
- Evaluation of citation quality → PRD-08.

## Open Questions
- Notion Custom Agents prompt-length and tool-call constraints — implementing session must confirm a single agent can hold the system prompt + this week's mirror context. Fallback: TS-side LLM call writing into Notion via SDK. Either is acceptable; document the choice in the PRD when complete.

## Verification
- Open Squad Weekly Summary DB, filter `Week Of = <this week>`, expect 12 rows.
- For each row, parse `Citations`, assert all `recordId` values resolve in Notion.

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

### What was actually built

- **`workers/summarizer/src/index.ts`**: Notion Worker with two tools deployed to the Notion Workers platform (workerId: `019e7499-8d6e-7452-892b-14d9e6fac1d7`). No LLM calls in the worker — it is pure data plumbing. The AI layer lives in a Notion Custom Agent (Notion's built-in Claude) that calls the tools.
- **`read_mirror_rows` tool**: Queries any of the 4 mirror DBs filtered by squad relation, returns every row with its `notionPageId` (the citation target), `sourceId`, `title`, `url`, excerpt (source-specific field), `status`, and `lastUpdated`. `readOnlyHint: true` so Custom Agents auto-execute it without user confirmation.
- **`write_squad_summary` tool**: Finds the existing placeholder row by (Squad relation, Week Of, Source), deletes all old blocks, appends structured page body (What Shipped / In Progress / Risks & Blockers / Notable), updates `Citations` property with the JSON array, sets `Status = awaiting-review` (or `approved` when citations is empty — zero-activity auto-approval), and writes an Agent Run Log entry tagged `summarizer.<source>.<squad>`.
- **`workers/summarizer/package.json`**: `@notionhq/client` pinned to `2.3.0` (see Gotcha 1). Root `package.json` gained `summarizer:deploy` script.

### Open question resolved

The brief asked: "Notion Custom Agents prompt-length and tool-call constraints — implementing session must confirm." **Confirmed viable**: the worker exposes narrow read/write tools; the Custom Agent (Notion AI, Claude-backed) is the LLM layer. No Anthropic SDK in the worker. This is the canonical Notion agent architecture.

### AC status at hand-off

| AC | Status | Notes |
|---|---|---|
| AC1 — 12 rows produced | ✅ | All 12 rows (4 sources × 3 squads) verified `awaiting-review`. All 4 Custom Agents confirmed operational with worker tools connected. |
| AC2 — Citations JSON valid | ✅ | 12/12 rows parse cleanly; `allBareUUIDs: true` on every row; 9/12 rows required multi-chunk storage after `rt()` fix (see Gotcha 4). |
| AC3 — Spot-check inline mentions | ✅ | All 4 sources spot-checked — claims verified against live mirror rows: PR #51 / ATLS-42 / EU billing latency incident / Figma email templates. Zero hallucinated facts found. |
| AC4 — Zero-activity skip HITL | ✅ (code) | `write_squad_summary` sets `Status = approved` when `citations.length === 0`. Not exercised in W21 fixtures (all squads have activity). |

### Additional files

- **`agent-prompts/summarizer-{github,jira,slack,figma}.md`**: Production system prompts for all 4 Custom Agents, stored in repo. Each uses markdown-native formatting (emoji headers, field tables). Includes a `🔧 Required Tools` guardrail section that instructs the agent to hard-stop if worker tools are not visible — prevents silent fallback to native Notion queries.

### Gotchas for downstream sessions

**1. Cloud build resolves `@notionhq/client@5.22.0` — breaks `databases.query`**
Notion Workers' cloud build uses npm, which auto-installs the latest compatible peer dep. `@notionhq/client` v5.x removed `databases.query` from the `Client.databases` type. Symptom: `Property 'query' does not exist on type '{ retrieve..., create..., update... }'`. Fix already in place: `"@notionhq/client": "2.3.0"` pinned as an explicit dependency in `workers/summarizer/package.json`. Any future worker touching Notion DBs must do the same.

**2. Worker uses `NOTION_API_TOKEN`, not `NOTION_API_KEY`**
The workers runtime reads `process.env.NOTION_API_TOKEN`. For local `ntn workers exec` testing, the `.env.local` key (`NOTION_API_KEY`) doesn't auto-apply. Push the value once: `ntn workers env set NOTION_API_TOKEN="<value from .env.local>"`. For the deployed worker, this was already done in this session.

**3. Custom Agent trigger architecture — Agent Run Log "pending" row (final design)**
The final architecture uses Agent Run Log as the trigger surface. When each mirror worker completes, `createSummarizerTrigger()` (in `src/workers/lib/agent-run-log.ts`, called from `src/workers/lib/source-worker.ts`) creates ONE Agent Run Log row with `Outcome = "pending"` and `Agent Name = "summarizer.{source}"`. Each Custom Agent watches for this row and fires ONCE per source run, then queries Squad Weekly Summary to enumerate N squads dynamically — no hardcoded squad list.

Design rationale: triggering per Squad Weekly Summary row (the naive approach) fires N simultaneous invocations. One trigger row → one invocation is the correct job-queue-consumer pattern and supports any number of squads without config changes.

Schema changes: Agent Run Log Outcome select gained `"pending"` option (PATCH 2026-05-29). System prompts (Step 4) instruct the agent to update the trigger row `Outcome → "ok"` after processing all squads.

**4. Notion rich_text property hard-caps at 2000 chars per element — Citations JSON silently truncated**
Symptom: `Citations` stored only the first 1999 chars of the JSON array, producing invalid JSON (mid-object cut). Root cause: original `rt()` helper used `s.substring(0, 1999)` — one element, hard limit. Fix in `workers/summarizer/src/index.ts`: `rt()` now chunks into multiple 1999-char elements and Notion concatenates them on read. With 10–15 citations per summary (~150–200 chars each), arrays routinely exceed 1999 chars. Any downstream PRD writing rich_text of unknown length must use a chunking `rt()` — do not use single-element writes.

**5. Custom Agent bypasses worker tools if not explicitly connected in Notion UI**
First test run: agent used native Notion page-read instead of `read_mirror_rows`, returned Notion URLs as `recordId` instead of bare UUIDs, and wrote directly to pages instead of using `write_squad_summary`. Root cause: the worker was deployed but not connected to the agent in the Notion Custom Agent tool configuration UI. Fix: (a) connect `arcline-worker-summarizer` (worker ID `019e7499-8d6e-7452-892b-14d9e6fac1d7`) in each agent's tool settings, (b) `🔧 Required Tools` guardrail section in each prompt instructs the agent to hard-stop and output an error message if the tools are not visible — prevents silent fallback.

**6. Write tool confirmation prompt only appears in interactive sessions**
When watching a Custom Agent run live in the Notion UI, write tool calls (e.g., `write_squad_summary`) prompt for user confirmation. This is a Notion UI safety gate, not an SDK `destructiveHint` — `ToolHints` in `@notionhq/workers` only exposes `readOnlyHint`, so it cannot be suppressed programmatically. Unattended runs (cron triggers, property-change triggers with no viewer) auto-approve all tool calls — no action needed for production.
