# PRD-19 — Round 2 Presentation Deck in Notion

<!-- status:
state: ready
owner: -
updated: 2026-06-08T00:00:00Z
notes: Dep PRD-13 completed → READY (synced with README, which already read ready; file block was stale at 'waiting' — Opus fixed the desync 2026-06-08). Deck pages can be written now; Live Demo Flow beats 3/5/6 depend on PRD-17 rework (GTM Weekly DB row) + PRD-16 (Release Bridge, still waiting) — write those beats with the bracketed "not yet walkable" caveats already in the Design section.
-->

## Goal
Create a complete Round 2 presentation structure in Notion: (A) a polished, CRO-aware presentation deck built as Notion pages, and (B) a step-by-step walkthrough guide for Dan to practice building the 4 candidate GTM agents natively in Notion before the interview.

**Critical note on Part B:** The implementing session's job is to WRITE the walkthrough guide pages in Notion (page content describing the steps). Do NOT build the candidate agents themselves. The agents must be created by Dan as a manual practice exercise, then deleted before the interview so he can recreate one live with confidence.

## Why this exists
The Round 2 interview adds the CRO and Director of Sales Enablement as new stakeholders. Without a structured presentation canvas, the 40-minute session risks drifting into a technical demo without connecting to business value. The deck also serves as the live navigation surface during the interview — Dan can share his screen showing the Notion workspace, click through checkboxes, and reference the objection prep during Q&A.

## Reference Implementation — AI-Native GTM Hub
> **The candidate agents come straight from Dan's prior art.** See
> [`prds/REFERENCE-gtm-hub.md`](REFERENCE-gtm-hub.md). Three of the four candidate agents in Part B map
> directly to existing Hub agents, so Dan already has working prompt language to adapt:
> - **Sales Call Summarizer** → Hub's `sales` + `summary` prompts (`prompts.ts`)
> - **Competitive Mention Tracker** → Hub's `product` prompt COMPETITIVE INTELLIGENCE section
> - **Release Notes Generator** → Hub's `product` prompt FEATURE RESONANCE fields
>
> When writing the Part B walkthrough instructions, the implementing session should pull the actual
> prompt wording from `personal-website/lib/projects/notion-meeting-intelligence/prompts.ts` and
> simplify it into plain-language Notion Custom Agent instructions. This also gives Dan a credible
> "I've built this exact thing before" story to tell the Director of Sales Enablement. The Hub's live
> template (`dm4th.notion.site/AI-Native-GTM-Hub-...`) can be shown as proof if asked.

## Dependencies
- PRD-13 through PRD-18 should be complete or close to complete so the Live Demo Flow checklist references real, working things. However, the presentation deck pages themselves can be written before all workers are live — just note any sections that depend on not-yet-built items.
- PRD-10 (Teaching Hub page ID: `36ffc8f4-554c-81a8-9a77-c1abefc99d18`) — the presentation links to existing workspace explainers where appropriate.

## Inputs
- `BASE_NOTION_PAGE` — presentation deck lives under a new "Round 2 — CRO Presentation" top-level page here.
- Round 2 problem statement (`round-2-problem-statement.md` in the repo root) — use the exact CRO quotes from that document in the "What We Heard" section.
- Arcline persona details: VP of Engineering (original champion), CRO (new stakeholder), Director of Sales Enablement (new stakeholder).

## Outputs

### Part A: Notion presentation pages
A parent page titled `"Round 2 — Arcline CRO Presentation"` under `BASE_NOTION_PAGE` with 5 sub-pages:
1. `Agenda`
2. `What We Heard`
3. `Discovery Questions`
4. `Live Demo Flow`
5. `Objection Prep`

### Part B: Candidate agent walkthrough guide
A 6th sub-page titled `"Candidate Agents — Practice Guide (Dan Only)"` — a step-by-step guide for Dan to manually build and then delete 4 Notion Custom Agents before the interview.

## Design

### Parent page structure
```
Round 2 — Arcline CRO Presentation/
├── Agenda
├── What We Heard
├── Discovery Questions
├── Live Demo Flow          ← checkboxes, Dan checks off as he goes
├── Objection Prep
└── Candidate Agents — Practice Guide (Dan Only)
```

### Page 1: Agenda

Use a callout block for the session header, then a 4-row table:

