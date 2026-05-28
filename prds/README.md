# PRDs — Notion SE Take-Home

This directory is the **work-breakdown** for the Arcline EPD Weekly Digest POC. Each numbered file is a self-contained brief that a fresh Claude session (or human) can pick up and execute.

Background context lives in (read these first if you're new):
- `../problem-statement.md` — Arcline's ask, frozen.
- `../solution-intro.md` — Dan's first-pass narrative, frozen. Superseded by these PRDs where they conflict.
- `~/.claude/plans/i-am-applying-for-swirling-allen.md` — the master plan that produced this directory, including critique of `solution-intro.md`.

## Locked decisions (do not relitigate without checking with Dan)
- Build scope: all 4 data sources (GitHub, Jira, Slack, Figma).
- Data: mocked JSON fixtures, committed.
- Squads simulated: **3** (not the prompt's 8).
- Notion tier: Workers + Custom Agents available.
- HITL: per-squad consolidated review → 3 approvals/week → master.
- Submission: single HTML, layered hook (backtest accuracy → live-trigger video → teaching workspace).
- Eval is its own PRD (PRD-08).

## Dependency graph

```
00 ─► 01 ─┬─► 03a/b/c/d ─► 04a ─┐
          │                    ├─► 05 ─► 09
          ├─► 02 ──────────────┘
          ├─► 04b ──────────────┘
          ├─► 06 ───────────────┘
          ├─► 07
          ├─► 08 ───────────────► 09
          ├─► 10
          └─► 11 (fully independent)
```

## Recommended parallel waves
| Wave | PRDs in parallel | Unblocks |
|---|---|---|
| A | 01, 02, 11 | data plane, interview prep |
| B | 03a, 03b, 03c, 03d, 06, 07, 10 | reasoning plane |
| C | 04a, 04b, 08 | synthesis, eval |
| D | 05 | submission |
| E | 09 | done |

## Conventions
- Every PRD follows `_template.md` exactly, including the `<!-- status: ... -->` block immediately under the title.
- "Dependencies" lists PRD filenames; a session is ready when all listed PRDs are marked `completed` in this README's status table.
- Notion DB and page IDs produced by a PRD must be written back into that PRD's "Outputs" section so downstream PRDs can reference them.
- No PRD should introduce a new top-level concept (DB, agent, page type) without updating PRD-01 (schema) first.
- **Lifecycle**: PRD state transitions follow `SOP.md`. Use `/prd-status` to make and audit transitions; manual edits are allowed but must update both this table and the PRD file's status block in sync.

## Status (canonical source of truth — keep in sync with each PRD's `<!-- status: ... -->` block)

States: `waiting`, `ready`, `in-progress`, `in-review`, `completed`, `blocked`. See `SOP.md` for the full state machine.

| PRD | State | Owner | Updated | Notes |
|---|---|---|---|---|
| 00 | ready | — | — | no deps; blocks everything |
| 01 | waiting | — | — | deps: 00 |
| 02 | waiting | — | — | deps: 00 |
| 03a | waiting | — | — | deps: 00, 01, 02, 03 |
| 03b | waiting | — | — | deps: 00, 01, 02, 03 |
| 03c | waiting | — | — | deps: 00, 01, 02, 03 |
| 03d | waiting | — | — | deps: 00, 01, 02, 03 |
| 04a | waiting | — | — | deps: 00, 01, 03a, 03b, 03c, 03d |
| 04b | waiting | — | — | deps: 00, 01, 04a |
| 05 | waiting | — | — | deps: 00, 01, 04a, 04b, 06 |
| 06 | waiting | — | — | deps: 00, 01 |
| 07 | waiting | — | — | deps: 01 |
| 08 | waiting | — | — | deps: 02, 04a, 04b, 05 |
| 09 | waiting | — | — | deps: 05, 08, 10 |
| 10 | waiting | — | — | deps: 01 |
| 11 | ready | — | — | no deps |
