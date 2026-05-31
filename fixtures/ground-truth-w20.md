# Ground Truth Report — Arcline EPD Week of 2026-W20 (May 11–17, 2026)

> This is the authoritative "perfect" weekly report for evaluation purposes.
> An AI-generated master summary for 2026-W20 is scored against this document.

---

## Executive Summary

Mid-sprint progress is strong across all three squads: Atlas fixed the payment processor NPE and brought rate limiting into final review; Lumen shipped three bug fixes (dark mode flicker, data grid perf, React upgrade) and is days from merging auth v2; Forge cleared two critical bugs (iOS 16 crash, camera memory leak) and merged haptic feedback. Two process gaps need immediate attention: the billing portal's 429 error state has not been designed despite rate limiting shipping to review, and an EU replica lag signal from a load test went untracked — no ticket was filed.

---

## Atlas (AuthShield — Billing Platform)

### Shipped / In Progress
- **NPE fix merged** (atlas-pr-050, ATLS-41 → Done): `payment.metadata.customerId` null check merged Tuesday. Resolves 3 known silent payment failures in staging.
- **Rate limiting** (atlas-pr-048, ATLS-38): Implementation complete, final code review in progress. Validated at 1200 req/min per-tenant in load tests. **Returns 429 with Retry-After header as specified.**
- **Billing API CQRS refactor** (atlas-pr-051, ATLS-42): CQRS split complete. Load test running on staging, targeting merge this sprint.
- **Webhook HMAC timing bug** (atlas-pr-054, ATLS-47): Discovered during load test — `Date.now()` causes clock drift under load, rejecting valid Stripe signatures. Monotonic clock fix in progress.
- **Test coverage** (atlas-pr-053, ATLS-44): WIP, coverage improving from 28% toward 85% target.
- **Auth migration** (atlas-pr-049, ATLS-55 → Blocked): Still blocked on Lumen auth v2. Lumen confirmed merge target May 18–19. Atlas ready to pick up immediately after.
- **Premium feature flags** (atlas-pr-057, ATLS-55 → Blocked): Blocked behind auth migration.
- **Analytics spike** (atlas-pr-055, ATLS-50): Scope expanding; under discussion to close without merge and move to separate analytics track.

### Risks & Open Flags

**⚠️ T3 — Rate limiting shipping without 429 error state in Figma**: Rate limiting PR #48 is in final review, but the Billing Portal Figma file does not yet contain a 429 error state design. Alex Kumar flagged this in Slack (#atlas-eng, May 12) and Sarah Chen acknowledged it but no resolution was confirmed. A feature that surfaces 429 responses to users without a designed error state creates a UX gap. The design is "on the list" but was not completed during W20.

**⚠️ T4 — EU replica lag risk not tracked**: During billing refactor load tests, Jordan Lee observed 800ms replication lag on the EU read replica at peak traffic. Alex Kumar suggested filing a ticket; Jordan Lee agreed but said it was "low priority" and would bring it up in standup. **No ticket was filed as of end of W20.** This is a latent risk: if EU traffic routing is enabled before the lag is investigated, users in the EU region will experience degraded read performance under load.

### Cross-Squad Dependencies
- Atlas → Lumen: Blocked on auth v2 merge (expected May 18). This is the single critical-path dependency for the entire premium tier launch.

---

## Lumen (Frontend Platform)

### Shipped This Week
- **Dark mode flicker fixed** (lumen-pr-032, LMNE-18 → Done): Synchronous `ThemeContext` initialization merged Monday. Verified across Chrome/Firefox/Safari.
- **Data grid perf fixed** (lumen-pr-035, LMNE-20 → Done): `useMemo` row identity stabilization merged. P99 scroll jank: 180ms → 22ms.
- **React 18.3 upgrade** (lumen-pr-037, LMNE-19 → Done): All 8 `useLegacyRef` sites migrated. `createRoot` concurrent mode enabled.

