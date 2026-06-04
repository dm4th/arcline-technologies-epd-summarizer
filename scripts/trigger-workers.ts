/**
 * Manual trigger for data source workers.
 *
 * Usage:
 *   pnpm workers                          # run all sources, default week
 *   pnpm workers --source=github          # single source
 *   pnpm workers --week=2026-W21          # explicit week
 *   pnpm workers --source=jira --week=2026-W21
 */

import { loadEnv } from "../src/lib/env";
import { githubWorkerConfig } from "../src/workers/github";
import { jiraWorkerConfig } from "../src/workers/jira";
import { slackWorkerConfig } from "../src/workers/slack";
import { figmaWorkerConfig } from "../src/workers/figma";
import { runSourceWorker } from "../src/workers/lib/source-worker";
import type { SourceWorkerConfig } from "../src/workers/lib/types";

loadEnv();

const ALL_CONFIGS: Record<string, SourceWorkerConfig> = {
  github: githubWorkerConfig,
  jira:   jiraWorkerConfig,
  slack:  slackWorkerConfig,
  figma:  figmaWorkerConfig,
};

const args = process.argv.slice(2);
const sourceArg = args.find((a) => a.startsWith("--source="))?.split("=")[1];
const weekArg   = args.find((a) => a.startsWith("--week="))?.split("=")[1];
const weekOf    = weekArg ?? "2026-W21";

const configs = sourceArg
  ? (() => {
      const c = ALL_CONFIGS[sourceArg];
      if (!c) {
        console.error(
          `Unknown source: "${sourceArg}". Valid: ${Object.keys(ALL_CONFIGS).join(", ")}`
        );
        process.exit(1);
      }
      return [c];
    })()
  : Object.values(ALL_CONFIGS);

console.log(
  `Running ${configs.map((c) => c.source).join(", ")} worker(s) for week ${weekOf}\n`
);

(async () => {
  for (const config of configs) {
    await runSourceWorker(config, weekOf);
  }
  console.log("\nAll workers complete.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
