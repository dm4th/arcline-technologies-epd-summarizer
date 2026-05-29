/**
 * bootstrap-workspace.ts  (v2)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  FIRST-TIME WORKSPACE CREATION ONLY
 *
 * This script creates the 11 Notion databases and seeds their initial rows.
 * It is safe to re-run on a populated workspace — it is a no-op (title-scan
 * detects existing DBs; dbIsEmpty() guards all seed rows).
 *
 * For live workspace changes after initial setup, use the ntn CLI instead:
 *   Add a column:    ntn api v1/databases/{id} -X PATCH --notion-version 2022-06-28 \
 *                      -d '{"properties":{"New Col":{"rich_text":{}}}}'
 *   Update content:  ntn pages update {id} --content "..."
 *   Additive batch:  pnpm patch   (runs scripts/patch-schema.ts)
 *
 * See CLAUDE.md § "Notion Workspace Operations" for the full ruleset.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Schema (v2 vs v1 changes):
 *  - Squads:              Members (text), Product URL (url), page body with team roster
 *  - Mirror — Slack:      Thread Timestamp (text) for channel + thread-level tracking
 *  - Squad Weekly Summary: Summary column removed (→ page body); approval section in body
 *  - Master EPD Weekly:   Executive Summary + Body columns removed (→ page body)
 *  - Product Roadmap:     Related PRDs (relation → PRDs)
 *  - NEW: Delivery Pipeline — step-by-step status tracking per weekly run
 *  - PRDs seed:           Full page bodies for AuthShield, Luminance, FieldKit
 *  - Roadmap seed:        Links to associated PRD pages
 *  - Squad "pages":       pages.squad* in notion-ids.ts are the Squads DB row IDs,
 *                         not standalone top-level pages.
 */

import path from "path";
import fs from "fs";
import { getNotionClient, extractPageId } from "../src/lib/notion";
import { loadEnv } from "../src/lib/env";

// ── DB names ─────────────────────────────────────────────────────────────────

const DB_NAMES = {
  squads:             "Squads",
  mirrorGithub:       "GitHub | Mirror",
  mirrorJira:         "Jira | Mirror",
  mirrorSlack:        "Slack | Mirror",
  mirrorFigma:        "Figma | Mirror",
  prds:               "PRDs",
  productRoadmap:     "Product Roadmap",
  squadWeeklySummary: "Squad Weekly Summary",
  masterEpdWeekly:    "Master EPD Weekly",
  agentRunLog:        "Agent Run Log",
  deliveryPipeline:   "Delivery Pipeline",
} as const;

type DbKey = keyof typeof DB_NAMES;

const SQUAD_PAGE_NAMES = {
  squadAtlas: "Atlas",
  squadLumen: "Lumen",
  squadForge: "Forge",
} as const;

type PageKey = keyof typeof SQUAD_PAGE_NAMES;

// ── Seed data ────────────────────────────────────────────────────────────────

const SQUADS_SEED = [
  {
    name:       "Atlas",
    squadId:    "atlas",
    em:         "Sarah Chen",
    pm:         "Marcus Webb",
    dl:         "Priya Nair",
    members:    "Sarah Chen · Marcus Webb · Priya Nair · Jake Morrison · Fatima Al-Rashid · Dmitri Volkov · Yuki Tanaka",
    productUrl: "https://arcline.internal/platform",
    product:    "AuthShield — enterprise SSO & identity platform",
    roster: [
      { name: "Sarah Chen",       role: "Engineering Manager" },
      { name: "Marcus Webb",      role: "Product Manager" },
      { name: "Priya Nair",       role: "Design Lead" },
      { name: "Jake Morrison",    role: "Staff Engineer" },
      { name: "Fatima Al-Rashid", role: "Senior Engineer" },
      { name: "Dmitri Volkov",    role: "Senior Engineer" },
      { name: "Yuki Tanaka",      role: "Engineer" },
    ],
  },
  {
    name:       "Lumen",
    squadId:    "lumen",
    em:         "David Park",
    pm:         "Elena Santos",
    dl:         "Tomás Rivera",
    members:    "David Park · Elena Santos · Tomás Rivera · Amara Osei · Nadia Kowalski · Ben Fletcher",
    productUrl: "https://arcline.internal/design-system",
    product:    "Luminance — web frontend & design system",
    roster: [
      { name: "David Park",    role: "Engineering Manager" },
      { name: "Elena Santos",  role: "Product Manager" },
      { name: "Tomás Rivera",  role: "Design Lead" },
      { name: "Amara Osei",    role: "Senior Engineer" },
      { name: "Nadia Kowalski",role: "Senior Engineer" },
      { name: "Ben Fletcher",  role: "Engineer" },
    ],
  },
  {
    name:       "Forge",
    squadId:    "forge",
    em:         "Aisha Johnson",
    pm:         "Kai Yamamoto",
    dl:         "Chris Okafor",
    members:    "Aisha Johnson · Kai Yamamoto · Chris Okafor · Mei Lin · Rodrigo Flores · Ingrid Bjornsson",
    productUrl: "https://arcline.internal/mobile",
    product:    "FieldKit — offline-first mobile SDK",
    roster: [
      { name: "Aisha Johnson",   role: "Engineering Manager" },
      { name: "Kai Yamamoto",    role: "Product Manager" },
      { name: "Chris Okafor",    role: "Design Lead" },
      { name: "Mei Lin",         role: "Senior Engineer" },
      { name: "Rodrigo Flores",  role: "Senior Engineer" },
      { name: "Ingrid Bjornsson",role: "Engineer" },
    ],
  },
] as const;

