# Enterprise Solutions Engineer Presentation Prompt 
## 👋 Brief Biography, Why Notion, Why You? [5min]
- Personal/Professional background
- Why you’re interested in Notion
- Why you’re a great fit for the Enterprise SE role at Notion

## 🏦 Notion Mock Presentation [35min]
In Round 2, you designed an agentic workflow for Arcline Technologies to automate their weekly EPD digest. Your design was shared with Arcline's leadership and they've agreed to move forward with a paid pilot. However, a new stakeholder has entered the picture: **Arcline's Chief Revenue Officer (CRO)**, who wants to understand the commercial case before committing headcount to the rollout.
Your task is to present your solution presentation, demo it live in Notion, and make the CRO see this as a revenue-enabling investment, not just an engineering productivity tool.
Context

The VP of Engineering championed the pilot internally. But the CRO has questions:

>"My GTM teams are already spread thin. If Engineering gets an AI-powered digest, great — but I need to understand two things. First, does this actually improve our ability to ship and communicate product updates to customers faster? Second, if we're going to invest in AI tooling company-wide, I want to see how this same approach could help my revenue teams — sales enablement, customer-facing release notes, competitive intelligence."

The CRO controls a significant portion of the tooling budget and can either accelerate or block enterprise-wide adoption.

### Participants (role-played by your interviewers)
- VP of Engineering — your original champion; focused on EM time savings and digest accuracy
- CRO — new to the conversation; thinks in terms of revenue impact, GTM velocity, and cross-org leverage
- Director of Sales Enablement — wants to know if the same agentic approach could automate internal release comms and competitive battle cards

### Objectives
- Frame the narrative for a revenue-focused audience: Set a clear agenda that acknowledges the CRO and Sales Enablement Director as new stakeholders.
- Demonstrate understanding of cross-org needs: Signal how the engineering story connects to business and GTM impact.
- Conduct targeted discovery: Ask 2–3 questions before demoing, with at least one directed at the CRO or Sales Enablement Director, to surface revenue-side pain points and priorities.
- Present your Live Solution: Walk through the EPD digest workspace and at least one Custom Agent live, explicitly showing how digest output feeds downstream consumers, how the agent architecture is applicable for GTM use cases, and how Notion's workspace structure supports cross-org visibility without over-sharing sensitive data.
- Tie capabilities to pain points: Connect every feature and workflow shown back to the specific pain points and GTM gaps surfaced in discovery and "What we heard."
- Handle objections: Confidently handle pushback from the CRO and Sales Enablement Director.

### 💡 Tips & Best Practices
- Build all content in Notion
- You will need a Notion Business Plan. If you do not have an active trial, reach out to your recruiter to receive an upgraded Notion workspace!
- Your Custom Agent should be functional enough to walk through live.
- We’re evaluating your ability to identify customer pain points, conduct technical discovery, and consult on pragmatic solutions.
- You are not expected to be a Notion expert, but you should be able to identify the prospect’s pain and show us something within the product that solves for that pain.


# Dan's Initial Reactions
- CRO is going to be the main buyer. Need to first prove that we can build a similar system for his GTM team as it was the first contention he raised (i.e. his team is strapped)
    - We can (and should) build a similar pipeline that reads from meetings notes taken with Notion's meeting notes tool and a "Salesforce" opportunities database just like the other data sources we made for the eng side.
    - Populate these notes daily to demonstrate the value of a small summarization task bubbling up issues for a strapped team on a daily basis rather than jsut weekly
- Need to focus the beginning part of the meeting to do **very quick** demos to get them ideating on what else they could build with agents in Notion. Set up an infra to try to build an agent on the fly with them in the room
- Updates to existing infra
    - Squad Summarizer needs to highlight key releases in a enw section of their summary
    - Master summarizer collects these, and writes them to a GTM Weekly document for the revenue org VPs
    - Cross reference with opportunities in Salesforce to reach out to them with new release news proactively
    - Cross reference with known competitors capabilities for updating battle cards
        - Should use product roadmaps for this anyway
- I have already built an AI-Native GTM hub in Notion in my personal website. You should definitly look there for more ideas and ways to build meeting analyzers and display content. You can find this at one up from the level of the root directory here