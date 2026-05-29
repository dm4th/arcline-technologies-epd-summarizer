import { NOTION_IDS, getSquadPageId } from "../lib/notion-ids";
import { loadFixtures } from "./lib/fixture-loader";
import { runSourceWorker } from "./lib/source-worker";
import type { SourceRecord, SquadId } from "../types/core";
import type { MirrorProperties, SourceWorkerConfig } from "./lib/types";

const rt = (s: string) => [{ text: { content: s.substring(0, 1999) } }];

type JiraRaw = {
  key: string;
  status: string;
  assignee: string | null;
  acceptance_criteria: string;
  description?: string;
};

const VALID_STATUSES = new Set([
  "Backlog",
  "In Progress",
  "In Review",
  "Done",
  "Blocked",
]);

const config: SourceWorkerConfig = {
  source: "jira",
  mirrorDbId: NOTION_IDS.dbs.mirrorJira,

  fixtureLoader: (squad: SquadId, weekOf: string) =>
    loadFixtures("jira", squad, weekOf),

  normalize: (raw: unknown, _squad: SquadId): SourceRecord => {
    const r = raw as SourceRecord & { raw: JiraRaw };
    // summary = first paragraph of description ≤280 chars, fallback to title
    const desc = r.raw.description ?? r.title;
    const summary = desc.split("\n\n")[0].substring(0, 280);
    return { ...r, summary };
  },

  propertyMapper: (rec: SourceRecord): MirrorProperties => {
    const r = rec.raw as JiraRaw;
    // Constrain status to valid select options; fall back to "Backlog"
    const status = VALID_STATUSES.has(r.status) ? r.status : "Backlog";
    return {
      Title:          { title: [{ text: { content: rec.title } }] },
      "Ticket Key":   { rich_text: rt(r.key) },
      Squad:          { relation: [{ id: getSquadPageId(rec.squadId) }] },
      Status:         { select: { name: status } },
      Assignee:       { rich_text: rt(r.assignee ?? "") },
      URL:            { url: rec.url },
      "Last Updated": { date: { start: rec.lastUpdated } },
      "Acceptance Criteria": { rich_text: rt(r.acceptance_criteria ?? "") },
      Raw:            { rich_text: rt(JSON.stringify(rec.raw)) },
      "Source ID":    { rich_text: rt(rec.sourceId) },
    };
  },
};

export { config as jiraWorkerConfig };

if (process.argv[1]?.includes("jira")) {
  const weekArg = process.argv.find((a) => a.startsWith("--week="));
  const weekOf = weekArg ? weekArg.split("=")[1] : undefined;
  runSourceWorker(config, weekOf).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
