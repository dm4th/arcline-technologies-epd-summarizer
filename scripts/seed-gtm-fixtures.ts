/**
 * seed-gtm-fixtures.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds realistic GTM fixture data into the 4 GTM databases:
 *   1. 8 rows in GTM | Opportunities
 *   2. 10 rows in GTM | Meeting Notes  (linked to Opportunities)
 *   3. 3 rows in GTM | Battle Cards    (competitor stubs, sparse Differentiators)
 *   4. 1 row in GTM | Daily Digest     (prior-week stub so demo doesn't start empty)
 *
 * Idempotent: upserts by Title (or "Competitor" for Battle Cards). Rows that
 * already exist are skipped. Safe to re-run.
 *
 * Usage:
 *   pnpm seed-gtm-fixtures
 *   pnpm seed-gtm-fixtures --dry-run   ← checks what exists, prints plan, no writes
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { loadEnv } from "../src/lib/env";
import { getNotionClient } from "../src/lib/notion";
import { NOTION_IDS } from "../src/lib/notion-ids";

const DRY_RUN = process.argv.includes("--dry-run");

// PRD page IDs from PRD-01 — stable canonical IDs for Product Interest relation
// AuthShield = Atlas squad security platform; FieldKit = Forge squad mobile sync
const PRD_AUTHSHIELD_ID = "36efc8f4-554c-81d2-87e9-efddab1762c8";
const PRD_FIELDKIT_ID   = "36efc8f4-554c-81c5-84cc-ee35b20095d7";

function rt(content: string) {
  return [{ type: "text" as const, text: { content } }];
}

// ── Upsert helper ─────────────────────────────────────────────────────────────
// Always queries first (even in dry-run) so skip counts reflect reality.

async function upsertRow(
  dbId: string,
  titleProp: string,
  titleValue: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>,
): Promise<{ action: "created" | "skipped"; pageId: string }> {
  const notion = getNotionClient();

  const existing = await notion.databases.query({
    database_id: dbId,
    filter: { property: titleProp, title: { equals: titleValue } },
    page_size: 1,
  });

  if (existing.results.length > 0) {
    return { action: "skipped", pageId: existing.results[0].id };
  }

  if (DRY_RUN) {
    return { action: "created", pageId: "dry-run-placeholder" };
  }

  const page = await notion.pages.create({
    parent: { database_id: dbId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: properties as any,
  });

  return { action: "created", pageId: page.id };
}

// ── Fixture data ──────────────────────────────────────────────────────────────

type OpportunityFixture = {
  title: string;
  account: string;
  stage: string;
  acv: number;
  closeDate: string;
  productInterestId: string | null; // PRD page ID; null = no product linked
  rep: string;
  health: string;
};

const OPPORTUNITIES: OpportunityFixture[] = [
  // Demo-critical: Meridian is the "buyer who doesn't know AuthShield just shipped"
  {
    title: "Meridian Financial — Auth Upgrade",
    account: "Meridian Financial",
    stage: "technical-eval",
    acv: 120000,
    closeDate: "2026-08-15",
    productInterestId: PRD_AUTHSHIELD_ID,
    rep: "Sarah Chen",
    health: "on-track",
  },
  // Demo-critical: at-risk deal + negative meeting = CRO's urgency signal
  {
    title: "Vantage Logistics — SSO Rollout",
    account: "Vantage Logistics",
    stage: "negotiation",
    acv: 85000,
    closeDate: "2026-07-01",
    productInterestId: PRD_AUTHSHIELD_ID,
    rep: "Marcus Webb",
    health: "at-risk",
  },
  // Demo-critical: FieldKit buyer, active eval
  {
    title: "Orion Health — Mobile Field App",
    account: "Orion Health",
    stage: "technical-eval",
    acv: 95000,
    closeDate: "2026-09-30",
    productInterestId: PRD_FIELDKIT_ID,
    rep: "Sarah Chen",
    health: "on-track",
  },
  {
    title: "Apex Consulting — Platform Eval",
    account: "Apex Consulting",
    stage: "discovery",
    acv: 60000,
    closeDate: "2026-10-15",
    productInterestId: null,
    rep: "Marcus Webb",
    health: "on-track",
  },
  {
    title: "Brightpath EDU — Collaboration",
    account: "Brightpath EDU",
    stage: "discovery",
    acv: 45000,
    closeDate: "2026-11-01",
    productInterestId: null,
    rep: "Jordan Park",
    health: "on-track",
  },
  {
    title: "Crestwood Capital — Enterprise",
    account: "Crestwood Capital",
    stage: "closed-won",
    acv: 200000,
    closeDate: "2026-05-30",
    productInterestId: PRD_AUTHSHIELD_ID,
    rep: "Sarah Chen",
    health: "on-track",
  },
  // Demo-critical: at-risk FieldKit deal competing with Monday.com
  {
    title: "Nexus Manufacturing — Offline",
    account: "Nexus Manufacturing",
    stage: "negotiation",
    acv: 78000,
    closeDate: "2026-07-20",
    productInterestId: PRD_FIELDKIT_ID,
    rep: "Jordan Park",
    health: "at-risk",
  },
  {
    title: "Pinnacle Retail — Auth Migration",
    account: "Pinnacle Retail",
    stage: "technical-eval",
    acv: 55000,
    closeDate: "2026-08-01",
    productInterestId: PRD_AUTHSHIELD_ID,
    rep: "Marcus Webb",
    health: "on-track",
  },
];

type MeetingNoteFixture = {
  title: string;
  account: string;
  opportunityTitle: string; // resolved to page ID via oppMap
  date: string;
  rep: string;
  stage: string;
  sentiment: string;
  competitorMentioned: string; // empty string = no competitor
  actionItems: string;
};

const MEETING_NOTES: MeetingNoteFixture[] = [
  {
    title: "Meridian — Technical Deep Dive",
    account: "Meridian Financial",
    opportunityTitle: "Meridian Financial — Auth Upgrade",
    date: "2026-06-02",
    rep: "Sarah Chen",
    stage: "technical-eval",
    sentiment: "positive",
    competitorMentioned: "",
    actionItems: "Follow up with AuthShield SSO demo recording by Friday",
  },
  // Demo-critical: at-risk + competitor = CRO alert
  {
    title: "Vantage — Stalled Renewal Call",
    account: "Vantage Logistics",
    opportunityTitle: "Vantage Logistics — SSO Rollout",
    date: "2026-06-03",
    rep: "Marcus Webb",
    stage: "negotiation",
    sentiment: "at-risk",
    competitorMentioned: "Linear",
    actionItems: "Need to show roadmap — they're evaluating Linear's new auth module",
  },
  {
    title: "Orion — Field App Requirements",
    account: "Orion Health",
    opportunityTitle: "Orion Health — Mobile Field App",
    date: "2026-06-02",
    rep: "Sarah Chen",
    stage: "technical-eval",
    sentiment: "positive",
    competitorMentioned: "",
    actionItems: "Share FieldKit offline sync benchmark results",
  },
  {
    title: "Nexus — Procurement Review",
    account: "Nexus Manufacturing",
    opportunityTitle: "Nexus Manufacturing — Offline",
    date: "2026-06-03",
    rep: "Jordan Park",
    stage: "negotiation",
    sentiment: "at-risk",
    competitorMentioned: "Monday.com",
    actionItems: "Budget squeeze — Monday.com pitched lower price point",
  },
  {
    title: "Apex — First Discovery Call",
    account: "Apex Consulting",
    opportunityTitle: "Apex Consulting — Platform Eval",
    date: "2026-06-01",
    rep: "Marcus Webb",
    stage: "discovery",
    sentiment: "neutral",
    competitorMentioned: "",
    actionItems: "Schedule technical eval with their CTO next week",
  },
  {
    title: "Brightpath — Intro Meeting",
    account: "Brightpath EDU",
    opportunityTitle: "Brightpath EDU — Collaboration",
    date: "2026-05-27",
    rep: "Jordan Park",
    stage: "discovery",
    sentiment: "positive",
    competitorMentioned: "Asana",
    actionItems: "Strong champion but IT director needs Asana comparison",
  },
  {
    title: "Crestwood — Kickoff (Won)",
    account: "Crestwood Capital",
    opportunityTitle: "Crestwood Capital — Enterprise",
    date: "2026-05-30",
    rep: "Sarah Chen",
    stage: "closed-won",
    sentiment: "positive",
    competitorMentioned: "",
    actionItems: "Schedule implementation kickoff with their eng team",
  },
  {
    title: "Meridian — Exec Sponsor Intro",
    account: "Meridian Financial",
    opportunityTitle: "Meridian Financial — Auth Upgrade",
    date: "2026-05-28",
    rep: "Sarah Chen",
    stage: "technical-eval",
    sentiment: "positive",
    competitorMentioned: "",
    actionItems: "Loop in CISO on AuthShield compliance documentation",
  },
  {
    title: "Pinnacle — Requirements Gathering",
    account: "Pinnacle Retail",
    opportunityTitle: "Pinnacle Retail — Auth Migration",
    date: "2026-05-29",
    rep: "Marcus Webb",
    stage: "technical-eval",
    sentiment: "neutral",
    competitorMentioned: "Asana",
    actionItems: "They use Asana for project tracking — integration question",
  },
  {
    title: "Vantage — Champion 1:1",
    account: "Vantage Logistics",
    opportunityTitle: "Vantage Logistics — SSO Rollout",
    date: "2026-05-27",
    rep: "Marcus Webb",
    stage: "negotiation",
    sentiment: "neutral",
    competitorMentioned: "",
    actionItems: "Internal champion is preparing exec summary for CRO sign-off",
  },
  // ── Historical context rows (W19–W21) — pipeline backstory for the demo ──────
  // W19 (May 4–10): early pipeline seeding
  {
    title: "Vantage — Initial SDR Outreach",
    account: "Vantage Logistics",
    opportunityTitle: "Vantage Logistics — SSO Rollout",
    date: "2026-05-06",
    rep: "Marcus Webb",
    stage: "discovery",
    sentiment: "positive",
    competitorMentioned: "",
    actionItems: "Schedule follow-up demo with procurement lead",
  },
  {
    title: "Orion — Intro Call",
    account: "Orion Health",
    opportunityTitle: "Orion Health — Mobile Field App",
    date: "2026-05-07",
    rep: "Sarah Chen",
    stage: "discovery",
    sentiment: "neutral",
    competitorMentioned: "",
    actionItems: "Share product overview deck and FieldKit one-pager",
  },
  // W20 (May 11–17): early evaluations
  {
    title: "Meridian — Security Requirements",
    account: "Meridian Financial",
    opportunityTitle: "Meridian Financial — Auth Upgrade",
    date: "2026-05-12",
    rep: "Sarah Chen",
    stage: "discovery",
    sentiment: "positive",
    competitorMentioned: "",
    actionItems: "Map AuthShield feature set to their SOC 2 audit requirements",
  },
  {
    title: "Nexus — Use Case Discovery",
    account: "Nexus Manufacturing",
    opportunityTitle: "Nexus Manufacturing — Offline",
    date: "2026-05-14",
    rep: "Jordan Park",
    stage: "discovery",
    sentiment: "neutral",
    competitorMentioned: "",
    actionItems: "Identify field-worker persona and offline workflow requirements",
  },
  // W21 (May 18–24): technical evals begin
  {
    title: "Brightpath — Champion Alignment",
    account: "Brightpath EDU",
    opportunityTitle: "Brightpath EDU — Collaboration",
    date: "2026-05-19",
    rep: "Jordan Park",
    stage: "discovery",
    sentiment: "positive",
    competitorMentioned: "Asana",
    actionItems: "Internal champion drafting business case; IT director comparison still needed",
  },
  {
    title: "Apex — Technical Scoping",
    account: "Apex Consulting",
    opportunityTitle: "Apex Consulting — Platform Eval",
    date: "2026-05-20",
    rep: "Marcus Webb",
    stage: "technical-eval",
    sentiment: "neutral",
    competitorMentioned: "",
    actionItems: "Confirmed API integration requirements; security questionnaire pending",
  },
  {
    title: "Pinnacle — Auth Requirements Gathering",
    account: "Pinnacle Retail",
    opportunityTitle: "Pinnacle Retail — Auth Migration",
    date: "2026-05-21",
    rep: "Marcus Webb",
    stage: "discovery",
    sentiment: "positive",
    competitorMentioned: "",
    actionItems: "Confirmed migration timeline: Q3 cutover, legacy system decommission by EOY",
  },
];

type BattleCardFixture = {
  competitor: string;
  theirStrengths: string;
};

// Our Differentiators is intentionally sparse — Battle Card Updater (PRD-18) fills it.
// Last Updated = 2026-05-01 so the field is visibly stale for the demo.
const BATTLE_CARDS: BattleCardFixture[] = [
  {
    competitor: "Asana",
    theirStrengths:
      "Strong project management, large template library, broad integrations, competitive pricing at mid-market, well-known brand",
  },
  {
    competitor: "Monday.com",
    theirStrengths:
      "Visual workflow builder, strong sales team, aggressive pricing, better mobile experience historically, CRM add-on",
  },
  {
    competitor: "Linear",
    theirStrengths:
      "Developer-friendly, fast UI, strong GitHub integration, growing mindshare in engineering orgs",
  },
];

type DailyDigestFixture = {
  title: string;
  date: string;
  dealsTouched: number;
  summary: string;
};

// Four digest stubs spanning W19–W22. W23 digest is not pre-seeded — the GTM
// Daily Digest worker (PRD-15) generates it during the live demo.
const DAILY_DIGESTS: DailyDigestFixture[] = [
  {
    title: "GTM Daily Digest — 2026-05-09",
    date: "2026-05-09",
    dealsTouched: 2,
    summary: "2 early discovery calls (Vantage outreach, Orion intro). Pipeline seeding phase. No flags.",
  },
  {
    title: "GTM Daily Digest — 2026-05-16",
    date: "2026-05-16",
    dealsTouched: 2,
    summary: "Meridian security requirements (positive). Nexus use-case discovery (neutral). 2 deals advancing to evaluation.",
  },
  {
    title: "GTM Daily Digest — 2026-05-23",
    date: "2026-05-23",
    dealsTouched: 3,
    summary: "Brightpath champion alignment, Apex technical scoping, Pinnacle requirements gathering. Positive momentum, no at-risk signals.",
  },
  {
    title: "GTM Daily Digest — 2026-05-30",
    date: "2026-05-30",
    dealsTouched: 3,
    summary: "2 positive meetings (Brightpath intro, Crestwood kickoff), 1 neutral. No at-risk flags for the day.",
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  const dryLabel = DRY_RUN ? " (DRY RUN — no writes)" : "";
  console.log("═".repeat(60));
  console.log(`Arcline GTM Fixtures Seed${dryLabel}`);
  console.log("═".repeat(60));
  console.log("  Seeds 8 Opportunities, 17 Meeting Notes, 3 Battle Cards,");
  console.log("  and 4 Daily Digest stubs (W19–W22). Skips existing rows.\n");

  // ── Step 1: GTM | Opportunities ────────────────────────────────────────────
  // Must run first — Meeting Notes relate back to Opportunity page IDs.
  console.log("[1/4] Seeding GTM | Opportunities…");
  const oppMap = new Map<string, string>(); // title → page ID (created or found)
  let oppCreated = 0;
  let oppSkipped = 0;

  for (const opp of OPPORTUNITIES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: Record<string, any> = {
      "Title":      { title: rt(opp.title) },
      "Account":    { rich_text: rt(opp.account) },
      "Stage":      { select: { name: opp.stage } },
      "ACV":        { number: opp.acv },
      "Close Date": { date: { start: opp.closeDate } },
      "Rep":        { select: { name: opp.rep } },
      "Health":     { select: { name: opp.health } },
    };
    if (opp.productInterestId) {
      props["Product Interest"] = { relation: [{ id: opp.productInterestId }] };
    }

    const { action, pageId } = await upsertRow(
      NOTION_IDS.dbs.opportunities, "Title", opp.title, props,
    );
    oppMap.set(opp.title, pageId);

    if (action === "created") {
      oppCreated++;
      console.log(`  ✓ created: ${opp.title}`);
    } else {
      oppSkipped++;
      console.log(`  — skipped: ${opp.title}`);
    }
  }
  console.log(`[1/4] ✓ ${oppCreated} created, ${oppSkipped} already existed.\n`);

  // ── Step 2: GTM | Meeting Notes ────────────────────────────────────────────
  console.log("[2/4] Seeding GTM | Meeting Notes…");
  let mnCreated = 0;
  let mnSkipped = 0;

  for (const note of MEETING_NOTES) {
    const oppPageId = oppMap.get(note.opportunityTitle);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: Record<string, any> = {
      "Title":        { title: rt(note.title) },
      "Account":      { rich_text: rt(note.account) },
      "Date":         { date: { start: note.date } },
      "Rep":          { select: { name: note.rep } },
      "Stage":        { select: { name: note.stage } },
      "Sentiment":    { select: { name: note.sentiment } },
      "Action Items": { rich_text: rt(note.actionItems) },
    };
    if (oppPageId) {
      props["Opportunity"] = { relation: [{ id: oppPageId }] };
    }
    if (note.competitorMentioned) {
      props["Competitor Mentioned"] = { rich_text: rt(note.competitorMentioned) };
    }

    const { action } = await upsertRow(
      NOTION_IDS.dbs.gtmMeetingNotes, "Title", note.title, props,
    );

    if (action === "created") {
      mnCreated++;
      console.log(`  ✓ created: ${note.title}`);
    } else {
      mnSkipped++;
      console.log(`  — skipped: ${note.title}`);
    }
  }
  console.log(`[2/4] ✓ ${mnCreated} created, ${mnSkipped} already existed.\n`);

  // ── Step 3: GTM | Battle Cards ─────────────────────────────────────────────
  console.log("[3/4] Seeding GTM | Battle Cards…");
  let bcCreated = 0;
  let bcSkipped = 0;

  for (const card of BATTLE_CARDS) {
    const { action } = await upsertRow(
      NOTION_IDS.dbs.battleCards,
      "Competitor",
      card.competitor,
      {
        "Competitor":          { title: rt(card.competitor) },
        "Last Updated":        { date: { start: "2026-05-01" } },
        "Their Strengths":     { rich_text: rt(card.theirStrengths) },
        "Our Differentiators": { rich_text: rt("(placeholder — to be updated by Battle Card Updater)") },
        "Related Releases":    { rich_text: rt("(placeholder)") },
      },
    );

    if (action === "created") {
      bcCreated++;
      console.log(`  ✓ created: ${card.competitor}`);
    } else {
      bcSkipped++;
      console.log(`  — skipped: ${card.competitor}`);
    }
  }
  console.log(`[3/4] ✓ ${bcCreated} created, ${bcSkipped} already existed.\n`);

  // ── Step 4: GTM | Daily Digest ─────────────────────────────────────────────
  console.log("[4/4] Seeding GTM | Daily Digest (4 stubs, W19–W22)…");
  let digestCreated = 0;
  let digestSkipped = 0;

  for (const digest of DAILY_DIGESTS) {
    const { action } = await upsertRow(
      NOTION_IDS.dbs.gtmDailyDigest,
      "Title",
      digest.title,
      {
        "Title":         { title: rt(digest.title) },
        "Date":          { date: { start: digest.date } },
        "Status":        { select: { name: "published" } },
        "Deals Touched": { number: digest.dealsTouched },
        "Summary":       { rich_text: rt(digest.summary) },
      },
    );

    if (action === "created") {
      digestCreated++;
      console.log(`  ✓ created: ${digest.title}`);
    } else {
      digestSkipped++;
      console.log(`  — skipped: ${digest.title}`);
    }
  }
  console.log(`[4/4] ✓ ${digestCreated} created, ${digestSkipped} already existed.\n`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalCreated = oppCreated + mnCreated + bcCreated + digestCreated;
  const totalSkipped = oppSkipped + mnSkipped + bcSkipped + digestSkipped;

  console.log("─".repeat(60));
  if (DRY_RUN) {
    console.log(`Dry run complete — would create ${totalCreated} rows, skip ${totalSkipped}.`);
    console.log("Remove --dry-run to seed live rows.");
  } else {
    console.log(`✓  GTM seeding complete — ${totalCreated} rows created, ${totalSkipped} already existed.`);
    console.log("   Coverage: W19–W22 historical + W23 current-week demo data.");
    if (totalCreated > 0) {
      console.log("\n  NEXT STEP:");
      console.log("  Run workers: pnpm gtm-daily-digest   (PRD-15)");
      console.log("               pnpm gtm-release-bridge  (PRD-16)");
    }
  }
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
