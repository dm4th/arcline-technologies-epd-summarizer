import dotenv from "dotenv";
import path from "path";

// Load .env.local from the project root. No-op if already loaded or file absent.
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const REQUIRED = ["NOTION_API_KEY", "BASE_NOTION_PAGE"] as const;

export type Env = { readonly [K in (typeof REQUIRED)[number]]: string };

export function loadEnv(): Env {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}\n` +
        "Copy .env.local.example → .env.local and fill in the values."
    );
  }
  return Object.fromEntries(REQUIRED.map((k) => [k, process.env[k]!])) as Env;
}
