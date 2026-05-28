# Intro

This repository is meant to scaffold both a notion workspace as a POC for Arcline as well as create a single webpage application to help highlight what we've built. In this document, I'll lay out my strategy for how I'd like to solve this problem in my own words. This will be the source of truth for what we are builing here, and provide insight into the restrictions I'm putting on what we can solve.

This is a submission for a Solutions Engineering role at Notion, not a real customer engagement. With that in mind, please treat this as much like a customer engagement as possible. That means polish and simplicity above all else. This is meant to mimic a POC, not a fully fledged product, and explainability is of high importance.

The problem statement can be found at `problem-statement.md`

## Rules
1. We will always use product and solution surface areas native to notion wherever possible.
2. Any other agent should be able to call into our notion space to observe, test, change, and learn more about the notion-based solution we will build.
3. Strive for simplicity over a complete solution
4. One single change to assumptions should not change the full build. Flexibility is important, more important than compeleteness
5. If you need more resources, please ask rather than assume they are off limits. This includes paying for higher tiers at notion if certain features are blocked.
6. You may adjust and change the notion workspace that starts at BASE_NOTION_PAGE in the `.env.local` file as much as possible using the connection defined by NOTION_API_KEY in the `.env.local file`.
7. I need to be able to explain everything that is built. Please include explainers and how tos for everything built, and give study guides upon request.
8. My ideas for the solution are listed below. I'm looking for additional innovation on top of my ideas. The expectation is for you to go above and beyond, especially in the implementation phase.

## Notion Resources

I'd love to use the new developer features that Notion released, including workers and the Notion CLI. The CLI is already installed. please refer to the developer docs for each below:
- Notion Workers: https://developers.notion.com/workers/get-started/overview
- Notion CLI: https://developers.notion.com/cli/get-started/overview

Additionally, you can review connections (defined with the API key above) and the API docs here:
- Notion Typescript SDK: https://developers.notion.com/reference/intro#code-samples-&-sdks
- Notion API Reference: https://developers.notion.com/reference/intro


# Solution Path

## Initial Questions

I think these are the 5 questions I'd like to ask the customer:
1. In what format do the VPs tend to like to read the report, and how frequently are they making requests for updated content? --> Try to drive home at the final output and how frequently it is expected to change (i.e. flexibility)
2. Which data source(s) has the most well-structured data? What about the least-well-structured? Optionally, rank each of the data sources from 1-5, with 5 being well-structured and 1 being extremely hard to parse. --> Which data source(s) make good candidates for a 30 day POC, or shich should we leave off for deeper discovery?
3. Which parts of the process take the most amount of the time for the engineering managers? --> Time savings for that team is the core measurable KPI I'd like to pitch for them
4. What is the tolerance for human review gates in this solution? Would you accept human review in perpetuity, or is the overall goal to have a fully autonomous system? --> How much human-in-the-loop dependence can we have on the engineering managers for training, testing, and reducing the overall hallucination surface area?
5. <What question am I missing here? What am I not asking?>

## V1 Agentic Workflow

Again, please add additional ideas if I miss anything...

### Data Source Workers 
I'd like a worker to fire for each data source at 6AM Monday morning. Each worker should have read access to each of their respective data sources, and read the last week of data for each workstream into an associated database in Notion specifically scaffolded to the data source in question.
*Note: It's important that we can show feature parity with any of these other tools as much as possible. If we can help a customer reduce their SaaS tool count, that creates potential expansion opportunities for us at Notion.* 
I'd also like these workers to monitor for updates to their sorces of truth throughout the process of creating the readout. To accomplish this, we'll need `last_updated` timestamps for each record update in the data source, that the final report generation agent will be able to use to callout the scale and scope of any changes that have happened between data retrieval and report completion / report delivery. In a perfect state, the workers update the latest report throughout Monday and Tuesday so that anyone reading the report after the fact is made aware they may be looking at stale data.
#### Consolidated Actions
- Start: 6AM Monday Morning
- Reads: Records in a specified source of truth
- Writes: REcords in a mirror Notion Database to the system of record
- Ends: Once all records are written over
- Signals: Data Source Summarizers
- Quantity: 1 per data source -> 4 (GitHub, JIRA, Slack, Figma)

