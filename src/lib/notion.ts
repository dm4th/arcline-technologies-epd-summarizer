import { Client } from "@notionhq/client";
import { loadEnv } from "./env";

let _client: Client | null = null;

/**
 * Returns a singleton Notion SDK client authenticated from .env.local.
 * Throws on first call if NOTION_API_KEY is missing.
 */
export function getNotionClient(): Client {
  if (!_client) {
    const env = loadEnv();
    _client = new Client({ auth: env.NOTION_API_KEY });
  }
  return _client;
}

/**
 * Extract a bare 32-hex-char Notion page ID from a full URL or any ID format.
 * Handles:
 *   https://www.notion.so/workspace/Title-abc123def456
 *   https://www.notion.so/abc123def456
 *   abc12345-def4-56ab-cdef-123456789012  (UUID with dashes)
 *   abc123def456...                        (raw 32-char hex)
 */
export function extractPageId(urlOrId: string): string {
  const hex32 = urlOrId.match(/([a-f0-9]{32})(?:[?#].*)?$/i);
  if (hex32) return hex32[1];

  const uuid = urlOrId.match(
    /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:[?#].*)?$/i
  );
  if (uuid) return uuid[1].replace(/-/g, "");

  throw new Error(
    `Could not extract a Notion page ID from: "${urlOrId}"\n` +
      "Expected a notion.so URL or a bare UUID/hex-32 string."
  );
}
