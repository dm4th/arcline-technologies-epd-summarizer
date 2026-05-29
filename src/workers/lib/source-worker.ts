import type { SquadId } from "../../types/core";
import { upsertRecord } from "./upsert";
import { writeAgentRunLog, createSummarizerTrigger } from "./agent-run-log";
import type { SourceWorkerConfig, RunResult } from "./types";

const SQUADS: SquadId[] = ["atlas", "lumen", "forge"];

export async function runSourceWorker(
  config: SourceWorkerConfig,
  weekOf = "2026-W21"
): Promise<void> {
  const startedAt = new Date();
  const result: RunResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  for (const squad of SQUADS) {
    let records: unknown[];
    try {
      records = await config.fixtureLoader(squad, weekOf);
    } catch (err) {
      console.error(`[${config.source}/${squad}] Failed to load fixtures:`, err);
      result.errors++;
      continue;
    }

    for (const raw of records) {
      try {
        const rec = config.normalize(raw, squad);
        const props = config.propertyMapper(rec);
        const action = await upsertRecord(config.mirrorDbId, rec, props);
        result[action]++;
        if (action !== "skipped") {
          console.log(`  [${config.source}] ${action}: ${rec.sourceId}`);
        }
      } catch (err) {
        console.error(`[${config.source}] Error processing record:`, err);
        result.errors++;
      }
    }
  }

  const completedAt = new Date();
  const notes =
    `week=${weekOf} created=${result.created} updated=${result.updated} ` +
    `skipped=${result.skipped} errors=${result.errors}`;

  try {
    await writeAgentRunLog({
      agentName: `worker.${config.source}`,
      startedAt,
      completedAt,
      outcome: result.errors > 0 ? "error" : "ok",
      notes,
    });
  } catch (err) {
    console.error(`[${config.source}] Failed to write Agent Run Log:`, err);
  }

  console.log(`[${config.source}] Done — ${notes}`);

  try {
    await createSummarizerTrigger({ source: config.source, weekOf });
    console.log(`[${config.source}] Summarizer trigger created for ${weekOf}`);
  } catch (err) {
    console.error(`[${config.source}] Failed to create summarizer trigger:`, err);
  }
}