### Data Source & Product Progress Summarizers
These are custom agents built within Notion that read updates since the last report was generated and create a readout for the summarizer agent at the end of the agentic workflow. These agents should have conetxt of previous reports, and requests from key stakeholders of the final report on what to focus on this week. These sub-reports do not need to follow a specific structure, but I do think having them all in the same Notion database will make QA as well as generation tracking easier to manage.
*Note: Having summarizers for each data source helps us with our deployment timeline (i.e. we can include certain data sources earlier than others based on data structure and time burden for each source) and allows us to read different data structures into a consistent format that a master summary agent can read.*
One agent to also create is a "Product Roadmap Summarizer" -- This assumes the source of truth for Arcline's product roadmap is in fact housed within Notion. JIRA is where the roadmap is optimized and operationalized, but the high-level is in a Notion Product Roadmap database.
*Note: Again, show Arcline the power of Notion in so many different ways.*
Each Engineering manager/squad (i.e. 8 teams) also need some sort of a PRD that they have their high-level product requirements built from. We will need a "PRD Fact Checker" agent as well. -- This sits with data source summarizers because we'll want a similarly formatted document that the master summarizer agent can later refer to. 
*Note: Again, show Arcline the power of Notion in so many different ways.*
These summarizer agents should be kicked off on completion of the worker's 6AM run. For the product ones, they should simply kick off at 6AM.
The reports the summarizer agents create should include an executive summary as well as citiations back to the records it is using to generate insights inline on the Notion page. There should be an alert sent to a team of eng managers that will read the report and click an "Approved" button to create a HITL loop for checking the validity and accuracy of the summaries before going to the next step.
*Note: Over time, I would expect this HITL loop to go away as the team builds confidence in the agent's ability to summarize the previous week. We'll always keep that feature enabled in case the team needs to re-enable it, especially in the case of regressions.*
#### Consolidated Actions
- Start: Triggered by Data Source Workers
- Reads: Mirror source of truth Notion Databases
- Writes: Weekly summary in a detailed weekly summary view database
- Ends: Once the summary is fully written for that week/data source
- Signals: Eng Managers to review the summary and approve
- Quantity: 4 per data source + 2 for product roadmap/PRD -> 6 agents
    - *Note: These 6 agents should be run once each for each of the 8 eng teams, creating 48 summary outputs each week for eng managers to review. Yes this sounds like a lot, but should still be significantly faster than manual creation and is fully automated over time.*

### Master Summarizer Agent
This agent will be responsible for creating the final report once all of the specific data source summaries have been approved by eng managers. It will make sure to do the following very specific tasks:
- Generate the report in the format expected by VPs
- Cite sources back to the source of truth, using citations that earlier summary agents created
- Incorporate feedback from previous EPD weekly documents & meetings, including comments made on the document
- **Call out discrepancies between sources of truth within products, including diversions from product roadmaps and PRDs**
- **Call out areas of inefficiency or synergy between EPD teams**
Most of the hard work should be done by the product-specific data-source summaries. Becuase there will be quite a bit of content to review for this agent, it should rely most on products that have upcoming deadlines, have the most interesting progress to share, or have been explicitly requested to have an update for the week based on prior weeks.
Engineering managers should be alerted when this master summary is completed, and should all sign off before the final report is signaled to be ready to share with VPs. Similarly to the last report, this step will get less cumbersome over time.
#### Consolidated Actions
- Start: Triggered by all eng managers approving their summary docs
- Reads: 48 product-data summaries
- Writes: Weekly summary in the EPD Weekly database, fitting the description set forth by the customer
- Ends: Once the summary is fully written
- Signals: Eng Managers to review the summary and approve
- Quantity: Once per week

### Data Staleness Agents (V2)
We'll need some sort of looping review of the data sources, their summaries, and the overall master summary for data staleness concerns throughout the full process. This agent will go on a 15 to 30 minute loop (depends on how long reviews take) and review a specific report for any citations that may look out of date based on new information. I want to leave this in V2 as I haven't fully thought through how this will work, but a cron schedule for an agent per report makes sense. If they are invoked on a cron with arguments for the data source and the report(s) to review, and stop running after either a weekly summary review signal is sent by VPs or Monday at 7PM hits, we should be ok. Again, haven't fully thought through yet.

### Report Generation Progress Tracking
Each of the `Start` and `Signals` above should be tracked in a separate admin database for tracking the progress of the weekly report generation. Over time, we'll want to track how long each step takes so that we know where to improve parts of the pipeline in an effort to make the process as quick as possible. This will also be helpful for the team to alert other members in case they become the bottleneck in a particular week.

### Data Sources to Create
- Mirror copies for each source of truth
- Data Source Summaries
- Weekly EPD Readout
    - Includes Meeting Notes and Inline Comments for feedback to incorporate into future readouts
- EPD Product Roadmaps
    - Tie in the actual product roadmap into VP summaries
- EPD PRDs
    - Have actual PRDs for each product
- Report Generation Progress Tracking


# 2 Biggest Risks

<Please call out additional risks both before we start to build as well as while we build>

### Agent Sprawl
There's a lot going on here.... I think asking the customer to manage all of this after a 30-Day POC is going to be a lot to ask of them. We need to make sure we instrument the updates and validation of agent steps thoughtfully to not interrupt workflows too much for these managers and provide enough value that they are willing to work through early snags in the process if they arrive. The largest mitigation here is going to be visibility. Make sure each engineering manager has their say in how they get their data displayed to them, just as much as the VPs have a say in how their report is generated. Let's also make sure that we take performance feedback into consideration quickly and test against previous week's outputs quickly when we need to make changes to be ready for the next monday's run. 
This sprawl is a response to the potential hallucination concern brought by the customer in the problem statement. Creating many, smaller agents with reduced context is a way to avoid hallucination risk by overflooding context windows in the agents. I want to explicitly call this out as this problem seems entirely self-inflicted, but it's for a very good reason.

