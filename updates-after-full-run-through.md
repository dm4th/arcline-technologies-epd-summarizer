# Arcline EPD — Post-Run-Through Update Log

**Date**: 2026-05-31  
**Context**: First full end-to-end demo run of the W19 pipeline. Documents what was built, what was tested, observed failure modes, and a spec for the next architectural iteration.

---

## 1. What We Built

### Scripts (the PATH A pipeline)

| Script | Purpose |
|--------|---------|
| `scripts/reset-data.ts` | Archives rows for a specific week (or all weeks) across all 9 data DBs. Scoped: never touches DB schemas, config DBs (Squads/PRDs/Roadmap), or rows from other weeks. |
| `scripts/demo-week.ts` | Setup-only runner: runs 4 source workers to ingest fixtures into Mirror DBs, seeds 18 Squad Weekly Summary placeholder rows (6 per squad × 3 squads), creates the Master EPD Weekly row. No approvals. |
| `scripts/generate-summaries.ts` | Uses `claude-sonnet-4-6` directly to generate all 12 source summaries (4 sources × 3 squads) and 3 squad consolidations. Writes to Notion via SDK. Source summary rows land as `"awaiting-review"` — no status that triggers any Notion agent. Sets `Consolidated At` on HITL Review Session pages so `approve-week.ts` can gate on content presence. |
| `scripts/approve-week.ts` | User-triggered HITL approval. Gates on `Consolidated At` being set. Flips Squad Weekly Summary rows to `"approved"` and creates the master summarizer trigger. This is the only script that fires agent-triggering status changes. |
| `scripts/generate-master.ts` | Uses `claude-sonnet-4-6` to read HITL session page bodies, synthesize a VP-level master report, and write it to the Master EPD Weekly page. Also reads VP feedback comments from the prior week's master page if present. |

### Data & Fixtures

- **24 new fixture files**: `fixtures/{github,jira,slack,figma}/{atlas,lumen,forge}/2026-W{19,20}.json` — two consecutive sprint weeks forming a narrative arc (W19 kickoff → W20 mid-sprint → W21 existing golden week).
- **2 ground truth reports**: `fixtures/ground-truth-w19.md`, `fixtures/ground-truth-w20.md` — planted tensions for eval scoring (ATLS-42 owner mismatch, Lumen auth v2 forward dep, EU replica lag untracked, Figma 429 design drift).
- **Week-aware eval harness**: `evals/run.ts` resolves `fixtures/ground-truth-{week}.md` with fallback to the original `fixtures/ground-truth-report.md` for W21.

### Agent Prompt Updates

- `agent-prompts/summarizer-master.md` — added a VP Feedback Follow-up section: agent reads comments from the prior week's master page, quotes the VP's concern, and states whether this week's data resolves/worsens/is neutral to it.

---

## 2. What We Tested

### Full Reset Cycle

```
pnpm reset-data --week=2026-W19 --dry-run
→ Would archive 116 rows (18 squad summaries, 1 master, 3 HITL sessions,
  36 agent run log entries, 21 GitHub, 21 Jira, 10 Slack, 6 Figma mirror rows)

pnpm reset-data --week=2026-W19 --yes
→ 116 rows archived cleanly. DB schemas and W20/W21 rows untouched.
```

The reset covers all 9 data DBs with three filter strategies:
- `week-of`: direct `Week Of` date property match (most DBs)
- `notes-contains`: `Notes` text contains the week string (Agent Run Log)
- `last-updated`: `Last Updated` date range covering the 7-day window (Mirror DBs)

### demo-week Run for W19

```
pnpm demo-week --week=2026-W19
→ 21 GitHub + 21 Jira + 10 Slack + 6 Figma mirror rows created (58 total)
→ 18 Squad Weekly Summary placeholder rows seeded (6 per squad × 3 squads)
→ 3 HITL Review Session pages created
→ 1 Master EPD Weekly row created
```

The seed portion ran cleanly. All row IDs were correctly linked to squad relation pages.

### generate-summaries (dry run only)