const PRDS_SEED = [
  {
    title:       "AuthShield SSO Phase 1",
    squadId:     "atlas",
    status:      "active",
    productSlug: "authshield",
    goal: "Implement SAML 2.0 + OIDC federation so enterprise customers can use their existing IdP (Okta, Azure AD, ADFS) to sign in across all Arcline products.",
    why: "Our largest 12 enterprise deals have blocked on SSO. Each product currently maintains separate auth, forcing customers to manage 3+ credential sets. Losing deals to competitors who shipped SSO two years ago.",
    design: [
      "SAML 2.0 service provider for the three Arcline products + an OIDC wrapper for forward compatibility.",
      "Token exchange service: SAML assertion → short-lived JWT; JWT consumed by existing auth middleware.",
      "Admin portal: per-tenant IdP configuration, certificate rotation, debug logs.",
      "MFA pass-through: Arcline delegates MFA entirely to the IdP; no second-factor prompt on our side.",
      "Session management: 8h rolling session tied to SAML assertion; logout triggers SAML SLO.",
    ],
    acs: [
      "SAML federation end-to-end working for 5 test enterprise tenants (Okta, Azure AD, ADFS, Ping, JumpCloud).",
      "Token exchange p99 latency < 200 ms under 100 RPS load.",
      "MFA pass-through: users with MFA on their IdP are not prompted for a second factor by Arcline.",
      "Admin portal: tenant can upload IdP metadata XML and certificate; rotation does not break active sessions.",
      "SOC2 audit log: every login event timestamped with tenant, user, IdP, success/failure.",
      "Zero regressions on existing username/password auth flow (parallel, not replacing).",
    ],
    outOfScope: [
      "OAuth2 for consumer (B2C) accounts — separate epic.",
      "SCIM 2.0 user provisioning — Phase 2.",
      "Google Workspace / Microsoft 365 as dedicated first-class connectors.",
    ],
  },
  {
    title:       "Luminance Design System 2.0",
    squadId:     "lumen",
    status:      "active",
    productSlug: "luminance",
    goal: "Unify the visual language across all Arcline web products under a single, token-driven component library — reducing per-sprint design-debt and accelerating new feature UI delivery by 30%.",
    why: "Three separate component libraries (ProductA, Admin, Marketing) have drifted visually and technically. Engineers copy-paste components between repos. Designers maintain 3 Figma files with overlapping but inconsistent components. Any brand update requires triple the work.",
    design: [
      "Figma token pipeline: design tokens defined in Figma Variables → exported via token-transformer → CSS custom properties + TypeScript constants in the npm package.",
      "React component library: 32 base components covering layout, inputs, feedback, navigation. Radix UI primitives for accessibility; styled with Tailwind + CSS vars.",
      "Storybook 8 documentation site deployed to arcline.design with auto-generated prop tables and interactive playground.",
      "Monorepo package: @arcline/luminance — versioned, changelogs auto-generated from conventional commits.",
      "Migration guide: codemods for the 6 most common patterns; estimated 1 sprint per product to fully migrate.",
    ],
    acs: [
      "32 components implemented and documented in Storybook with ≥ 1 usage story each.",
      "Figma tokens exported and consumed: no hardcoded hex values in component source.",
      "Storybook deployed to arcline.design (or equivalent internal URL) and accessible to all engineers.",
      "Lighthouse accessibility score ≥ 95 on the Storybook index page.",
      "ProductA web app migrated to @arcline/luminance with zero visual regressions (validated by Percy).",
      "package published to internal npm registry at version 2.0.0.",
    ],
    outOfScope: [
      "Native mobile (React Native) components — separate Forge deliverable.",
      "Email template library.",
      "Marketing site design — owned by Brand.",
    ],
  },
  {
    title:       "FieldKit Offline Sync",
    squadId:     "forge",
    status:      "active",
    productSlug: "fieldkit",
    goal: "Enable field engineers to use the Arcline mobile app without network connectivity for up to 48 hours, with automatic conflict-free sync when connectivity is restored.",
    why: "Customer NPS driver #2 (after onboarding). 23% of field sessions drop mid-flow due to poor connectivity in industrial sites and remote locations. We lose ~$2.4M ARR/yr to churn directly attributed to offline gaps. Competitors shipped offline mode in Q1.",
    design: [
      "Local SQLite cache: all resources fetched on app open and stored in a versioned local DB. Cache stamped with last-sync timestamp.",
      "Write-ahead queue: any mutation (create/update/delete) queued locally with UUID, timestamp, and operation type.",
      "Sync engine: on connectivity restore, queue drains in chronological order. Conflict strategy: last-write-wins for scalar fields; append-only for arrays (e.g., comments). User presented with conflict review UI when structural conflicts are detected.",
      "Freshness indicators: stale data surfaces a banner ('Last synced 4 h ago') to prevent user confusion.",
      "Background sync: OS background task wakes every 15 min when on WiFi to pre-fetch updates.",
    ],
    acs: [
      "App functions fully offline for 48 h: create, read, update, delete for all core resource types.",
      "Conflict resolution UI surfaces when structural conflicts are detected; user can choose version or merge.",
      "On connectivity restore, queue drains and sync completes within 5 s (p95) for queue depth ≤ 50 ops.",
      "Battery impact of background sync < 5% over 8-hour field day (measured via Instruments).",
      "Offline mode covered by ≥ 80% unit test line coverage on the sync engine module.",
      "Cold-start with no connectivity shows cached data within 800 ms (p95) on iPhone 13 / Pixel 7.",
    ],
    outOfScope: [
      "Offline mode for the web app.",
      "Desktop (macOS/Windows) clients.",
      "Peer-to-peer sync between devices.",
      "Real-time collaborative editing (CRDTs) — the conflict model is optimistic concurrency, not CRDT.",
    ],
  },
] as const;