| Time | Section | Owner | Goal |
|---|---|---|---|
| 0–5 min | Intro & framing | Dan | Set context for all 3 stakeholders; acknowledge CRO as new voice in the room |
| 5–12 min | Discovery | Dan (facilitated) | 3 targeted questions; at least 1 directed at CRO, 1 at Dir of Sales Enablement |
| 12–38 min | Live demo | Dan | Walk EPD pipeline → GTM pipeline; show Cross-Ref and Battle Card update live |
| 38–40 min | Commercial close | Dan | Tie each feature to pain; address quorum question; propose next step |

Opening statement to include verbatim on the Agenda page (callout block, highlighted):
> "Welcome — I know this is a new conversation for some of you. My goal today is to show you that the same system we built for your EPD can do for your revenue team what it's already doing for engineering: surface the right information to the right person at the right moment, automatically."

### Page 2: What We Heard

Three-column layout (use toggle blocks or a table). Pre-filled from the Round 2 problem statement and Arcline's context:

| Stakeholder | Pain Point | "Without this" scenario |
|---|---|---|
| VP of Engineering | EMs spend 3–4 hours every Monday manually assembling the EPD from GitHub, Jira, Slack, Figma | Digest arrives Tuesday, leadership reviews stale data, sprint decisions lag by a week |
| CRO | GTM teams are spread thin; doesn't know if engineering releases are being communicated to active deals fast enough | Rep in a negotiation doesn't know AuthShield just shipped the exact feature their prospect asked for; deal stalls |
| Dir. of Sales Enablement | Battle cards are always out of date; reps go into competitive calls without current positioning | Rep faces a Linear comparison without knowing FieldKit just addressed the offline sync gap Linear can't match |

Include the CRO's exact quote from `round-2-problem-statement.md`:
> "My GTM teams are already spread thin. If Engineering gets an AI-powered digest, great — but I need to understand two things. First, does this actually improve our ability to ship and communicate product updates to customers faster? Second, if we're going to invest in AI tooling company-wide, I want to see how this same approach could help my revenue teams."

### Page 3: Discovery Questions

Three callout blocks, one per question. Each includes: the question to ask, who it's directed at, what you're listening for, and how it connects to the demo.

---

**Question 1 — For VP of Engineering:**
> "When a new feature ships this week, how does that information get to your top three enterprise accounts?"

*Listening for:* manual email, Slack pings, or "it doesn't reliably." Any of these opens the Release Bridge demo.
*Demo connection:* AuthShield shipped → Bridge Worker → 3 deals flagged automatically, same day.

---

**Question 2 — For CRO:**
> "When one of your reps is in a late-stage deal and engineering ships something that directly addresses the prospect's concern — how fast does the rep hear about it today?"

*Listening for:* "end of sprint," "monthly all-hands," or "whenever someone thinks to tell them." This is the gap the Release Bridge closes.
*Demo connection:* Show the Release Cross-Ref section of GTM Daily Digest — Vantage Logistics flagged within seconds of the Master EPD publishing.

---

**Question 3 — For Director of Sales Enablement:**
> "How often are your battle cards out of date at the exact moment a rep needs them in a competitive evaluation?"

*Listening for:* "always," "we update them quarterly," or "when we remember." Any answer validates the Battle Card Updater use case.
*Demo connection:* Linear battle card updated in the same run that AuthShield published — timestamped proof.

### Page 4: Live Demo Flow

A numbered checklist using Notion checkbox blocks. Dan checks each off during the live session.

```
□ 1. (2 min) Recap: EPD pipeline is live for W21
     → Open Master EPD Weekly → show Key Releases section (new from PRD-17)
     → "This is what shipped. VP Eng already uses this every Monday."

□ 2. (1 min) GTM Highlights property
     → Still in Master EPD row → show GTM Highlights field
     → "150 words. No PR numbers. Written for your revenue team."

□ 3. (2 min) GTM Weekly Briefs (CRO-facing artifact)
     → Open GTM | Weekly Briefs database → "GTM Weekly — 2026-W21" row
     → "One row per week — Week Of, Status, deals flagged, all filterable. This is the
        version your team can subscribe to. No engineering context required."
     → [Note: this is now a database (NOTION_IDS.dbs.gtmWeeklyBriefs =
        379fc8f4-554c-803c-acbb-dccd29e576bf — created live by Dan 2026-06-08, see
        PRD-13 Addendum), not a page hierarchy — see PRD-17 "Spec Update" for why.
        The DB itself is live; the "GTM Weekly — 2026-W21" row still needs to be
        written by PRD-17's rebuilt Tool 6 before this demo beat is walkable
        end-to-end — update this beat to drop the bracket once that row exists.]

□ 4. (2 min) GTM Daily Digest
     → Open GTM | Daily Digest → today's row
     → Walk through: Deal Updates / Pipeline Health / Action Items / Flags for CRO
     → "Every morning. Not just Monday."

□ 5. (2 min) Release Bridge demo — the AHA moment
     → Open GTM | Daily Digest → Release Cross-Ref section
     → "AuthShield shipped this week. These 3 deals should hear about it. Today."
     → Highlight Vantage Logistics ⚠ AT-RISK flag

□ 6. (2 min) Battle Card update
     → Open GTM | Battle Cards → Linear row
     → Show "[NEW THIS WEEK] AuthShield..." entry in Our Differentiators
     → "Same run. No one had to update this manually."

□ 7. (3 min) "Let's build one together"
     → Open a pre-built Candidate Agent (e.g., Renewal Risk Radar)
     → Walk through the plain-language instructions in the Notion Custom Agent UI
     → "This is all it takes to add a new agent to the system. No code, no deploy."
     → If they suggest a use case: "Let's build it right now."
```

