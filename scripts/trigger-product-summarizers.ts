/**
 * Manual trigger for product summarizer agents (roadmap + PRD fact check).
 *
 * Run this AFTER the per-source summarizer agents (PRD-04a) have completed
 * for all squads — i.e., after all 12 Squad Weekly Summary rows are in
 * "awaiting-review" status.
 *
 * Usage:
 *   pnpm product-summarizers                  # trigger both agents, default week
 *   pnpm product-summarizers --week=2026-W21  # explicit week
 *
 * This creates two Agent Run Log rows with Outcome = "pending":
 *   - summarizer.roadmap   (watched by the Roadmap Summarizer Custom Agent)
 *   - summarizer.prdcheck  (watched by the PRD Fact Checker Custom Agent)
 *
 * After running, open each Custom Agent in Notion and start a new session
 * to process the pending trigger row.
 */

import { createProductSummarizerTriggers } from "../src/workers/lib/agent-run-log";

const args   = process.argv.slice(2);
const weekOf = args.find((a) => a.startsWith("--week="))?.split("=")[1] ?? "2026-W21";

console.log(`\nCreating product summarizer triggers for week ${weekOf}…`);

createProductSummarizerTriggers({ weekOf })
  .then(() => {
    console.log(`\n✓ Done — open the Roadmap Summarizer and PRD Fact Checker agents in Notion to process.`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
