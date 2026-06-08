/**
 * generate-summaries.ts
 *
 * Generates all squad weekly summary content using the Anthropic API directly,
 * bypassing the Notion Custom Agent dependency for demo runs and historical backfill.
 *
 * Replaces 19 manual Notion agent runs per week:
 *   - 12 source summaries   (github/jira/slack/figma × 3 squads)
 *   - 6 placeholder approvals (roadmap/prd-fact-check × 3 squads — auto-approved as "no significant change")
 *   - 3 squad consolidations (one per HITL Review Session page body)
 *
 * After this script completes, run: pnpm approve-week --week=YYYY-Www
 *
 * Usage:
 *   pnpm generate-summaries --week=2026-W19
 *   pnpm generate-summaries --week=2026-W20 [--dry-run]
 */

import Anthropic from "@anthropic-ai/sdk";
import { isFullPage } from "@notionhq/client";
import { getNotionClient } from "../src/lib/notion";
import { loadEnv } from "../src/lib/env";
import { NOTION_IDS, getSquadPageId } from "../src/lib/notion-ids";
import { weekOfToDate, ALL_SQUADS } from "../src/workers/hitl-review";
import type { SquadId } from "../src/types/core";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const weekOf = args.find((a) => a.startsWith("--week="))?.split("=")[1];
const DRY_RUN = args.includes("--dry-run");

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceType = "github" | "jira" | "slack" | "figma";

interface MirrorRow {
  notionPageId: string;
  sourceId: string;
  title: string;
  url: string;
  excerpt: string;
  status: string;
  lastUpdated: string;
}

interface SourceSummaryOutput {
  whatShipped: string;
  inProgress: string;
  risks: string;
  notable: string;
  keyReleases: string;
  citationCoveragePct: number;
  citationCount: number;
}

interface ConsolidationOutput {
  executiveSummary: string;
  highlights: string;
  keyReleases: string;
  risksBlockers: string;
  crossSquadDeps: string;
  openFlags: string;
  citationCoveragePct: number;
  citationCount: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCES: SourceType[] = ["github", "jira", "slack", "figma"];

const MIRROR_DB: Record<SourceType, string> = {
  github: NOTION_IDS.dbs.mirrorGithub,
  jira:   NOTION_IDS.dbs.mirrorJira,
  slack:  NOTION_IDS.dbs.mirrorSlack,
  figma:  NOTION_IDS.dbs.mirrorFigma,
};

const URL_PROP: Record<SourceType, string> = {
  github: "URL",
  jira:   "URL",
  slack:  "Thread URL",
  figma:  "URL",
};

const EXCERPT_PROP: Record<SourceType, string> = {
  github: "Body Excerpt",
  jira:   "Acceptance Criteria",
  slack:  "Excerpt",
  figma:  "Comment Excerpt",
};

// ── Notion helpers ────────────────────────────────────────────────────────────

const rt = (s: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += 1999)
    chunks.push({ type: "text", text: { content: s.slice(i, i + 1999) } });
  return chunks.length > 0 ? chunks : [{ type: "text" as const, text: { content: "" } }];
};

function plainText(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if ("rich_text" in p && Array.isArray(p.rich_text) && p.rich_text.length > 0)
    return (p.rich_text as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  if ("title" in p && Array.isArray(p.title) && p.title.length > 0)
    return (p.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  return "";
}

function urlValue(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  return typeof p.url === "string" ? p.url : "";
}

function dateStart(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  const d = p.date as Record<string, unknown> | undefined;
  return d && typeof d.start === "string" ? d.start : "";
}

function selectName(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  const s = p.select as Record<string, unknown> | undefined;
  return s && typeof s.name === "string" ? s.name : "";
}

// ── JSON repair ───────────────────────────────────────────────────────────────
// Claude occasionally embeds literal control characters (bare \n, \t, \r) inside
// JSON string values instead of escaping them. This walks the raw text character
// by character, tracking string vs. structural context, and escapes any bare
// control characters it finds inside strings. Safe to run on well-formed JSON too.

function fixJsonStrings(raw: string): string {
  let out = "";
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped)        { out += ch; escaped = false; continue; }
    if (ch === "\\" && inStr) { out += ch; escaped = true;  continue; }
    if (ch === '"')     { inStr = !inStr; out += ch; continue; }
    if (inStr) {
      if      (ch === "\n") { out += "\\n";  continue; }
      else if (ch === "\r") { out += "\\r";  continue; }
      else if (ch === "\t") { out += "\\t";  continue; }
    }
    out += ch;
  }
  return out;
}

