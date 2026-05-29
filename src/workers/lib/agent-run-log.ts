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
