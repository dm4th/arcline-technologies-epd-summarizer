/**
 * probe-workspace.ts
 *
 * Reads BASE_NOTION_PAGE and prints its child page tree to stdout, confirming
 * that the API key, page access, and TypeScript types all work end-to-end.
 *
 * Usage:  pnpm tsx scripts/probe-workspace.ts
 *         (requires .env.local with NOTION_API_KEY and BASE_NOTION_PAGE)
 */

import { getNotionClient, extractPageId } from "../src/lib/notion";
import { loadEnv } from "../src/lib/env";
import type { SourceRecord } from "../src/types/core";

// Verify the types compile with real usage (AC #5)
const _typeCheck: Partial<SourceRecord> = { source: "github", title: "probe" };
void _typeCheck;

async function getPageTitle(pageId: string): Promise<string> {
  const client = getNotionClient();
  try {
    const page = await client.pages.retrieve({ page_id: pageId });
    if ("properties" in page) {
      const titleProp = Object.values(page.properties).find(
        (p) => p.type === "title"
      );
      if (titleProp && titleProp.type === "title" && titleProp.title.length > 0) {
        return titleProp.title.map((t) => t.plain_text).join("");
      }
    }
    return `(untitled — id: ${pageId})`;
  } catch {
    return `(inaccessible — id: ${pageId})`;
  }
}

interface TreeNode {
  id: string;
  title: string;
  type: string;
  children: TreeNode[];
}

async function fetchChildren(blockId: string, depth: number): Promise<TreeNode[]> {
  if (depth > 2) return []; // cap recursion at 3 levels deep

  const client = getNotionClient();
  const nodes: TreeNode[] = [];

  let cursor: string | undefined;
  try {
    do {
      const response = await client.blocks.children.list({
        block_id: blockId,
        ...(cursor ? { start_cursor: cursor } : {}),
      });

      for (const block of response.results) {
        if (!("type" in block)) continue;

        let title: string = block.type;
        if (block.type === "child_page") {
          title = block.child_page.title || "(untitled page)";
        } else if (block.type === "child_database") {
          title = `[DB] ${block.child_database.title || "(untitled db)"}`;
        }

        const children =
          block.has_children && (block.type === "child_page" || block.type === "child_database")
            ? await fetchChildren(block.id, depth + 1)
            : [];

        nodes.push({ id: block.id, title, type: block.type, children });
      }

      cursor = response.next_cursor ?? undefined;
    } while (cursor);
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err ? (err as { code: string }).code : null;
    if (code === "object_not_found") {
      nodes.push({
        id: blockId,
        title: `[ACCESS DENIED — share this page with your integration]`,
        type: "error",
        children: [],
      });
    } else {
      throw err;
    }
  }

  return nodes;
}

function printTree(nodes: TreeNode[], prefix = "", isRoot = false): void {
  if (isRoot) {
    console.log(`ROOT  (${nodes.length} top-level block${nodes.length !== 1 ? "s" : ""})`);
  }
  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    console.log(`${prefix}${connector}${node.title}  [${node.type}]  (${node.id})`);
    if (node.children.length > 0) {
      printTree(node.children, childPrefix);
    }
  });
}

async function main(): Promise<void> {
  const env = loadEnv();
  const pageId = extractPageId(env.BASE_NOTION_PAGE);

  console.log("─".repeat(60));
  console.log("Notion Workspace Probe");
  console.log("─".repeat(60));
  console.log(`Base page URL : ${env.BASE_NOTION_PAGE}`);
  console.log(`Extracted ID  : ${pageId}`);
  console.log();

  const rootTitle = await getPageTitle(pageId);
  console.log(`Page title    : ${rootTitle}`);
  console.log();

  console.log("Fetching child tree (max depth 3)…");
  const children = await fetchChildren(pageId, 0);

  const hasAccessError = children.some((n) => n.type === "error");

  if (children.length === 0) {
    console.log("(no child blocks found — page may be empty)");
  } else {
    printTree(children, "", true);
  }

  console.log();
  console.log("─".repeat(60));

  if (hasAccessError || rootTitle.startsWith("(inaccessible")) {
    console.log("⚠  Integration does not have access to this page.");
    console.log("   Fix: open the page in Notion → Share → invite your integration.");
    console.log("   Integration name shown in the API error above.");
    process.exit(1);
  }

  console.log("✓  Probe complete. API access confirmed.");
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
