# Ground Truth — EPD Weekly Digest, Week of 2026-W21

> **Purpose:** This document is the hand-authored "perfect VP report" for the W21 fixture week.
> It is the evaluation target for PRD-08. A generated master summary scores well if it surfaces
> the same key findings, citations, and recommendations. It is NOT a template — it is a benchmark.
>
> Scoring guidance for PRD-08:
> - **Must surface** (blocking for passing): all 5 tensions explicitly called out.
> - **Should surface** (high-quality signal): the positive coordination story (Tension 5), sprint completion rates.
> - **May surface** (bonus): team health observations, follow-up recommendations.

---

## EPD Weekly Digest — Week of May 19, 2026

**Prepared for:** VP Engineering  
**Coverage:** Atlas (platform/billing) · Lumen (frontend) · Forge (mobile)  
**Data sources:** GitHub PRs, Jira tickets, Slack threads, Figma comments  
**Week:** 2026-W21 (May 19–24)

---

### Executive Summary

Strong delivery week across all three squads. Atlas shipped its billing API refactor and completed the Lumen auth token v2 migration — a clean cross-team dependency handoff. Lumen closed 6 tickets and shipped auth tokens v2 to production. Forge completed the iOS widget, a memory fix, and a crash fix.

**Three items require VP attention this week:**

1. **[ACTION REQUIRED] Forge navigation architecture conflict** — A Figma comment from the design lead reverses the tab bar navigation decision that was agreed in sprint planning and already shipped. Engineering has paused downstream work (deep links, routing) pending resolution. Recommend a sync between design lead and EM within 48 hours to protect Sprint 10 planning.

2. **[PROCESS GAP] Lumen auth service blocker went untracked** — A 24+ hour auth service outage blocked LMNE-25 delivery and was resolved entirely via Slack, with no Jira ticket filed despite an explicit request. The belated ticket (LMNE-28) remains unscheduled. Recommend formalizing a team norm: incidents blocking delivery for >2 hours require a ticket.

3. **[DATA QUALITY] Atlas billing refactor ticket stale** — GitHub PR #51 ("Closes ATLS-42") merged on May 22, but Jira ticket ATLS-42 remains "In Progress" as of end of week. Status mismatches reduce trust in the Jira board and will cause the eval harness to flag drift. Recommend updating ATLS-42 to Done.

---

### Atlas — Platform / Billing

**Sprint 14 velocity:** 7 tickets closed (ATLS-38, ATLS-41, ATLS-42-pending, ATLS-29, ATLS-55, ATLS-57, ATLS-58). 3 in flight (ATLS-44, ATLS-47, ATLS-56).

