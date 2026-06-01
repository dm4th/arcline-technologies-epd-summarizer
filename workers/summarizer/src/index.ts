import { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { isFullPage } from "@notionhq/client";

const worker = new Worker();
export default worker;

// ── Stable workspace IDs ──────────────────────────────────────────────────────
// Written by scripts/bootstrap-workspace.ts — stable once the workspace exists.

const MIRROR_DB: Record<Source, string> = {
  github: "36efc8f4-554c-81d7-85ac-d35f95eb69e4",
  jira:   "36efc8f4-554c-819f-8f3e-d03323cbbf71",
  slack:  "36efc8f4-554c-81bd-af9b-c3564c1c4522",
  figma:  "36efc8f4-554c-81e0-b50e-d63ca48e5f3c",
};

const SQUAD_PAGE_ID: Record<Squad, string> = {
  atlas: "36efc8f4-554c-81e7-a83b-c976963a5fab",
  lumen: "36efc8f4-554c-81b6-8583-dd3634f0e7ad",
  forge: "36efc8f4-554c-8102-b02e-d9def2d4a4da",
};

const SQUAD_WEEKLY_SUMMARY_DB = "36efc8f4-554c-819e-b339-ec0bb2c97a76";
const AGENT_RUN_LOG_DB        = "36efc8f4-554c-814e-8c51-ea51792f5344";

type Source = "github" | "jira" | "slack" | "figma";
type Squad  = "atlas"  | "lumen" | "forge";

// ── Property maps (verified against live workspace) ───────────────────────────

// The rich-text field that best represents what happened in a record
const EXCERPT_PROP: Record<Source, string> = {
  github: "Body Excerpt",
  jira:   "Acceptance Criteria",
  slack:  "Excerpt",
  figma:  "Comment Excerpt",
};

// The url field for the canonical source link
const URL_PROP: Record<Source, string> = {
  github: "URL",
  jira:   "URL",
  slack:  "Thread URL",
  figma:  "URL",
};

// ── Tiny property extractors ──────────────────────────────────────────────────

function plainText(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if ("rich_text" in p && Array.isArray(p.rich_text) && p.rich_text.length > 0)
    return (p.rich_text[0] as { plain_text: string }).plain_text ?? "";
  if ("title" in p && Array.isArray(p.title) && p.title.length > 0)
    return (p.title[0] as { plain_text: string }).plain_text ?? "";
  return "";
}

function urlValue(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  return (typeof (prop as Record<string, unknown>).url === "string"
    ? (prop as Record<string, unknown>).url
    : "") as string;
}

function dateStart(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const d = (prop as Record<string, unknown>).date;
  if (d && typeof d === "object") return ((d as Record<string, unknown>).start as string) ?? "";
  return "";
}

function selectName(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const s = (prop as Record<string, unknown>).select;
  if (s && typeof s === "object") return ((s as Record<string, unknown>).name as string) ?? "";
  return "";
}

// Notion rich-text array from a plain string, split into 1999-char chunks to avoid API limit.
// A single rich_text element caps at 2000 chars, but a property accepts multiple elements.
const rt = (s: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += 1999) {
    chunks.push({ type: "text", text: { content: s.slice(i, i + 1999) } });
  }
  return chunks.length > 0 ? chunks : [{ type: "text" as const, text: { content: "" } }];
};

// Parse "2026-W21" → "2026-05-18" (Monday of that ISO week)
function weekOfToDate(weekOf: string): string {
  const [yearStr, weekStr] = weekOf.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow  = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (dow - 1));
  const monday = new Date(week1Mon);
  monday.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().split("T")[0];
}

// ── Tool 1: read_mirror_rows ──────────────────────────────────────────────────
//
// Called first by the Custom Agent. Returns every mirror row for the given
// (source, squad) so the agent can read the raw activity and generate a summary.
// Each row's notionPageId is the citation target for write_squad_summary.

worker.tool("read_mirror_rows", {
  title: "Read Mirror Rows",
  description:
    "Return all mirror DB rows for a given source and squad. " +
    "Each row includes a notionPageId — these are the citation targets the agent " +
    "must reference in write_squad_summary to satisfy the ≥90% citation-coverage contract.",
  hints: { readOnlyHint: true },
  schema: j.object({
    source: j
      .enum("github", "jira", "slack", "figma")
      .describe("Which mirror database to query"),
    squad: j
      .enum("atlas", "lumen", "forge")
      .describe("Squad whose rows to return"),
    weekOf: j
      .string()
      .describe("Week context for the agent, e.g. 2026-W21 (does not filter rows)"),
  }),
  execute: async ({ source, squad, weekOf }, { notion }) => {
    const response = await notion.databases.query({
      database_id: MIRROR_DB[source as Source],
      filter: {
        property: "Squad",
        relation: { contains: SQUAD_PAGE_ID[squad as Squad] },
      },
      page_size: 100,
    });

    const rows = response.results
      .filter(isFullPage)
      .map((page) => {
        const p = page.properties as Record<string, unknown>;
        return {
          notionPageId: page.id,
          sourceId:     plainText(p["Source ID"]),
          title:        plainText(p["Title"]),
          url:          urlValue(p[URL_PROP[source as Source]]),
          excerpt:      plainText(p[EXCERPT_PROP[source as Source]]).substring(0, 500),
          status:       selectName(p["Status"]),
          lastUpdated:  dateStart(p["Last Updated"]),
        };
      });

    return { rows, totalRows: rows.length, squad, source, weekOf };
  },
});

