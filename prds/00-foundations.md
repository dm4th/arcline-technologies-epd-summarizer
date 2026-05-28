# PRD-00 — Foundations

## Goal
Stand up a TypeScript repo wired to the live Notion workspace and to Notion Workers, with shared types and CLI access proven, so every downstream PRD has a stable surface to build on.

## Why this exists
Dan's Rule #4: "One single change to assumptions should not change the full build." Every following PRD assumes a working Notion SDK client, env wiring, type contracts, and a verified Workers runtime. If those wobble, the parallel sessions diverge.

## Dependencies
None.

## Inputs
- `.env.local` containing `BASE_NOTION_PAGE` and `NOTION_API_KEY`.
- Notion CLI already installed (per `solution-intro.md`).
- Notion developer docs (linked in `solution-intro.md`).

## Outputs
- `package.json`, `tsconfig.json`, `pnpm-lock.yaml` (or npm equivalent).
- `src/lib/notion.ts` — typed Notion client factory reading `.env.local`.
- `src/types/core.ts` — exported types: `SourceRecord`, `SquadId`, `SquadSummary`, `MasterSummary`, `AgentRun`, `ApprovalState`.
- `src/lib/env.ts` — runtime env validation (throws on missing vars).
- `workers/` directory with one trivial Worker (`hello.ts`) successfully deployed via Notion CLI, proving the pipeline.
- `scripts/probe-workspace.ts` — reads `BASE_NOTION_PAGE`, prints child page tree to confirm API access and permissions.
- `README.md` at repo root: setup, scripts, "how to add a Worker."

## Design
- Node 20+, TypeScript strict mode, `tsx` for scripts.
- Notion SDK: `@notionhq/client` latest.
- One-shot scripts go under `scripts/`; persistent runtimes go under `workers/`.
- `SourceRecord` is the common shape every mirror DB normalizes to:
  ```ts
  type SourceRecord = {
    sourceId: string;            // stable id in source system
    source: "github" | "jira" | "slack" | "figma";
    squadId: SquadId;
    title: string;
    url: string;                 // back to source-of-truth
    lastUpdated: string;         // ISO
    raw: unknown;                // source-specific payload
    summary?: string;            // optional pre-extracted summary
  };
  ```
- `SquadId` is a string-literal union of 3 ids defined in PRD-01.
- Workers probe: if Workers are NOT actually available on this workspace, the implementing session must STOP and surface this as a `[BLOCKER]` in this PRD's Open Questions, NOT silently fall back. Dan confirmed availability; we verify before building on it.

## Acceptance Criteria
1. `pnpm install && pnpm tsx scripts/probe-workspace.ts` prints a non-empty page tree.
2. `pnpm tsx scripts/probe-workspace.ts` fails loudly with a useful message if any env var is missing.
3. Trivial `hello` Worker deployed and visible in the Notion CLI's `worker list` output.
4. `pnpm tsc --noEmit` passes with strict mode.
5. `src/types/core.ts` is imported by at least one script (e.g. probe annotates output with types) to prove the types compile in real use.
6. README has a "Quickstart" that a fresh contributor can follow in under 5 minutes.

## Out of Scope
- Any business logic (data ingestion, summarization, HITL).
- Notion DB schemas — that's PRD-01.
- Mock fixtures — that's PRD-02.
- Test framework setup beyond `tsc --noEmit` (downstream PRDs can add Vitest if they need it).

## Open Questions
- Workspace plan tier confirmed at API level? (probe should report it if surfaceable.)
- Preferred package manager — pnpm vs npm? Default to pnpm; flip if Dan objects.

## Verification
- `pnpm tsx scripts/probe-workspace.ts` returns a JSON tree.
- `notion worker list` (or CLI equivalent) shows the `hello` worker.
- `git status` shows `.env.local` is NOT tracked.
