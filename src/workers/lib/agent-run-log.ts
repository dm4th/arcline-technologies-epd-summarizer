import { getNotionClient } from "../../lib/notion";
import { NOTION_IDS } from "../../lib/notion-ids";

const rt = (s: string) => [{ text: { content: s.substring(0, 1999) } }];

export async function createSummarizerTrigger(opts: {
  source: string;
  weekOf: string;
}): Promise<void> {
  const notion = getNotionClient();
  const startedAt = new Date();
  const runId = `summarizer.${opts.source}-${opts.weekOf}-trigger`;

  await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.agentRunLog },
    properties: {
      "Run Id":     { title: rt(runId) },
      "Agent Name": { select: { name: `summarizer.${opts.source}` } },
      "Started At": { date: { start: startedAt.toISOString() } },
      "Outcome":    { select: { name: "pending" } },
      "Notes":      { rich_text: rt(`week=${opts.weekOf}`) },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });
}

// Creates trigger rows for both product summarizer agents (roadmap + prd-fact-check).
// Call this after per-source summaries are ready (all 4 sources for all 3 squads).
export async function createProductSummarizerTriggers(opts: {
  weekOf: string;
}): Promise<void> {
  const notion = getNotionClient();
  const startedAt = new Date();

  for (const agentType of ["roadmap", "prdcheck"] as const) {
    const agentName = `summarizer.${agentType}`;
    const runId = `${agentName}-${opts.weekOf}-trigger`;
    await notion.pages.create({
      parent: { database_id: NOTION_IDS.dbs.agentRunLog },
      properties: {
        "Run Id":     { title: rt(runId) },
        "Agent Name": { select: { name: agentName } },
        "Started At": { date: { start: startedAt.toISOString() } },
        "Outcome":    { select: { name: "pending" } },
        "Notes":      { rich_text: rt(`week=${opts.weekOf}`) },
      } as Parameters<typeof notion.pages.create>[0]["properties"],
    });
    console.log(`  Created trigger: ${agentName} for ${opts.weekOf}`);
  }
}

// Creates the trigger row for the master summarizer agent.
// Call after HITL approval once ≥2 squads are fully approved for the week.
export async function createMasterSummarizerTrigger(opts: {
  weekOf: string;
  approvedSquads: string[];
}): Promise<void> {
  const notion = getNotionClient();
  const startedAt = new Date();
  const runId = `summarizer.master-${opts.weekOf}-trigger`;

  await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.agentRunLog },
    properties: {
      "Run Id":     { title: rt(runId) },
      "Agent Name": { select: { name: "summarizer.master" } },
      "Started At": { date: { start: startedAt.toISOString() } },
      "Outcome":    { select: { name: "pending" } },
      "Notes":      { rich_text: rt(`week=${opts.weekOf} approved=${opts.approvedSquads.join(",")}`) },
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });
}

export async function writeAgentRunLog(opts: {
  agentName: string;
  startedAt: Date;
  completedAt: Date;
  outcome: "ok" | "error";
  notes?: string;
  tokenCostUsd?: number;
}): Promise<void> {
  const notion = getNotionClient();
  const durationMs =
    opts.completedAt.getTime() - opts.startedAt.getTime();
  const runId = `${opts.agentName}-${opts.startedAt.toISOString()}`;

  await notion.pages.create({
    parent: { database_id: NOTION_IDS.dbs.agentRunLog },
    properties: {
      "Run Id": { title: rt(runId) },
      "Agent Name": { select: { name: opts.agentName } },
      "Started At": { date: { start: opts.startedAt.toISOString() } },
      "Completed At": { date: { start: opts.completedAt.toISOString() } },
      "Duration ms": { number: durationMs },
      "Outcome": { select: { name: opts.outcome } },
      ...(opts.notes ? { Notes: { rich_text: rt(opts.notes) } } : {}),
      ...(opts.tokenCostUsd != null
        ? { "Token Cost USD": { number: opts.tokenCostUsd } }
        : {}),
    } as Parameters<typeof notion.pages.create>[0]["properties"],
  });
}