// ── Tool 2: begin_summary ─────────────────────────────────────────────────────
//
// Called by the Custom Agent immediately before composing content. Flips the
// pre-seeded placeholder row from "pending" → "generating-review" so the row
// shows live status in Notion while the agent reasons.
//
// Returns { started: true } when the flip succeeded (row was "pending").
// Returns { started: false, currentStatus } when the row is already in progress
// or done — the agent should exit rather than duplicate work.

worker.tool("begin_summary", {
  title: "Begin Summary Generation",
  description:
    "Mark a Squad Weekly Summary row as 'generating-review' before composing content. " +
    "Call this after read_mirror_rows returns rows, before generating any text. " +
    "If started=false the row is already being processed or is done — stop immediately.",
  schema: j.object({
    squad:  j.enum("atlas", "lumen", "forge").describe("Squad this summary belongs to"),
    source: j.enum("github", "jira", "slack", "figma").describe("Data source being summarized"),
    weekOf: j.string().describe("Week identifier, e.g. 2026-W21"),
  }),
  execute: async ({ squad, source, weekOf }, { notion }) => {
    const squadPageId = SQUAD_PAGE_ID[squad as Squad];
    const weekDate    = weekOfToDate(weekOf);

    const existing = await notion.databases.query({
      database_id: SQUAD_WEEKLY_SUMMARY_DB,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: squadPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
          { property: "Source",  select:   { equals: source } },
        ],
      },
      page_size: 5,
    });

    if (existing.results.length === 0) {
      return { started: false, reason: "row not found", currentStatus: null, pageId: null, squad, source, weekOf };
    }

    const page = existing.results[0];
    if (!isFullPage(page)) {
      return { started: false, reason: "row not full page", currentStatus: null, pageId: null, squad, source, weekOf };
    }

    const currentStatus = selectName((page.properties as Record<string, unknown>)["Status"]);

    // Only flip from "pending" — any other status means another run is in progress or done
    if (currentStatus !== "pending") {
      return { started: false, reason: "already processed", currentStatus, pageId: null, squad, source, weekOf };
    }

    await notion.pages.update({
      page_id: page.id,
      properties: {
        "Status": { select: { name: "generating-review" } },
      } as Parameters<typeof notion.pages.update>[0]["properties"],
    });

    return { started: true, reason: null, currentStatus: "generating-review", pageId: page.id, squad, source, weekOf };
  },
});

// ── Tool 3: write_squad_summary ───────────────────────────────────────────────
//
// Called by the Custom Agent after it has generated the summary. Replaces the
// placeholder page body with structured sections, updates the Citations property
// with a JSON array the HITL reviewer and PRD-08 eval harness can parse, and
// writes an Agent Run Log entry so observability dashboards stay accurate.

