# Arcline Technologies — EPD Weekly Digest Automation

A worked Solutions Engineering take-home for **Notion**, designed and built as if it were a real pre-sales POC for a fictional 1,200-person SaaS company.

The fictional customer (Arcline Technologies) wants to replace their engineering managers' 3–4 hour Monday-morning ritual of stitching together a weekly EPD digest from Jira, GitHub, Slack, and Figma. The hard part isn't summarization — it's *trust*. Leadership makes resourcing decisions from this digest. Hallucinations are a real problem.

This repo is the work behind a single-file `submission.html` artifact. The submission itself is a candidate-voice resume artifact; the rest of this repo is written in the voice of a Notion SE working with the customer.

> **Round 2 is underway.** Round 1 (the EPD pipeline) shipped and earned a paid pilot. A new buyer — Arcline's **CRO**, plus a **Director of Sales Enablement** — now wants the commercial case: can the same agentic approach drive *revenue* outcomes? Round 2 extends the workspace with a parallel **GTM pipeline**. See the [Round 2](#round-2--gtm-pipeline) section below.

---

## How to navigate this repo

If you have 30 seconds: read this file and `submission.html` (when built).

If you have 5 minutes:
1. **`problem-statement.md`** / **`round-2-problem-statement.md`** — the prompts as given. Frozen.
2. **`solution-intro.md`** — my hand-written first-pass solution (5 questions, V1 agentic workflow, risks, 30-day POC plan).
3. **`prds/README.md`** — the staged build plan with dependency graph and canonical status table (Round 1 PRDs 00–12, Round 2 PRDs 13–20).
4. **`prds/REFERENCE-gtm-hub.md`** — reusable assets from my existing AI-Native GTM Hub that Round 2 builds on.

If you have 30 minutes: read any individual PRD in `prds/` end-to-end — they're self-contained briefs.

If you have all day: the Notion workspace itself (link will live in `submission.html`) is the demo.

---

## What's in here

| Path | What it is |
|---|---|
| `problem-statement.md` | The Round 1 Notion SE technical screen prompt. |
| `round-2-problem-statement.md` | The Round 2 prompt — CRO + Sales Enablement stakeholders, the GTM revenue case. |
| `CLAUDE.md` | Project guide for Claude sessions — Round 2 goals, architecture rules, working conventions. |
| `solution-intro.md` | Hand-written solution doc. The 5 questions, V1 workflow, risks, and 30-day plan in my own thinking. |
| `perplexity-review.md` | Research conversation used to ground `solution-intro.md`. Strategy authoring was hand-written; research was AI-assisted. |
| `prds/` | 25 self-contained PRDs (00–12 Round 1, 13–20 Round 2) + lifecycle SOP + status table. Each PRD is one parallel build session. |
| `prds/REFERENCE-gtm-hub.md` | Index of reusable assets from my AI-Native GTM Hub that Round 2 borrows (prompts, output types, field-mapping). |
| `prds/SOP.md` | PRD lifecycle (waiting → ready → in-progress → in-review → completed). State machine and wave-checkpoint procedure. |
| `prds/README.md` | Canonical build status table. Source of truth for "what's left." |
| `.env.local.example` | Template for `NOTION_API_KEY` and `BASE_NOTION_PAGE`. |
| `src/lib/` | Shared library code — Notion SDK client factory (`notion.ts`), env validation (`env.ts`). |
| `src/types/core.ts` | Canonical TypeScript types: `SourceRecord`, `SquadSummary`, `MasterSummary`, `AgentRun`, `ApprovalState`. |
| `scripts/` | One-shot Node scripts. `probe-workspace.ts` verifies API access and prints the page tree. |
| `workers/` | Notion Worker sub-projects. `hello/` is the proof-of-concept; data-source workers land in Wave B. |
| *(future)* `fixtures/`, `evals/`, `assets/`, `submission.html` | Created as PRDs land. |

---

## Build status

The canonical status table — per-PRD state, owner, notes — lives in **[`prds/README.md`](./prds/README.md)**. This section is a rollup view.

### Round 1 (PRDs 00–12) — shipped ✅

The full EPD pipeline landed: 11-database Notion workspace, four data-source workers, source/product/master summarizers with citation chains, HITL squad approval, observability dashboard, eval harness (**81% trust score**), 11-page teaching layer, and a single-file `submission.html`. PRDs 09 and 11 are in final review; the rest are completed. This earned the paid pilot that triggered Round 2.

### Round 2 (PRDs 13–20) — in progress 🔨