// Three-stage JSON parse: raw → strip preamble → fix control chars.
// Throws only if all three stages fail, showing the actual parse error + context snippet.
function safeParseJson<T>(text: string, context: string): T {
  // Stage 1: straight parse
  try { return JSON.parse(text) as T; } catch { /* fall through */ }

  // Stage 2: strip any non-JSON preamble before the first `{`
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s !== -1 && e !== -1) {
    const slice = text.slice(s, e + 1);
    try { return JSON.parse(slice) as T; } catch { /* fall through */ }

    // Stage 3: fix bare control characters inside string values, try again
    const fixed = fixJsonStrings(slice);
    try { return JSON.parse(fixed) as T; } catch (err3) {
      // Report: actual error + 200-char window around the failure point
      const msg = err3 instanceof Error ? err3.message : String(err3);
      const posMatch = msg.match(/position (\d+)/);
      const pos = posMatch ? parseInt(posMatch[1], 10) : 0;
      const window = fixed.slice(Math.max(0, pos - 80), pos + 120);
      throw new Error(
        `Failed to parse JSON for ${context} (after all 3 repair stages).\n` +
        `Parse error: ${msg}\n` +
        `Context around position ${pos}:\n  ...${window}...`
      );
    }
  }

  throw new Error(
    `Failed to parse JSON for ${context}: no JSON object found in response.\n` +
    `Raw (first 400 chars): ${text.slice(0, 400)}`
  );
}

// ── Step 1: Read mirror rows for one squad/source combo ───────────────────────

async function readMirrorRows(source: SourceType, squad: SquadId): Promise<MirrorRow[]> {
  const notion      = getNotionClient();
  const squadPageId = getSquadPageId(squad);

  const response = await notion.databases.query({
    database_id: MIRROR_DB[source],
    filter: { property: "Squad", relation: { contains: squadPageId } },
    page_size: 100,
  });

  return response.results.filter(isFullPage).map((page) => {
    const p = page.properties as Record<string, unknown>;
    return {
      notionPageId: page.id,
      sourceId:    plainText(p["Source ID"]),
      title:       plainText(p["Title"]),
      url:         urlValue(p[URL_PROP[source]]),
      excerpt:     plainText(p[EXCERPT_PROP[source]]).substring(0, 500),
      status:      selectName(p["Status"]),
      lastUpdated: dateStart(p["Last Updated"]),
    };
  });
}

// ── Step 2: Generate source summary with Claude ───────────────────────────────

