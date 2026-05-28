# Arcline Technologies — EPD Weekly Digest Automation

A worked Solutions Engineering take-home for **Notion**, designed and built as if it were a real pre-sales POC for a fictional 1,200-person SaaS company.

The fictional customer (Arcline Technologies) wants to replace their engineering managers' 3–4 hour Monday-morning ritual of stitching together a weekly EPD digest from Jira, GitHub, Slack, and Figma. The hard part isn't summarization — it's *trust*. Leadership makes resourcing decisions from this digest. Hallucinations are a real problem.

This repo is the work behind a single-file `submission.html` artifact. The submission itself is a candidate-voice resume artifact; the rest of this repo is written in the voice of a Notion SE working with the customer.

---

## How to navigate this repo

If you have 30 seconds: read this file and `submission.html` (when built).

If you have 5 minutes:
1. **`problem-statement.md`** — the prompt as given. Frozen.
2. **`solution-intro.md`** — my hand-written first-pass solution (5 questions, V1 agentic workflow, risks, 30-day POC plan).
3. **`prds/README.md`** — the staged build plan with dependency graph and canonical status table.

If you have 30 minutes: read any individual PRD in `prds/` end-to-end — they're self-contained briefs.

If you have all day: the Notion workspace itself (link will live in `submission.html`) is the demo.

---

## What's in here

| Path | What it is |
|---|---|
| `problem-statement.md` | The Notion SE technical screen prompt. |
| `solution-intro.md` | Hand-written solution doc. The 5 questions, V1 workflow, risks, and 30-day plan in my own thinking. |
| `perplexity-review.md` | Research conversation used to ground `solution-intro.md`. Strategy authoring was hand-written; research was AI-assisted. |
| `prds/` | 17 self-contained PRDs + lifecycle SOP + status table. Each PRD is one parallel build session. |
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

The actual canonical status table — per-PRD state, owner, notes — lives in **[`prds/README.md`](./prds/README.md)**. This section is a rollup view.

### Progress

| Tier | PRDs | Status |
|---|---|---|
| **Tier 0** — Foundations | 00 | 🔨 In-progress (Wave A) |
| **Tier 1** — Independent foundations | 01, 02, 11 | ⏳ 11 ready; 01, 02 waiting on 00 |
| **Tier 2** — Data plane (workers) | 03a, 03b, 03c, 03d | ⏸ Waiting on Tier 1 |
| **Tier 3** — Reasoning plane | 04a, 04b, 06 | ⏸ Waiting on Tier 2 |
| **Tier 4** — Synthesis | 05 | ⏸ Waiting on Tier 3 |
| **Tier 5** — Cross-cutting | 07, 08, 10 | ⏸ Waiting on Tier 1+ |
| **Tier 6** — Submission | 09 | ⏸ Waiting on 05 + 08 + 10 |

Completion: **0 / 17** PRDs landed.

### Recommended parallel waves

| Wave | PRDs in parallel | Unblocks |
|---|---|---|
| A | 01, 02, 11 | data plane, interview prep |
| B | 03a, 03b, 03c, 03d, 06, 07, 10 | reasoning plane |
| C | 04a, 04b, 08 | synthesis, eval |
| D | 05 | submission |
| E | 09 | done |

### What's next

1. **Wave A kickoff** — PRD-00 (Foundations) must land first to seed `src/lib/notion-ids.ts`. Then 01, 02, 11 can run in parallel.
2. **First Opus review checkpoint** — after 01 and 02 reach `in-review`, before unblocking Wave B.

### Tracking

Use `/prd-status` from within Claude Code for an interactive picker that reads current state and offers the next-best action (claim a ready PRD, review an in-review PRD, etc.). See `prds/SOP.md` for the manual procedure if the skill isn't available.

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
