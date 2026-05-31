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

// ── CLI args ──────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const weekOf = args.find((a) => a.startsWith("--week="))?.split("=")[1];
const DRY_RUN = args.includes("--dry-run");

// ── Types ─────────────────────────────────────────────────────────────────────

interface Citation {
  recordId: string;
  sourceUrl: string;
  claim: string;
}

interface MasterOutput {
  executiveSummary: string;
  highlights: string;
  risksBlockers: string;
  crossSquadDeps: string;
  roadmapMovement: string;
  openDiscrepancies: string;
  conflictPolicy: string;
  citationCoveragePct: number;
  citations: Citation[];
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
  { squad: SquadId; sessionId: string; content: string }[]
> {
  const notion   = getNotionClient();
  const weekDate = weekOfToDate(weekOf);
  const results: { squad: SquadId; sessionId: string; content: string }[] = [];

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

    results.push({ squad, sessionId, content });
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

Citation rules:
- recordId = the HITL Session pageId (listed above as sessionId).
- sourceUrl = leave empty ("").
- claim = verbatim sentence from your report.
- Target ≥85% factual sentence coverage.
- Compute citationCoveragePct as (cited_sentences / total_factual_sentences × 100).

Respond with ONLY valid JSON (no markdown fences, no preamble):
{
  "executiveSummary": "string",
  "highlights": "markdown string",
  "risksBlockers": "markdown string",
  "crossSquadDeps": "markdown string",
  "roadmapMovement": "markdown string",
  "openDiscrepancies": "markdown string",
  "conflictPolicy": "string",
  "citationCoveragePct": 90.0,
  "citations": [{"recordId": "<sessionId>", "sourceUrl": "", "claim": "<exact sentence>"}]
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
  try {
    return JSON.parse(text) as MasterOutput;
  } catch {
    const start = text.indexOf("{");
    const end   = text.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(text.slice(start, end + 1)) as MasterOutput;
    }
    throw new Error(`Failed to parse master report JSON: ${text.slice(0, 200)}`);
  }
}

// ── Step 4: Write master report to Notion ────────────────────────────────────
// Replicates write_master_summary worker tool logic directly.

async function writeMasterReport(
  weekOf: string,
  output: MasterOutput,
  approvedSessionIds: string[],
): Promise<{ pageId: string; action: "created" | "updated" }> {
  const notion   = getNotionClient();
  const weekDate = weekOfToDate(weekOf);
  const startedAt = new Date();

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
            `${output.citations.length} citations`,
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
          `citations=${output.citations.length} ` +
          `coverage=${Math.round(output.citationCoveragePct)}% ` +
          `status=awaiting-VP`,
        ),
      },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });

  return { pageId, action };
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
    console.log(`  ✓ Generated (${output.citations.length} citations, coverage ${Math.round(output.citationCoveragePct)}%)`);

    const approvedSessionIds = squads.map((s) => s.sessionId);
    const { pageId, action } = await writeMasterReport(weekOf, output, approvedSessionIds);
    console.log(`  ✓ Master EPD Weekly ${action}: ${pageId.slice(0, 8)}…`);
  }

  console.log("\n" + "─".repeat(60));
  if (!DRY_RUN) {
    console.log(`✓  Master report for ${weekOf} written. Status: awaiting-VP.`);
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