function buildSourcePrompt(
  source: SourceType,
  squad: string,
  weekOf: string,
  rows: MirrorRow[],
): string {
  const sectionGuide: Record<SourceType, string> = {
    github: `whatShipped: merged PRs — title, PR number (from sourceId), what it does, any Jira ticket reference. Past tense, one bullet each.
inProgress: open PRs — title, PR number, current state, reviewer if mentioned.
risks: PRs with blockers in excerpt, closed-without-merge, waiting on another team.
notable: cross-team PRs, large diffs, security changes, direction changes.
keyReleases: bulleted, customer-facing translation of items that were FULLY shipped this week — merged PRs explicitly tagged "merged to main" or carrying a release tag ONLY (a strict subset of whatShipped). No PR numbers or ticket IDs — describe what the feature does for the customer, not the internal mechanics. Write exactly "(no releases this week)" if nothing qualifies.`,

    jira: `whatShipped: tickets with status=Done — key, title, what was completed. Past tense.
inProgress: tickets with status=In Progress or To Do — key, title, current progress.
risks: Blocked tickets, high-priority unresolved issues, cross-team dependencies.
notable: sprint goal tickets, scope changes, cross-squad coordination items.
keyReleases: bulleted, customer-facing translation of tickets with status="Done" or "Released" ONLY (a strict subset of whatShipped). No ticket keys/IDs — describe the customer-visible capability. Write exactly "(no releases this week)" if nothing qualifies.`,

    slack: `whatShipped: decisions made, issues resolved, announcements confirmed in threads.
inProgress: ongoing discussions, unresolved questions, pending decisions.
risks: flagged concerns, mentioned blockers, issues acknowledged but not tracked in Jira.
notable: cross-team coordination, process gaps the VP should know about.
keyReleases: bulleted, customer-facing translation of ONLY explicit, unambiguous deploy/release/launch confirmations. Slack is signal, not authoritative — exclude anything ambiguous, planned, in-progress, or "about to ship." No message IDs or channel names — translate to product capability language. Write exactly "(no releases this week)" if nothing clearly shipped per Slack.`,

    figma: `whatShipped: designs published, handed off, or approved in comments.
inProgress: designs actively in review or iteration phase.
risks: unresolved design comments, design reversals, designs blocking engineering.
notable: major design decisions, cross-team design dependencies, open exploration threads.
keyReleases: bulleted, customer-facing translation of designs explicitly marked "approved," "ready for dev," or handed off to engineering THIS WEEK ONLY (a strict subset of whatShipped) — exclude drafts and in-review work. No Figma file names or frame IDs — describe what the feature does for the end user. Write exactly "(no releases this week)" if nothing was finalized.`,
  };

  return `Generate a ${source} activity summary for the ${squad} squad (${weekOf}).

Section guide:
${sectionGuide[source]}

Citation coverage:
- Count factual sentences that name a specific PR/ticket/thread/comment — this includes keyReleases sentences.
- Compute citationCoveragePct as (cited_sentences / total_factual_sentences × 100). Target ≥90%.
- citationCount = total number of cited sentences (integer).

If no rows have any data, write "No activity this week." in whatShipped, "(no releases this week)" in keyReleases, and leave the others empty.

Generate keyReleases in this SAME pass — it is reviewed by the eng manager alongside every other section, not derived in a separate step.

Respond with ONLY valid JSON (no markdown fences, no preamble):
{
  "whatShipped": "markdown string",
  "inProgress": "markdown string",
  "risks": "markdown string",
  "notable": "markdown string",
  "keyReleases": "markdown string — bulleted customer-facing list, or the exact string \\"(no releases this week)\\"",
  "citationCoveragePct": 90.0,
  "citationCount": 42
}

DATA (${rows.length} rows):
${JSON.stringify(rows, null, 2)}`;
}

async function generateSourceSummary(
  source: SourceType,
  squad: SquadId,
  weekOf: string,
  rows: MirrorRow[],
): Promise<SourceSummaryOutput> {
  const anthropic = new Anthropic();
  const prompt    = buildSourcePrompt(source, squad, weekOf, rows);

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 8192,   // 8192 is the Sonnet output ceiling; Slack with 12+ rows needs it
    messages:   [{ role: "user", content: prompt }],
  });

  const text = (response.content[0] as { text: string }).text.trim();
  return safeParseJson<SourceSummaryOutput>(text, `${squad}/${source}`);
}

// ── Step 3: Write source summary to Notion ────────────────────────────────────
// Replicates the write_squad_summary worker tool logic, writing directly to
// the Notion SDK rather than going through the Custom Agent tool endpoint.

