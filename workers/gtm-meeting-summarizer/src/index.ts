import { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { isFullPage } from "@notionhq/client";

const worker = new Worker();
export default worker;

// ── Stable workspace IDs ──────────────────────────────────────────────────────
// GTM databases (377… set) are under the "Revenue" sub-page created by PRD-13.
// Agent Run Log (36efc8f4…) is shared with the EPD pipeline — same log, all agents.

const MEETING_NOTES_DB = "377fc8f4-554c-81b1-b388-d5aa65781f01"; // GTM | Meeting Notes
const OPPORTUNITIES_DB = "377fc8f4-554c-81b8-ba74-cc69fc66d19d"; // GTM | Opportunities (unused directly — here for completeness)
const DAILY_DIGEST_DB  = "377fc8f4-554c-8120-9027-f33bf647c36b"; // GTM | Daily Digest
const AGENT_RUN_LOG_DB = "36efc8f4-554c-814e-8c51-ea51792f5344"; // Agent Run Log (shared)

// Suppress unused-variable warning — OPPORTUNITIES_DB is a reference constant, not used at runtime
void OPPORTUNITIES_DB;

// ── Property extractors ──────────────────────────────────────────────────────

function plainText(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if ("rich_text" in p && Array.isArray(p.rich_text) && p.rich_text.length > 0)
    return (p.rich_text[0] as { plain_text: string }).plain_text ?? "";
  if ("title" in p && Array.isArray(p.title) && p.title.length > 0)
    return (p.title[0] as { plain_text: string }).plain_text ?? "";
  return "";
}

function selectName(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const s = (prop as Record<string, unknown>).select;
  if (s && typeof s === "object") return ((s as Record<string, unknown>).name as string) ?? "";
  return "";
}

function dateStart(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const d = (prop as Record<string, unknown>).date;
  if (d && typeof d === "object") return ((d as Record<string, unknown>).start as string) ?? "";
  return "";
}

function numberValue(prop: unknown): number {
  if (!prop || typeof prop !== "object") return 0;
  const n = (prop as Record<string, unknown>).number;
  return typeof n === "number" ? n : 0;
}

function relationIds(prop: unknown): string[] {
  if (!prop || typeof prop !== "object") return [];
  const rel = (prop as Record<string, unknown>).relation;
  if (!Array.isArray(rel)) return [];
  return rel.map((r) => (r as Record<string, unknown>).id as string);
}

// Notion rich-text array from a plain string, chunked to stay under the 2000-char limit.
const rt = (s: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += 1999) {
    chunks.push({ type: "text", text: { content: s.slice(i, i + 1999) } });
  }
  return chunks.length > 0 ? chunks : [{ type: "text" as const, text: { content: "" } }];
};

// ── Tool 1: read_recent_meeting_notes ────────────────────────────────────────
//
// Called first by the Custom Agent. Returns meeting notes from the last N days.
// Resolves opportunityTitle inline (one extra pages.retrieve per linked note) so
// the agent has full context without needing a separate read_opportunity call per row.
// The agent should call read_opportunity for notes where ACV / health / closeDate matters.

