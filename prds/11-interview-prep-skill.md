# PRD-11 — `/interview-prep` Claude Skill

<!-- status:
state: in-review
owner: sonnet-2026-06-01-F1
updated: 2026-06-02T00:00:00Z
notes: AC1/2/3/4 ✅ — 5 skill files: SKILL.md + instructions.md + question-bank.md (36q) + grading-rubric.md + session-log.md. Cross-session score tracking added post-initial-build. PRD-09 dep waived by Dan.
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
- "What happens to your system when Arcline adds a 4th squad? Walk me through every file that needs to change." (Honest answer: `SQUAD_PAGE_ID` map in both workers requires a deploy — note this as known tech debt and describe the dynamic-lookup fix.)
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

- **Squad/source hardcoding — fix before building the question bank.** Both workers (`workers/summarizer/src/index.ts` and `workers/summarizer-product/src/index.ts`) have two places that require a code change when squads are added or removed: (1) the `SQUAD_PAGE_ID` static map (slug → Notion page ID), and (2) the `Squad` type union + `squad` enum on each tool schema. The fan-in threshold is already dynamic (queries Squads DB at runtime); the slug→ID map is not. Fix: replace the static map with a live lookup against the Squads DB at tool call time, keyed on the `SquadId` property. Same principle applies to adding/removing a source — `PER_SOURCES`, the `Source` type, and the `EXCERPT_PROP`/`URL_PROP` maps all need updating, but those are intentional code-level decisions. The squad map is the part that should not require a deploy. Add "What breaks when Arcline adds their 4th squad?" to the question bank — this is the honest answer.

## Verification
- Run `/interview-prep` locally. Get asked a question. Answer. Observe follow-up. End session and see debrief.

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

### What was actually built

- **`.claude/skills/interview-prep/SKILL.md`**: Skill manifest + full session flow (open → pick question → wait → evaluate → follow-up → debrief). The brief described `instructions.md` as containing everything; the session split it into four files for modularity. SKILL.md is the entry point the harness loads on `/interview-prep` trigger. Includes variant triggers: `/interview-prep debrief`, `/interview-prep category <name>`, `/interview-prep hard`.
- **`.claude/skills/interview-prep/instructions.md`**: Interviewer persona named **Jordan** (not in brief), ground rules (one-question-at-a-time, no hollow praise, stay in persona), escalation signals, and the full debrief template. The persona name is a useful anchor for the model to stay in character.
- **`.claude/skills/interview-prep/question-bank.md`**: 36 questions across 4 categories (10 Why-design, 10 What-breaks, 8 Adversarial, 8 Soft-skills). Brief asked for ≥30; landed at 36. Each question includes a "Key thing to probe" column so the model knows what a strong answer must hit — this doubles as a silent eval guide without exposing the rubric to Dan mid-session.
- **`.claude/skills/interview-prep/grading-rubric.md`**: 3-tier scoring (Strong/Adequate/Weak/Miss), per-category rubric of what a strong answer looks like, category weights for debrief emphasis, and a list of escalation triggers.
- **`.claude/skills/interview-prep/session-log.md`** *(added post-initial-build)*: Persistent cross-session score log. The skill appends a structured entry after every debrief (question IDs scored Weak/Strong, per-category summary, one-line gap note) and reads it at session start to bias question selection toward historically weak categories. A fifth trigger variant `/interview-prep history` prints a cross-session trend summary. This was not in the original PRD brief — added at Dan's request.
- **`SKILL.md` + `instructions.md` updated** *(added post-initial-build)*: SKILL.md gained session-log read logic (tally weak categories, bias toward them, avoid repeat-struggle questions in favour of adjacent variants), step 9 (auto-write log after debrief), and the `/interview-prep history` trigger. `instructions.md` gained a "Session log writing" section with the exact append format and conservative scoring rule (one Weak answer makes the whole category Weak in the log entry).

### Gotchas for downstream sessions

**1. PRD-09 dep waived — skill built against static repo state, not live submission HTML**
The brief deferred this PRD until PRD-09 (submission HTML) was completed so the skill could reference the live build. Dan waived the dep. The question bank was authored against the existing PRDs, live Notion workspace schema, and eval metrics (PRD-08 Trust Score = 81%). If PRD-09 adds significant new framing or artifacts, the question bank's "Adversarial" category (especially A3 on runtime SLA) should be revisited.

**2. Open Question on MCP wiring was deferred, not answered**
The PRD asked whether the skill should wire live Notion MCP access so the interviewer can say "open this page." The session chose static repo state (no MCP wiring) — keeps the skill portable and doesn't require workspace credentials in every session. If a future session wants to add live workspace probing, add a `## Live Workspace Mode` section to SKILL.md and gate it on a `/interview-prep live` trigger variant.

**3. Question bank "Key thing to probe" is intentionally visible to the model, not Dan**
The table column "Key thing to probe" in `question-bank.md` is the model's silent rubric — it tells the interviewer what a strong answer must contain without showing Dan the answer. Don't move this column into a separate file or strip it out thinking it's redundant; it's what makes follow-up questions accurate rather than generic.

**4. Squad-hardcoding open question captured as a question (B9), not fixed**
The PRD flagged `SQUAD_PAGE_ID` hardcoding as a pre-build fix. The session treated it as a known architectural gap and made it Question B9 in the question bank ("The squad-page ID map is hardcoded in both summarizer workers. What's the live impact today, and what's the fix?"). The actual code fix (replacing the static map with a live Squads DB lookup) was not implemented — it's a worker-layer change outside PRD-11's scope. If this gets fixed before the interview, update B9's "Key thing to probe" column to reflect that it's no longer an open gap.

**5. Session log is the skill's only persistent state — treat it as append-only**
`session-log.md` is a plain markdown file the skill appends to via the Edit tool. It is the sole cross-session memory mechanism. Do not rename or move it without updating the path reference in both SKILL.md (Before starting + step 9) and instructions.md (Session log writing section). The file does not need to be committed to git for the skill to function — it lives in `.claude/skills/` which is personal tooling. If it gets deleted, the skill degrades gracefully (treats all categories as equal weight), so no data-loss risk to the interview flow itself.