async function writeSourceSummary(
  squad: SquadId,
  source: SourceType,
  weekOf: string,
  output: SourceSummaryOutput,
): Promise<string> {
  const notion      = getNotionClient();
  const squadPageId = getSquadPageId(squad);
  const weekDate    = weekOfToDate(weekOf);
  const squadName   = squad.charAt(0).toUpperCase() + squad.slice(1);
  const generatedAt = new Date().toISOString();

  // No-activity rows get auto-approved (matching worker tool behavior for empty squads).
  // Rows with real content stay "awaiting-review" — only the user-triggered
  // approve-week.ts should ever flip a status-bearing row to "approved".
  const status = output.citationCount === 0 ? "approved" : "awaiting-review";

  // Find the existing placeholder row seeded by seedSquadWeeklySummaries
  const existing = await notion.databases.query({
    database_id: NOTION_IDS.dbs.squadWeeklySummary,
    filter: {
      and: [
        { property: "Squad",   relation: { contains: squadPageId } },
        { property: "Week Of", date:     { equals: weekDate } },
        { property: "Source",  select:   { equals: source } },
      ],
    },
  });

  const blocks: Parameters<typeof notion.blocks.children.append>[0]["children"] = [
    {
      type: "callout",
      callout: {
        rich_text: rt(`Generated by generate-summaries · ${source}.${squad} · Week ${weekOf} · ${output.citationCount} citations · coverage ${Math.round(output.citationCoveragePct * 10) / 10}%`),
        color: "blue_background",
      },
    },
    { type: "divider", divider: {} },
    { type: "heading_2", heading_2: { rich_text: rt("What Shipped") } },
    { type: "paragraph",  paragraph:  { rich_text: rt(output.whatShipped || "No activity this week.") } },
    { type: "divider", divider: {} },
    { type: "heading_2", heading_2: { rich_text: rt("In Progress") } },
    { type: "paragraph",  paragraph:  { rich_text: rt(output.inProgress || "") } },
    { type: "divider", divider: {} },
    { type: "heading_2", heading_2: { rich_text: rt("Risks & Blockers") } },
    { type: "paragraph",  paragraph:  { rich_text: rt(output.risks || "") } },
    { type: "divider", divider: {} },
    { type: "heading_2", heading_2: { rich_text: rt("Notable") } },
    { type: "paragraph",  paragraph:  { rich_text: rt(output.notable || "") } },
    { type: "divider", divider: {} },
    { type: "heading_2", heading_2: { rich_text: rt("Key Releases") } },
    { type: "paragraph",  paragraph:  { rich_text: rt(output.keyReleases || "(no releases this week)") } },
  ] as Parameters<typeof notion.blocks.children.append>[0]["children"];

  let pageId: string;

  if (existing.results.length === 0) {
    const page = await notion.pages.create({
      parent: { database_id: NOTION_IDS.dbs.squadWeeklySummary },
      properties: {
        "Title":        { title: rt(`${squadName} / ${source} — ${weekOf}`) },
        "Squad":        { relation: [{ id: squadPageId }] },
        "Week Of":      { date: { start: weekDate } },
        "Source":       { select: { name: source } },
        "Status":       { select: { name: status } },
        "Generated At": { date: { start: generatedAt } },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });
    pageId = page.id;
  } else {
    pageId = existing.results[0].id;

    // Clear placeholder blocks before writing real content
    let cursor: string | undefined;
    do {
      const childList = await notion.blocks.children.list({
        block_id: pageId,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const block of childList.results)
        await notion.blocks.delete({ block_id: block.id });
      cursor = childList.has_more ? (childList.next_cursor ?? undefined) : undefined;
    } while (cursor);

    await notion.pages.update({
      page_id: pageId,
      properties: {
        "Status":       { select: { name: status } },
        "Generated At": { date: { start: generatedAt } },
      } as Parameters<typeof notion.pages.update>[0]["properties"],
    });
  }

  await notion.blocks.children.append({ block_id: pageId, children: blocks });

  // Agent Run Log entry for observability
  const completedAt = new Date();
  await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.agentRunLog },
    properties: {
      "Run Id":       { title: rt(`summarizer.${source}.${squad}-${completedAt.toISOString()}`) },
      "Agent Name":   { select: { name: `summarizer.${source}.${squad}` } },
      "Started At":   { date: { start: completedAt.toISOString() } },
      "Completed At": { date: { start: completedAt.toISOString() } },
      "Duration ms":  { number: 0 },
      "Outcome":      { select: { name: "ok" } },
      "Notes":        { rich_text: rt(`week=${weekOf} citations=${output.citationCount} coverage=${Math.round(output.citationCoveragePct * 10) / 10}% action=generated-via-api status=${status}`) },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });

  return pageId;
}