const ROADMAP_SEED = [
  { title: "Unified Auth SSO",           squadId: "atlas", quarter: "Q3 2026", status: "In Progress", notes: "Phase 1: SAML + OIDC. Phase 2: SCIM provisioning.", prdSlug: "authshield" },
  { title: "Real-time Notifications V2", squadId: "lumen", quarter: "Q3 2026", status: "Planning",    notes: "WebSocket lift + per-user preference center. No PRD yet.", prdSlug: null },
  { title: "Mobile Offline Mode",        squadId: "forge", quarter: "Q4 2026", status: "Planning",    notes: "SQLite cache + sync queue. See FieldKit PRD.", prdSlug: "fieldkit" },
  { title: "API Rate Limiting Overhaul", squadId: "atlas", quarter: "Q4 2026", status: "Backlog",     notes: "Token bucket per tenant; Redis-backed. Sizing spike needed.", prdSlug: null },
  { title: "Design System 2.0",          squadId: "lumen", quarter: "Q2 2026", status: "Shipped",     notes: "Figma tokens → Tailwind; Percy coverage; Storybook live.", prdSlug: "luminance" },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      else if (block.type === "child_page") map.set(block.child_page.title, block.id);
    }
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return map;
}

async function dbIsEmpty(dbId: string): Promise<boolean> {
  const client = getNotionClient();
  const res = await client.databases.query({ database_id: dbId, page_size: 1 });
  return res.results.length === 0;
}

/** Wraps a string as a Notion rich-text array. */
function rt(content: string): Array<{ type: "text"; text: { content: string } }> {
  return [{ type: "text", text: { content } }];
}