The GTM pipeline extension. See the [Round 2 section](#round-2--gtm-pipeline) for scope and the wave plan.

### Tracking

Use `/prd-status` from within Claude Code for an interactive picker that reads current state and offers the next-best action (claim a ready PRD, review an in-review PRD, etc.). See `prds/SOP.md` for the manual procedure if the skill isn't available.

---

## Round 2 — GTM pipeline

Round 1 proved the engineering value. Round 2 makes the **commercial** case for Arcline's CRO, who controls the tooling budget and asked two questions:

1. Does this improve our ability to **communicate product updates to customers faster**?
2. Can the same agentic approach help my **revenue teams** — sales enablement, release notes, competitive intel?

The answer is a parallel **GTM pipeline** that extends the existing workspace rather than replacing anything:

- **Daily GTM digest** from Notion Meeting Notes + a simulated Salesforce **Opportunities** DB — surfaces at-risk deals and competitor mentions every morning (sales moves faster than a sprint).
- **Release Bridge** — when engineering ships something, it flags the open deals evaluating that product so reps can reach out *the same day*. This is the CRO's "AHA" moment.
- **GTM Weekly** — a non-technical, CRO-facing weekly brief produced alongside the EPD (no ticket numbers, just customer impact).
- **Battle Card Updater** — keeps competitive positioning current automatically as features ship.
- **Presentation deck + candidate agents** — a Notion-native pitch surface and four ready-to-demo GTM agents.

**Architecture stays consistent with Round 1:** native **Notion Custom Agents** for reasoning + **`ntn` Workers** for data plumbing, all logging to the same Agent Run Log. It deliberately reuses domain logic from my existing **AI-Native GTM Hub** (see `prds/REFERENCE-gtm-hub.md`).

### Round 2 wave plan

| Wave | PRDs in parallel | Builds |
|---|---|---|
| R2-A | 13 | GTM schema (4 new DBs + Key Releases / GTM Highlights patches) |
| R2-B | 14, 17 | GTM fixtures + EPD pipeline updates (Key Releases, GTM Weekly page) |
| R2-C | 15, 16, 18, 19 | GTM workers (daily digest, release bridge, battle cards) + presentation deck |
| R2-D | 20 | Teaching layer (GTM explainers + Day-2 Operations guide) |

Full briefs in `prds/13` through `prds/20`. Read `CLAUDE.md` and `prds/REFERENCE-gtm-hub.md` before building any of them.

---

## How this was built

A four-step process, also documented in PRD-09 §11b for inclusion in `submission.html`:

1. **Read the prompt + Perplexity research pass** — grounding, not authoring.
2. **Hand-wrote `solution-intro.md`** — the strategy doc, no AI authoring.
3. **One Opus planning session** expanded the solution into 17 self-contained PRDs with an explicit dependency graph for parallelization.
4. **Parallel Sonnet sessions** execute individual PRDs in dependency waves; an **Opus review session** gates each wave before the next begins.

The repo's git log mirrors this split: scaffolding (commit 1) → PRDs (commit 2) → per-wave commits as they land.

---

## Quickstart

> **New contributor? Follow these 5 steps — you'll be running in under 5 minutes.**

**1. Clone and install**

```bash
git clone <this-repo>
cd notion-solutions-eng-submission
pnpm install          # installs root + all workers/* workspace packages
```

**2. Create your `.env.local`**

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in:

```
NOTION_API_KEY="ntn_..."       # your Notion integration token
BASE_NOTION_PAGE="https://www.notion.so/your-workspace/Page-title-abc123"
```

> Get a token at **notion.so → Settings → Connections → Develop or manage integrations**.

**3. Share the root page with your integration**

Open `BASE_NOTION_PAGE` in Notion → click **Share** → invite your integration by name. Without this step, the API returns `object_not_found`.

**4. Verify API access**

```bash
pnpm probe
```

You should see a page title and a child-block tree. If you see `⚠ Integration does not have access`, re-check step 3.

**5. (Optional) Deploy the hello Worker**

```bash
ntn login                           # one-time: authenticates ntn CLI
cd workers/hello
NOTION_API_TOKEN=$NOTION_API_KEY \
  ntn workers deploy --name hello   # first deploy; omit --name on updates
```

Confirm with: `ntn workers list`

---

## How to add a Worker

1. `mkdir workers/<name> && cd workers/<name>`
2. Copy `workers/hello/package.json` and `workers/hello/tsconfig.json`; rename the package.
3. Create `src/index.ts` — import `Worker` from `@notionhq/workers`, export `default new Worker()`, register your tools.
4. Run `pnpm install` from the repo root (pnpm workspace picks up new members automatically).
5. Deploy: `cd workers/<name> && ntn workers deploy --name <name>`

See the data-source worker PRDs (03a–03d) for the full pattern including sync capabilities and squad-scoped filtering.

---

## License & context

This is a job-application artifact, not a product. The customer (Arcline Technologies) is fictional; the data is mocked; the workspace is a sandbox under a real Notion account. The intent is to demonstrate Solutions Engineering thinking, not to ship software.