worker.tool("write_squad_summary", {
  title: "Write Squad Summary",
  description:
    "Upsert a Squad Weekly Summary row: replace placeholder body content with " +
    "AI-generated sections and populate the Citations property. " +
    "Set Status to 'awaiting-review' (or 'approved' when citations is empty, " +
    "indicating no activity this week — those rows skip HITL automatically).",
  schema: j.object({
    squad:       j.enum("atlas", "lumen", "forge").describe("Squad this summary belongs to"),
    source:      j.enum("github", "jira", "slack", "figma").describe("Data source covered"),
    weekOf:      j.string().describe("Week identifier, e.g. 2026-W21"),
    whatShipped: j.string().describe("Markdown — completed / merged work this week"),
    inProgress:  j.string().describe("Markdown — work actively in flight"),
    risks:       j.string().describe("Markdown — blockers, risks, open questions"),
    notable:     j
      .string()
      .describe("Markdown — cross-team dependencies, process notes, standout moments"),
    citations: j
      .array(
        j.object({
          recordId:  j.string().describe("notionPageId of the mirror row being cited"),
          sourceUrl: j.string().describe("URL of that source record"),
          claim:     j.string().describe("Verbatim factual sentence this citation supports"),
        }),
      )
      .describe(
        "One entry per factual sentence in the summary. Empty only when no activity this week.",
      ),
  }),
  execute: async (
    { squad, source, weekOf, whatShipped, inProgress, risks, notable, citations },
    { notion },
  ) => {
    const squadPageId   = SQUAD_PAGE_ID[squad as Squad];
    const weekDate      = weekOfToDate(weekOf);
    const startedAt     = new Date();
    const generatedAt   = startedAt.toISOString();
    const citationsJson = JSON.stringify(citations);
    const noActivity    = citations.length === 0;
    const status        = noActivity ? "approved" : "awaiting-review";
    const squadName     = squad.charAt(0).toUpperCase() + squad.slice(1);

    // Find the existing placeholder row seeded by the HITL worker
    const existing = await notion.databases.query({
      database_id: SQUAD_WEEKLY_SUMMARY_DB,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: squadPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
          { property: "Source",  select:   { equals: source } },
        ],
      },
    });

    // Structured page body — same section headings used by PRD-05 master summarizer
    const blocks = [
      {
        type: "callout" as const,
        callout: {
          rich_text: rt(
            `Generated by summarizer.${source}.${squad} · Week ${weekOf} · ${citations.length} citation${citations.length === 1 ? "" : "s"}`,
          ),
          color: "blue_background" as const,
        },
      },
      { type: "divider" as const, divider: {} },
      { type: "heading_2" as const, heading_2: { rich_text: rt("What Shipped") } },
      { type: "paragraph"  as const, paragraph:  { rich_text: rt(whatShipped) } },
      { type: "divider" as const, divider: {} },
      { type: "heading_2" as const, heading_2: { rich_text: rt("In Progress") } },
      { type: "paragraph"  as const, paragraph:  { rich_text: rt(inProgress) } },
      { type: "divider" as const, divider: {} },
      { type: "heading_2" as const, heading_2: { rich_text: rt("Risks & Blockers") } },
      { type: "paragraph"  as const, paragraph:  { rich_text: rt(risks) } },
      { type: "divider" as const, divider: {} },
      { type: "heading_2" as const, heading_2: { rich_text: rt("Notable") } },
      { type: "paragraph"  as const, paragraph:  { rich_text: rt(notable) } },
    ];

    let pageId: string;
    let action: "created" | "updated";

    if (existing.results.length === 0) {
      // No placeholder found — create a fresh row
      const page = await notion.pages.create({
        parent: { database_id: SQUAD_WEEKLY_SUMMARY_DB },
        properties: {
          "Title":        { title: rt(`${squadName} / ${source} — ${weekOf}`) },
          "Squad":        { relation: [{ id: squadPageId }] },
          "Week Of":      { date: { start: weekDate } },
          "Source":       { select: { name: source } },
          "Citations":    { rich_text: rt(citationsJson) },
          "Status":       { select: { name: status } },
          "Generated At": { date: { start: generatedAt } },
        } as Parameters<typeof notion.pages.create>[0]["properties"],
      });
      pageId = page.id;
      action = "created";
    } else {
      pageId = existing.results[0].id;
      action = "updated";

      // Delete every existing block so the placeholder content is replaced cleanly
      let cursor: string | undefined;
      do {
        const childList = await notion.blocks.children.list({
          block_id: pageId,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        for (const block of childList.results) {
          await notion.blocks.delete({ block_id: block.id });
        }
        cursor = childList.has_more ? (childList.next_cursor ?? undefined) : undefined;
      } while (cursor);

      // Update the DB row properties
      await notion.pages.update({
        page_id: pageId,
        properties: {
          "Citations":    { rich_text: rt(citationsJson) },
          "Status":       { select: { name: status } },
          "Generated At": { date: { start: generatedAt } },
          "Approved By":  { rich_text: rt("") },
        } as Parameters<typeof notion.pages.update>[0]["properties"],
      });
    }

    // Append the new structured body
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks as Parameters<typeof notion.blocks.children.append>[0]["children"],
    });

    // Write to Agent Run Log so the observability dashboard stays accurate
    const completedAt = new Date();
    await notion.pages.create({
      parent: { database_id: AGENT_RUN_LOG_DB },
      properties: {
        "Run Id":       { title: rt(`summarizer.${source}.${squad}-${startedAt.toISOString()}`) },
        "Agent Name":   { select: { name: `summarizer.${source}.${squad}` } },
        "Started At":   { date: { start: startedAt.toISOString() } },
        "Completed At": { date: { start: completedAt.toISOString() } },
        "Duration ms":  { number: completedAt.getTime() - startedAt.getTime() },
        "Outcome":      { select: { name: "ok" } },
        "Notes": {
          rich_text: rt(
            `week=${weekOf} citations=${citations.length} action=${action} status=${status}`,
          ),
        },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });

    return { pageId, action, citationCount: citations.length, status };
  },
});
