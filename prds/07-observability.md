# PRD-07 — Observability (Agent Run Log + dashboards)

<!-- status:
state: completed
owner: opus-review-2026-05-29
updated: 2026-05-29T12:25:00Z
notes: APPROVED by Opus review — re-verified live. AC1 ✅ grep confirms all run-log writes route through writeAgentRunLog (source-worker + hitl-review); only DB-id reference is its definition in notion-ids.ts. AC2 ✅ Weekly Pipeline Dashboard (36ffc8f4-554c-8104-aea9-c1e79b3b5fc0) renders 5 embedded views. AC3 ✅ prose matches live rollup exactly: 11 runs / 1.9 min / 0 errors / 2 approvals / $0.00.
-->

## Goal
Make agent sprawl *measurable* — every agent invocation produces a structured row with latency, cost, and outcome, surfaced in views that answer "where's the bottleneck this week?"

## Why this exists
Dan's biggest acknowledged risk is sprawl. The structural answer isn't fewer agents — it's making the existing ones legible. This PRD turns "we have many small agents" from a liability into a selling point ("…and you can see every one of them, with timing and cost, in this dashboard").

## Dependencies
- PRD-01 (Agent Run Log DB exists).

## Inputs
- All other PRDs write to Agent Run Log.

## Outputs
- Notion views on Agent Run Log (DB `36efc8f4-554c-814e-8c51-ea51792f5344`):
  - **This Week — by agent** `view://36ffc8f4-554c-815c-bf4d-000c3568121d`
  - **Latency Hot Spots** `view://36ffc8f4-554c-8111-ab3b-000c50308639`
  - **Errors** `view://36ffc8f4-554c-8101-884e-000ca8fb0f73`
  - **Cost This Week** `view://36ffc8f4-554c-81f6-b298-000c9a6cd794`
  - **Pipeline Timeline** `view://36ffc8f4-554c-81e4-bb10-000ca23cf783`
- **Weekly Pipeline Dashboard** page: `36ffc8f4-554c-8104-aea9-c1e79b3b5fc0`
  - URL: `https://notion.so/36ffc8f4554c8104aea9c1e79b3b5fc0`
  - All 5 views embedded as inline linked databases; prose summary auto-generated from live Agent Run Log query.
- **Summarizing agent script**: `scripts/setup-observability.ts` (`pnpm observe` or `pnpm observe --week=YYYY-Www`)

## Design
- The dashboard is the interview demo's *second* "wow" — it shows you respect operational reality.
- All workers and summarizers must use the shared `src/lib/agent-log.ts` helper (defined in PRD-00) to write rows. No ad-hoc Notion writes for logging.
- Cost estimation: implementing session chooses between (a) real token counting via the LLM client, (b) a fixed-per-agent estimate. Either is fine; document choice.

## Acceptance Criteria
1. Every PRD's agent/worker writes to Agent Run Log via the shared helper. Grep for direct DB writes finds zero.
2. The Weekly Pipeline Dashboard renders all five views without errors.
3. After a full pipeline run, the dashboard's prose summary numbers match the rollups.

## Out of Scope
- External observability (Datadog, etc.) — out for V1. Mention as an integration story in the submission HTML.

## Open Questions
None.

## Verification
- Run the full pipeline. Open the Weekly Pipeline Dashboard. Confirm row counts and totals.

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

### What was actually built

- **`src/workers/lib/agent-run-log.ts`**: Added optional `tokenCostUsd?: number` param — the DB schema already had `Token Cost USD` (added during PRD-01 build) but the helper wasn't writing to it. One-line conditional spread addition.
- **`scripts/setup-observability.ts`** (`pnpm observe [--week=YYYY-Www] [--all]`): The "summarizing agent" — queries Agent Run Log, computes stats (total runs, duration, cost, errors, approvals), then creates or refreshes the Weekly Pipeline Dashboard page under `BASE_NOTION_PAGE`. Idempotent: scans root page children for an existing dashboard by title, clears and rewrites blocks if found. The script handles prose generation; the 5 linked-view embeds were appended once via MCP and persist across refreshes.
- **5 view tabs on Agent Run Log DB**: Created via Notion MCP `notion-create-view` with `database_id`. Tabs: "This Week — by agent" (grouped), "Latency Hot Spots" (sort desc Duration ms), "Errors" (filter Outcome=error), "Cost This Week" (sort desc Token Cost USD), "Pipeline Timeline" (sort asc Started At).
- **5 inline linked-database blocks on the dashboard page** (`36ffc8f4-554c-8104-aea9-c1e79b3b5fc0`): Same 5 configs embedded directly in the page body via `notion-create-view` with `parent_page_id`. No `--all` flag needed when real weekly data exists — default `pnpm observe` uses the current ISO week.

### Gotchas for downstream sessions

**1. Notion public API has no view management endpoints**
`GET/POST /v1/databases/{id}/views` returns `400 invalid_request_url`. All view creation — whether adding a tab to a DB or embedding an inline view on a page — must go through the Notion MCP (`notion-create-view`). The `ntn api` CLI and `@notionhq/client` SDK do not expose this surface at all.

**2. Linked-database page blocks require the MCP, not the SDK**
There is no `linked_database` block type in the Notion SDK or REST API. The only way to embed a linked database view into a page (equivalent to the `/linked` UI command) is `notion-create-view` with `parent_page_id`. Attempting to create such a block via `notion.blocks.children.append` fails with unsupported block type.

**3. The log helper lives at `src/workers/lib/agent-run-log.ts`, not `src/lib/agent-log.ts`**
PRD-00's brief specified `src/lib/agent-log.ts` but the build placed it under `src/workers/lib/agent-run-log.ts`. All four source workers and `hitl-review.ts` import from the correct path. When AC1 says "grep for direct DB writes finds zero," grep for `writeAgentRunLog` (the function name) rather than the file path — that's the authoritative check.

**4. Cost is $0.00 for all current fixture-ingestion workers**
Workers do no LLM API calls, so `tokenCostUsd` is omitted (Notion stores `null`, displayed as `$0.00`). When PRD-04a/04b/05 implement real Anthropic calls, they should pass `tokenCostUsd` to `writeAgentRunLog` — use the `usage.input_tokens + usage.output_tokens` from the API response multiplied by the per-token rate. The `Token Cost USD` column is already formatted as `dollar` in Notion.