// PRD-17 redesign (2026-06-06): Key Releases used to be extracted in a second
// Haiku pass and written to a side-channel "Key Releases" property on the
// Squad Weekly Summary row — bypassing EM review entirely. That violated the
// project's core trust principle (every claim is citation-backed AND
// human-reviewed). The property has been removed from the live schema.
//
// Key Releases is now generated in the SAME generateSourceSummary pass as
// every other section (see buildSourcePrompt's `keyReleases` field) and
// written into the page body as its own "## Key Releases" heading — reviewed
// by the EM at the same HITL gate as What Shipped / Risks / Notable. Do not
// re-add a second-pass extraction or a side-channel property write here.

// ── Step 4: Generate squad consolidation with Claude ─────────────────────────

function contentFromOutput(output: SourceSummaryOutput): string {
  return [
    `## What Shipped\n${output.whatShipped}`,
    `## In Progress\n${output.inProgress}`,
    `## Risks & Blockers\n${output.risks}`,
    `## Notable\n${output.notable}`,
    `## Key Releases\n${output.keyReleases}`,
  ]
    .filter((s) => s.split("\n")[1]?.trim())
    .join("\n\n");
}

function buildConsolidationPrompt(
  squad: string,
  weekOf: string,
  sources: { source: SourceType; pageId: string; output: SourceSummaryOutput }[],
): string {
  const summariesText = sources
    .map((s) => `### ${s.source.toUpperCase()} (Squad Weekly Summary pageId: ${s.pageId})\n${contentFromOutput(s.output)}`)
    .join("\n\n---\n\n");

  return `Synthesize a squad consolidation for the ${squad} squad (${weekOf}).

Sections:
- executiveSummary: ≤150 words. What shipped, what's at risk, key cross-squad dependencies. Audience: eng manager.
- highlights: Shipped work only (merged PRs, Done tickets, published designs). Format: "- **[Source]** Item — what it does."
- keyReleases: ⚠️ This section feeds the GTM pipeline directly (Master Summarizer → GTM Highlights → CRO-facing GTM Weekly page) — it is the ONLY place that pipeline reads from; there is no separate property write. Roll up the "## Key Releases" sections from all 4 source summaries above into ONE de-duplicated, customer-facing, squad-level list. Merge near-duplicate items reported across multiple sources (e.g. the same shipment confirmed in both GitHub and Slack) into a single bullet — don't double-count. Preserve the customer-facing language from upstream — do NOT reintroduce ticket IDs, PR numbers, or file names during consolidation. Write exactly "(no releases this week)" if all 4 upstream sections read that. Format: "- Deliverable name — what it does for the customer and why it matters."
- risksBlockers: [BLOCK]/[HIGH]/[WATCH] flags. Format: "- **[SEVERITY]** Description — source — recommended action."
- crossSquadDeps: Squad-to-squad dependencies. Format: "- **[This] → [Other]**: what — current state." Write "None identified." if none.
- openFlags: Every [BLOCK] and [WARN], design reversals, Slack-only unverified claims, assignee mismatches, untracked issues. Format: "- **[FLAG TYPE]** Source — description."

Citation coverage:
- Count factual sentences that name a specific event, metric, decision, or identifier.
- Include keyReleases sentences in the count — even phrased in customer-facing language, each one asserts that something specific shipped.
- Compute citationCoveragePct as (cited_sentences / total_factual_sentences × 100). Target ≥85%.
- citationCount = total number of cited sentences (integer).

Respond with ONLY valid JSON (no markdown fences, no preamble):
{
  "executiveSummary": "string",
  "highlights": "markdown string",
  "keyReleases": "markdown string — bulleted customer-facing list, or the exact string \\"(no releases this week)\\"",
  "risksBlockers": "markdown string",
  "crossSquadDeps": "markdown string",
  "openFlags": "markdown string",
  "citationCoveragePct": 85.0,
  "citationCount": 38
}

SOURCE SUMMARIES:
${summariesText}`;
}