type SelectColor =
  | "default" | "gray" | "brown" | "orange" | "yellow"
  | "green" | "blue" | "purple" | "pink" | "red";

const PALETTE: SelectColor[] = ["blue", "green", "yellow", "orange", "red", "purple", "pink", "gray", "brown"];

function selectProp(...names: string[]) {
  return { select: { options: names.map((name, i) => ({ name, color: PALETTE[i % PALETTE.length] })) } };
}

// ── Block builders for page body content ─────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = Record<string, any>;

function h1(text: string): Block {
  return { type: "heading_1", heading_1: { rich_text: rt(text) } };
}
function h2(text: string): Block {
  return { type: "heading_2", heading_2: { rich_text: rt(text) } };
}
function h3(text: string): Block {
  return { type: "heading_3", heading_3: { rich_text: rt(text) } };
}
function p(text: string): Block {
  return { type: "paragraph", paragraph: { rich_text: rt(text) } };
}
function bullet(text: string): Block {
  return { type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(text) } };
}
function numbered(text: string): Block {
  return { type: "numbered_list_item", numbered_list_item: { rich_text: rt(text) } };
}
function divider(): Block {
  return { type: "divider", divider: {} };
}
function callout(text: string): Block {
  return { type: "callout", callout: { rich_text: rt(text), color: "blue_background" } };
}

async function appendBlocks(pageId: string, blocks: Block[]): Promise<void> {
  const client = getNotionClient();
  for (let i = 0; i < blocks.length; i += 100) {
    await client.blocks.children.append({
      block_id: pageId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      children: blocks.slice(i, i + 100) as any,
    });
  }
}

// ── notion-ids.ts writer ──────────────────────────────────────────────────────

