# PRD-10 — Teaching Layer

## Goal
Embed short "How this works / How to change this" explainers in the Notion workspace alongside every database and agent, so Arcline can maintain and extend the system without Notion's help.

## Why this exists
Dan's stated belief: a great SE teaches the customer to fish. This PRD operationalizes that — the workspace itself becomes its own documentation, which is also a flex for the interviewer (a customer can see exactly what the post-handoff experience looks like).

## Dependencies
- PRD-01 (DBs exist).

## Inputs
- Outputs of every other PRD (the things being explained).

## Outputs
- One **Explainer page** per database, co-located beneath the DB's page:
  - *What this is*
  - *Who writes to it* (agent name + PRD reference)
  - *Who reads from it*
  - *How to add a property* (numbered steps with screenshots if possible)
  - *How to change the agent* (link to the agent's PRD + a "What you'd edit" pointer)
- One **Agent Explainer page** per agent: roughly the same template, focused on the agent's prompt and trigger.
- A top-level **"How this workspace works"** page that links to everything and shows the data-flow diagram (same SVG as in `submission.html`).

## Design
- Tone is SE-to-customer: warm, explanatory, never breaks the fourth wall about the take-home. (The "I'm Dan, a candidate" voice lives only in `submission.html` — see PRD-09.)
- Each explainer caps at ~250 words. Brevity is the teaching.
- Every explainer ends with a "What to do if this breaks" callout — links to the Weekly Pipeline Dashboard (PRD-07) and the Agent Run Log filter for that agent.

## Acceptance Criteria
1. Every DB in PRD-01 has a co-located explainer page.
2. Every agent in PRD-03/04/05 has an explainer page.
3. The top-level "How this workspace works" page renders the architecture diagram inline.
4. Word-count audit: no explainer exceeds 300 words.

## Out of Scope
- Video tutorials per agent (nice-to-have; one optional Loom referenced from the top-level page is enough).

## Open Questions
- Should the explainers be Notion AI-summarized from the PRDs to keep them in sync? Recommend: hand-authored for V1 (control), with a note in the page that says "to regenerate, see <command>." V2 can automate.

## Verification
- Click the top-level "How this workspace works" page. Follow links to a DB explainer, then an agent explainer. Verify they exist and read well.