**Highlights:**
- Billing API refactor (ATLS-42) merged — PR #51 represents a significant architectural change (CQRS split, 634 additions, 418 deletions) that was load-tested at 5x peak in staging. High-quality delivery.
- Legacy /billing/v1 endpoints removed (ATLS-29) — 287 lines deleted. Zero callers confirmed via Datadog trace analysis before removal. Clean deprecation cycle.
- Lumen auth token v2 migration completed (ATLS-55, PR #49) — Atlas was a dependent consumer of Lumen's new endpoint and migrated in the same week it shipped. Notably smooth cross-team coordination.
- EU billing latency spike (ATLS-58) — 18-minute P99 breach in eu-west-1 caused by replica lag after the v1 endpoint removal deploy. Self-diagnosed and resolved same day. Post-mortem recommended.

**⚠️ Flag — Tension 1:** GitHub PR #51 body reads "Closes ATLS-42" and was merged on May 22. As of end of week, ATLS-42 in Jira still shows status "In Progress." This is a cross-source inconsistency — either the ticket was not updated post-merge or the closure claim in the PR body is premature. The Friday standup Slack thread (`#atlas-eng`, May 24) confirms the team is aware: alex-kumar flagged it. **Recommend: update ATLS-42 to Done.**

---

### Lumen — Frontend

**Sprint 12 velocity:** 6 tickets closed (LMNE-17, LMNE-18, LMNE-19, LMNE-20, LMNE-21, LMNE-22). 3 in flight (LMNE-24, LMNE-25, LMNE-26).

**Highlights:**
- Auth tokens v2 shipped to production on Monday (LMNE-22, PR #31) — introducing `tenantId` and `scopes` fields in the token payload. v1 deprecated with a June 15 sunset. Atlas migrated in the same week. Excellent coordination.
- Design token migration complete (LMNE-21, PR #34) — 38 files changed, zero hardcoded hex values remaining in component library. Enables consistent dark mode and brand refresh.
- Accessibility fixes shipped (LMNE-17, PR #38) — resolves 9 axe violations from the Q1 audit. WCAG AA compliance on form inputs.
- React 18.3 upgrade (LMNE-19) — concurrent rendering enabled without incident.
- Data grid performance fixed (LMNE-20) — P99 scroll jank down from 180ms to 22ms.
- Gesture nav experiment reverted (LMNE-26 created) — user testing showed 67% preference for tab bar. Good data-driven decision.

**⚠️ Flag — Tension 2:** A multi-day auth service OOM incident (intermittent 503s, starting Tuesday May 20) blocked dev-okonkwo's Playwright e2e test work (LMNE-25) and affected staging deploys. The incident was diagnosed and resolved entirely via a Slack thread (`#lumen-eng`, May 21) — no Jira ticket was filed despite a direct request from dev-okonkwo during the thread. The belated ticket (LMNE-28: "Investigate intermittent auth service 503s in CI") was created after the fact and is currently in the backlog, unscheduled, with no blocker link to LMNE-25. **Process gap: blockers affecting delivery should be tracked in Jira, not just Slack.** Recommend: link LMNE-28 as a blocker on LMNE-25; add to Sprint 13.

---

### Forge — Mobile / iOS

**Sprint 9 velocity:** 5 tickets closed (FORGE-28, FORGE-29, FORGE-30, FORGE-31, FORGE-33). 2 in flight (FORGE-32, FORGE-35). 1 paused (FORGE-36).

**Highlights:**
- iOS widget shipped (FORGE-31, PR #19) — small variant using WidgetKit with App Group container sharing. No additional API calls required. Clean implementation.
- Memory leak fixed (FORGE-29, PR #21) — AVCaptureSession delegate was not being released. Instruments confirms zero leak post-fix.
- Tab bar navigation shipped (FORGE-30, PR #22) — Home, Tasks, Notifications, Profile. Deep-linkable.
- iOS 16 rotation crash fixed (FORGE-28, PR #25) — UICollectionViewLayout invalidation deferred to prevent crash on device rotation.

**🚨 Flag — Tension 3 (PRIORITY):** On May 21, Forge's design lead (`yuki-designer`) added a comment to the Figma file "Forge Mobile — Navigation Architecture v2" explicitly reversing the tab bar navigation decision agreed in sprint planning. The comment reads: *"Following the exec UX review on Monday, we are pivoting away from the tab bar to a gesture-based navigation model … This reverses the tab bar decision from sprint planning."* FORGE-30 (tab bar implementation) was marked Done the same day. Engineering became aware via Slack (`#forge-mobile`, May 21) — carlos-mendez has paused FORGE-36 (deep link routing) and FORGE-26 pending resolution. FORGE-38 ("Redesign navigation architecture") is in the backlog as To Do. **Blast radius if gesture nav proceeds:** FORGE-30 (5 story points, Done), FORGE-36 (3 SP, in progress), plus deep link routing and offline mode sync indicator (also references nav structure). Estimated rework: ~13 story points. **Recommend: EM escalate to design lead for a decision meeting this week. Do not start Sprint 10 nav-dependent work until the architecture is locked.**

---

### Cross-squad: Atlas ↔ Lumen Auth Migration

**Tension 5 (positive signal):** Lumen shipped a breaking API change (auth tokens v2, new `tenantId` + `scopes` fields in token payload) on May 19. Atlas migrated to the v2 endpoint in the same week (PR #49, merged May 20). The coordination was proactive — PR bodies on both sides reference each other, and a cross-team Slack thread (`#cross-team`, May 23) confirmed the migration and surfaced an important detail: the new `scopes` field in v2 tokens must be consumed correctly in Atlas's premium tier entitlement gating (ATLS-56, currently in progress). This is a best-practice example of cross-squad dependency management. **Recommend: include in engineering all-hands as a coordination win. Confirm ATLS-56 is reading `scopes` from the v2 token before premium tier launch.**

---

### Data Quality Notes

- **Stale record:** ATLS-42 (`lastUpdated: 2026-05-21`) — 3 days without a status update as of end of week. Status remains "In Progress" despite the related PR merging May 22. (Compounds Tension 1.)
- **Stale record:** `forge-pr-025` — PR body notes it fixed "a 3-day-old regression from the grid layout refactor" (explicitly annotated as stale by the author).

---

### By-the-numbers

| Squad | PRs merged | Tickets closed | Blockers (Jira) | Blockers (Slack-only) |
|---|---|---|---|---|
| Atlas | 6 | 7 | 0 | 0 |
| Lumen | 5 | 6 | 0 | 1 ⚠️ |
| Forge | 4 | 5 | 0 | 0 |

---

### Recommended VP Actions

| Priority | Action | Owner |
|---|---|---|
| 🚨 HIGH | Resolve Forge nav architecture conflict before Sprint 10 planning | Forge EM + yuki-designer |
| ⚠️ MEDIUM | Update ATLS-42 to Done in Jira | Atlas EM or jordan-lee |
| ⚠️ MEDIUM | Link LMNE-28 as blocker on LMNE-25; schedule it in Sprint 13 | Lumen EM or priya-nair |
| ℹ️ LOW | Confirm ATLS-56 reads `scopes` from Lumen v2 token before premium tier launch | Atlas EM + sarah-chen |
| ℹ️ LOW | Add replica lag canary check to billing deploy runbook (EU latency incident) | Atlas EM |