function writeNotionIds(dbIds: Record<DbKey, string>, pageIds: Record<PageKey, string>): void {
  const src = `// AUTO-GENERATED by scripts/bootstrap-workspace.ts — do not edit manually.
// Run \`pnpm tsx scripts/bootstrap-workspace.ts\` to re-populate.

export interface NotionIds {
  dbs: {
    mirrorGithub: string;
    mirrorJira: string;
    mirrorSlack: string;
    mirrorFigma: string;
    squads: string;
    prds: string;
    productRoadmap: string;
    squadWeeklySummary: string;
    masterEpdWeekly: string;
    agentRunLog: string;
    deliveryPipeline: string;
  };
  pages: {
    squadAtlas: string;
    squadLumen: string;
    squadForge: string;
  };
}

export const NOTION_IDS: NotionIds = {
  dbs: {
    mirrorGithub:       "${dbIds.mirrorGithub}",
    mirrorJira:         "${dbIds.mirrorJira}",
    mirrorSlack:        "${dbIds.mirrorSlack}",
    mirrorFigma:        "${dbIds.mirrorFigma}",
    squads:             "${dbIds.squads}",
    prds:               "${dbIds.prds}",
    productRoadmap:     "${dbIds.productRoadmap}",
    squadWeeklySummary: "${dbIds.squadWeeklySummary}",
    masterEpdWeekly:    "${dbIds.masterEpdWeekly}",
    agentRunLog:        "${dbIds.agentRunLog}",
    deliveryPipeline:   "${dbIds.deliveryPipeline}",
  },
  pages: {
    squadAtlas: "${pageIds.squadAtlas}",
    squadLumen: "${pageIds.squadLumen}",
    squadForge: "${pageIds.squadForge}",
  },
};
`;
  const outPath = path.resolve(__dirname, "../src/lib/notion-ids.ts");
  fs.writeFileSync(outPath, src, "utf8");
  console.log(`\nWrote ${outPath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const env = loadEnv();
  const client = getNotionClient();
  const baseId = extractPageId(env.BASE_NOTION_PAGE);

  console.log("─".repeat(60));
  console.log("Arcline Workspace Bootstrap  (v2)  — FIRST-TIME CREATION ONLY");
  console.log(`Base page: ${env.BASE_NOTION_PAGE}`);
  console.log("─".repeat(60));
  console.log("\n⚠️  Live workspace changes must use `ntn` CLI or `pnpm patch`.");
  console.log("   Re-running on a populated workspace is a safe no-op.\n");

  const existing = await scanChildTitles(baseId);
  console.log(`Scanned ${existing.size} existing child blocks.\n`);

  let created = 0;
  let found = 0;

  async function findOrCreateDb(
    key: DbKey,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: Record<string, any>
  ): Promise<string> {
    const title = DB_NAMES[key];
    if (existing.has(title)) {
      console.log(`[found]  ${title}`);
      found++;
      return existing.get(title)!;
    }
    const db = await client.databases.create({
      parent: { type: "page_id", page_id: baseId },
      title: rt(title),
      properties,
    });
    created++;
    console.log(`[create] ${title} → ${db.id}`);
    return db.id;
  }

  // ── 1. Squads (first — others depend on it) ────────────────────────────────
  const squadsId = await findOrCreateDb("squads", {
    "Name":        { title: {} },
    "SquadId":     { rich_text: {} },
    "EM":          { rich_text: {} },
    "PM":          { rich_text: {} },
    "Design Lead": { rich_text: {} },
    "Members":     { rich_text: {} },
    "Product URL": { url: {} },
  });

  // ── 2. Mirror DBs ─────────────────────────────────────────────────────────
  const mirrorGithubId = await findOrCreateDb("mirrorGithub", {
    "Title":        { title: {} },
    "PR Number":    { number: { format: "number" } },
    "Squad":        { relation: { database_id: squadsId, single_property: {} } },
    "Status":       selectProp("open", "merged", "closed"),
    "Author":       { rich_text: {} },
    "URL":          { url: {} },
    "Last Updated": { date: {} },
    "Body Excerpt": { rich_text: {} },
    "Linked Jira":  { rich_text: {} },
    "Raw":          { rich_text: {} },
  });

  const mirrorJiraId = await findOrCreateDb("mirrorJira", {
    "Title":               { title: {} },
    "Ticket Key":          { rich_text: {} },
    "Squad":               { relation: { database_id: squadsId, single_property: {} } },
    "Status":              selectProp("To Do", "In Progress", "Done", "Blocked"),
    "Assignee":            { rich_text: {} },
    "URL":                 { url: {} },
    "Last Updated":        { date: {} },
    "Acceptance Criteria": { rich_text: {} },
    "Raw":                 { rich_text: {} },
  });

  // Slack: channel + thread-level tracking
  const mirrorSlackId = await findOrCreateDb("mirrorSlack", {
    "Title":              { title: {} },
    "Channel":            { rich_text: {} },
    "Thread Timestamp":   { rich_text: {} },   // Slack ts value for deep-linking
    "Squad":              { relation: { database_id: squadsId, single_property: {} } },
    "Thread URL":         { url: {} },          // direct thread permalink
    "Last Updated":       { date: {} },
    "Excerpt":            { rich_text: {} },
    "Participant Count":  { number: { format: "number" } },
    "Raw":                { rich_text: {} },
  });

  const mirrorFigmaId = await findOrCreateDb("mirrorFigma", {
    "Title":           { title: {} },
    "File Key":        { rich_text: {} },
    "Squad":           { relation: { database_id: squadsId, single_property: {} } },
    "URL":             { url: {} },
    "Last Updated":    { date: {} },
    "Comment Excerpt": { rich_text: {} },
    "Raw":             { rich_text: {} },
  });

  // ── 3. PRDs DB ─────────────────────────────────────────────────────────────
  const prdsId = await findOrCreateDb("prds", {
    "Title":    { title: {} },
    "Squad":    { relation: { database_id: squadsId, single_property: {} } },
    "Status":   selectProp("draft", "active", "completed", "cancelled"),
    "Last Updated": { date: {} },
  });

  // ── 4. Product Roadmap (links to both Squads and PRDs) ────────────────────
  const productRoadmapId = await findOrCreateDb("productRoadmap", {
    "Title":          { title: {} },
    "Owning Squad":   { relation: { database_id: squadsId, single_property: {} } },
    "Related PRDs":   { relation: { database_id: prdsId, single_property: {} } },
    "Target Quarter": selectProp("Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"),
    "Status":         selectProp("Backlog", "Planning", "In Progress", "Shipped"),
    "Notes":          { rich_text: {} },
  });

  // ── 5. Squad Weekly Summary (no Summary column — body is the page) ─────────
  const squadWeeklySummaryId = await findOrCreateDb("squadWeeklySummary", {
    "Title":        { title: {} },
    "Squad":        { relation: { database_id: squadsId, single_property: {} } },
    "Week Of":      { date: {} },
    "Source":       selectProp("github", "jira", "slack", "figma", "roadmap", "prd-fact-check"),
    "Citations":    { rich_text: {} },         // JSON array of cited Notion page IDs
    "Status":       selectProp("draft", "awaiting-review", "approved", "rejected"),
    "Approved By":  { rich_text: {} },
    "Generated At": { date: {} },
  });

  // ── 6. Master EPD Weekly (no Executive Summary / Body columns — page body) ─
  const masterEpdWeeklyId = await findOrCreateDb("masterEpdWeekly", {
    "Title":               { title: {} },
    "Week Of":             { date: {} },
    "Citation Coverage %": { number: { format: "percent" } },
    "Quorum Met":          { checkbox: {} },
    "Squads Approved":     { relation: { database_id: squadsId, single_property: {} } },
    "Status":              selectProp("draft", "awaiting-review", "approved", "published"),
  });

  // ── 7. Agent Run Log ────────────────────────────────────────────────────────
  const agentRunLogId = await findOrCreateDb("agentRunLog", {
    "Run Id":         { title: {} },
    "Agent Name":     selectProp(
      "mirror-github", "mirror-jira", "mirror-slack", "mirror-figma",
      "summarizer-source", "summarizer-product", "master-summarizer"
    ),
    "Squad":          { relation: { database_id: squadsId, single_property: {} } },
    "Started At":     { date: {} },
    "Completed At":   { date: {} },
    "Duration ms":    { number: { format: "number" } },
    "Token Cost USD": { number: { format: "dollar" } },
    "Outcome":        selectProp("ok", "error", "skipped"),
    "Notes":          { rich_text: {} },
  });

  // ── 8. Delivery Pipeline (new — step-by-step status per weekly run) ────────
  const deliveryPipelineId = await findOrCreateDb("deliveryPipeline", {
    "Step":          { title: {} },
    "Stage":         selectProp("data-mirror", "source-summarize", "hitl-review", "master-synthesize", "approval"),
    "Week Of":       { date: {} },
    "Status":        selectProp("pending", "running", "completed", "failed", "skipped", "blocked"),
    "Weekly Digest": { relation: { database_id: masterEpdWeeklyId, single_property: {} } },
    "Squad":         { relation: { database_id: squadsId, single_property: {} } },
    "Started At":    { date: {} },
    "Completed At":  { date: {} },
    "Error":         { rich_text: {} },
    "Notes":         { rich_text: {} },
  });

  // ── 9. Seed Squads DB ─────────────────────────────────────────────────────
  const squadPageIds = new Map<string, string>();
  console.log();

  if (await dbIsEmpty(squadsId)) {
    console.log("Seeding Squads DB…");
    for (const s of SQUADS_SEED) {
      const page = await client.pages.create({
        parent: { type: "database_id", database_id: squadsId },
        properties: {
          "Name":        { title: rt(s.name) },
          "SquadId":     { rich_text: rt(s.squadId) },
          "EM":          { rich_text: rt(s.em) },
          "PM":          { rich_text: rt(s.pm) },
          "Design Lead": { rich_text: rt(s.dl) },
          "Members":     { rich_text: rt(s.members) },
          "Product URL": { url: s.productUrl },
        },
      });
      squadPageIds.set(s.squadId, page.id);
      console.log(`  [seed] ${s.name} → ${page.id}`);

      // Append team roster + product info to the squad page body
      await appendBlocks(page.id, [
        h2("Team Roster"),
        ...s.roster.map((m) => bullet(`${m.name} — ${m.role}`)),
        divider(),
        h2("Products"),
        bullet(s.product),
        p(`Product page: ${s.productUrl}`),
      ]);
    }
  } else {
    console.log("[skip]   Squads DB already seeded — loading IDs…");
    const res = await client.databases.query({ database_id: squadsId });
    for (const page of res.results) {
      if (!("properties" in page)) continue;
      const prop = page.properties["SquadId"];
      if (prop?.type === "rich_text" && Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
        const first = prop.rich_text[0] as { plain_text: string };
        squadPageIds.set(first.plain_text, page.id);
      }
    }
    console.log(`  Loaded ${squadPageIds.size} squad IDs.`);
  }

  // Squad "pages" in notion-ids.ts are the Squads DB row IDs (not standalone pages).
  // This ensures a re-run never creates duplicate top-level pages and always reflects
  // the live row IDs from the Squads DB.
  const pageIds: Record<PageKey, string> = {
    squadAtlas: squadPageIds.get("atlas") ?? "",
    squadLumen: squadPageIds.get("lumen") ?? "",
    squadForge: squadPageIds.get("forge") ?? "",
  };

  // ── 10. Seed PRDs DB (full page bodies) ────────────────────────────────────
  const prdPageIds = new Map<string, string>(); // productSlug → notion page id
  const today = new Date().toISOString().slice(0, 10);

  if (await dbIsEmpty(prdsId)) {
    console.log("\nSeeding PRDs DB…");
    for (const prd of PRDS_SEED) {
      const squadPageId = squadPageIds.get(prd.squadId);
      const page = await client.pages.create({
        parent: { type: "database_id", database_id: prdsId },
        properties: {
          "Title":         { title: rt(prd.title) },
          ...(squadPageId ? { "Squad": { relation: [{ id: squadPageId }] } } : {}),
          "Status":        { select: { name: prd.status } },
          "Last Updated":  { date: { start: today } },
        },
      });
      prdPageIds.set(prd.productSlug, page.id);
      console.log(`  [seed] ${prd.title} → ${page.id}`);

      // Build the full PRD page body
      const blocks: Block[] = [
        callout(`Squad: ${prd.squadId.charAt(0).toUpperCase() + prd.squadId.slice(1)}  ·  Status: ${prd.status}  ·  Last Updated: ${today}`),
        divider(),
        h2("Goal"),
        p(prd.goal),
        divider(),
        h2("Why This Exists"),
        p(prd.why),
        divider(),
        h2("Design"),
        ...prd.design.map((d) => bullet(d)),
        divider(),
        h2("Acceptance Criteria"),
        ...prd.acs.map((ac) => numbered(ac)),
        divider(),
        h2("Out of Scope"),
        ...prd.outOfScope.map((o) => bullet(o)),
      ];
      await appendBlocks(page.id, blocks);
    }
  } else {
    console.log("\n[skip]   PRDs DB already seeded — loading IDs…");
    const res = await client.databases.query({ database_id: prdsId });
    for (const page of res.results) {
      if (!("properties" in page)) continue;
      const titleProp = page.properties["Title"];
      if (titleProp?.type === "title" && Array.isArray(titleProp.title) && titleProp.title.length > 0) {
        const titleText = (titleProp.title[0] as { plain_text: string }).plain_text;
        // Map titles back to slugs
        const match = PRDS_SEED.find((p) => p.title === titleText);
        if (match) prdPageIds.set(match.productSlug, page.id);
      }
    }
    console.log(`  Loaded ${prdPageIds.size} PRD IDs.`);
  }

  // ── 12. Seed Product Roadmap (links to squads + PRDs) ─────────────────────
  if (await dbIsEmpty(productRoadmapId)) {
    console.log("\nSeeding Product Roadmap DB…");
    for (const init of ROADMAP_SEED) {
      const squadPageId = squadPageIds.get(init.squadId);
      const prdPageId   = init.prdSlug ? prdPageIds.get(init.prdSlug) : undefined;
      await client.pages.create({
        parent: { type: "database_id", database_id: productRoadmapId },
        properties: {
          "Title":          { title: rt(init.title) },
          ...(squadPageId ? { "Owning Squad": { relation: [{ id: squadPageId }] } } : {}),
          ...(prdPageId   ? { "Related PRDs": { relation: [{ id: prdPageId }] } } : {}),
          "Target Quarter": { select: { name: init.quarter } },
          "Status":         { select: { name: init.status } },
          "Notes":          { rich_text: rt(init.notes) },
        },
      });
      console.log(`  [seed] ${init.title}${prdPageId ? " (linked PRD)" : ""}`);
    }
  } else {
    console.log("\n[skip]   Product Roadmap DB already seeded");
  }

  // ── 13. Seed one template Master EPD Weekly (shows the approval layout) ───
  if (await dbIsEmpty(masterEpdWeeklyId)) {
    console.log("\nSeeding Master EPD Weekly (template row)…");
    const weekOf = new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 86400000)
      .toISOString().slice(0, 10); // Monday of current week
    const masterPage = await client.pages.create({
      parent: { type: "database_id", database_id: masterEpdWeeklyId },
      properties: {
        "Title":    { title: rt(`EPD Weekly Digest — ${weekOf}`) },
        "Week Of":  { date: { start: weekOf } },
        "Status":   { select: { name: "draft" } },
        "Quorum Met": { checkbox: false },
      },
    });
    console.log(`  [seed] Master EPD Weekly template → ${masterPage.id}`);

    // Page body: executive summary placeholder + approval section
    await appendBlocks(masterPage.id, [
      callout("This page is auto-generated by the Master Summarizer agent. Edit with care."),
      divider(),
      h2("Executive Summary"),
      p("[ Generated by master-summarizer agent — replace this placeholder ]"),
      divider(),
      h2("Digest Body"),
      p("[ Full narrative body will be written here by the agent ]"),
      divider(),
      h2("Squad Approvals"),
      p("Each squad's Engineering Manager must approve before this digest goes to VP review."),
      p("To approve: update the 'Squads Approved' relation and, once all 3 squads are added, check 'Quorum Met' and set Status → awaiting-review."),
      bullet("Atlas — EM: Sarah Chen"),
      bullet("Lumen — EM: David Park"),
      bullet("Forge — EM: Aisha Johnson"),
      divider(),
      h2("VP / Leadership Approval"),
      p("Once Quorum Met is checked, set Status → approved, then → published after sign-off."),
    ]);
  } else {
    console.log("\n[skip]   Master EPD Weekly already seeded");
  }

  // ── 14. Seed one template Squad Weekly Summary per squad ──────────────────
  if (await dbIsEmpty(squadWeeklySummaryId)) {
    console.log("\nSeeding Squad Weekly Summary templates…");
    const weekOf = new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 86400000)
      .toISOString().slice(0, 10);

    for (const s of SQUADS_SEED) {
      const squadPageId = squadPageIds.get(s.squadId);
      const summaryPage = await client.pages.create({
        parent: { type: "database_id", database_id: squadWeeklySummaryId },
        properties: {
          "Title":        { title: rt(`${s.name} Weekly Summary — ${weekOf}`) },
          ...(squadPageId ? { "Squad": { relation: [{ id: squadPageId }] } } : {}),
          "Week Of":      { date: { start: weekOf } },
          "Source":       { select: { name: "github" } },   // template; agent sets per-source
          "Status":       { select: { name: "draft" } },
          "Generated At": { date: { start: new Date().toISOString() } },
        },
      });
      console.log(`  [seed] ${s.name} Weekly Summary template → ${summaryPage.id}`);

      await appendBlocks(summaryPage.id, [
        callout(`Squad: ${s.name}  ·  Week of ${weekOf}  ·  Status: draft`),
        divider(),
        h2("Summary"),
        p("[ Generated by summarizer-source agent — this section is written by the agent ]"),
        divider(),
        h2("Key Highlights"),
        bullet("[ Highlight 1 ]"),
        bullet("[ Highlight 2 ]"),
        bullet("[ Highlight 3 ]"),
        divider(),
        h2("Citations"),
        p("[ JSON citations array will be populated by agent in the Citations property ]"),
        divider(),
        h2("Approval"),
        p(`This summary must be approved by the squad EM (${s.em}) before it feeds into the Master EPD Digest.`),
        p("To approve: set Status → approved and update the Approved By field with your name."),
        bullet(`${s.em} (EM, ${s.name}) — pending approval`),
      ]);
    }
  } else {
    console.log("\n[skip]   Squad Weekly Summary already seeded");
  }

  // ── 15. Write notion-ids.ts ────────────────────────────────────────────────
  const dbIds: Record<DbKey, string> = {
    squads:             squadsId,
    mirrorGithub:       mirrorGithubId,
    mirrorJira:         mirrorJiraId,
    mirrorSlack:        mirrorSlackId,
    mirrorFigma:        mirrorFigmaId,
    prds:               prdsId,
    productRoadmap:     productRoadmapId,
    squadWeeklySummary: squadWeeklySummaryId,
    masterEpdWeekly:    masterEpdWeeklyId,
    agentRunLog:        agentRunLogId,
    deliveryPipeline:   deliveryPipelineId,
  };

  writeNotionIds(dbIds, pageIds);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("─".repeat(60));
  if (created === 0) {
    console.log("✓  All databases exist — no changes made.");
  } else {
    console.log(`✓  Bootstrap complete. Created: ${created}  Skipped: ${found}`);
  }
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
