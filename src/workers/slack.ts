import { NOTION_IDS, getSquadPageId } from "../lib/notion-ids";
import { loadFixtures } from "./lib/fixture-loader";
import { runSourceWorker } from "./lib/source-worker";
import type { SourceRecord, SquadId } from "../types/core";
import type { MirrorProperties, SourceWorkerConfig } from "./lib/types";

const rt = (s: string) => [{ text: { content: s.substring(0, 1999) } }];

type SlackMessage = { author: string; text: string; ts: string };
type SlackRaw = {
  channel: string;
  thread_ts: string;
  participant_count: number;
  messages: SlackMessage[];
};

function buildSummary(messages: SlackMessage[]): string {
  if (messages.length === 0) return "";
  const first = messages[0].text;
  const last = messages[messages.length - 1].text;
  if (messages.length === 1) return first.substring(0, 280);
  return `${first} — ${last}`.substring(0, 280);
}

function buildExcerpt(messages: SlackMessage[]): string {
  const full = messages
    .map((m) => `${m.author}: ${m.text}`)
    .join("\n");
  if (full.length <= 2000) return full;
  return full.substring(0, 1999) + "…";
}

const config: SourceWorkerConfig = {
  source: "slack",
  mirrorDbId: NOTION_IDS.dbs.mirrorSlack,

  fixtureLoader: (squad: SquadId, weekOf: string) =>
    loadFixtures("slack", squad, weekOf),

  normalize: (raw: unknown, _squad: SquadId): SourceRecord => {
    const r = raw as SourceRecord & { raw: SlackRaw };
    const summary = buildSummary(r.raw.messages ?? []);
    return { ...r, summary };
  },

  propertyMapper: (rec: SourceRecord): MirrorProperties => {
    const r = rec.raw as SlackRaw;
    const excerpt = buildExcerpt(r.messages ?? []);
    return {
      Title:             { title: [{ text: { content: rec.title } }] },
      Channel:           { rich_text: rt(r.channel ?? "") },
      Squad:             { relation: [{ id: getSquadPageId(rec.squadId) }] },
      Permalink:         { url: rec.url },
      "Last Updated":    { date: { start: rec.lastUpdated } },
      Excerpt:           { rich_text: [{ text: { content: excerpt.substring(0, 1999) } }] },
      "Participant Count": { number: r.participant_count ?? 0 },
      // Schema v2 additions (from PRD-01 implementation notes)
      "Thread Timestamp": { rich_text: rt(r.thread_ts ?? "") },
      "Thread URL":       { url: rec.url },
      Raw:               { rich_text: rt(JSON.stringify(rec.raw)) },
      "Source ID":       { rich_text: rt(rec.sourceId) },
    };
  },
};

export { config as slackWorkerConfig };

if (process.argv[1]?.includes("slack")) {
  const weekArg = process.argv.find((a) => a.startsWith("--week="));
  const weekOf = weekArg ? weekArg.split("=")[1] : undefined;
  runSourceWorker(config, weekOf).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
