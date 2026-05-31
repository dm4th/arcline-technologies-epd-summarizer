/**
 * validate-fixtures.ts
 *
 * Validates all fixture files against their JSON Schema definitions.
 * Auto-discovers all available week directories (e.g. 2026-W19, 2026-W21).
 * Exits 0 if all pass, 1 if any fail.
 *
 * Usage:
 *   pnpm tsx scripts/validate-fixtures.ts
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "..");
const SCHEMAS_DIR = path.join(ROOT, "fixtures", "schemas");
const FIXTURES_DIR = path.join(ROOT, "fixtures");

const SOURCES = ["github", "jira", "slack", "figma"] as const;
const SQUADS = ["atlas", "lumen", "forge"] as const;

type Source = (typeof SOURCES)[number];

// ---------------------------------------------------------------------------
// Discover all available weeks from the filesystem
// ---------------------------------------------------------------------------

// A week directory exists if at least one source/squad file is present for it.
// Pattern: fixtures/<source>/<squad>/2026-W<NN>.json
const weeksSet = new Set<string>();
for (const source of SOURCES) {
  for (const squad of SQUADS) {
    const dir = path.join(FIXTURES_DIR, source, squad);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const m = file.match(/^(20\d\d-W\d+)\.json$/);
      if (m) weeksSet.add(m[1]);
    }
  }
}
const WEEKS = [...weeksSet].sort();

// ---------------------------------------------------------------------------
// Load and compile schemas
// ---------------------------------------------------------------------------

const validators: Record<Source, ReturnType<typeof ajv.compile>> = {} as any;

for (const source of SOURCES) {
  const schemaPath = path.join(SCHEMAS_DIR, `${source}.json`);
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌  Schema missing: ${schemaPath}`);
    process.exit(1);
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  validators[source] = ajv.compile(schema);
}

// ---------------------------------------------------------------------------
// Validate each fixture file
// ---------------------------------------------------------------------------

let totalFiles = 0;
let passed = 0;
let failed = 0;

const failures: string[] = [];

console.log(`Weeks found: ${WEEKS.join(", ")}\n`);

for (const week of WEEKS) {
for (const source of SOURCES) {
  for (const squad of SQUADS) {
    const fixturePath = path.join(FIXTURES_DIR, source, squad, `${week}.json`);
    totalFiles++;

    if (!fs.existsSync(fixturePath)) {
      // A missing file for a given week/source/squad is only an error if
      // other files exist for that same week (partial week = bad).
      const anyExist = SQUADS.some(sq =>
        fs.existsSync(path.join(FIXTURES_DIR, source, sq, `${week}.json`))
      );
      if (anyExist) {
        const rel = path.relative(ROOT, fixturePath);
        failures.push(`  MISSING  ${rel}`);
        failed++;
        totalFiles++;
      }
      continue;
    }

    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    } catch (err) {
      const rel = path.relative(ROOT, fixturePath);
      failures.push(`  PARSE ERROR  ${rel}: ${(err as Error).message}`);
      failed++;
      continue;
    }

    const validate = validators[source];
    const valid = validate(data);

    const rel = path.relative(ROOT, fixturePath);
    if (valid) {
      const count = Array.isArray(data) ? data.length : "?";
      console.log(`  ✅  ${rel}  (${count} records)`);
      passed++;
    } else {
      console.log(`  ❌  ${rel}`);
      for (const err of validate.errors ?? []) {
        const loc = err.instancePath || "(root)";
        failures.push(`       ${loc}: ${err.message}`);
      }
      failed++;
    }
  }
}
} // end weeks loop

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
console.log(`Fixtures validated: ${totalFiles} files — ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const line of failures) {
    console.log(line);
  }
  process.exit(1);
}

console.log("\nAll fixtures valid ✅");
process.exit(0);
