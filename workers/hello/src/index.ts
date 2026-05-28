import { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";

const worker = new Worker();
export default worker;

/**
 * Proof-of-concept tool: confirms the Workers runtime is reachable and deployable.
 * Downstream data-source workers (PRD-03a–03d) follow the same Worker + tool pattern.
 */
worker.tool("ping", {
  title: "Ping",
  description: "Returns a timestamped pong — confirms the hello worker is live.",
  schema: j.object({}),
  execute: () => ({
    pong: true,
    worker: "hello",
    ts: new Date().toISOString(),
  }),
});
