# Ground Truth Report — Arcline EPD Week of 2026-W19 (May 4–10, 2026)

> This is the authoritative "perfect" weekly report for evaluation purposes.
> An AI-generated master summary for 2026-W19 is scored against this document.

---

## Executive Summary

Sprint 14 kicked off across Atlas, Lumen, and Forge. Atlas is targeting its billing API CQRS refactor (ATLS-42) as the main sprint goal, alongside rate limiting and a critical cross-team dependency on Lumen's auth v2 endpoint. Lumen is mid-flight on auth v2 but blocked on PM sign-off for the token scopes schema, putting Atlas's premium tier timeline at risk. Forge is establishing navigation foundations (tab bar) and clearing a critical iOS 16 crash regression.

---

## Atlas (AuthShield — Billing Platform)

### Shipped / In Progress
- **Rate limiting middleware** (atlas-pr-048): started this sprint, adds 1000 req/min per-tenant cap to all `/billing/*` endpoints. Scaffolding complete, not yet in review.
- **NPE fix** (atlas-pr-050, ATLS-41): Stripe webhook NPE root cause identified (`payment.metadata.customerId` null on non-checkout events). Fix in progress, close to landing.
- **Billing API CQRS refactor** (atlas-pr-051, ATLS-42): Sprint 14 main goal, 8 story points. Splitting `BillingService` into `BillingQueryService` / `BillingCommandService`. Early implementation underway.
- **v1 endpoint deprecation cleanup** (atlas-pr-052, ATLS-29): ready to merge once ATLS-42 lands (shared code paths).
- **Premium feature flags** (atlas-pr-057, ATLS-55): scaffolding started but hard-blocked on Lumen auth v2 — cannot gate on premium entitlements without the `scopes` field from v2 tokens.

### Risks & Blockers
- **ATLS-55 / auth migration hard-blocked**: Atlas is waiting on Lumen to ship `/api/auth/tokens/v2`. Lumen's ETA is "end of sprint (May 10) optimistic, start of next sprint (May 18) realistic." With the June 15 v1 sunset 5 weeks away, a Lumen slip to May 18 leaves Atlas only ~3 weeks to migrate, test, and ship — very tight.
- **ATLS-42 assignee discrepancy**: Jira shows `jordan-lee` as assignee, but the sprint kickoff Slack thread shows `sarah-chen` declaring she is "taking point" on ATLS-42. This ownership ambiguity should be resolved immediately to avoid work duplication or gaps.

### Cross-Squad Dependencies
- Atlas → Lumen: `/api/auth/tokens/v2` endpoint. Blocks ATLS-55, atlas-pr-049, atlas-pr-057. Critical path for premium tier launch.

---

## Lumen (Frontend Platform)

### Shipped / In Progress
- **Auth tokens v2** (lumen-pr-031, LMNE-22): Implementation underway. Token payload design (`tenantId` + `scopes` fields) agreed by engineering. **PM sign-off on scopes schema pending** — Marcus (PM) traveling, expected sign-off next week. Work continues on undisputed scaffolding.
- **Design token migration** (lumen-pr-034, LMNE-21): Large refactor (~300+ files) migrating hardcoded hex and spacing values to Figma-synced tokens. ~60% complete.
- **Dark mode flicker fix** (lumen-pr-032, LMNE-18): Root cause identified (async `ThemeContext` init causes wrong-theme flash on first paint). Fix in PR, ready for review.
- **Data grid perf fix** (lumen-pr-035, LMNE-20): Unstable row identity causing full virtual window re-render on scroll. `useMemo` fix in progress.
- **React 18.3 upgrade** (lumen-pr-037, LMNE-19): Migration to `createRoot` started, 8 `useLegacyRef` sites identified.
- **Accessibility fixes** (lumen-pr-038, LMNE-17): Q1 audit violations (9 axe issues on form inputs) being addressed.

### Risks & Blockers
- **Auth v2 PM sign-off risk**: Marcus is traveling until Monday May 11. If sign-off is delayed further, the "end of sprint" (May 10) target becomes impossible. This is the critical path for Atlas's June 15 deadline.
- **Skeleton loaders blocked on token migration**: LMNE-24 (skeleton loaders) can't start until LMNE-21 (design tokens) lands — creates a sequential dependency within Lumen's sprint.

---

## Forge (iOS Mobile)

### Shipped / In Progress
- **Tab bar navigation** (forge-pr-022, FORGE-30): Implementation started, per sprint planning decision. This is the structural foundation — deep links (FORGE-36) are explicitly blocked on it.
- **iOS widget small variant** (forge-pr-019, FORGE-31): WidgetKit scaffolding underway. Design finalized (progress ring shows today's task completion rate).
- **Haptic feedback** (forge-pr-020, FORGE-33): Implementation done, in review.
- **Camera memory leak fix** (forge-pr-021, FORGE-29): 12MB/session leak identified, weak reference fix in progress.
- **iOS 16 rotation crash** (forge-pr-025, FORGE-28): Regression from last sprint's grid layout refactor. Crash in task view on rotation, iOS 16 only. Fix in progress.
- **Offline mode** (forge-pr-024, FORGE-32): Scoping phase — GRDB-backed SQLite approach agreed, implementation not yet started.
- **Deep links** (forge-pr-026, FORGE-36): Blocked on FORGE-30 (tab bar) — routing depends on final navigation structure.

### Risks & Flags
- **iOS 16 crash (FORGE-28) is a user-facing regression**: All iOS 16 users cannot rotate device in task view without a crash. This was introduced last sprint and should be prioritized as a hotfix regardless of sprint goals.

---

## Cross-Squad Analysis

- **Critical path**: Lumen auth v2 (LMNE-22) → Atlas auth migration (atlas-pr-049, ATLS-55) → Atlas premium feature flags (atlas-pr-057, ATLS-55) → Premium tier launch. Current status: **Lumen is not yet in review** due to pending PM sign-off. If Lumen ships May 18 as the "realistic" estimate, Atlas has ~3.5 weeks before June 15 v1 sunset — sufficient but leaves no buffer for bugs.
- **Forge is self-contained this sprint** with no cross-team dependencies other than Figma design handoffs.

---

## VP Actions Required

1. **Resolve ATLS-42 ownership today**: Jira assigns `jordan-lee`; Slack sprint kickoff assigns `sarah-chen`. This is an 8-story-point critical-path ticket — ambiguous ownership on sprint day 1 is a red flag.
2. **Escalate Lumen auth v2 timeline**: If PM sign-off doesn't happen by May 11, the May 18 merge target becomes May 25 at earliest, leaving Atlas < 3 weeks before June 15 sunset. VP should confirm whether the timeline can be accelerated.
3. **Confirm iOS 16 crash is treated as a hotfix** (FORGE-28): this is a regression affecting live users, not new feature work.