async function generateConsolidation(
  squad: SquadId,
  weekOf: string,
  sources: { source: SourceType; pageId: string; output: SourceSummaryOutput }[],
): Promise<ConsolidationOutput> {
  const anthropic = new Anthropic();
  const prompt    = buildConsolidationPrompt(squad, weekOf, sources);

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 8192,   // consolidation output can be large (citations from all 4 sources)
    messages:   [{ role: "user", content: prompt }],
  });

  const text = (response.content[0] as { text: string }).text.trim();
  return safeParseJson<ConsolidationOutput>(text, `${squad}/consolidation`);
}

// ── Step 5: Write consolidation to HITL Review Session page body ──────────────
// Replicates write_squad_consolidation worker tool logic directly.
// Sets Consolidated At so approve-week.ts can gate on content presence.

async function writeConsolidation(
  squad: SquadId,
  weekOf: string,
  output: ConsolidationOutput,
): Promise<void> {
  const notion      = getNotionClient();
  const squadPageId = getSquadPageId(squad);
  const weekDate    = weekOfToDate(weekOf);
  const squadName   = squad.charAt(0).toUpperCase() + squad.slice(1);
  const consolidatedAt = new Date().toISOString();

  const sessionResp = await notion.databases.query({
    database_id: NOTION_IDS.dbs.hitlReviewSessions,
    filter: {
      and: [
        { property: "Squad",   relation: { contains: squadPageId } },
        { property: "Week Of", date:     { equals: weekDate } },
      ],
    },
    page_size: 5,
  });

  if (sessionResp.results.length === 0) {
    throw new Error(
      `No HITL Review Sessions row for ${squad}/${weekOf}. Run pnpm demo-week --week=${weekOf} first.`,
    );
  }

  const sessionId = sessionResp.results[0].id;

  // Update session properties
  await notion.pages.update({
    page_id: sessionId,
    properties: {
      "Status":          { select: { name: "awaiting-squad-review" } },
      "Consolidated At": { date:   { start: consolidatedAt } },
    } as Parameters<typeof notion.pages.update>[0]["properties"],
  });

  // Clear existing blocks (placeholder content from seedSquadWeeklySummaries)
  let cursor: string | undefined;
  do {
    const childList = await notion.blocks.children.list({
      block_id: sessionId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const block of childList.results)
      await notion.blocks.delete({ block_id: block.id });
    cursor = childList.has_more ? (childList.next_cursor ?? undefined) : undefined;
  } while (cursor);

  // Write consolidated body matching the format read_approved_summaries expects
  await notion.blocks.children.append({
    block_id: sessionId,
    children: [
      {
        type: "callout",
        callout: {
          rich_text: rt(output.executiveSummary),
          color: "blue_background",
        },
      },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Highlights") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.highlights) } },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Key Releases") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.keyReleases || "(no releases this week)") } },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Risks & Blockers") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.risksBlockers) } },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Cross-Squad Dependencies") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.crossSquadDeps) } },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Open Flags") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.openFlags) } },
      { type: "divider", divider: {} },
      {
        type: "callout",
        callout: {
          rich_text: rt(
            `${squadName} consolidation · Week ${weekOf} · ` +
            `${output.citationCount} citations · coverage ${Math.round(output.citationCoveragePct * 10) / 10}% · ` +
            `generated-via-api`,
          ),
          color: "gray_background",
        },
      },
    ] as Parameters<typeof notion.blocks.children.append>[0]["children"],
  });

  // Agent Run Log for observability
  const completedAt = new Date();
  await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.agentRunLog },
    properties: {
      "Run Id":       { title: rt(`summarizer.squad-consolidation.${squad}-${completedAt.toISOString()}`) },
      "Agent Name":   { select: { name: `summarizer.squad-consolidation.${squad}` } },
      "Started At":   { date: { start: completedAt.toISOString() } },
      "Completed At": { date: { start: completedAt.toISOString() } },
      "Duration ms":  { number: 0 },
      "Outcome":      { select: { name: "ok" } },
      "Notes":        { rich_text: rt(`week=${weekOf} squad=${squad} citations=${output.citationCount} coverage=${Math.round(output.citationCoveragePct * 10) / 10}% status=awaiting-squad-review`) },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  if (!weekOf) {
    console.error("Usage: pnpm generate-summaries --week=YYYY-Www [--dry-run]");
    process.exit(1);
  }

  const dryLabel = DRY_RUN ? " (DRY RUN — no writes)" : "";
  console.log("═".repeat(60));
  console.log(`Arcline Generate Summaries — ${weekOf}${dryLabel}`);
  console.log("═".repeat(60));
  console.log("  Generates 12 source summaries + 3 squad consolidations");
  console.log("  using Anthropic API directly (no Notion agents required).\n");

  for (const squad of ALL_SQUADS as SquadId[]) {
    console.log(`\n── ${squad.toUpperCase()} ────────────────────────────────────────`);

    const sourceResults: { source: SourceType; pageId: string; output: SourceSummaryOutput }[] = [];

    // ── Source summaries (4 per squad) ──
    for (const source of SOURCES) {
      process.stdout.write(`  [${source}] reading mirror rows...`);
      const rows = await readMirrorRows(source, squad);
      process.stdout.write(` ${rows.length} rows. Generating...`);

      if (DRY_RUN) {
        console.log(" [dry] skipped");
        continue;
      }

      const output = await generateSourceSummary(source, squad, weekOf, rows);
      const pageId = await writeSourceSummary(squad, source, weekOf, output);
      sourceResults.push({ source, pageId, output });

      // Key Releases is generated in the SAME pass as the rest of the summary
      // (see buildSourcePrompt's `keyReleases` field) and written into the page
      // body as its own reviewed section — no separate extraction call or
      // side-channel property write (PRD-17 redesign, see comment above Step 4).
      const hasReleases = output.keyReleases.trim() !== "(no releases this week)";
      console.log(` ✓ (${output.citationCount} citations, ${Math.round(output.citationCoveragePct * 10) / 10}% coverage → ${pageId.slice(0, 8)}… | key-releases: ${hasReleases ? "✓" : "none"})`);
    }

    // ── Squad consolidation ──
    if (!DRY_RUN && sourceResults.length === SOURCES.length) {
      process.stdout.write(`  [consolidation] generating...`);
      const consolidationOutput = await generateConsolidation(squad, weekOf, sourceResults);
      await writeConsolidation(squad, weekOf, consolidationOutput);
      console.log(` ✓ (${consolidationOutput.citationCount} citations, ${Math.round(consolidationOutput.citationCoveragePct * 10) / 10}% coverage → HITL session updated)`);
    } else if (DRY_RUN) {
      console.log(`  [consolidation] [dry] skipped`);
    } else {
      console.log(`  [consolidation] skipped — source summaries incomplete (${sourceResults.length}/${SOURCES.length})`);
    }
  }

  console.log("\n" + "─".repeat(60));
  if (!DRY_RUN) {
    console.log(`✓  Summaries generated for ${weekOf}.`);
    console.log("─".repeat(60));
    console.log("\n  NEXT STEP:");
    console.log(`  Review the squad consolidations in Notion HITL Review Sessions.`);
    console.log(`  When ready, approve and fire the master trigger:`);
    console.log(`\n     pnpm approve-week --week=${weekOf}`);
    console.log(`\n  Or with VP feedback for next week's report:`);
    console.log(`     pnpm approve-week --week=${weekOf} --vp-feedback="..."`);
  } else {
    console.log(`[dry] No changes made. Remove --dry-run to generate.`);
  }
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
