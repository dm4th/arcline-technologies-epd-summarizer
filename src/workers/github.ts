import { NOTION_IDS, getSquadPageId } from "../lib/notion-ids";
import { loadFixtures } from "./lib/fixture-loader";
import { runSourceWorker } from "./lib/source-worker";
import type { SourceRecord, SquadId } from "../types/core";
import type { MirrorProperties, SourceWorkerConfig } from "./lib/types";

const rt = (s: string) => [{ text: { content: s.substring(0, 1999) } }];

type GithubRaw = {
  number: number;
  state: string;
  author: string;
  body: string;
  linked_jira_key: string | null;
};

const config: SourceWorkerConfig = {
  source: "github",
  mirrorDbId: NOTION_IDS.dbs.mirrorGithub,

  fixtureLoader: (squad: SquadId, weekOf: string) =>
    loadFixtures("github", squad, weekOf),

  normalize: (raw: unknown, _squad: SquadId): SourceRecord => {
    const r = raw as SourceRecord & { raw: GithubRaw };
    const body = r.raw.body ?? "";
    // summary = first paragraph of PR body, ≤280 chars
    const summary = body.split("\n\n")[0].substring(0, 280);
    return { ...r, summary };
  },

  propertyMapper: (rec: SourceRecord): MirrorProperties => {
    const r = rec.raw as GithubRaw;
    return {
      Title:        { title: [{ text: { content: `#${r.number} — ${rec.title}` } }] },
      "PR Number":  { number: r.number },
      Squad:        { relation: [{ id: getSquadPageId(rec.squadId) }] },
      Status:       { select: { name: r.state } },
      Author:       { rich_text: rt(r.author ?? "") },
      URL:          { url: rec.url },
      "Last Updated": { date: { start: rec.lastUpdated } },
      "Body Excerpt": { rich_text: rt(rec.summary ?? "") },
      "Linked Jira":  { rich_text: rt(r.linked_jira_key ?? "") },
      Raw:          { rich_text: rt(JSON.stringify(rec.raw)) },
      "Source ID":  { rich_text: rt(rec.sourceId) },
    };
  },
};

export { config as githubWorkerConfig };

// Allow direct invocation: tsx src/workers/github.ts [--week=YYYY-Www]
if (process.argv[1]?.includes("github")) {
  const weekArg = process.argv.find((a) => a.startsWith("--week="));
  const weekOf = weekArg ? weekArg.split("=")[1] : undefined;
  runSourceWorker(config, weekOf).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