worker.tool("read_recent_meeting_notes", {
  title: "Read Recent Meeting Notes",
  description:
    "Return GTM | Meeting Notes rows where Date >= today minus daysBack days. " +
    "Each row includes sentiment, actionItems, and competitorMentioned. " +
    "atRiskCount and competitorCount in the response tell the agent how many flags exist " +
    "before it reads individual rows. Pass opportunityId to read_opportunity for deal context.",
  hints: { readOnlyHint: true },
  schema: j.object({
    daysBack: j
      .number()
      .describe(
        "How many days back to look. Default 1 = yesterday. " +
        "Use 3 on Mondays to cover the weekend.",
      ),
  }),
  execute: async ({ daysBack }, { notion }) => {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - daysBack);
    const cutoffDate = cutoff.toISOString().split("T")[0];

    const response = await notion.databases.query({
      database_id: MEETING_NOTES_DB,
      filter: {
        property: "Date",
        date: { on_or_after: cutoffDate },
      },
      sorts: [{ property: "Date", direction: "descending" }],
      page_size: 50,
    });

    const notes = await Promise.all(
      response.results.filter(isFullPage).map(async (page) => {
        const p        = page.properties as Record<string, unknown>;
        const oppIds   = relationIds(p["Opportunity"]);
        let opportunityTitle = "";
        let opportunityId    = "";

        if (oppIds.length > 0) {
          opportunityId = oppIds[0];
          try {
            const opp = await notion.pages.retrieve({ page_id: opportunityId });
            if (isFullPage(opp)) {
              opportunityTitle = plainText((opp.properties as Record<string, unknown>)["Title"]);
            }
          } catch {
            // Opportunity row not found — return empty title gracefully
          }
        }

        return {
          pageId:              page.id,
          title:               plainText(p["Title"]),
          account:             plainText(p["Account"]),
          opportunityId,
          opportunityTitle,
          date:                dateStart(p["Date"]),
          rep:                 selectName(p["Rep"]),
          stage:               selectName(p["Stage"]),
          sentiment:           selectName(p["Sentiment"]),
          actionItems:         plainText(p["Action Items"]),
          summary:             plainText(p["Summary"]),
          competitorMentioned: plainText(p["Competitor Mentioned"]),
        };
      }),
    );

    const atRiskCount    = notes.filter((n) => n.sentiment === "at-risk").length;
    const competitorCount = notes.filter((n) => n.competitorMentioned !== "").length;

    return { notes, totalNotes: notes.length, cutoffDate, atRiskCount, competitorCount };
  },
});

// ── Tool 2: read_opportunity ─────────────────────────────────────────────────
//
// Fetches a single GTM | Opportunities row by page ID for deal-size and health context.
// Called by the Custom Agent after read_recent_meeting_notes returns opportunityId values.
// Not all meetings need enrichment — call this for at-risk and high-ACV deals.

worker.tool("read_opportunity", {
  title: "Read Opportunity",
  description:
    "Fetch a single GTM | Opportunities row by page ID. " +
    "Returns ACV, stage, health, closeDate, and rep so the agent can include " +
    "deal-size context in the Flags for CRO section.",
  hints: { readOnlyHint: true },
  schema: j.object({
    opportunityId: j
      .string()
      .describe("Notion page ID of the opportunity row (from read_recent_meeting_notes.notes[].opportunityId)"),
  }),
  execute: async ({ opportunityId }, { notion }) => {
    const page = await notion.pages.retrieve({ page_id: opportunityId });
    if (!isFullPage(page)) {
      return {
        found:         false,
        error:         "opportunity page not found or not a full page",
        opportunityId,
        title:         "",
        account:       "",
        stage:         "",
        acv:           0,
        closeDate:     "",
        health:        "",
        rep:           "",
      };
    }
    const p = page.properties as Record<string, unknown>;
    return {
      found:         true,
      error:         "",
      opportunityId: page.id,
      title:         plainText(p["Title"]),
      account:       plainText(p["Account"]),
      stage:         selectName(p["Stage"]),
      acv:           numberValue(p["ACV"]),
      closeDate:     dateStart(p["Close Date"]),
      health:        selectName(p["Health"]),
      rep:           selectName(p["Rep"]),
    };
  },
});

// ── Tool 3: write_gtm_daily_digest ───────────────────────────────────────────
//
// Upserts a GTM | Daily Digest row keyed on the Date property.
// Auto-publishes if atRiskCount = 0 (nothing urgent, no review needed).
// Leaves as "draft" when atRiskCount > 0 so the CRO sees at-risk flags before publishing.
// Running twice on the same date updates the existing row — no duplicates.

