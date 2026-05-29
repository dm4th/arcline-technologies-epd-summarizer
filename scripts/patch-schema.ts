/**
 * patch-schema.ts
 *
 * ADDITIVE migration script — safe to run against a live Notion workspace.
 * Never deletes, archives, or overwrites existing rows or page content.
 *
 * What it does:
 *  1. Reads DB IDs from src/lib/notion-ids.ts (must already be populated by bootstrap).
 *  2. Calls databases.update to add new property columns to existing DBs.
 *     Notion merges new properties; existing columns and rows are untouched.
 *  3. Skips any property that already exists on the DB (checks live schema first).
 *  4. Does NOT re-seed rows; use seedMissing() helpers if you need to add new seed data.
 *
 * When to use vs teardown:
 *  - Adding a new column?           → patch-schema.ts  ✓
 *  - Changing a column's type?      → manual in Notion (API can't change column types)
 *  - Removing a column?             → manual in Notion
 *  - Starting from scratch (dev)?   → teardown + bootstrap  (MUST confirm with user first)
 *
 * Usage:  pnpm tsx scripts/patch-schema.ts
 *         pnpm tsx scripts/patch-schema.ts --dry-run
 */

import { getNotionClient } from "../src/lib/notion";
import { loadEnv } from "../src/lib/env";
import { NOTION_IDS } from "../src/lib/notion-ids";

const DRY_RUN = process.argv.includes("--dry-run");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the set of property names that currently exist on a database. */
async function existingProps(dbId: string): Promise<Set<string>> {
  const client = getNotionClient();
  const db = await client.databases.retrieve({ database_id: dbId });
  return new Set(Object.keys(db.properties));
}

type SelectColor =
  | "default" | "gray" | "brown" | "orange" | "yellow"
  | "green" | "blue" | "purple" | "pink" | "red";

const PALETTE: SelectColor[] = ["blue", "green", "yellow", "orange", "red", "purple", "pink", "gray"];

function selectProp(...names: string[]) {
  return { select: { options: names.map((name, i) => ({ name, color: PALETTE[i % PALETTE.length] })) } };
}

/**
 * Adds missing properties to a database.
 * Fetches the live schema first and skips any property that already exists.
 */
async function addMissingProps(
  dbId: string,
  dbName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wanted: Record<string, any>
): Promise<void> {
  const client = getNotionClient();
  const current = await existingProps(dbId);
  const missing: Record<string, unknown> = {};

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

  await client.databases.update({
    database_id: dbId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: missing as any,
  });
  console.log(`  ✓ ${dbName}: added ${Object.keys(missing).length} properties`);
}

// ── Migration definitions ─────────────────────────────────────────────────────
//
// To add new columns in a future session: add an entry here for the affected DB,
// listing only the NEW properties. Existing ones are safe — they're skipped.

async function runMigrations(): Promise<void> {
  const ids = NOTION_IDS.dbs;

  console.log("Patching Squads DB…");
  await addMissingProps(ids.squads, "Squads", {
    "Members":     { rich_text: {} },
    "Product URL": { url: {} },
  });

  console.log("\nPatching Mirror — Slack DB…");
  await addMissingProps(ids.mirrorSlack, "Mirror — Slack", {
    "Thread Timestamp": { rich_text: {} },
    "Thread URL":       { url: {} },
  });

  console.log("\nPatching Squad Weekly Summary DB…");
  await addMissingProps(ids.squadWeeklySummary, "Squad Weekly Summary", {
    "Approved By": { rich_text: {} },
    // NOTE: "Summary" column was intentionally REMOVED from this DB in v2.
    // If it exists on a workspace that ran v1 bootstrap, remove it manually in Notion.
  });

  console.log("\nPatching Product Roadmap DB…");
  await addMissingProps(ids.productRoadmap, "Product Roadmap", {
    "Related PRDs": { relation: { database_id: ids.prds, single_property: {} } },
  });

  console.log("\nPatching PRDs DB…");
  await addMissingProps(ids.prds, "PRDs", {
    // v1 had "Acceptance Criteria" and "Last Updated" — removing is manual; adding:
    "Last Updated": { date: {} },
  });

  console.log("\nPatching Master EPD Weekly DB…");
  await addMissingProps(ids.masterEpdWeekly, "Master EPD Weekly", {
    // NOTE: "Executive Summary" and "Body" were intentionally removed in v2.
    // Remove them manually in Notion if they exist from a v1 workspace.
    // New properties:
    "Status": selectProp("draft", "awaiting-review", "approved", "published"),
  });

  // Delivery Pipeline is a new DB — if it doesn't exist in notion-ids.ts
  // (i.e., empty string), bootstrap must be run first.
  if (ids.deliveryPipeline) {
    console.log("\nDelivery Pipeline DB already present — no patch needed.");
  } else {
    console.warn("\n[warn]  deliveryPipeline ID is empty in notion-ids.ts.");
    console.warn("        Run pnpm bootstrap on a clean workspace to create it.");
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  const allEmpty = Object.values(NOTION_IDS.dbs).every((v) => v === "");
  if (allEmpty) {
    console.error("[fatal] notion-ids.ts has no IDs. Run pnpm bootstrap first.");
    process.exit(1);
  }

  console.log("─".repeat(60));
  console.log(`Arcline Schema Patch${DRY_RUN ? "  (DRY RUN)" : ""}`);
  console.log("─".repeat(60) + "\n");

  await runMigrations();

  console.log("\n" + "─".repeat(60));
  console.log(DRY_RUN ? "Dry run complete — no changes made." : "✓  Schema patch complete.");
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
