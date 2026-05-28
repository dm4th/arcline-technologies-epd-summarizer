# PRD Lifecycle SOP

The canonical procedure for moving a PRD through its states. Read once; the `/prd-status` skill automates it.

## States

| State | Meaning | Who sets it |
|---|---|---|
| `waiting` | One or more dependency PRDs are not yet `completed`. Default for every new PRD. | Auto (initial) |
| `ready` | All dependencies are `completed`. No session has claimed it. | Auto (when last dep flips to `completed`) |
| `in-progress` | A session has claimed and is building it. | The implementing session, on claim. |
| `in-review` | Implementation is finished. Awaiting an Opus review checkpoint. | The implementing session, on finish. |
| `completed` | Reviewed and accepted. Downstream PRDs may unblock. | The reviewing Opus session, on approval. |
| `blocked` | An unresolved `[BLOCKER]` open question prevents progress. | Any session, with a one-line reason. |

## State machine

```
waiting ──(deps met)──► ready ──(claim)──► in-progress ──(finish)──► in-review
                                                                     │  │
                                                                     │  └─(approve)─► completed
                                                                     └─(changes requested)─► in-progress
any state ──(blocker hit)──► blocked ──(blocker resolved)──► (prior state)
```

## Where state lives

State has **two synchronized homes**. The skill keeps them in sync; manual editors must update both.

1. **`prds/README.md` status table** — the at-a-glance orchestration view. Single row per PRD with state, owner session id, last-updated timestamp, notes.
2. **Each PRD file's `Status` frontmatter block** — so a session reading only the PRD knows where it stands. Block format:
   ```markdown
   <!-- status:
   state: in-progress
   owner: sonnet-session-2026-05-28-14:02
   updated: 2026-05-28T14:02:00Z
   notes: claimed for Wave B build
   -->
   ```
   Placed immediately under the H1 title. The HTML-comment form keeps it invisible in rendered markdown.

## Transition rules

- **Claim** (`ready → in-progress`): session writes its own short id as `owner` and a one-line `notes`. If two sessions race, the second sees `in-progress` and bails.
- **Finish** (`in-progress → in-review`): session sets state, leaves `owner` as itself, adds a one-line `notes` summarizing what landed and where the verification artifacts live.
- **Approve** (`in-review → completed`): Opus review session only. On approval, the skill recomputes `waiting` rows whose dependencies are now satisfied and flips them to `ready`.
- **Request changes** (`in-review → in-progress`): Opus review session sets state back and appends a `notes` line describing what's needed. Original implementing session resumes if available; otherwise next session can claim.
- **Block** (`* → blocked`): any session sets state with a `notes` line beginning `BLOCKER:` and the reason. The prior state is preserved in `notes` as `previous: <state>` so the skill can restore it on unblock.
- **Unblock** (`blocked → previous state`): whoever resolved it; the skill reads `previous:` from notes.

## Wave checkpoint (the human gate)

After each parallel wave, Dan runs `/prd-status` (interactive) — the skill detects the `in-review` backlog and surfaces "Review in-review PRDs" as the recommended action, then lets him pick which to start with via a picker ranked by time-in-review. The selected PRD is reviewed by Opus, which then calls `approve` or `request-changes`. Only after the whole wave is `completed` does the next wave start.

Power-user shortcut: `/prd-status review` skips the picker and lists all in-review rows directly.

This is the Opus-as-gate / Sonnet-as-lanes pattern described in PRD-09 §11b ("How I built this") — the SOP is what makes that pattern enforceable instead of aspirational.

## Edge cases

- **A PRD has no dependencies (e.g., PRD-11)**: initial state is `ready`, not `waiting`.
- **A PRD's dependencies change mid-build** (rare; PRD edits): the skill recomputes the affected row's state. If it regresses (e.g., a dep was un-completed), the affected PRD goes back to `waiting` and a warning is surfaced.
- **Multiple sessions hold the same PRD**: the skill refuses the second claim. Resolve by hand if a session crashed without releasing — set the row back to `ready` via `/prd-status release <prd>`.
- **A PRD is split or merged**: do it explicitly via README edits + SOP-compliant state moves. Don't silently retitle.

## Manual cheat sheet (no skill)

If the skill is unavailable, the same SOP works by hand:

1. Pick a PRD whose deps are all `completed` in the README table.
2. Edit the README row: state → `in-progress`, owner → your session id, updated → now.
3. Edit the PRD file's status block to match.
4. Build it.
5. When done: state → `in-review` in both places, write a one-line summary in `notes`.
6. Tell Dan or kick off an Opus review session.
