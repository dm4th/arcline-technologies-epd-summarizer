/**
 * patch-schema-round2.ts
 *
 * ADDITIVE Round 2 schema migration — safe to run against a live Notion workspace.
 * Never deletes, archives, or overwrites existing rows or page content.
 *
 * What it does:
 *  1. Finds or creates a "Revenue" sub-page under BASE_NOTION_PAGE.
 *  2. Creates 5 new GTM databases under "Revenue" (skips if they already exist by title):
 *     Opportunities, Meeting Notes, Daily Digest, Battle Cards, Weekly Briefs.
 *     ("Weekly Briefs" added 2026-06-07 — replaces the original page-hierarchy design
 *      for the GTM Weekly digest with a proper database, one row per week, mirroring
 *      Master EPD Weekly. See PRD-13 Addendum + PRD-17 spec update.)
 *  3. Patches "Key Releases" onto Squad Weekly Summary (skips if already present).
 *  4. Patches "GTM Highlights" onto Master EPD Weekly (skips if already present).
 *  5. Writes the 5 new DB IDs back into src/lib/notion-ids.ts.
 *
 * Usage:
 *   pnpm patch-round2
 *   pnpm patch-round2 -- --dry-run
 *
 * Idempotency: safe to run multiple times — second run prints "all GTM databases exist"
 * and exits 0 without touching any rows.
 */

import path from "path";
import fs from "fs";
import { getNotionClient, extractPageId } from "../src/lib/notion";
import { loadEnv } from "../src/lib/env";
import { NOTION_IDS } from "../src/lib/notion-ids";

const DRY_RUN = process.argv.includes("--dry-run");

// ── DB names ──────────────────────────────────────────────────────────────────

const GTM_DB_NAMES = {
  opportunities: "GTM | Opportunities",
  meetingNotes:  "GTM | Meeting Notes",
  dailyDigest:   "GTM | Daily Digest",
  battleCards:   "GTM | Battle Cards",
  // Added 2026-06-07: converts the GTM Weekly digest from a page-hierarchy
  // (Revenue > GTM Weekly Briefs > GTM Weekly — {weekOf}) into a proper
  // database — mirroring Master EPD Weekly (one row per week, queryable,
  // structured properties) instead of title-matched sub-pages. See PRD-13
  // Addendum and PRD-17 spec update for rationale.
  weeklyBriefs:  "GTM | Weekly Briefs",
} as const;

type GtmDbKey = keyof typeof GTM_DB_NAMES;