worker.tool("write_gtm_daily_digest", {
  title: "Write GTM Daily Digest",
  description:
    "Upsert a GTM | Daily Digest row for the given date. " +
    "If a row already exists for that date, its fields are updated in place. " +
    "Status auto-logic: atRiskCount = 0 → 'published' (no review needed); " +
    "atRiskCount > 0 → 'draft' (CRO should review the at-risk flags before it goes live). " +
    "For the zero-meetings case, pass summary='No meetings recorded for YYYY-MM-DD.', " +
    "dealsTouched=0, atRiskCount=0 — the row auto-publishes and the run log gets outcome='skipped'.",
  schema: j.object({
    date: j
      .string()
      .describe("ISO date string YYYY-MM-DD identifying this digest"),
    summary: j
      .string()
      .describe(
        "Markdown digest with 4 required sections: " +
        "## Deal Updates, ## Pipeline Health, ## Action Items Due ≤48h, ## Flags for CRO. " +
        "Keep under 300 words. Be direct and specific.",
      ),
    dealsTouched: j
      .number()
      .describe("Number of deals that had meeting activity in the period"),
    actionItems: j
      .string()
      .describe("Bulleted list of rep-specific follow-ups with deadlines (≤48h horizon)"),
    releaseCrossRef: j
      .string()
      .describe(
        "Comma-separated release names relevant to open deals. " +
        "Leave empty string if PRD-16 (Release Bridge) is not yet running.",
      ),
    atRiskCount: j
      .number()
      .describe(
        "Number of at-risk deals in this digest. " +
        "Controls auto-publish: 0 = published, >0 = draft for CRO review.",
      ),
  }),
  execute: async ({ date, summary, dealsTouched, actionItems, releaseCrossRef, atRiskCount }, { notion }) => {
    const status = atRiskCount > 0 ? "draft" : "published";
    const title  = `GTM Daily Digest — ${date}`;

    const properties = {
      "Title":             { title: rt(title) },
      "Date":              { date: { start: date } },
      "Summary":           { rich_text: rt(summary) },
      "Deals Touched":     { number: dealsTouched },
      "Action Items":      { rich_text: rt(actionItems) },
      "Release Cross-Ref": { rich_text: rt(releaseCrossRef || "") },
      "Status":            { select: { name: status } },
    } as Parameters<typeof notion.pages.create>[0]["properties"];

    // Upsert keyed on Date — prevents duplicate rows when the agent runs twice in a day
    const existing = await notion.databases.query({
      database_id: DAILY_DIGEST_DB,
      filter: { property: "Date", date: { equals: date } },
      page_size: 1,
    });

    let pageId: string;
    let action: "created" | "updated";

    if (existing.results.length > 0) {
      pageId = existing.results[0].id;
      action = "updated";
      await notion.pages.update({ page_id: pageId, properties });
    } else {
      const page = await notion.pages.create({
        parent: { database_id: DAILY_DIGEST_DB },
        properties,
      });
      pageId = page.id;
      action = "created";
    }

    return { pageId, action, date, title, status, dealsTouched, atRiskCount };
  },
});

// ── Tool 4: write_agent_run_log ───────────────────────────────────────────────
//
// Writes to the shared Agent Run Log for observability.
// The same log receives entries from all EPD and GTM workers, so the dashboard
// shows both pipelines in one view.
// Always call this at the end of every agent execution — even for skipped/error runs.

worker.tool("write_agent_run_log", {
  title: "Write Agent Run Log",
  description:
    "Write an entry to the shared Agent Run Log for observability. " +
    "Call at the end of every execution. " +
    "notes should include: notesProcessed=N atRisk=M actionItems=K. " +
    "outcome='skipped' when there were no meeting notes for the period.",
  schema: j.object({
    agentName: j
      .string()
      .describe("Agent identifier, e.g. 'gtm-meeting-summarizer'"),
    startedAt: j
      .string()
      .describe("ISO 8601 timestamp when the agent run started"),
    completedAt: j
      .string()
      .describe("ISO 8601 timestamp when the agent run completed"),
    durationMs: j
      .number()
      .describe("Elapsed duration in milliseconds"),
    outcome: j
      .enum("ok", "error", "skipped")
      .describe("ok = success; error = unrecoverable failure; skipped = no meeting notes found"),
    notes: j
      .string()
      .describe("Free-text summary, e.g. 'notesProcessed=3 atRisk=1 actionItems=4'"),
  }),
  execute: async ({ agentName, startedAt, completedAt, durationMs, outcome, notes }, { notion }) => {
    const runId = `${agentName}-${startedAt}`;
    const page  = await notion.pages.create({
      parent: { database_id: AGENT_RUN_LOG_DB },
      properties: {
        "Run Id":       { title: rt(runId) },
        "Agent Name":   { select: { name: agentName } },
        "Started At":   { date: { start: startedAt } },
        "Completed At": { date: { start: completedAt } },
        "Duration ms":  { number: durationMs },
        "Outcome":      { select: { name: outcome } },
        "Notes":        { rich_text: rt(notes) },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });
    return { pageId: page.id, runId, outcome };
  },
});
