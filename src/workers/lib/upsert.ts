import { isFullPage } from "@notionhq/client";
import { getNotionClient } from "../../lib/notion";
import type { MirrorProperties, UpsertAction } from "./types";
import type { SourceRecord } from "../../types/core";

export async function upsertRecord(
  mirrorDbId: string,
  rec: SourceRecord,
  properties: MirrorProperties
): Promise<UpsertAction> {
  const notion = getNotionClient();

  const existing = await notion.databases.query({
    database_id: mirrorDbId,
    filter: {
      property: "Source ID",
      rich_text: { equals: rec.sourceId },
    },
  });

  const rawJson = JSON.stringify(rec.raw).substring(0, 1999);

  if (existing.results.length === 0) {
    await notion.pages.create({
      parent: { database_id: mirrorDbId },
      properties: properties as Parameters<
        typeof notion.pages.create
      >[0]["properties"],
    });
    return "created";
  }

  const page = existing.results[0];
  if (!isFullPage(page)) {
    // Partial page response — can't compare, update to be safe.
    await notion.pages.update({
      page_id: page.id,
      properties: properties as Parameters<
        typeof notion.pages.update
      >[0]["properties"],
    });
    return "updated";
  }

  // Compare stored Raw JSON against the new value to detect actual changes.
  const rawProp = page.properties["Raw"];
  const existingRaw =
    rawProp?.type === "rich_text" &&
    Array.isArray(rawProp.rich_text) &&
    rawProp.rich_text.length > 0
      ? (rawProp.rich_text[0] as { plain_text: string }).plain_text
      : "";

  if (existingRaw === rawJson) {
    return "skipped";
  }

  await notion.pages.update({
    page_id: page.id,
    properties: properties as Parameters<
      typeof notion.pages.update
    >[0]["properties"],
  });
  return "updated";
}
