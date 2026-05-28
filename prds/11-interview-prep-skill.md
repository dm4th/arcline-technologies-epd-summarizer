# PRD-11 — `/interview-prep` Claude Skill

<!-- status:
state: waiting
owner: —
updated: 2026-05-28T19:52:00Z
notes: moved to post-Wave E; blocked until PRD-09 (submission HTML) is completed so the full live build is available for the interviewer to interrogate
-->

## Goal
Produce a Claude skill at `.claude/skills/interview-prep/` that role-plays a Notion-SE-interviewer, drilling Dan on the architecture, trade-offs, and risks of the workspace he just built.

## Why this exists
Dan explicitly asked for this in `solution-intro.md`. The assignment will be the basis of most of his remaining interview rounds; the skill is his rehearsal partner. Independent of the build, can be written immediately.

## Dependencies
- `09-submission-html.md` — the submission represents the completed system; the interview skill's question bank and live-workspace references only make full sense once the whole build is real and submittable.

## Inputs
- This repo's PRDs (as the interviewer's ground truth).
- `solution-intro.md` (as the artifact under interrogation).
- Once landed: the live Notion workspace (read-only via API).

## Outputs
- `.claude/skills/interview-prep/SKILL.md` — skill manifest with description and trigger phrases (`/interview-prep`).
- `.claude/skills/interview-prep/instructions.md` — interviewer persona, ground rules, question bank, scoring rubric.
- `.claude/skills/interview-prep/question-bank.md` — categorized question pool:
  - **Why this design** (probes for sprawl, HITL math, citation contract)
  - **What breaks** (failure modes per agent, what the eval would miss)
  - **Customer adversarial** (VP-style "I don't trust this", "why is it slow")
  - **Solutions Engineering soft skills** (handling pushback, scoping, pricing/expansion hooks)
- `.claude/skills/interview-prep/grading-rubric.md` — what a strong answer hits.

## Design

### Interviewer persona
- Senior Notion SE who has seen many customer POCs.
- Tonally: warm but probing. Asks one question at a time. Follows up on weak answers with "Why?" or "What would change your mind?"
- After Dan answers 3–5 questions, gives a debrief: what was strong, what was hand-wavy, what to tighten before the real interview.

### Question style (drawn from `solution-intro.md`'s adversarial-lens request)
Examples to seed the question bank:
- "You collapsed 18 approvals to 3. What's the failure mode if one EM is unavailable on Monday morning?"
- "Your Trust Score is 0.78. Walk me through where the 0.22 lives, and whether it's safe to ship to VPs."
- "Why 6 agents per squad? Why not one big agent that takes the whole week of data?"
- "Where does Notion stop and where does the customer's existing stack pick up?"
- "Cost: at Arcline's 8 squads, what's the weekly LLM bill, and how does it scale?"
- "An EM rejects a sub-summary 3 weeks in a row. What does the system do?"
- "Hallucination story: your eval is LLM-as-judge. Why isn't that circular?"

## Acceptance Criteria
1. Typing `/interview-prep` triggers the skill.
2. The skill asks one question at a time and follows up on weak answers.
3. After a session, the skill produces a written debrief.
4. Question bank ≥ 30 questions across the four categories.

## Out of Scope
- Auto-grading via test cases — V2.
- Live tool-use simulation of looking up customer answers — V2.

## Open Questions
- Should the skill have access to the live Notion workspace via MCP? Recommend: yes, read-only, so it can ask "open this page — what's wrong with how I designed it?" Implementing session decides whether to wire MCP access or use static repo state.

## Verification
- Run `/interview-prep` locally. Get asked a question. Answer. Observe follow-up. End session and see debrief.