### In Progress
- **Auth tokens v2** (lumen-pr-031, LMNE-22 → In Review): PM signed off on scopes schema Friday May 8. Implementation complete. In final code review with dev-okonkwo and kai-zhang. **Targeting merge May 18–19** — this is Atlas's critical-path dependency.
- **Design token migration** (lumen-pr-034, LMNE-21 → In Review): 90% complete. Merge is imminent this week, which unblocks skeleton loaders.
- **Accessibility fixes** (lumen-pr-038, LMNE-17 → In Review): 9 axe violations addressed, in review.
- **Skeleton loaders** (lumen-pr-033, LMNE-24 → In Progress): Waiting on design token merge. Implementation drafted and ready.

### Risks
- **e2e test CI flakiness** (lumen-pr-036, LMNE-25): Playwright tests blocked by intermittent auth service 503s in CI. Root cause unclear — could be shared staging environment or CI networking. The test suite can't merge in this state.

---

## Forge (iOS Mobile)

### Shipped This Week
- **iOS 16 crash fixed** (forge-pr-025, FORGE-28 → Done): `layoutIfNeeded()` deferral resolves rotation crash. Merged Monday.
- **Camera memory leak fixed** (forge-pr-021, FORGE-29 → Done): Weak reference on `AVCaptureSession` delegate. Instruments: 12MB/session → 0. Merged Monday.
- **Haptic feedback merged** (forge-pr-020, FORGE-33 → Done): Light/medium impact feedback on card swipe gestures.

### In Progress
- **Tab bar navigation** (forge-pr-022, FORGE-30 → In Review): Four-tab `UITabBarController` implementation complete. Final review. Deep links (FORGE-36) remain blocked until this merges.
- **iOS widget** (forge-pr-019, FORGE-31 → In Review): Design finalized (progress ring shows today's task completion rate with App Group container fallback). In review.
- **Offline mode** (forge-pr-024, FORGE-32 → In Progress): GRDB/SQLite implementation 70% complete. Sync strategy: server-wins on foreground resume.
- **Figma token sync** (forge-pr-023, FORGE-35 → Open): Held pending resolution of design lead's gesture nav exploration comment in Figma.

### Risks & Flags
- **Design lead gesture nav exploration**: Forge's design lead added a comment to the Figma tab bar file noting an exploration of gesture-based navigation. Engineering (carlos-mendez) correctly noted this is exploratory and tab bar will ship as planned. However, the unresolved Figma comment means forge-pr-023 (token sync) is on hold, and there is a risk that this design exploration resurfaces in W21 as a more formal challenge.

---

## Cross-Squad Analysis

- **Auth v2 critical path**: Lumen merge is now expected May 18–19 (start of W21). This is on-track but has zero buffer — any delay pushes into Atlas's migration window against the June 15 v1 sunset.
- The three Lumen fixes (dark mode, data grid, React upgrade) represent strong delivery velocity and show the squad shipping alongside the large auth v2 feature.
- Forge's three-fix Monday start demonstrates effective sprint hygiene — critical regressions (iOS 16, memory leak) cleared before new feature work.

---

## VP Actions Required

1. **File the EU replica lag ticket** (Atlas): jordan-lee identified 800ms EU replica lag during load tests on May 13. This was discussed in Slack but no JIRA ticket was created. Assign an owner before W21. Left untracked, this is a production incident waiting to happen if EU routing is enabled.
2. **Unblock the Billing Portal 429 error state design** (Atlas/Design): Rate limiting (PR #48) is in final review. The Figma file does not yet have a designed 429 error state. This must be resolved before the feature ships — currently scheduled for W21 merge. Assign the design task with urgency.
3. **Confirm Lumen auth v2 merge date (May 18–19 target)**: This is the single critical-path dependency for Atlas's premium tier and the June 15 v1 sunset. VP should confirm the date is firm and that no blockers remain in the review process.
