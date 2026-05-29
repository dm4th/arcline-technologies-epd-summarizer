# Fixtures — Week of 2026-W21 (May 19–24, 2026)

Mock data representing one week of engineering activity across three squads: **Atlas** (platform/billing), **Lumen** (frontend), and **Forge** (mobile/iOS).

## File layout

```
fixtures/
  <source>/
    <squad>/
      2026-W21.json     ← array of SourceRecord
  schemas/
    github.json         ← JSON Schema for GitHub fixture files
    jira.json           ← JSON Schema for Jira fixture files
    slack.json          ← JSON Schema for Slack fixture files
    figma.json          ← JSON Schema for Figma fixture files
  README.md             ← this file
  ground-truth-report.md ← hand-authored "perfect VP report" for eval (PRD-08)
```

All fixture files follow the `SourceRecord` contract from `src/types/core.ts`:

| Field | Type | Notes |
|---|---|---|
| `sourceId` | string | Stable ID in the source system |
| `source` | `"github" \| "jira" \| "slack" \| "figma"` | |
| `squadId` | `"atlas" \| "lumen" \| "forge"` | |
| `title` | string | |
| `url` | string (URI) | |
| `lastUpdated` | string (ISO 8601) | |
| `raw` | object | Source-specific payload; shape validated by `fixtures/schemas/<source>.json` |
| `summary` | string? | Optional; not populated in fixtures (workers generate this) |

## Record counts

| Source | Atlas | Lumen | Forge | Total |
|---|---|---|---|---|
| GitHub | 10 | 9 | 8 | 27 |
| Jira | 11 | 12 | 11 | 34 |
| Slack | 6 | 6 | 6 | 18 |
| Figma | 3 | 3 | 4 | 10 |
| **Total** | **30** | **30** | **29** | **89** |

## Planted tensions

These contradictions are deliberately embedded in the fixture data. They are *not* annotated in the JSON — the AI agents are expected to surface them from the raw content. The ground-truth report (`ground-truth-report.md`) names each tension and its expected resolution.

---

### Tension 1 — PR closes ticket; Jira still shows "In Progress" (Atlas)

**Type:** Cross-source factual conflict  
**Demo moment:** The PRD Fact Checker / source summarizer should flag that a merged GitHub PR says it closes a Jira ticket that remains in a non-terminal state.

**Records involved:**
- `fixtures/github/atlas/2026-W21.json` → `atlas-pr-051`  
  PR title: *"Complete billing API refactor — ATLS-42"*  
  PR body: *"Closes ATLS-42. … Fully deployed to staging; load tests passing."*  
  State: `merged`
- `fixtures/jira/atlas/2026-W21.json` → `ATLS-42`  
  Status: `"In Progress"` (not updated after PR merge)

**Expected agent behaviour:** Flag ATLS-42 as a potential stale-status ticket. Recommend a human verify whether the ticket should be marked Done. Do *not* assert it is done — only that the PR and Jira state are inconsistent.

**Supporting signal (Slack):** `atlas-slack-C01-006` — alex-kumar notices the discrepancy in the Friday standup thread: *"ATLS-42: Jordan merged the PR Friday … but I see the Jira ticket is still showing In Progress."*

---

### Tension 2 — Blocker discussed in Slack; no Jira ticket filed (Lumen)

**Type:** Signal present in one source only  
**Demo moment:** The PRD Fact Checker should notice that a multi-day engineering blocker (auth service OOM causing 503s) was discussed at length in Slack and directly blocked LMNE-25 delivery, but was never captured in Jira as a blocking issue or incident ticket.

**Records involved:**
- `fixtures/slack/lumen/2026-W21.json` → `lumen-slack-C02-002`  
  Thread: *"Auth service flaky — blocking e2e tests and staging deploys"*  
  7 messages over the thread. priya-nair diagnoses an OOM issue. dev-okonkwo explicitly asks for a ticket. priya-nair says *"Will do after standup."*
- `fixtures/jira/lumen/2026-W21.json` → `LMNE-28`  
  Title: *"Investigate intermittent auth service 503s in CI"*  
  Status: `"To Do"` (sprint not assigned) — created late, not linked as a blocker on LMNE-25.
- `fixtures/jira/lumen/2026-W21.json` → `LMNE-25`  
  Title: *"Add Playwright e2e tests for auth flow"*  
  Status: `"In Progress"` — no blocker link to the auth service incident.

**Expected agent behaviour:** Surface that LMNE-25 was blocked by an infrastructure incident that has no formal Jira blocker link, and that the incident ticket (LMNE-28) was filed late and is still unscheduled. Flag as a process gap — blockers should be tickets.

**Supporting signal (Slack):** `lumen-slack-C02-006` (sprint summary) explicitly notes: *"LMNE-25 was blocked by auth service OOM (Slack thread from Wednesday) — no Jira ticket was filed for that incident despite the ask."*

---

