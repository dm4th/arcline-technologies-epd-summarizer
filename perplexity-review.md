<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Can you review this technical take home I have for a job interview with Notion? I'm curiuos what your take is andhow you'd approach it: https://notion.notion.site/Solutions-Engineering-Technical-Screen-32eefdeead0580ad8f5edde79b74ac5a

Unfortunately, I'm unable to access the page directly — it's hosted on a public Notion site outside your connected workspace, and the fetch is returning an access/not-found error. Could you **paste the content of the take-home** directly into the chat? Even a quick copy-paste of the instructions would work perfectly.

That said, based on your background (full-stack dev, heavy Notion power user, AI/LLM experience, and RCM/healthcare SaaS context), here's how I'd **generally approach a Notion Solutions Engineering technical screen** while you grab that content:

## What These Screens Typically Cover

Notion SE take-homes usually test a combination of:

- **Workspace architecture** — designing databases, relations, rollups, and views for a realistic business scenario (e.g., a CRM, project tracker, or OKR system)
- **API/integration work** — using the Notion API to create/update pages, query databases, or build a lightweight automation
- **Solutions thinking** — writing up how you'd implement and *explain* the solution to a non-technical customer


## How to Stand Out

- **Show depth in the data model** — use relations and rollups, not just flat tables; this signals you understand Notion's core paradigm
- **Anticipate the "customer" angle** — SE roles are customer-facing, so frame your solution around a use case narrative, not just technical correctness
- **API polish** — if there's a coding component, clean error handling and comments matter more than clever one-liners
- **Notion AI / automation hooks** — if applicable, showing awareness of Notion AI, automation, or the new API features (like comments, databases v2) signals you're current


## Leveraging Your Background

Given your experience, you have a strong edge:

- Your **AI agent and LLM work** is directly relevant if the prompt involves automation or integrations
- Your **RCM/SaaS database design** experience translates well to complex relational Notion schemas
- You can frame examples from your actual work building Notion templates and agents

Go ahead and paste the prompt — I can give you specific, line-by-line guidance on approach, architecture decisions, and what to prioritize! 🚀

---

# \# Solutions Engineering Technical Screen

### The Prompt

**Scenario:** You're supporting a pre-sales POC with **Arcline Technologies**, a 1,200-person SaaS company with a fast-growing Engineering, Product, and Design (EPD) org. Their VP of Engineering has reached out after seeing a demo of Notion AI. He tells you:

*"Our engineering teams are spread across 8 squads with PMs and designers embedded in each. Every Monday, engineering managers spend 3 to 4 hours manually stitching together sprint status from Jira, GitHub PRs, Slack threads, and design review notes in Figma just to produce a weekly EPD digest for leadership. By the time it reaches the VP level, it's already outdated and missing context. We'd like to use AI to automate this, but our leadership makes resourcing decisions based on this digest. If the AI hallucinates a status update or misinterprets a PR's intent, that's a real problem. How do we trust the output?"*

**Your task:**

1. Identify the 3-5 questions you'd ask before designing anything, and explain why each one matters.
2. Design an build a V1 agentic workflow that addresses this problem. Include: the trigger, the data sources the agent touches, the steps it takes, and what it outputs.
3. Identify the two biggest risks in your design and how you'd mitigate them.
4. Describe how you'd structure a POC (Proof of Concept) for this workflow - what does success look like at the 30-day mark?

Be prepared to walk through your Agentic workflow, and add 2 additional components based on feedback.

Here's my full take on the prompt, along with an interactive HTML presentation you can use to walk through it. Here's the breakdown of my approach:

***

## Overall Read on the Prompt

This is a strong, realistic SE prompt — Notion is testing whether you can **think like a solutions architect** (not just a demo jockey), specifically around the hard part: **AI trust and hallucination risk**. The VP's quote is the real signal. They're not asking "can you automate this?" — they're asking "how do you design for accountability?" Every answer should ladder back to that.

***

## Part 1: The 5 Discovery Questions

The questions I'd prioritize, and *why each matters* for design decisions:

1. **Who reads the digest and what decision do they make?** — Determines the trust threshold. VP making headcount calls ≠ team standup.
2. **What does "untrustworthy" look like to you specifically?** — Trust isn't binary; knowing what *breaks* it lets you design explicit guardrails vs. vague "we'll use AI carefully."
3. **Which data source has the cleanest structure?** — V1 should start with Jira + GitHub (structured APIs), not Slack (unstructured natural language). This scopes hallucination risk.
4. **What's the current digest format?** — If leadership has a mental model, the AI output must match it or you've traded production burden for comprehension burden.
5. **Is there tolerance for a human review gate initially?** — This is the trust unlock. An EM spending 15 minutes reviewing a draft vs. 3–4 hours building from scratch is still a massive win.

***

## Part 2: The Workflow Design

The key architectural decision I'd defend: **trust-first, not speed-first**.

- **Trigger**: Monday 6 AM cron → 8 parallel squad agents
- **Data sources**: Jira (Tier 1, structured), GitHub (Tier 1, structured), Slack (Tier 2, supplementary only)
- **Core innovation**: Every claim gets a **confidence score** (HIGH/MEDIUM/LOW) with a source URL. LOW-confidence items go into a "Needs Verification" section — they never appear in the main narrative
- **Human gate**: EM reviews in Notion by 8:30 AM before anything reaches the VP. The agent draft is a *starting point*, not an autonomous publisher
- **Output**: VP page with squad rollup + AI confidence indicator showing % of HIGH vs MEDIUM content

The decision to **exclude Figma from V1** is intentional — design review notes have no structured API and high variance by team. Add it in V2 once trust is established.

***

## Part 3: The Two Biggest Risks

**Risk 1 — Hallucinated status:** Mitigated by grounding all claims in Jira ticket status, hard-constraining the prompt ("Never state completion unless Jira status = Done"), and source-linking every claim.

**Risk 2 — Silent data staleness:** Mitigated by surfacing `last_updated` timestamps on every source, halting generation (not proceeding with incomplete data) if an API call fails, and flagging "⚠️ Data Incomplete" rather than generating false confidence.

***

## Part 4: The 30-Day POC

The structure I'd pitch: **Week 1** = shadow mode (AI draft vs. manual, side by side), **Week 2** = accuracy audit and prompt tuning based on *real* errors, **Week 3** = first live delivery with EM gate, **Week 4** = measure and Go/No-Go decision. Success at Day 30 = EM spending <20 minutes reviewing, VP receiving zero corrections post-delivery, and the EM independently saying they wouldn't go back.

***

## What to Prepare for the "Add 2 Components" Live Question

Common directions they'd push:

- **Figma integration** — design review status from named Figma files
- **Cross-squad blocker detection** — agent identifies dependencies between squads and surfaces them proactively
- **Feedback loop** — EM edits feed back into prompt improvement over time
- **Notion AI summarization layer** — using Notion AI natively on already-populated pages rather than external LLM

Given your background in AI agents and Notion, I'd especially lean into the feedback loop component — it turns the system into a self-improving agent over time, which is a strong SE-to-product conversation.

