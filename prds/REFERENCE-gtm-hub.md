# Reference — AI-Native GTM Hub (prior art for Round 2)

> **What this is.** Dan has already built a production GTM intelligence system on his personal
> website. Round 2's GTM pipeline (PRDs 13–20) deliberately mirrors its patterns. This file is
> the single citable index of reusable assets so each PRD's implementing session does not have to
> re-explore that codebase. **Read the rows relevant to your PRD before building.**
>
> **Important distinction.** The GTM Hub runs agents on the **Anthropic SDK** (Claude calls in
> AWS Lambda) with prompts stored in a Notion "Agent Library" database. Round 2 instead uses
> **native Notion Custom Agents** (Feb 2026 feature) + `ntn` Workers for data plumbing. So borrow
> the Hub's *prompt content, output shapes, and Notion field-mapping logic* — NOT its Lambda/DynamoDB
> async architecture or its Agent Library DB pattern. The reasoning layer is different; the
> domain logic is reusable.

Project root: `/Users/dannymathieson/Develop/personal-website`

## Reusable assets by file

| Asset | Path (under personal-website) | What to reuse |
|---|---|---|
| **6 agent system prompts** | `lib/projects/notion-meeting-intelligence/prompts.ts` | `buildAgentPrompt(agent, today)` for `sales \| commercial \| delivery \| product \| icp \| summary`. The `sales` and `summary` prompts map to the GTM Meeting Summarizer; the `product` prompt's COMPETITIVE INTELLIGENCE section maps to the Battle Card Updater. |
| **Agent output types** | `lib/projects/notion-meeting-intelligence/types.ts` | `SalesAnalysis`, `ProductAnalysis` (has `competitive_gaps[]`, `resonated_features[]`, `notable_quotes[]`), `SummaryAnalysis` (has `executive_summary`, `deal_verdict`, `recommended_next_action`, `buyer_roles_present[]`). Mirror these output shapes in worker tool return types. |
| **Notion field mapping** | `lib/projects/notion-meeting-intelligence/fieldMapping.ts` | `buildMeetingNoteProperties()` shows how to flatten agent JSON → Notion property payloads. The `roleMap` (lines ~37–63) normalizes raw job titles → standardized buyer-role select options. |
| **Metadata derivation** | `lib/projects/notion-meeting-intelligence/metadata.ts` | Deterministic rules with NO extra LLM call: sentiment from sales score (≥7 positive / ≥4 neutral / else negative), and a stage-advancement decision tree (ICP tier + commercial tier + sales score → Move forward / Hold / Re-qualify / De-prioritize). Reuse this logic for the Daily Digest's at-risk flagging. |
| **Notion fetch / rubric injection** | `lib/projects/notion-meeting-intelligence/fetchAgentLibrary.ts` | The `{{ICP_RUBRIC}}` placeholder-injection pattern — a prompt pulls a scoring rubric from a Notion DB at runtime. Conceptual reference for the Renewal Risk Radar candidate agent; not needed for the core workers. |
| **Architecture write-up** | `info/projects/notion-meeting-intelligence/architecture.md` | Narrative of the design. Skim for the "Notion as methodology store" framing — useful language for the presentation deck (PRD-19). |
| **Project overview** | `info/projects/notion-meeting-intelligence/index.md` | The public template + demo framing. Live template: `dm4th.notion.site/AI-Native-GTM-Hub-357fc8f4554c806a908be47807ac63df`. |
| **Result card components** | `components/projects/NotionMeeting/*AgentCard.tsx` | Visual reference only — how each agent's output is laid out for a human reader. Informs how the Daily Digest / GTM Weekly pages should be structured. |

## Meeting Notes DB shape (from the Hub) — informs PRD-13 / PRD-14

The Hub's "Meeting Notes" database (built by `buildMeetingNoteProperties()`) is the prior art for
the `GTM | Meeting Notes` schema in PRD-13. Its proven property set:
- `Meeting Title` (title), `Date` (date), `Category` (select: Discovery/Solutioning/Check-In/Demo/Other)
- `Engagement Score` (number), `Sentiment` (select: 🟢/🟡/🔴), `Stage After Meeting` (select)
- `Key Signals` (rich_text), `Action Items` (rich_text), `General Summary` (rich_text), `AI Debrief` (rich_text)
- `Buyer Roles Present` (multi_select), `Recording Link` (url)

Round 2 simplifies this (no per-agent fan-out) but the sentiment/stage/action-items columns carry over.

## GTM use-case → Hub asset map

| Round 2 artifact | PRD | Borrow from |
|---|---|---|
| GTM Meeting Summarizer worker | 15 | `sales` + `summary` prompts; `metadata.ts` sentiment + stage rules |
| Battle Card Updater worker | 18 | `product` prompt COMPETITIVE INTELLIGENCE section; `ProductAnalysis.competitive_gaps` |
| GTM Weekly / release content | 17 | `product` prompt FEATURE RESONANCE; `ProductAnalysis.resonated_features`, `notable_quotes`, `product_team_insight` |
| Candidate: Sales Call Summarizer | 19 | `sales` + `summary` prompts wholesale |
| Candidate: Competitive Mention Tracker | 19 | `product` prompt competitive section |
| Candidate: Release Notes Generator | 19 | `product` prompt feature-resonance fields |
| Meeting Notes / Opportunities schema | 13, 14 | `buildMeetingNoteProperties()` field set |
