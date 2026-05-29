import { NOTION_IDS, getSquadPageId } from "../lib/notion-ids";
import { loadFixtures } from "./lib/fixture-loader";
import { runSourceWorker } from "./lib/source-worker";
import type { SourceRecord, SquadId } from "../types/core";
import type { MirrorProperties, SourceWorkerConfig } from "./lib/types";

const rt = (s: string) => [{ text: { content: s.substring(0, 1999) } }];

type FigmaComment = {
  author: string;
  text: string;
  created_at: string;
  resolved: boolean;
};
type FigmaRaw = {
  file_key: string;
  file_name: string;
  last_modified: string;
  comments: FigmaComment[];
};

function buildCommentExcerpt(comments: FigmaComment[]): string {
  const full = comments
    .map((c) => `${c.author}: ${c.text}${c.resolved ? " [resolved]" : ""}`)
    .join("\n");
  if (full.length <= 1500) return full;
  return full.substring(0, 1499) + "…";
}

const config: SourceWorkerConfig = {
  source: "figma",
  mirrorDbId: NOTION_IDS.dbs.mirrorFigma,

  fixtureLoader: (squad: SquadId, weekOf: string) =>
    loadFixtures("figma", squad, weekOf),

  normalize: (raw: unknown, _squad: SquadId): SourceRecord => {
    const r = raw as SourceRecord & { raw: FigmaRaw };
    // summary = top-level comment (first comment) first 280 chars
    const firstComment = r.raw.comments?.[0]?.text ?? "";
    const summary = firstComment.substring(0, 280);
    return { ...r, summary };
  },

  propertyMapper: (rec: SourceRecord): MirrorProperties => {
    const r = rec.raw as FigmaRaw;
    const excerpt = buildCommentExcerpt(r.comments ?? []);
    return {
      Title:            { title: [{ text: { content: rec.title } }] },
      "File Key":       { rich_text: rt(r.file_key ?? "") },
      Squad:            { relation: [{ id: getSquadPageId(rec.squadId) }] },
      URL:              { url: rec.url },
      "Last Updated":   { date: { start: rec.lastUpdated } },
      "Comment Excerpt": { rich_text: [{ text: { content: excerpt.substring(0, 1999) } }] },
      Raw:              { rich_text: rt(JSON.stringify(rec.raw)) },
      "Source ID":      { rich_text: rt(rec.sourceId) },
    };
  },
};

export { config as figmaWorkerConfig };

if (process.argv[1]?.includes("figma")) {
  const weekArg = process.argv.find((a) => a.startsWith("--week="));
  const weekOf = weekArg ? weekArg.split("=")[1] : undefined;
  runSourceWorker(config, weekOf).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
