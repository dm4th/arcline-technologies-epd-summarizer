/**
 * trigger-gtm-daily-digest.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Simulates the GTM Daily Digest Custom Agent (PRD-15). Reads recent meeting
 * notes from GTM | Meeting Notes, calls Claude to compose the digest, then
 * writes one GTM | Daily Digest row and an Agent Run Log entry.
 *
 * This script mirrors what a native Notion Custom Agent would do — useful for:
 *   - Demo runs (produce a live digest from fixture data on demand)
 *   - Integration testing (verify AC-2 through AC-7 without needing a live Custom Agent)
 *   - Historical backfill (pass --date to produce a digest for a past date)
 *
 * Usage:
 *   pnpm gtm-daily-digest                        # digest for today
 *   pnpm gtm-daily-digest --days-back=3          # look back 3 days (use on Mondays)
 *   pnpm gtm-daily-digest --date=2026-06-03      # produce digest for a specific date
 *   pnpm gtm-daily-digest --dry-run              # plan only, no writes
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from "@anthropic-ai/sdk";
import { isFullPage } from "@notionhq/client";
import { loadEnv } from "../src/lib/env";
import { getNotionClient } from "../src/lib/notion";
import { NOTION_IDS } from "../src/lib/notion-ids";

loadEnv();

// ── CLI args ──────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const daysBack = parseInt(
  args.find((a) => a.startsWith("--days-back="))?.split("=")[1] ?? "1",
  10,
);
const targetDate =
  args.find((a) => a.startsWith("--date="))?.split("=")[1] ??
  new Date().toISOString().split("T")[0];

// ── Types ─────────────────────────────────────────────────────────────────────

interface MeetingNote {
  pageId:              string;
  title:               string;
  account:             string;
  opportunityId:       string;
  opportunityTitle:    string;
  date:                string;
  rep:                 string;
  stage:               string;
  sentiment:           string;
  actionItems:         string;
  summary:             string;
  competitorMentioned: string;
}

interface OpportunityContext {
  title:     string;
  account:   string;
  stage:     string;
  acv:       number;
  closeDate: string;
  health:    string;
  rep:       string;
}

// ── Notion property extractors ────────────────────────────────────────────────

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

const rt = (s: string) =>
  s.match(/.{1,1999}/gs)?.map((chunk) => ({ type: "text" as const, text: { content: chunk } })) ??
  [{ type: "text" as const, text: { content: "" } }];

// ── Step 1: Read recent meeting notes ─────────────────────────────────────────

async function readRecentNotes(daysBackCount: number): Promise<MeetingNote[]> {
  const notion = getNotionClient();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - daysBackCount);
  const cutoffDate = cutoff.toISOString().split("T")[0];

  console.log(`  Querying meeting notes on or after ${cutoffDate}…`);

  const response = await notion.databases.query({
    database_id: NOTION_IDS.dbs.gtmMeetingNotes,
    filter: { property: "Date", date: { on_or_after: cutoffDate } },
    sorts: [{ property: "Date", direction: "descending" }],
    page_size: 50,
  });

  return Promise.all(
    response.results.filter(isFullPage).map(async (page) => {
      const p      = page.properties as Record<string, unknown>;
      const oppIds = relationIds(p["Opportunity"]);
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
          // Opportunity row missing — degrade gracefully
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
}

// ── Step 2: Enrich at-risk deals with Opportunity context ─────────────────────

async function enrichOpportunity(opportunityId: string): Promise<OpportunityContext | null> {
  if (!opportunityId) return null;
  const notion = getNotionClient();
  try {
    const page = await notion.pages.retrieve({ page_id: opportunityId });
    if (!isFullPage(page)) return null;
    const p = page.properties as Record<string, unknown>;
    return {
      title:     plainText(p["Title"]),
      account:   plainText(p["Account"]),
      stage:     selectName(p["Stage"]),
      acv:       numberValue(p["ACV"]),
      closeDate: dateStart(p["Close Date"]),
      health:    selectName(p["Health"]),
      rep:       selectName(p["Rep"]),
    };
  } catch {
    return null;
  }
}

// ── Step 3: Compose digest via Claude ─────────────────────────────────────────

interface DigestOutput {
  summary:      string;
  actionItems:  string;
  dealsTouched: number;
  atRiskCount:  number;
}

async function composeDigest(
  notes: MeetingNote[],
  enrichedOpps: Map<string, OpportunityContext>,
  date: string,
): Promise<DigestOutput> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const notesJson = notes.map((n) => {
    const opp = n.opportunityId ? enrichedOpps.get(n.opportunityId) : null;
    return {
      ...n,
      opportunityContext: opp
        ? `ACV $${opp.acv.toLocaleString()} | Stage: ${opp.stage} | Health: ${opp.health} | Close: ${opp.closeDate}`
        : null,
    };
  });

  const prompt = `You are the GTM Daily Digest agent for Arcline Technologies.

Today is ${date}. Here are the recent sales meeting notes:

${JSON.stringify(notesJson, null, 2)}

Write a structured daily digest in this exact markdown format:

## Deal Updates
One line per meeting — "Account (Stage): [key takeaway]"

## Pipeline Health
Total meetings / positive / neutral / at-risk counts — one line

## Action Items Due ≤48h
Bulleted list of rep-specific follow-ups

## Flags for CRO
⚠ lines for at-risk deals or competitor mentions that need attention. If none, write "No flags today."

Rules:
- Under 300 words total
- Be direct and specific — no filler language
- Include ACV and competitor name when known for at-risk deals
- Each action item names the rep and deadline

Return a JSON object with:
{
  "summary": "<full markdown digest>",
  "actionItems": "<bulleted action items only, for the Action Items field>",
  "dealsTouched": <number>,
  "atRiskCount": <number of at-risk deals in Flags for CRO>
}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from the response (may be wrapped in markdown code fences)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error(`Claude response did not contain parseable JSON:\n${text}`);
  }

  const parsed = JSON.parse(jsonMatch[1]) as DigestOutput;
  return parsed;
}

// ── Step 4: Write GTM | Daily Digest row ─────────────────────────────────────

async function writeDailyDigest(
  date: string,
  digest: DigestOutput,
): Promise<{ pageId: string; action: "created" | "updated"; status: string }> {
  const notion = getNotionClient();
  const status = digest.atRiskCount > 0 ? "draft" : "published";
  const title  = `GTM Daily Digest — ${date}`;

  const properties = {
    "Title":             { title: rt(title) },
    "Date":              { date: { start: date } },
    "Summary":           { rich_text: rt(digest.summary) },
    "Deals Touched":     { number: digest.dealsTouched },
    "Action Items":      { rich_text: rt(digest.actionItems) },
    "Release Cross-Ref": { rich_text: rt("") },
    "Status":            { select: { name: status } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const existing = await notion.databases.query({
    database_id: NOTION_IDS.dbs.gtmDailyDigest,
    filter: { property: "Date", date: { equals: date } },
    page_size: 1,
  });

  if (existing.results.length > 0) {
    const pageId = existing.results[0].id;
    await notion.pages.update({ page_id: pageId, properties });
    return { pageId, action: "updated", status };
  }

  const page = await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.gtmDailyDigest },
    properties,
  });
  return { pageId: page.id, action: "created", status };
}

// ── Step 5: Write Agent Run Log ───────────────────────────────────────────────

async function writeRunLog(
  startedAt: Date,
  outcome: "ok" | "skipped" | "error",
  notes: string,
): Promise<void> {
  const notion      = getNotionClient();
  const completedAt = new Date();
  const durationMs  = completedAt.getTime() - startedAt.getTime();
  const agentName   = "gtm-meeting-summarizer";
  const runId       = `${agentName}-${startedAt.toISOString()}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.agentRunLog },
    properties: {
      "Run Id":       { title: rt(runId) },
      "Agent Name":   { select: { name: agentName } },
      "Started At":   { date: { start: startedAt.toISOString() } },
      "Completed At": { date: { start: completedAt.toISOString() } },
      "Duration ms":  { number: durationMs },
      "Outcome":      { select: { name: outcome } },
      "Notes":        { rich_text: rt(notes) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startedAt = new Date();
  const dryLabel  = DRY_RUN ? " (DRY RUN — no writes)" : "";

  console.log("═".repeat(60));
  console.log(`GTM Daily Digest — ${targetDate}${dryLabel}`);
  console.log("═".repeat(60));
  console.log(`  Looking back ${daysBack} day(s) for meeting notes.\n`);

  // ── Step 1: Read meeting notes ───────────────────────────────────────────────
  console.log("[1/4] Reading recent meeting notes…");
  const notes = await readRecentNotes(daysBack);
  console.log(`  Found ${notes.length} meeting note(s).`);

  if (notes.length === 0) {
    console.log("\n  No meeting notes found — writing 'no meetings' digest.");
    const noMeetingDigest: DigestOutput = {
      summary:      `No meetings recorded for ${targetDate}.`,
      actionItems:  "",
      dealsTouched: 0,
      atRiskCount:  0,
    };

    if (!DRY_RUN) {
      const { pageId, action } = await writeDailyDigest(targetDate, noMeetingDigest);
      console.log(`  ✓ Digest ${action} (pageId=${pageId}, status=published)`);
      await writeRunLog(startedAt, "skipped", `no meeting notes for date=${targetDate}`);
      console.log("  ✓ Agent Run Log entry written (outcome=skipped)");
    } else {
      console.log("  (dry-run) Would create published 'no meetings' digest and run-log entry.");
    }
    return;
  }

  // ── Step 2: Enrich at-risk deals ─────────────────────────────────────────────
  const atRiskNotes = notes.filter((n) => n.sentiment === "at-risk");
  console.log(
    `\n[2/4] Enriching ${atRiskNotes.length} at-risk deal(s) with Opportunity context…`,
  );

  const enrichedOpps = new Map<string, OpportunityContext>();
  for (const note of atRiskNotes) {
    if (note.opportunityId) {
      const opp = await enrichOpportunity(note.opportunityId);
      if (opp) {
        enrichedOpps.set(note.opportunityId, opp);
        console.log(
          `  ✓ ${note.account}: ACV $${opp.acv.toLocaleString()} | health=${opp.health} | close=${opp.closeDate}`,
        );
      }
    }
  }

  // ── Step 3: Compose digest ────────────────────────────────────────────────────
  console.log("\n[3/4] Composing digest via Claude…");
  const digest = await composeDigest(notes, enrichedOpps, targetDate);
  console.log(`  ✓ Digest composed — ${digest.dealsTouched} deals, ${digest.atRiskCount} at-risk`);

  const competitorMentions = notes.filter((n) => n.competitorMentioned).length;
  console.log(`  Competitor mentions: ${competitorMentions}`);
  console.log(`  Status will be: ${digest.atRiskCount > 0 ? "draft (CRO review needed)" : "published (auto)"}`);

  if (DRY_RUN) {
    console.log("\n── Digest preview ────────────────────────────────────");
    console.log(digest.summary);
    console.log("──────────────────────────────────────────────────────");
    console.log("\n(dry-run) No writes performed.");
    return;
  }

  // ── Step 4: Write digest row ──────────────────────────────────────────────────
  console.log("\n[4/4] Writing GTM | Daily Digest row…");
  const { pageId, action, status } = await writeDailyDigest(targetDate, digest);
  console.log(`  ✓ Digest ${action} (pageId=${pageId}, status=${status})`);

  await writeRunLog(
    startedAt,
    "ok",
    `notesProcessed=${notes.length} atRisk=${digest.atRiskCount} competitors=${competitorMentions} dealsTouched=${digest.dealsTouched}`,
  );
  console.log("  ✓ Agent Run Log entry written (outcome=ok)");

  console.log("\n─".repeat(60));
  console.log(`✓  GTM Daily Digest complete.`);
  console.log(`   Digest: ${pageId}`);
  console.log(`   Status: ${status}${status === "draft" ? " ← CRO review needed" : " ← auto-published"}`);
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