An earlier dry run confirmed correct mirror DB reads:
- Atlas: GitHub 10, Jira 11, Slack 10, Figma 3
- Lumen: GitHub 9, Jira 12, Slack 9, Figma 5
- Forge: GitHub 8, Jira 11, Slack 9, Figma 6

The live run was interrupted because Notion source summarizer agents had already fired from the `createSummarizerTrigger()` calls inside the source workers.

---

## 3. Problems That Arose

### Problem 1: Agent triggers fire immediately on worker completion

**Root cause**: `source-worker.ts` calls `createSummarizerTrigger()` at the end of every worker run. This creates a pending Agent Run Log row. Notion's Custom Agent runtime watches the Agent Run Log and fires the matching source summarizer agent the moment the row lands.

**Effect**: By the time `demo-week` finishes its four worker calls, 4 Agent Run Log trigger rows exist. Notion agents start running before any script has a chance to generate summaries, before any human has reviewed anything, and before a deliberate decision to proceed has been made.

**In the W19 demo run**: After `demo-week` completed, the Notion source summarizer agents were already running (or had already completed) their summaries. Running `generate-summaries` on top of them would create a race or overwrite valid agent output.

### Problem 2: Ghost runs waste AI credits

**Root cause**: Notion's Custom Agent runtime uses a polling model — every agent that watches the Agent Run Log checks every new trigger row to determine if it should act. Agents that aren't the target of a given trigger still spin up, read the row, evaluate it, and exit. Each of these is a billed API call.

**Effect at scale**: With 4 source workers × 3 squads = 12 trigger rows created per week, and N agents watching the log, that's O(N × 12) evaluation calls where only 12 produce actual work. In practice the squad consolidation agent, master summarizer agent, and any non-matching source agents all check and bail. This is directly observed in the Agent Run Log as entries with `Outcome: "skipped"` or short durations with no meaningful output.

### Problem 3: Auto-approve sequencing (resolved)

The original `demo-week.ts` called `approveSquadWeek()` immediately after seeding placeholder rows. This set HITL sessions to `"approved"` before any consolidation content had been written. The master summarizer ran against empty page bodies.

**Fix applied**: `demo-week.ts` now does setup only. `approve-week.ts` is a separate user-triggered script that gates on `Consolidated At` being set. `generate-summaries.ts` writes content rows as `"awaiting-review"`, never `"approved"`.

---

## 4. Proposed Architecture: Cron-Based Agent Scheduling

### Core principle shift

Move from **event-driven** (worker completion fires agents) to **schedule-driven** (agents run at predictable times regardless of trigger rows).

### Cron schedule

| Job | Schedule | What it does |
|-----|----------|-------------|
| Source workers | 6AM and 6PM daily | Ingest live data into Mirror DBs. No trigger rows created. Workers just write data. |
| Source summarizer agents (×12) | 7AM Monday | Each agent wakes, reads its Mirror DB rows for the previous week (Mon–Sun), generates its summary, writes it as `"awaiting-review"`, marks itself complete. |
| Squad consolidation polling | Starting 7AM Monday, re-checks every N minutes | Checks quorum: have all sub-summarizers for this squad completed and been signed off? If yes → runs consolidation and exits. If no → waits and re-polls. |

### Changes required

#### 1. Remove `createSummarizerTrigger()` from source workers

In `src/workers/lib/source-worker.ts`, the `createSummarizerTrigger()` call at the end of `runSourceWorker()` should be removed or gated behind a flag. Workers should write data only. Agent scheduling becomes the responsibility of the cron, not the worker.

#### 2. Source summarizer agents: week detection at runtime

Instead of being triggered by a specific Agent Run Log row that contains `weekOf`, source summarizer agents should:
1. Compute `weekOf` from the current date at the time the cron fires (previous ISO week)
2. Query their Mirror DB for rows with `Last Updated` within that week's date range
3. Proceed if rows exist, skip gracefully if none

This eliminates the trigger-row dependency entirely.

#### 3. Squad consolidation agent: quorum polling loop