### Tension 3 — Figma comment reverses a shipped engineering decision (Forge)

**Type:** Design drift / decision conflict  
**Demo moment:** The roadmap summarizer and PRD Fact Checker should flag that the squad's design lead has proposed (via Figma comment) a navigation architecture change that directly contradicts a decision made in sprint planning, documented in the squad PRD, and already implemented in a shipped PR.

**Records involved:**
- `fixtures/figma/forge/2026-W21.json` → `forge-figma-MobileNavV2`  
  Figma comment from `yuki-designer` (2026-05-21T17:30:00Z):  
  *"Following the exec UX review on Monday, we are pivoting away from the tab bar to a gesture-based navigation model … This reverses the tab bar decision from sprint planning … I know FORGE-30 just shipped — flagging this as a priority rework for Sprint 10."*
- `fixtures/github/forge/2026-W21.json` → `forge-pr-022`  
  PR title: *"Implement tab bar navigation structure"*  
  State: `merged`. Linked Jira: `FORGE-30`. Body: *"…per the navigation architecture agreed in sprint planning."*
- `fixtures/jira/forge/2026-W21.json` → `FORGE-30`  
  Status: `"Done"` — tab bar implementation completed this week.

**Expected agent behaviour:** Flag the design-vs-implementation conflict. Note that FORGE-30 was closed as Done based on sprint planning agreement, but the Figma file now specifies a different architecture. Identify downstream blast radius: FORGE-36 (deep links) and FORGE-26 (routing) are both built on the current nav structure and may need rework.

**Supporting signal:** `forge-slack-C03-002` (Slack) and `forge-figma-OfflineModeUX` (Figma comment from carlos-mendez) both reference the uncertainty. FORGE-38 ("Redesign navigation architecture") is in Jira as `To Do`.

---

### Tension 4 — Stale data: record not updated in 3+ days (Atlas)

**Type:** Data freshness signal  
**Demo moment:** The source summarizer should call out records that haven't been updated in several days, which may indicate forgotten work or a stale Jira board.

**Records involved:**
- `fixtures/jira/atlas/2026-W21.json` → `ATLS-42`  
  `lastUpdated: "2026-05-21T09:00:00Z"` — 3 days before end of W21 (May 24).  
  Status remains `"In Progress"` despite the related PR merging on May 22 (see Tension 1).
- `fixtures/github/forge/2026-W21.json` → `forge-pr-025`  
  `lastUpdated: "2026-05-21T07:30:00Z"` — noted in PR body as *"a 3-day-old regression from the grid layout refactor."* Already merged, but the staleness annotation is explicit.

**Expected agent behaviour:** Include in the data-freshness summary. The ATLS-42 staleness is especially significant because it compounds Tension 1 (merged PR + stale ticket = double signal).

---

### Tension 5 — Cross-squad dependency: Atlas ships code that depends on Lumen's v2 API (Atlas ↔ Lumen)

**Type:** Cross-squad dependency / coordination signal  
**Demo moment:** The master summarizer should surface the Atlas ↔ Lumen coupling and confirm it was coordinated — or flag it if it wasn't.

**Records involved:**
- `fixtures/github/atlas/2026-W21.json` → `atlas-pr-049`  
  PR title: *"Migrate auth tokens to Lumen /api/auth/tokens/v2"*  
  PR body explicitly states: *"Depends on Lumen deploying their auth-tokens-v2 branch to prod — confirmed deployed as of 2026-05-18."*
- `fixtures/github/lumen/2026-W21.json` → `lumen-pr-031`  
  PR title: *"Release auth tokens v2 endpoint"*  
  Merged: 2026-05-19. Body: *"Atlas team has been notified and is migrating."*
- `fixtures/slack/atlas/2026-W21.json` → `atlas-slack-C01-005`  
  Cross-team coordination thread confirming migration and discussing token payload changes.
- `fixtures/jira/lumen/2026-W21.json` → `LMNE-22`, `fixtures/jira/atlas/2026-W21.json` → `ATLS-55`  
  Both tickets closed as Done, confirming the dependency was managed.

**Expected agent behaviour:** Surface the dependency in the master summary as a positive coordination example — two squads shipped a breaking API change and consumer migration in the same week with no incidents. Also note the `scopes` field addition in v2 tokens as a detail Atlas needs to handle correctly in premium tier gating.

---

## Naming conventions

- Fixture file paths: `fixtures/<source>/<squad>/<week>.json`
- Week identifier: ISO week number, e.g. `2026-W21`
- Source IDs follow per-source conventions:
  - GitHub: `<squad>-pr-<NNN>` (e.g. `atlas-pr-048`)
  - Jira: Jira ticket key (e.g. `ATLS-42`)
  - Slack: `<squad>-slack-<channel-code>-<NNN>` (e.g. `lumen-slack-C02-001`)
  - Figma: `<squad>-figma-<CamelCaseName>` (e.g. `forge-figma-MobileNavV2`)