const REVENUE_PAGE_TITLE = "Revenue";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Scans a page's direct children and returns a title→id map. */
async function scanChildTitles(parentId: string): Promise<Map<string, string>> {
  const client = getNotionClient();
  const map = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const res = await client.blocks.children.list({
      block_id: parentId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const block of res.results) {
      if (!("type" in block)) continue;
      if (block.type === "child_database") map.set(block.child_database.title, block.id);
      else if (block.type === "child_page")  map.set(block.child_page.title,   block.id);
    }
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return map;
}

/** Returns the set of property names currently on a database. */
async function existingProps(dbId: string): Promise<Set<string>> {
  const client = getNotionClient();
  const db = await client.databases.retrieve({ database_id: dbId });
  return new Set(Object.keys(db.properties));
}

/** Adds missing properties to a live database; skips any that already exist. */
async function addMissingProps(
  dbId: string,
  dbName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wanted: Record<string, any>
): Promise<void> {
  const client = getNotionClient();
  const current = await existingProps(dbId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const missing: Record<string, any> = {};

  for (const [name, schema] of Object.entries(wanted)) {
    if (current.has(name)) {
      console.log(`  [exists] "${name}" on ${dbName}`);
    } else {
      console.log(`  [add]    "${name}" on ${dbName}`);
      missing[name] = schema;
    }
  }

  if (Object.keys(missing).length === 0) {
    console.log(`  → ${dbName}: all properties already present`);
    return;
  }
  if (DRY_RUN) {
    console.log(`  [dry]    would add ${Object.keys(missing).length} properties to ${dbName}`);
    return;
  }
  await client.databases.update({ database_id: dbId, properties: missing });
  console.log(`  ✓ ${dbName}: added ${Object.keys(missing).length} properties`);
}

type SelectColor = "default"|"gray"|"brown"|"orange"|"yellow"|"green"|"blue"|"purple"|"pink"|"red";
const PALETTE: SelectColor[] = ["blue","green","yellow","orange","red","purple","pink","gray","brown"];

function selectProp(...names: string[]) {
  return { select: { options: names.map((name, i) => ({ name, color: PALETTE[i % PALETTE.length] })) } };
}

function rt(content: string) {
  return [{ type: "text" as const, text: { content } }];
}

// ── notion-ids.ts writer ──────────────────────────────────────────────────────

// Maps internal GtmDbKey → the TypeScript identifier in notion-ids.ts
const TSKEY: Record<GtmDbKey, string> = {
  opportunities: "opportunities",
  meetingNotes:  "gtmMeetingNotes",
  dailyDigest:   "gtmDailyDigest",
  battleCards:   "battleCards",
  weeklyBriefs:  "gtmWeeklyBriefs",
};

function updateNotionIds(ids: Record<GtmDbKey, string>): void {
  const filePath = path.resolve(__dirname, "../src/lib/notion-ids.ts");
  let src = fs.readFileSync(filePath, "utf8");

  for (const [key, id] of Object.entries(ids) as [GtmDbKey, string][]) {
    const tsKey = TSKEY[key];
    // Match the empty-string placeholder: `tsKey:    "",`  (any whitespace between)
    const re = new RegExp(`(${tsKey}:\\s+)""`);
    if (re.test(src)) {
      src = src.replace(re, `$1"${id}"`);
      console.log(`  [ids.ts] ${tsKey} → ${id}`);
    } else {
      console.warn(`  [warn]   Placeholder for "${tsKey}" not found in notion-ids.ts — update manually`);
    }
  }

  fs.writeFileSync(filePath, src, "utf8");
  console.log(`\nWrote ${filePath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const env = loadEnv();
  const client = getNotionClient();
  const baseId = extractPageId(env.BASE_NOTION_PAGE);

  console.log("─".repeat(60));
  console.log(`Arcline Round 2 Schema Patch${DRY_RUN ? "  (DRY RUN)" : ""}`);
  console.log(`Base page: ${env.BASE_NOTION_PAGE}`);
  console.log("─".repeat(60) + "\n");

  // ── 1. Find or create "Revenue" sub-page under the base workspace page ────
  console.log(`Scanning base page for "${REVENUE_PAGE_TITLE}" sub-page…`);
  const baseChildren = await scanChildTitles(baseId);

  let revenuePageId: string;
  if (baseChildren.has(REVENUE_PAGE_TITLE)) {
    revenuePageId = baseChildren.get(REVENUE_PAGE_TITLE)!;
    console.log(`[found]  Revenue sub-page → ${revenuePageId}`);
  } else if (DRY_RUN) {
    console.log("[dry]    would create 'Revenue' sub-page");
    revenuePageId = "dry-run-revenue";
  } else {
    const page = await client.pages.create({
      parent: { type: "page_id", page_id: baseId },
      properties: { title: { title: rt(REVENUE_PAGE_TITLE) } },
    });
    revenuePageId = page.id;
    console.log(`[create] Revenue sub-page → ${revenuePageId}`);
  }

  // ── 2. Scan Revenue page for existing GTM databases ───────────────────────
  console.log("\nScanning Revenue page for existing GTM databases…");
  const revenueChildren = DRY_RUN
    ? new Map<string, string>()
    : await scanChildTitles(revenuePageId);

  const gtmIds: Record<GtmDbKey, string> = {
    opportunities: "",
    meetingNotes:  "",
    dailyDigest:   "",
    battleCards:   "",
    weeklyBriefs:  "",
  };
  let created = 0;
  let found   = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function findOrCreateGtmDb(key: GtmDbKey, properties: Record<string, any>): Promise<string> {
    const title = GTM_DB_NAMES[key];
    if (revenueChildren.has(title)) {
      console.log(`[found]  ${title}`);
      found++;
      return revenueChildren.get(title)!;
    }
    if (DRY_RUN) {
      console.log(`[dry]    would create ${title}`);
      return `dry-${key}`;
    }
    const db = await client.databases.create({
      parent: { type: "page_id", page_id: revenuePageId },
      title: rt(title),
      properties,
    });
    created++;
    console.log(`[create] ${title} → ${db.id}`);
    return db.id;
  }

  // ── 3. GTM | Opportunities (first — Meeting Notes depends on it) ──────────
  console.log("\nCreating GTM | Opportunities…");
  gtmIds.opportunities = await findOrCreateGtmDb("opportunities", {
    "Title":            { title: {} },
    "Account":          { rich_text: {} },
    "Stage":            selectProp("discovery", "technical-eval", "negotiation", "closed-won", "closed-lost"),
    "ACV":              { number: { format: "dollar" } },
    "Close Date":       { date: {} },
    "Product Interest": { relation: { database_id: NOTION_IDS.dbs.prds, single_property: {} } },
    "Rep":              selectProp("Alice Mercer", "Ben Torres", "Clara Lin", "David Osei"),
    "Health":           selectProp("on-track", "at-risk", "churned"),
  });

  // ── 4. GTM | Meeting Notes (relation back to Opportunities) ───────────────
  console.log("\nCreating GTM | Meeting Notes…");
  gtmIds.meetingNotes = await findOrCreateGtmDb("meetingNotes", {
    "Title":                { title: {} },
    "Account":              { rich_text: {} },
    // Relation to Opportunities — use the ID we just obtained
    "Opportunity":          { relation: { database_id: gtmIds.opportunities, single_property: {} } },
    "Date":                 { date: {} },
    "Rep":                  selectProp("Alice Mercer", "Ben Torres", "Clara Lin", "David Osei"),
    "Stage":                selectProp("discovery", "technical-eval", "negotiation", "closed-won", "closed-lost"),
    "Sentiment":            selectProp("positive", "neutral", "at-risk"),
    "Action Items":         { rich_text: {} },
    "Summary":              { rich_text: {} },
    "Competitor Mentioned": { rich_text: {} },
  });

  // ── 5. GTM | Daily Digest ─────────────────────────────────────────────────
  console.log("\nCreating GTM | Daily Digest…");
  gtmIds.dailyDigest = await findOrCreateGtmDb("dailyDigest", {
    "Title":             { title: {} },
    "Date":              { date: {} },
    "Summary":           { rich_text: {} },
    "Deals Touched":     { number: { format: "number" } },
    "Action Items":      { rich_text: {} },
    "Release Cross-Ref": { rich_text: {} },
    "Status":            selectProp("draft", "published"),
  });

  // ── 6. GTM | Battle Cards ─────────────────────────────────────────────────
  console.log("\nCreating GTM | Battle Cards…");
  gtmIds.battleCards = await findOrCreateGtmDb("battleCards", {
    "Competitor":          { title: {} },
    "Last Updated":        { date: {} },
    "Their Strengths":     { rich_text: {} },
    "Our Differentiators": { rich_text: {} },
    "Related Releases":    { rich_text: {} },
    "Source Squads":       { relation: { database_id: NOTION_IDS.dbs.squads, single_property: {} } },
  });

  // ── 6b. GTM | Weekly Briefs ───────────────────────────────────────────────
  // One row per week — replaces the original page-hierarchy design
  // (Revenue > GTM Weekly Briefs > GTM Weekly — {weekOf}) with a proper
  // database, mirroring Master EPD Weekly. The 4-section brief body
  // (What Shipped / What It Means / Deals to Contact / How to Use) lives
  // in each row's page body exactly as it did in the old sub-page design —
  // only the structure around it changes (queryable properties + relations
  // instead of title-matched child pages).
  console.log("\nCreating GTM | Weekly Briefs…");
  gtmIds.weeklyBriefs = await findOrCreateGtmDb("weeklyBriefs", {
    "Title":         { title: {} },
    "Week Of":       { date: {} },
    "Status":        selectProp("draft", "published"),
    "Deals Flagged": { number: { format: "number" } },
    "Flagged Deals": { relation: { database_id: NOTION_IDS.dbs.opportunities, single_property: {} } },
  });

  // ── 7. Patch existing databases ───────────────────────────────────────────
  // Note: "Key Releases" was removed from Squad Weekly Summary patch (2026-06-08).
  // It is now written only as a `## Key Releases` section in the page body,
  // not as a rich_text property (see PRD-17 Implementation Notes for details).
  console.log("\nPatching Master EPD Weekly…");
  await addMissingProps(NOTION_IDS.dbs.masterEpdWeekly, "Master EPD Weekly", {
    "GTM Highlights": { rich_text: {} },
  });

  // ── 8. Write IDs back to notion-ids.ts (only when new DBs were created) ───
  if (!DRY_RUN && created > 0) {
    console.log("\nUpdating src/lib/notion-ids.ts…");
    updateNotionIds(gtmIds);
  } else if (!DRY_RUN) {
    console.log("\nnotion-ids.ts: no changes needed (all IDs already present).");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  if (DRY_RUN) {
    console.log("Dry run complete — no changes made.");
  } else if (created === 0 && found === 5) {
    console.log("✓  All GTM databases already exist — no changes made.");
  } else {
    console.log(`✓  Round 2 schema patch complete. Created: ${created}  Already existed: ${found}`);
    if (!DRY_RUN) {
      console.log("\nNew GTM DB IDs:");
      for (const key of Object.keys(gtmIds) as GtmDbKey[]) {
        console.log(`  ${TSKEY[key]}: ${gtmIds[key]}`);
      }
    }
  }
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
