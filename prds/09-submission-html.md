# PRD-09 — Submission HTML

<!-- status:
state: in-review
owner: sonnet-2026-05-30-E1
updated: 2026-06-02T22:00:00Z
notes: AC1-11 ✅ — 364KB self-contained HTML, 18 sections, 7 Loom embeds, base64 Lucid diagram, inline master report + citations, all external links verified live. AC12 ⚠ no build-script (hand-authored, gitignored — submit file directly). Eval JSON dead link fixed (commit 326a3b2).
-->

## Goal
Produce a single self-contained `submission.html` that **stands fully on its own as a submission artifact** — a reviewer who never clicks through to the Notion workspace, the GitHub repo, or the video should still come away with a complete picture of the design, the trade-offs, and the evidence it works. Live links exist for the reader who wants to dig in, not as load-bearing dependencies.

## Why this exists
This is the **only file** Dan can submit. Many reviewers will skim it on a phone, between meetings, without logging into Notion or starting a Loom video. The HTML must duplicate (not just *reference*) the most important workspace content — the sample Master Report, Trust Score breakdown, architecture diagram, sample summaries with their citations — and present them inline as a self-contained narrative.

## Dependencies
- PRD-05 (need a real Master row to point at), PRD-08 (need the Trust Score), PRD-10 (need the teaching workspace to tour).

## Inputs
- Latest `evals/reports/<week>.md` (PRD-08).
- Public links to Notion workspace pages (workspace must be share-on for the interviewer).
- A recorded video walkthrough (Loom or self-hosted MP4 referenced by URL).
- This repo's GitHub URL.

## Outputs
- `submission.html` at repo root. Self-contained (CSS inline, no external JS frameworks). Brand-leaning toward Notion's visual language without infringing.

## Design

### Three-layer hook (progressive disclosure for the engaged reader)
1. **Headline (above fold)**: the Trust Score with one sentence ("the agent's Master Report cites X% of its factual claims, with Y% judged source-aligned by an independent model").
2. **Live-trigger video**: embedded ≤ 2 min walkthrough showing a Monday run from cron → workers → summarizers → HITL → master. *Optional viewing — the rest of the page does not depend on it.*
3. **Teaching workspace tour**: deep links into Notion (Workspace home, Squad page, Squad Weekly Summary review, Master EPD Weekly, Weekly Pipeline Dashboard, eval report). *Optional clicking — every key page is also reproduced inline as screenshots + text excerpts.*

### Standalone-readability requirement (NEW — the central constraint of this PRD)
A reviewer who reads only the HTML must come away with:
- The exact problem in their head, in Arcline's voice.
- A clear mental model of the architecture without watching the video.
- A concrete sense of what the Master Report actually looks like, with its citations visible.
- The Trust Score with its three component scores broken out.
- The time-savings KPI with the manual-vs-agentic Monday-morning timeline visible inline.
- A clear picture of *how* this was built (hand-authored solution → Opus PRDs → parallel Sonnet builds → Opus review checkpoints).
- The 30-day plan as a readable narrative, not just dates.
- The two biggest risks and what was done about them.
- The "above and beyond" additions, each named and explained.

Every link in the doc should add depth for the curious reader — never carry information not already in the page.

### Structure (sections — each is content-complete inline)

