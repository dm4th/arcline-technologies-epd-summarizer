# PRD-00 — Foundations

<!-- status:
state: in-review
owner: sonnet-2026-05-28-A1
updated: 2026-05-28T18:56:00Z
notes: All 6 ACs pass: probe live, tsc clean, hello worker deployed (id: 019e6ff1-ede4-7081-a976-8bfa40c9f50a)
-->

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
- ~~Workspace plan tier confirmed at API level?~~ **Resolved:** `GET /v1/users/me` returns `workspace_limits` but not plan tier directly. Workers enablement is the real signal — if `ntn doctor` shows `Workers enabled: ✔`, the plan tier is sufficient.
- ~~Preferred package manager — pnpm vs npm?~~ **Resolved:** pnpm confirmed.

## Verification
- `pnpm tsx scripts/probe-workspace.ts` returns a JSON tree. ✅ Prints "Arcline Technologies | EPD Readout POC" with 6 child blocks.
- `ntn workers list` shows the `hello` worker. ✅ id: `019e6ff1-ede4-7081-a976-8bfa40c9f50a`
- `git status` shows `.env.local` is NOT tracked. ✅ (in `.gitignore`)

## Implementation Notes

> Written post-build. Read this before touching anything Workers-related in downstream PRDs.

### What was actually built

- **Root project** (`package.json` at repo root): `@notionhq/client` + `dotenv` for scripts; `tsx` + `typescript` for dev. Covers `src/` and `scripts/`.
- **Worker sub-project** (`workers/hello/`): separate `package.json` with `@notionhq/workers`. Declared as a pnpm workspace member via `pnpm-workspace.yaml`. A single `pnpm install` from the repo root installs both.
- **`src/lib/env.ts`**: loads `.env.local` via `dotenv` on import; throws with a copy-pasteable fix message if vars are missing. All scripts get env loading for free by importing this module.
- **`src/lib/notion.ts`**: singleton Notion client (avoids re-auth on repeated calls). Also exports `extractPageId()` which parses Notion page URLs into bare 32-char hex IDs — needed because `BASE_NOTION_PAGE` is a full URL, not an ID.
- **`scripts/probe-workspace.ts`**: fetches the root page title + child block tree (max 3 levels deep, paginated). Detects `object_not_found` from the API and surfaces a "share this page with your integration" message instead of crashing with a raw stack trace.
- **`workers/hello/src/index.ts`**: minimal `Worker` with a `ping` tool that returns `{ pong: true, worker: "hello", ts: <ISO> }`. Proves the full build→deploy→list pipeline works.

### Gotchas for downstream sessions

**1. The Notion CLI is `ntn`, not `notion`.**
The binary installed at `/usr/local/bin/ntn`. All worker commands are `ntn workers <subcommand>`. The `solution-intro.md` referred to it loosely as "Notion CLI" — the actual command is always `ntn`.

**2. Workers needs to be explicitly enabled in workspace settings.**
Even as workspace owner, `ntn workers list` returned `403 WorkersCapabilityMissing` until we enabled it at: **Notion web app → Settings & Members → Settings → [scroll to find Workers toggle]**. After enabling, you must re-login (`ntn logout && ntn login --no-browser` + `ntn login poll`) to get a token that includes the Workers scope. The old token doesn't pick it up automatically.

**3. `ntn workers deploy` uses user-level OAuth, not the integration API key.**
`NOTION_API_KEY` (the integration token, `ntn_...`) works for the Notion SDK (`@notionhq/client`) but is rejected by `ntn workers`. Workers management requires a user-level OAuth token obtained via `ntn login`. These are two separate auth surfaces: data plane (integration token) vs. infra plane (user OAuth). Store them separately.

**4. pnpm 11 dropped the `"pnpm"` field in `package.json`.**
The `onlyBuiltDependencies` setting (needed to allow `esbuild`'s post-install script) moved to `pnpm-workspace.yaml`:
```yaml
allowBuilds:
  esbuild: true
```
Using the old `"pnpm": { "onlyBuiltDependencies": [...] }` in `package.json` prints a warning and is silently ignored in pnpm 11.

**5. `esbuild` build scripts are blocked by default in pnpm but `tsx` still works.**
pnpm 11 requires opt-in for post-install scripts. Without the `allowBuilds` config, the install exits with `ERR_PNPM_IGNORED_BUILDS`. However, `tsx` (which depends on `esbuild`) works even with the build script blocked — `esbuild` v0.28+ ships platform-specific optional packages (`@esbuild/darwin-arm64`, etc.) so the binary is present without the post-install step. The `allowBuilds: esbuild: true` config is still correct practice; it just isn't strictly required for local dev.

**6. Workers sub-projects must be workspace members for `pnpm install` to reach them.**
Running `pnpm install` inside `workers/hello/` while the root `pnpm-workspace.yaml` exists will silently report "Already up to date" without actually installing anything — pnpm defers to the root workspace. The fix is to declare `packages: [workers/*]` in `pnpm-workspace.yaml` and always run `pnpm install` from the repo root.

**7. Notion deploys TypeScript source directly — no local `tsc` step needed for workers.**
`ntn workers deploy` uploads the source and runs `tsc` in Notion's cloud build environment. You do not need to run `tsc` locally before deploying. The `pnpm check` / `tsc --noEmit` in the worker's `package.json` scripts are for local type validation only.

**8. Workspace ID is derivable from the API.**
If you need `NOTION_WORKSPACE_ID` for `ntn` commands:
```bash
curl -s -H "Authorization: Bearer $NOTION_API_KEY" \
     -H "Notion-Version: 2022-06-28" \
     https://api.notion.com/v1/users/me | jq .bot.workspace_id
```
For this workspace: `4f2291b0-5ab4-483b-838a-f83d7e8d2754`.
