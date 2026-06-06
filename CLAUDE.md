# CLAUDE.md — Arcline EPD Digest (project guide)

Project-level instructions for Claude sessions working in this repo. The global
`~/.claude/CLAUDE.md` (Notion CLI rules, git workflow) still applies; this file adds
project-specific context. Read it before picking up any PRD.

## What this repo is

A Solutions Engineering take-home for **Notion**, built as a real pre-sales POC for a
fictional 1,200-person SaaS company (**Arcline Technologies**). Round 1 automated the
engineering managers' weekly EPD (Executive Product Digest) from GitHub/Jira/Slack/Figma.
The hard problem is **trust** — leadership makes resourcing decisions from this digest, so
every claim is citation-backed, human-reviewed (HITL), and eval-scored.

## Where things are

- `problem-statement.md` / `round-2-problem-statement.md` — the asks, frozen.
- `solution-intro.md` — Dan's hand-written Round 1 strategy doc.
- `prds/` — self-contained build briefs. `prds/README.md` is the **canonical status table**.
- `prds/REFERENCE-gtm-hub.md` — reusable assets from Dan's existing GTM Hub (see Round 2 below).
- `src/lib/notion-ids.ts` — canonical Notion DB/page IDs. Never hardcode IDs; import from here.
- `workers/` — `ntn` Worker sub-projects (data plumbing). `scripts/` — one-shot Node scripts.
- Plans: `~/.claude/plans/i-am-applying-for-swirling-allen.md` (Round 1),
  `~/.claude/plans/we-made-it-to-encapsulated-gosling.md` (Round 2).

## Status

- **Round 1 (PRDs 00–12):** shipped. EPD pipeline, eval harness (81% trust), teaching layer,
  submission HTML. 2 PRDs (09, 11) in final review. See `prds/README.md` for live state.
- **Round 2 (PRDs 13–20):** in progress. See below.

## Round 2 goals (current focus)

Arcline advanced to a paid pilot. A new buyer entered: the **CRO**, plus a **Director of Sales
Enablement**. The CRO controls the tooling budget and wants the commercial case, not just an
engineering productivity story. Two questions drive everything:
1. Does this help us communicate product updates to customers *faster*?
2. Can the same agentic approach help my *revenue* teams (sales enablement, release notes,
   competitive intel)?

The answer is a **parallel GTM pipeline** that extends the existing workspace:
- Reads Notion **Meeting Notes** + a simulated Salesforce **Opportunities** DB.
- Produces a **daily** GTM digest (vs the EPD's weekly cadence — sales moves faster).
- The EPD pipeline gains a **Key Releases** section that bridges into GTM: a **Release Bridge**
  flags open deals when engineering ships something they're evaluating (the CRO's "AHA" moment).
- A **Battle Card Updater** keeps competitive positioning current automatically.
- A CRO-facing **GTM Weekly** page (non-technical) is produced alongside the EPD.

PRDs 13–20 break this down. Build order: 13 (schema) → 14 (fixtures) + 17 (EPD updates) →
15, 16, 18 (workers) + 19 (presentation) → 20 (teaching). See `prds/README.md` wave table.

## Round 2 architecture rules (do not violate)

- **Agents are native Notion Custom Agents** (Feb 2026 feature) — configured in the Notion UI
  with plain-language instructions. There is **no Agent Library database** and we do **not**
  replicate the GTM Hub's Anthropic-SDK-on-Lambda pattern. Reasoning lives in Custom Agents.
- **Workers are data plumbing only** — `ntn workers` deployments that expose typed tools for
  reading/writing Notion DBs. No LLM logic in workers.
- **All workers write to the existing Agent Run Log** for observability. Do not invent a new
  observability layer.
- **Schema changes are additive** — `ntn api ... -X PATCH --notion-version 2022-06-28`. Never
  teardown the live workspace (see global CLAUDE.md). New DBs use the `GTM | X` naming convention.
- **Reuse Dan's GTM Hub domain logic** (`~/Develop/personal-website`) — agent prompts, output
  shapes, Notion field-mapping. Borrow the *domain logic*, not the architecture. Index:
  `prds/REFERENCE-gtm-hub.md`.
- **PRD-19 Part B is a practice guide for Dan**, not an implementation task. The session writes
  the walkthrough pages; Dan builds (and deletes) the candidate agents himself for the live demo.

## Working conventions

- Use the `/prd-status` skill to claim/transition PRDs; keep `prds/README.md` and each PRD's
  `<!-- status: -->` block in sync.
- Each new worker adds a `package.json` alias (`"<name>": "tsx --env-file=.env.local scripts/..."`
  and `"<name>:deploy": "pnpm --filter <pkg> deploy"`).
- Verify live before marking a PRD done — open the Notion workspace, confirm rows/pages exist.
- Wind down a build session with the `/prd-wind-down` skill (writes Implementation Notes).