### Data Staleness
There really isn't any way to deal with this technically if there is already concerns that 3 to 4 hours is already too slow for communications. We just need to explicitly call out via the master summary agent when data is stale at the time of report creation, and then callout that the staleness problem will be dealt with once we are confident in the intial report generation capabilities. I don;t think it makes sense to go after this problem until we have full report generation capabilities.

### Report Rigidity
We'll need to make sure that the system and user prompts for each of our agents are customizeable in some way by either an updater agent, or the eng managers themseleves. This is not a huge problem, but is a risk that we at Notion cannot 100% solve for (unless Arcline has full confidence in an agent's ability to take report feedback and update the correct agent prompts 100% accurately without review). I do not think this will be a problem. We'll work with Arcline to land on a report they feel is delivering tremendous value, and we can revisit the pipeline if they need additions/subtractions/changes over time.

# 30 Day POC

### Scope
We'll want to build out 2 to 3 of the data sources based on time savings first and data ease second. We'll focus on data parity and report structure/approval workflows to set a stage for continuous improvement for days 30-90. 
**I'm most worried about the conversion of data from other sources of truth into Notion more than anything else in this build.** This is the risk I want to reduce int he POC so that we build the maximum confidence in our abilities with Arcline. Keeping the data scope small greatly reduces the effectiveness of the final summarizer agent, but I believe it's a necessary tradeoff to get the most time savings back to the eng managers as quickly as possible.

### Week 1 
We'll want to build the data workers and mirror copy databases as well as the product-specific summarizer agents in week 1. This includes any additional scaffolding like tracking report progress and teh summary databases. We will meet regularly with eng managers to understand how they will want to be alerted for their input on a summary agent so taht we can build those flows in week 2, and meet with VPs regularly to understand success criteria (if we haven't done that already) and the final output report structure.

### Week 2
Week 2, we start to build the data-product-specific agents and actually implement HITL loops with eng managers for their specific workflows. We also start to build the master summary agent at this time, and collect 2 months worth of previous readouts to test against. I don't anticipate Arcline will have data-source-specific summaries.

### Week 3
We finalize the product-data-specific outputs with the engineering managers, quickly iterating based on (hopefully) daily feedback. This motion will very much need to be a push motion from the Notion team, the eng managers are already time constrained and will be fatigued with how much feedback we need from them initially. We also build the master summary agent and those loops as well based on feedback from eng managers, and start to backchannel initial results up to the VPs for initial feedback there. We need to be running our first full test of the pipeline by the end of week 3, backtesting against the reports we pulled in week 2. Full parity won't be an option at this stage (we won't be automatically ingesting data from all data sources yet), but showing how quickly we can generate summaries for the data sources we do ingest will be key. Matching those insights against previous full reports will show progress just as much as the full summary report will.

### Week 4
Backtesting against previous reports continues, including a live run against the weekly report on Monday. We tweak around the edges of the pipeline to get to feature parity with that report for the specific data sources we identified in the POC scope before we kicked off.

### Success
We have built confidence that the agent-generated report meets the standards to hand off to VPs. I think this is actually a low bar and should be something we should definitely achieve to build confidence. The fully agentic pipeline should take a little more time, but it's important to build the confidence more than anything at this stage.
Because we will no own the full creation process at this stage, it's difficult to say we can reduce the time to generate these reports by more than 50%. If we select the right initial data sources to build on, I believe having a report out by 11AM (i.e. 2 hours after 9AM) should be the minimum acceptable time for this process. Internally and with the eng managers, we will target 10AM (1 hour).

### Days 30-90
We'll want to quickly scaffold out the remaining data sources to get the full context to the summarizer agents. Once we have all the data sources, we can dial in the HITL feedback mechanism. By 90 days, we should be able to generate ad hoc / daily reports for VPs as needed.


# Final Additions

### Submission
I can only submit one file for the build here. I think an HTML file directly addressing the prompt with link outs to the notion workspace and the github repo will suffice. I want that HTML to be more informative and highlight the work we've done, taking a view that I am a conadidate in a job interview process. I want the rest of the material to read as if I am actually a Solutions Engineer at Notion working with a large enterprise customer.

### Teaching is the Name of the Game
**More than anything, I want to teach Arcline how to maintain and eventually build workflows like this themselves.** This mindset has 2 key advantages:
1. I can help show Notion that my belief is that a good Solutions Engineer gives their customer fish, while a great Solutions Engineer teaches customers how to fish.
2. Arcline eventually learns how to fish.
I would love opportunities where I can record quick demos and provide a "professorial" vibe to this assignment.

### Interview Prep
This assignment will be the basis of most of the rest of the interview process I have with Notion. I'd like some sort of adversarial lense applied as we build, where you ask why we are making certain decisions. I'd also like a CLAUDE SKILL created for `/interview-prep` where you behave like an interviewer for me and I have to answer your questions based on the build once we are done and ave submitted.