### Page 5: Objection Prep

Five callout blocks. Each is one objection + a direct response + a demo action.

**"My team is too busy to set this up."**
Response: The entire EPD pipeline runs from a single command. New agents are created in the Notion Custom Agent UI — you describe what you want in plain language and Notion generates the instructions. No engineering involvement required for the common cases.
Demo action: Show the Notion Custom Agent UI for one of the pre-built candidate agents.

**"How do I know the AI output is accurate?"**
Response: Three safeguards: (1) every factual claim in the EPD links back to a source record in the Mirror DB — one click from the digest to the original PR, ticket, or thread; (2) the HITL approval gate means an EM reviews every squad summary before it reaches the VP; (3) the eval harness scores the agent output at 81% trust against hand-authored ground truth.
Demo action: Open Master EPD Weekly → click a citation → trace it back to the Mirror DB row.

**"We already have Salesforce for pipeline data."**
Response: Salesforce is an input to this system, not something it replaces. The GTM | Opportunities database is your Salesforce mirror — it holds the deals, stages, and product interests. The pipeline reads from it; it never overwrites it. When you're ready, replacing the mock Opportunities DB with a live Salesforce sync is a single integration step.
Demo action: Show the GTM | Opportunities DB and the relation to PRDs — "this is what Salesforce would feed."

**"What does this cost?"**
Response: The Arcline implementation runs on Notion Business Plan (which you likely already have) plus Anthropic API. At the fixture data volume, the full weekly pipeline costs approximately $2–5 per run — that's the cost of 3 minutes of an EM's time versus the 3–4 hours it replaces.
Demo action: Open Agent Run Log → Token Cost USD column → "here's the actual cost per run."

**"Who maintains this after the pilot?"**
Response: The day-2 operations guide (walkthrough page in the teaching hub) covers the three most common changes — adding a new data source, adding a new squad, adding a new agent — and none of them require code changes. The Custom Agents are Notion pages; editing their behavior is editing a page. The workers are deployed once and require no changes unless the database schema changes.
Demo action: Navigate to Teaching Hub → "Day-2 Operations" explainer (PRD-20).

### Page 6: Candidate Agents — Practice Guide (Dan Only)

**⚠️ Implementation note:** The implementing Claude session should write this guide as Notion page content. Do NOT create the actual Notion Custom Agents. Dan must create them manually, practice the demo, and then delete them before the interview so the live creation is authentic.

---

**How to use this guide:**
1. Build each of the 4 candidate agents below using Notion's Custom Agent UI.
2. Practice running them and walking through their configuration to a simulated audience.
3. Delete all 4 agents 24 hours before the interview.
4. During the interview, pick the one that resonates most with the audience and recreate it live.

---

**Candidate Agent 1: Sales Call Summarizer**
- **Name:** Sales Call Summarizer
- **Access:** GTM | Meeting Notes, GTM | Opportunities
- **Trigger:** Manual (or when a new Meeting Notes row is created)
- **Instructions to type into Notion Custom Agent:**
  > "When given a meeting notes page, analyze the call and produce: (1) Key objections raised and how they were handled, (2) Competitor mentions and context, (3) Rep coaching suggestions — talk time, question quality, objection handling score 1-10, (4) Recommended next action for this deal. Keep it under 200 words. Write your output as a comment on the meeting notes page."
- **Demo moment:** Show this running on the Vantage Logistics at-risk call — the coaching score and competitor alert would have surfaced the Linear threat earlier.

