# PRD-03 — Worker Pattern (shared)

<!-- status:
state: waiting
owner: —
updated: 2026-05-28T23:00:00Z
notes: CULMINATION / rollup (Dan's ruling 2026-05-28): PRD-03 is the culmination of the worker pattern + the four 03a–d sub-PRDs, not a gate before them. The pattern contract here is already authored, so 03a–d are unblocked and ready. This row completes once all four workers (03a, 03b, 03c, 03d) are completed. deps: 03a, 03b, 03c, 03d. NOTE: the Dependencies prose in 03/03a–d files still lists the old direction (03a–d depend on "PRD-03 (pattern)"); README is authoritative per SOP rule 1.
-->

> Not an implementation PRD. The four `03a–03d` PRDs delegate their structure here.

## Goal
Define the shape, contract, and shared utilities for the four Data Source Workers so they look like siblings, not strangers.

## Why this exists
Dan's Rule #4 demands that changing assumptions about one data source not reshape the build. The way to honor that is to make every worker pluggable behind an identical contract.

## Dependencies
- PRD-00, PRD-01, PRD-02.

## Outputs
- `src/workers/lib/source-worker.ts` exporting a `runSourceWorker(config: SourceWorkerConfig)` helper that handles: read fixtures, normalize to `SourceRecord`, upsert into mirror DB, write `Agent Run Log` row, emit completion event.
- A typed `SourceWorkerConfig`:
  ```ts
  type SourceWorkerConfig = {
    source: SourceRecord["source"];
    mirrorDbId: string;          // from notion-ids.ts
    fixtureLoader: (squad: SquadId, weekOf: string) => Promise<unknown[]>;
    normalize: (raw: unknown, squad: SquadId) => SourceRecord;
    propertyMapper: (rec: SourceRecord) => NotionPagePropertiesShape;
  };
  ```
- `src/workers/lib/upsert.ts` — generic upsert by `sourceId` (queries Notion by a unique property).

## Design
- Trigger: Monday 6AM cron (Notion Worker schedule). For demos, a manual `pnpm tsx scripts/trigger-workers.ts --week=YYYY-Www` shortcut.
- Idempotent: re-running for the same week updates `lastUpdated` only when the underlying record changed.
- Failure mode: per-record try/catch. One bad record does not halt the worker; it's logged as `outcome=error` in Agent Run Log with the offending sourceId.
- Concurrency: workers for different sources run independently; the 4 may run in parallel.
- Completion event: writes a row to `Agent Run Log` with `agent_name = "worker.<source>"`. The summarizers (PRD-04) poll/listen on this.

## Acceptance Criteria
Met collectively by 03a–03d. This PRD has no standalone acceptance criteria.

## Out of Scope
- Source-specific field mapping — owned by each 03x PRD.
- Summarization — PRD-04.

## Open Questions
- Notion Workers event model — do we use cron + DB polling, or is there a native event-emission API the summarizers can subscribe to? Implementing session probes and documents.
