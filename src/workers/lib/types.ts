import type { SourceRecord, SquadId } from "../../types/core";

export type RichTextItem = { text: { content: string } };

export type NotionPropertyValue =
  | { title: RichTextItem[] }
  | { rich_text: RichTextItem[] }
  | { number: number | null }
  | { url: string | null }
  | { select: { name: string } | null }
  | { date: { start: string } | null }
  | { relation: { id: string }[] };

export type MirrorProperties = Record<string, NotionPropertyValue>;

export type SourceWorkerConfig = {
  source: SourceRecord["source"];
  mirrorDbId: string;
  fixtureLoader: (squad: SquadId, weekOf: string) => Promise<unknown[]>;
  normalize: (raw: unknown, squad: SquadId) => SourceRecord;
  propertyMapper: (rec: SourceRecord) => MirrorProperties;
};

export type UpsertAction = "created" | "updated" | "skipped";

export type RunResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
};