---

**Candidate Agent 2: Release Notes Generator**
- **Name:** Release Notes Generator
- **Access:** Master EPD Weekly (or GTM | Weekly Briefs)
- **Trigger:** Manual, after GTM Weekly publishes
- **Instructions:**
  > "Read this week's GTM Weekly Briefs row in GTM | Weekly Briefs. For each item in 'What Shipped This Week', write three versions of a release note: (1) For developers — technical details and migration notes, (2) For admins — configuration changes and permissions, (3) For end users — what's new and how to use it. Format as three clearly labeled sections per feature."
- **Demo moment:** Dir of Sales Enablement will immediately see this as their release comms solution — one agent, three audiences, no manual drafting.

---

**Candidate Agent 3: Renewal Risk Radar**
- **Name:** Renewal Risk Radar
- **Access:** GTM | Opportunities, GTM | Meeting Notes
- **Trigger:** Weekly (Monday morning, 1 hour before standup)
- **Instructions:**
  > "Every Monday, check for Opportunities where Close Date is within 90 days and Health is at-risk or churned. For each, find their most recent Meeting Notes. Write a renewal risk brief: deal name, close date, last meeting sentiment, key risk factors, recommended escalation action. Keep each entry to 3 sentences. Post results as a comment on this week's row in GTM | Weekly Briefs."
- **Demo moment:** CRO's "my team is spread thin" objection answered — the radar surfaces at-risk renewals before the weekly standup, no manual pipeline review needed.

---

**Candidate Agent 4: Competitive Mention Tracker**
- **Name:** Competitive Mention Tracker
- **Access:** GTM | Meeting Notes
- **Trigger:** Daily (end of day)
- **Instructions:**
  > "At the end of each day, scan all Meeting Notes created today for competitor mentions in the 'Competitor Mentioned' field. Group by competitor. For each, list: which deals mentioned them, what context, and the current battle card differentiator for that competitor from GTM | Battle Cards. Format as a 3-column table: Competitor / Deals / Recommended response. Post to the GTM Daily Digest for today."
- **Demo moment:** Dir of Sales Enablement sees this as their competitive intelligence ops tool — daily signal without any rep admin overhead.

---

**After the interview:** If the session goes well and the interviewer wants to see a 5th use case, the most likely ask is a **Win/Loss Analyzer** ("when we close a deal, what can we learn?"). Template: read the closed Opportunity and all linked Meeting Notes → summarize the deal story → identify the top 3 win/loss factors → output as a comment on the Opportunity page.

## Acceptance Criteria
1. Parent page "Round 2 — Arcline CRO Presentation" exists under `BASE_NOTION_PAGE` with 6 sub-pages.
2. Page 2 (What We Heard) contains the exact CRO quote from `round-2-problem-statement.md`.
3. Page 3 (Discovery Questions) has 3 questions with "listening for" and "demo connection" notes for each.
4. Page 4 (Live Demo Flow) has 7 numbered checkbox items, each with a time estimate and a Notion navigation action.
5. Page 5 (Objection Prep) covers all 5 objections listed in the Design section.
6. Page 6 (Candidate Agents guide) has 4 agent templates with names, access lists, trigger descriptions, and copy-paste instructions for the Notion Custom Agent UI. Page includes a prominent ⚠️ note that Dan builds and deletes these manually.
7. No actual Notion Custom Agents are created by the implementing session — only the written guide pages.

## Out of Scope
- Dan's biography / personal intro — this is not scripted; it's a 5-minute spoken section.
- Creating actual Notion Custom Agents (Part B is a written guide only).
- Slide deck in any tool other than Notion — the entire presentation lives in Notion.
- Updating the interview prep skill (PRD-11) — that is a separate artifact for architecture Q&A.

## Open Questions
- None. The implementing session should write all pages with the detail specified above, using callout blocks, toggle blocks, and checkbox blocks where indicated to match Notion's native formatting.

## Verification
Open Notion → `BASE_NOTION_PAGE` → "Round 2 — Arcline CRO Presentation":
- Confirm 6 sub-pages exist with the exact titles listed in the Design section.
- Open "What We Heard" → confirm CRO quote is present verbatim.
- Open "Live Demo Flow" → confirm 7 numbered checkbox items are clickable.
- Open "Candidate Agents — Practice Guide" → confirm ⚠️ note is at the top, 4 agent templates present.
- Confirm there are no actual Notion Custom Agents created in the workspace by this session.