Rather than running once on a trigger, the squad consolidation agent should run on a short interval (e.g., every 15 minutes on Monday morning) and:

1. Query Squad Weekly Summary rows for this squad + this week
2. Check: are all 4 source summaries (`github/jira/slack/figma`) in `"awaiting-review"` or `"approved"` status?
3. Check: have those rows been signed off by the eng manager (status = `"approved"`)?
4. If quorum reached → run consolidation, write to HITL Review Session, exit the polling loop
5. If quorum not reached → log status, exit, and wait for next scheduled check

The quorum gate already exists via the `Sub-Summary Approval Rate` rollup on HITL Review Sessions. The change is that the agent polls for it on a schedule rather than being woken by a trigger.

#### 4. Completion linking

When a source summarizer agent completes its summary, it should:
1. Set `Status: "awaiting-review"` on its Squad Weekly Summary row (already done)
2. Update an `Assigned To` or `Completed By` field linking to the squad-level HITL Review Session (so the session page shows which sub-summaries are done and which are pending)

This gives the eng manager visibility into partial completion — they can see in the HITL Review Session which of the 4 source summaries are ready and which are still running, without having to query the Squad Weekly Summary DB separately.

#### 5. VP feedback timing

With cron-based scheduling, VP feedback is no longer injected via `approve-week.ts --vp-feedback`. Instead:
- The VP reviews the prior week's master report and adds a Notion comment at any point during the week
- The master summarizer agent (or `generate-master.ts`) already reads comments from the prior week's page — this part of the architecture is unchanged

### What this looks like end-to-end (new flow)

```
Mon–Sun (6AM, 6PM)
  Workers run silently: ingest live data → Mirror DBs
  No triggers, no agents, no notifications.

Monday 7AM
  Cron fires source summarizer agents (×12)
  Each agent reads its Mirror DB rows for last week
  Each writes its squad summary as "awaiting-review"
  Each posts an @mention to the eng manager in the HITL Review Session
    (e.g., "@sarah-chen Atlas GitHub summary is ready for review")

Monday 7AM → ongoing
  Squad consolidation agents poll every 15 minutes:
    "Have all 4 source summaries for my squad been approved?"
  Eng managers review squad summaries and flip to "approved" in Notion UI
  Once all 4 approved → squad consolidation agent runs once, exits

After all 3 squads consolidated
  VP or SE reviews HITL Review Sessions
  Runs: pnpm approve-week --week=YYYY-Www
  Master summarizer runs (agent or generate-master.ts)
  pnpm eval --week=YYYY-Www
```

### What stays the same

- All Notion DB schemas — no schema changes needed
- The `approve-week.ts` user-triggered approval script — HITL approval remains a human step
- The `generate-master.ts` and `generate-summaries.ts` scripts — PATH A (fully automated) stays intact for demos and backfill
- The eval harness — unchanged
- The VP feedback reading from prior week's master comments — unchanged

---

## 5. Open Questions

1. **Cron platform**: Where do the worker and agent crons live? Notion doesn't have native cron for Custom Agents. Options: (a) a simple external cron (GitHub Actions, Vercel cron, macOS launchd for demo) that calls `pnpm workers --week=...` on schedule, and Notion agent crons configured in the Custom Agent settings UI; (b) Notion's own scheduled agent trigger if/when that feature ships.

2. **Quorum polling interval**: 15 minutes is proposed, but what's the right number? Too frequent = wasted credits; too infrequent = slow consolidation. Could alternatively be a webhook/event-driven check only when a summary status changes.

3. **Completion linking field**: What property on HITL Review Sessions best represents "which sub-summaries are done"? The `Sub-Summary Approval Rate` rollup already tracks this numerically. An additional `Pending Sources` text field written by each summarizer agent as it completes could give human-readable status.

4. **`createSummarizerTrigger()` removal**: Removing it from `source-worker.ts` is a breaking change for any PATH B demo that relies on trigger-based agent firing today. A `--no-triggers` flag on workers could gate the behavior during a transition period.
