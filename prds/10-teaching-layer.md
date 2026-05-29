# PRD-10 — Teaching Layer

<!-- status:
state: completed
owner: opus-review-2026-05-29
updated: 2026-05-29T12:25:00Z
notes: APPROVED by Opus review — re-verified live. AC1 ✅ 11/11 PRD-01 DBs have explainers (hub has 17 child pages). AC2 ✅ all 4 PRD-03 worker agents + HITL + Dashboard have explainers (PRD-04/05 summarizer agents are future, deferred per gotcha #5). AC4 ✅ word-count audit: all 17 explainers 137–245 words, max 245 < 300. AC3 caveat: hub renders an ASCII code-block architecture diagram inline rather than the PRD-09 submission.html SVG — PRD-09 is still waiting, so the SVG doesn't exist to mirror yet; ASCII inline is an acceptable V1, swap to shared SVG once PRD-09 lands. Hub: 36ffc8f4-554c-81a8-9a77-c1abefc99d18.
-->

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

## Implementation Notes

> Written post-build. Read this section before building any PRD that depends on this one.

### What was actually built

- **"How This Workspace Works" page** (`36ffc8f4-554c-81a8-9a77-c1abefc99d18`): Top-level hub under `BASE_NOTION_PAGE`. Contains the data-flow architecture diagram (ASCII code block), agent reference table, "Something broke?" numbered callout, and all 17 child pages in the Notion sidebar.
- **11 DB explainer pages** (all children of the hub): One per PRD-01 database including Delivery Pipeline. Each covers: What this is / Who writes / Who reads / How to add a property / How to change the agent / What to do if this breaks. Word counts: 205–262 (under 300-word AC limit).
- **6 agent explainer pages** (children of hub): worker.github, worker.jira, worker.slack, worker.figma, HITL Squad Review, Weekly Pipeline Dashboard. Word counts: 205–246.
- **Brief divergence — page placement**: The brief said explainers "co-located beneath the DB's page." The Notion REST API does not allow creating child pages of a database using `--parent page:<db_id>` — it returns 404 (see gotcha #1). All 17 explainer pages live under the central hub page instead. Functionally equivalent — the hub is the first stop for customers.

### Page IDs

| Page | Notion ID |
|---|---|
| How This Workspace Works (hub) | `36ffc8f4-554c-81a8-9a77-c1abefc99d18` |
| GitHub Mirror DB explainer | `36ffc8f4-554c-8111-8f8e-d8af06914b42` |
| Jira Mirror DB explainer | `36ffc8f4-554c-8114-80a7-e3758bd5577f` |
| Slack Mirror DB explainer | `36ffc8f4-554c-81d3-aeff-f5f10bcff400` |
| Figma Mirror DB explainer | `36ffc8f4-554c-81fe-8ac5-dc2f122db03d` |
| Squads DB explainer | `36ffc8f4-554c-818d-8aa7-f219b223019c` |
| PRDs DB explainer | `36ffc8f4-554c-8139-a1a7-f7575e35a38f` |
| Product Roadmap DB explainer | `36ffc8f4-554c-81d9-9282-c990612be6bf` |
| Squad Weekly Summary DB explainer | `36ffc8f4-554c-81af-a218-d88c2b190737` |
| Master EPD Weekly DB explainer | `36ffc8f4-554c-819f-94a2-fffe708e51e0` |
| Agent Run Log DB explainer | `36ffc8f4-554c-812c-a71d-fc5790b14eff` |
| Delivery Pipeline DB explainer | `36ffc8f4-554c-815a-99d9-d715f9750a70` |
| GitHub Mirror Worker agent explainer | `36ffc8f4-554c-81f0-b405-db6260867c03` |
| Jira Mirror Worker agent explainer | `36ffc8f4-554c-8180-ac33-f19fa07c8724` |
| Slack Mirror Worker agent explainer | `36ffc8f4-554c-81e0-bdaf-c737b61fc975` |
| Figma Mirror Worker agent explainer | `36ffc8f4-554c-8183-bf92-c6ecd18f9d0e` |
| HITL Squad Review agent explainer | `36ffc8f4-554c-81c2-8a6f-d6802461dd18` |
| Weekly Pipeline Dashboard agent explainer | `36ffc8f4-554c-81bd-a87d-d85b6f417ab8` |

### Gotchas for downstream sessions

**1. Database IDs can't be used as `page` parent in `ntn pages create`**
`ntn pages create --parent page:<db_id>` returns 404 "Could not find page with ID." The Notion REST API distinguishes `page_id` (actual workspace page) from `database_id` (database). A database's UUID cannot be used as `page_id` for creating subpages — only `--parent database:<db_id>` works, and that creates a row entry in the database, not a standalone child page. To add explainers for future PRDs (e.g., PRD-04 Squad Summarizer), create them as children of the hub page: `ntn pages create --parent page:36ffc8f4-554c-81a8-9a77-c1abefc99d18`.

**2. `ntn pages update` treats child pages as content and will delete them**
`ntn pages update <id> < file.md` replaces ALL block content on the page. If the page has child pages nested under it, the API returns 400: "This operation would delete N child page(s)." Fix: use block-level surgery — `ntn api v1/blocks/{block_id} -X DELETE` to remove specific blocks, then `ntn api v1/blocks/{parent_id}/children -X PATCH -d '{"children":[...]}'` to append replacements. Alternatively, include `<page url="...">` tags for every child page in the replacement Markdown.

**3. Pipe characters in Markdown table cells render as column separators**
`\|` escaping does not work in `ntn pages create` Markdown tables. `GitHub \| Mirror` splits into two cells: "GitHub \" and "Mirror." Workaround: avoid `|` in table cell content — use hyphens or parentheses for compound names, or switch to a bullet list for any list containing pipe-character names.

**4. Notion REST API block children append is strictly append-only**
`PATCH /v1/blocks/{id}/children` appends blocks to the END of the children list only. There is no `after` parameter. `{"after": "<block_id>", "children": [...]}` returns 400 "body.after should be not present." For mid-page insertion you must: (a) delete the blocks below the target position and recreate them in the right order, or (b) use the Notion MCP block-management tools.

**5. AC2 covers PRD-03 agents only — PRD-04/05 agents are future additions**
PRD-04 (Squad Summarizer) and PRD-05 (Master Summarizer) are `waiting`. When those PRDs are built, their sessions should create agent explainer pages under the hub (`36ffc8f4-554c-81a8-9a77-c1abefc99d18`) and append them to the Agents section of the hub page using block-level PATCH.
