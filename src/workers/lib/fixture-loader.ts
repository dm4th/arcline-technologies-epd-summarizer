import fs from "fs/promises";
import path from "path";
import type { SquadId } from "../../types/core";

export async function loadFixtures(
  source: string,
  squad: SquadId,
  weekOf: string
): Promise<unknown[]> {
  const filePath = path.join(
    process.cwd(),
    "fixtures",
    source,
    squad,
    `${weekOf}.json`
  );
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as unknown[];
}