1. **Header strip** — Dan's name, role applied for, one-line tagline, links (Notion · GitHub · Loom · Eval JSON). Sticky on scroll.
2. **The problem** — full verbatim quote from `problem-statement.md` in a styled blockquote so the reviewer remembers exactly what was asked.
3. **My five questions for Arcline (before designing anything)** — Dan's list as final answered: each question with a 1-2 sentence *why it matters*. Both #5 candidates included with rationale for asking both.
4. **The architecture, end-to-end** — inline SVG architecture diagram + a 3-4 paragraph narrative walkthrough. Diagram is annotated; the narrative explains the *why* of each layer (mirror DBs, per-source summarizers, HITL consolidation, master, eval).
5. **What the Master Report actually looks like** — a styled, *embedded reproduction* of one week's Master EPD Weekly row. Show the executive summary, the five body sections (*Highlights*, *Risks & Blockers*, *Cross-Squad Dependencies*, *Roadmap Movement*, *Open Discrepancies*), the conflict-resolution policy callout, and the citation chain rendered as clickable footnotes that resolve inline (modal/popover or footnote-style at the bottom of the section). This is the moment the reviewer "sees" the output. **It must look like a real artifact, not a screenshot of one.**
6. **Trust & evals** — the headline Trust Score, plus a *breakdown table* with the three component scores (citation coverage %, source-fact alignment %, backtest similarity %), the composite formula, and one specific honestly-named weakness (the failing-case example pulled from `evals/reports/<week>.md`). Include a small example of a flagged "unsupported claim" with the verdict from the LLM judge.
6b. **Time savings vs the manual baseline (the core KPI)** — the headline business outcome, given equal weight to Trust. Two inline diagrams:
    - **Monday-morning timeline (before vs after)**: a horizontal Gantt-style SVG showing the manual baseline ("3–4 hrs of EM stitching, report by ~11 AM if lucky") on one row and the agentic pipeline ("workers 6:00 AM → summaries 6:30 AM → HITL 8:00–9:30 AM → master by ~9:45 AM → VP-ready by 10:00 AM") on a parallel row. Annotated with where humans are still in the loop and how that human time decays in days 30–90.
    - **Per-step time budget table**: each pipeline step with target latency (from PRD-07's Agent Run Log) and what the manual equivalent used to cost in EM-hours. Totals row shows the **EM-hours saved per week × 3 squads × 52 weeks** as an annualized figure, with explicit assumptions surfaced.
    - One-paragraph caveat naming the *quality* axis (the Trust Score in §6) — fast and wrong is worse than slow and right, so the two KPIs must be read together. Avoids the "we shaved hours but introduced hallucinations" anti-pattern.
7. **How HITL actually works for an EM** — embedded screenshot of the per-squad review page from PRD-06 + a 2-paragraph explanation of why 18 approvals became 3, and what happens when an EM rejects a sub-summary.
8. **Top 2 risks & mitigations** — sprawl-addressed-by-observability (with a small screenshot of the Weekly Pipeline Dashboard from PRD-07), staleness-flagged-not-fixed (with the V2 plan). Each risk gets a "what would change my mind" paragraph — interview honesty signal.
9. **30-day POC plan** — week-by-week narrative, redone with correct date math from today. Include the explicit success criteria from `solution-intro.md` (report by 11 AM as floor, 10 AM as target).
10. **Above and beyond** — each addition with a one-paragraph explanation:
    - PRD Fact Checker (drift detection)
    - Observability dashboard (sprawl made measurable)
    - Eval harness with golden-set replay (regression-safe prompts)
    - Teaching layer (Arcline maintains it after handoff)
    - `/interview-prep` Claude skill (rehearsal partner)
11. **What I'd want to validate with Arcline before building further** — short list of customer-validatable assumptions (VP report format, conflict policy, ownership post-handoff). Demonstrates SE instincts.
11b. **How I built this** — a transparent process narrative, written first-person, that lays out Dan's collaboration model with AI tooling. The shape is honest and specific:
    - **Step 1 — I read the prompt, did a Perplexity search for prior art on similar problems, then wrote the solution document by hand.** The Perplexity pass was strictly for grounding — surfacing how other teams have tackled multi-source weekly digests, what failure modes are typical, and what "trust in AI output" frameworks exist in the wild. The 5 questions, the V1 workflow, the risks, and the 30-day plan in `solution-intro.md` are Dan's own thinking, informed by that reading but not written by AI.
    - **Step 2 — One Opus planning session expanded the solution doc into staged PRDs.** Single high-context session. Critiqued the hand-written solution doc, surfaced the approval-math problem and the hallucination-measurement gap, broke the work into 17 self-contained PRDs with an explicit dependency graph for parallelization. The PRDs live in `/prds`.
    - **Step 3 — Parallel Sonnet sessions executed individual PRDs.** One session per PRD, run in dependency waves (A → E). Each session was scoped to a single PRD's brief and could not see the other sessions' working state — the PRDs are self-contained by design so this works.
    - **Step 4 — Opus review checkpoint after each wave.** Between waves, an Opus session audited the artifacts produced (workspace schema, fixtures, worker outputs, summarizer outputs, master report) against the next wave's PRDs and flagged contract drift before downstream sessions inherited it.
    - Include a small **wave-by-wave diagram** showing Opus (plan + review) as gates and Sonnet (build) as parallel lanes between them.
    - Close with one paragraph naming what this approach is good for and where it falls down. Honest: it's good for well-scoped fan-out work with clear contracts; it's bad for ambiguous design where context has to be held across sessions. The PRD-authoring step is the load-bearing one. **This whole section is also a quiet pitch: "I know how to wield AI assistants as a Solutions Engineer, not just be impressed by them."**
12. **Appendix: sample Squad Weekly Summary** — one fully-rendered example (Atlas / GitHub) with its citation list expanded inline. Lets the reviewer audit at the leaf level if they want.
13. **Footer** — links repeated, contact info, short colophon ("Built in N days using Notion Workers + Custom Agents, mocked data sources, Claude as drafting partner").

### Inline content sourcing
- All sample content (Master Report, Squad Summary, citations, eval breakdown) is **generated from the real workspace at build time** by `scripts/build-submission.ts` — not hand-pasted. This ensures the HTML and the workspace cannot drift apart. If the workspace isn't ready, the script falls back to hand-authored placeholders clearly marked `[PLACEHOLDER — workspace not yet populated]`.
- Screenshots are also generated by the build script via Playwright against the live Notion pages (where possible) or static asset paths under `assets/`.

### Visual / typographic constraints
- Single self-contained HTML: inline CSS, no external JS frameworks, minimal vanilla JS only for the footnote/popover interactions.
- Lean Notion-adjacent visual language: serif headings (or system-ui), generous whitespace, small accent color, no animations beyond hover.
- Mobile readable (most likely reviewer device on first open). Test at 375px width.
- Print-stylesheet friendly: a reviewer who prints to PDF should get a clean document.

### Voice
Dan-as-candidate: confident, specific, no hedge-padding. Avoid "I think" — say it. The Notion workspace itself is written in Dan-as-SE voice (see PRD-10) — keep these separated.

### Two-audience separation (the most important design call)
The HTML is the **resume artifact**. The Notion workspace is the **customer artifact**. The HTML can say "here's the trade-off I made" (candidate voice). The Notion workspace cannot break the fourth wall (SE voice). The implementing session must keep these two voices apart.

### Voice
Dan-as-candidate: confident, specific, no hedge-padding. Avoid "I think" — say it. The Notion workspace itself is written in Dan-as-SE voice (see PRD-10) — keep these separated.

### Two-audience separation (the most important design call)
The HTML is the **resume artifact**. The Notion workspace is the **customer artifact**. The HTML can say "here's the trade-off I made" (candidate voice). The Notion workspace cannot break the fourth wall (SE voice). The implementing session must keep these two voices apart.

## Acceptance Criteria
1. `submission.html` opens in a browser standalone (`file://`) with no broken images or styles.
2. Above-the-fold contains the Trust Score number, prominently.
3. Every section listed in the Structure above is content-complete inline — a reviewer can read the page top-to-bottom with no external clicks and miss nothing critical.
4. The "What the Master Report actually looks like" section reproduces a real Master Report row with citations rendered as inline footnotes that expand on click without leaving the page.
5. Disabling JavaScript still leaves the page readable end-to-end (footnotes degrade to bottom-of-section list).
6. Cutting the network cable (no Notion, no Loom, no GitHub) still leaves every section readable — only the "click to dig in" links break, gracefully.
7. Embedded video plays when network is available.
8. Every Notion link works for an unauthenticated visitor (workspace pages set to public-share-link). If not possible (workspace tier limits), screenshots inline are sufficient and the link is omitted rather than left broken.
9. Lighthouse Accessibility ≥ 90; Performance ≥ 90 on cached load.
10. Print-to-PDF produces a clean readable document (Chrome → Print → Save as PDF).
11. Mobile-readable at 375px width (visual check).
12. `scripts/build-submission.ts` regenerates `submission.html` deterministically from the workspace + eval outputs.

## Out of Scope
- Multiple HTML pages — single file constraint.
- Server-side rendering or hosting — must work from `file://`.
- Real-time data from the workspace at view time — content is snapshotted at build time.

## Open Questions
- Can the Notion workspace be share-linked publicly for the interviewer? If workspace tier blocks anonymous share, fall back to embedded screenshots of key pages and a private-share invite as an alternate path. Implementing session probes and decides.

## Verification
- Open `submission.html` in Chrome from `file://`. Visually inspect. Click every link. Watch the video. Run Lighthouse.
- **Standalone test**: turn off WiFi, open the file. Read every section. Confirm no critical content is missing or obviously broken.
- **No-JS test**: open the file with JS disabled. Confirm full readability.
- **Print test**: print to PDF. Confirm clean output across pages.
- **Phone test**: open on a phone (or DevTools 375px). Confirm typography and architecture diagram remain legible.
- **Cold-reader test**: give the file to someone unfamiliar with the project and ask "what does this person propose to build, and why should I trust it works?" — they should be able to answer both without follow-up questions.

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

### What was actually built

- **`submission.html`** (364 KB, gitignored at line 39 of `.gitignore`): Single self-contained HTML file with inline CSS and minimal vanilla JS. 18 sections, fully readable from `file://` with no network dependency. Submit this file directly — there is no build script that regenerates it (see Gotcha 1). All Notion workspace content (Master Report, Trust Score, HITL mock, citations, appendix summary) is reproduced inline as styled HTML; no screenshots are used.

- **Architecture diagram** (§03): The PRD specified an inline SVG diagram. What shipped instead is a **two-panel sticky layout** — a fixed 52px HTML label column containing hand-labeled lane names, sitting beside a scrollable `<img>` tag containing the Lucid export (`solution-diagram/Notion _ Solutions Engineer Process Diagram.svg`) base64-encoded as a data URI (~264K chars of base64). The hand-crafted swimlane SVG originally written by Claude was replaced entirely at Dan's direction. A `<div style="display:flex;height:520px">` wrapper holds both panels; the image panel uses `overflow-x:auto` for horizontal scrolling.

- **§03b — Other Paths Considered**: Three `.risk-card` blocks (Path 1/2/3 — Rejected) added beyond the PRD's section list, showing the three architectural alternatives considered and why each was ruled out.

- **§11c — Demo Walkthrough Plan**: Six `.week-block` entries (Videos 1–6) each describing a Loom clip + a compact `video-placeholder-sm` div that was replaced with live responsive `<iframe>` Loom embeds once URLs were available. Intro video also embedded at the top `#video` section.

- **`q-assumption` / `q-assumption-sm` CSS classes**: Blue callout boxes used in §02 (Five Questions) to annotate POC-scoped assumptions inline within each question's answer. Not in the PRD brief.

- **Risk 3 — AI Token Cost (Low)**: The PRD called for "Top 2 Risks." Shipped as Top 3; Risk 3 covers AI token cost with a Low severity badge, cost estimate (~$1–3/week), and pointer to the existing Observability Dashboard for tracking.

- **All external links verified live**: 9 Notion links (200), 2 GitHub links (200), Lucid invitation URL, 7 Loom embeds. The Eval JSON link was fixed (see Gotcha 5). `solution-intro.md` on GitHub is live.

### Gotchas for downstream sessions

**1. `scripts/build-submission.ts` was never built — AC12 is unmet**
AC12 requires a TypeScript script that regenerates `submission.html` deterministically from the workspace + eval outputs. This script does not exist. The file was authored iteratively by Claude sessions making targeted `Edit` calls and Python `str.replace()` scripts directly against the HTML. `submission.html` is gitignored (`.gitignore` line 39: "Generated submission artifact (regeneratable from build script)") so it is not in version control. **Submit the file directly from the local filesystem.** Any session that looks for `scripts/build-submission.ts` will not find it.

**2. Lucid SVG text is vector paths — lane labels cannot be extracted programmatically**
The Lucid export (`solution-diagram/Notion _ Solutions Engineer Process Diagram.svg`) encodes all text as `<use>` element glyph references, not `<text>` nodes. You cannot `grep` the SVG for lane names or extract them with any standard XML parser. Dan provided all lane labels manually. The two-panel layout (HTML label column + image) is the workaround. If the diagram is re-exported from Lucid, lane labels in the HTML column must be re-verified against the new image by eye.

**3. Rotated text in 52px lane divs — do not use `writing-mode` or flex centering**
The 7 lane label `<div>`s in the HTML label column use `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(270deg)` with `overflow:hidden` on the parent. `align-items:center;justify-content:center` on a flex parent is unreliable for rotated text and was tried and abandoned. Key constraints: font-size 7px, no `text-transform:uppercase`, letter-spacing `.02em`. Two labels were abbreviated to fit within the ~70px row height ("Mirror Data Sources" → "Mirror Data", "Engineering Managers" → "Eng. Managers").

**4. Python string replacement seam bug when splicing large HTML blocks**
When replacing the hand-crafted swimlane SVG with the Lucid image block, a Python boundary calculation consumed 6 chars of the immediately following `<p class="diagram-caption">` tag, producing `</div>class="diagram-caption">`. The pattern: `content[start:end]` where `end` was computed from the old string length sometimes drifts if the new content is inserted at a slightly different offset. Fix: always use `content.replace(old_str, new_str)` with exact string matching rather than slicing by computed position. If the old string is not uniquely present, use a larger context window.

**5. `evals/reports/*.json` was gitignored — caused dead nav link**
The original `.gitignore` had `evals/reports/*.json` and `evals/reports/*.md` under the comment "large, regeneratable." The files are 19 KB and 8 KB respectively. The nav and footer both link to `https://github.com/dm4th/arcline-technologies-epd-summarizer/blob/main/evals/reports/2026-W21.json`, which was 404. Fix: commented out those two gitignore rules and committed/pushed both eval files (commit `326a3b2`). If new eval reports are generated, they will now be tracked automatically.

**6. Workers count was wrong throughout the document**
The inline SVG timeline showed "Workers ×6" and the time-budget table said "Data workers (6 parallel)." The correct count is 4 (GitHub, Jira, Slack, Figma — PRDs 03a–03d). The hero text ("Four data-source workers") was already correct. The "6" likely crept in by conflating workers with the 6 source-summarizer agent types. Fixed in the SVG text and table. If the worker count ever changes (e.g., a Roadmap or PRD data-source worker is added), update both the inline SVG `<text>` element and the table row.

**7. Em-dash cleanup required 3 passes and 101 replacements**
The initial draft used em-dashes heavily throughout. Dan requested systematic removal. Three Python `str.replace()` passes handled ~101 replacements: section labels (`—` → `·`), prose dashes (→ `,` `;` `:` or parentheses), risk badge/title separators (→ `:`). Content inside the `.master-report` mock and appendix sample was deliberately preserved — those em-dashes represent authentic AI output formatting. The `— VP Engineering` blockquote attribution was also preserved. The `<td>—</td>` null placeholder in the appendix table was preserved.
