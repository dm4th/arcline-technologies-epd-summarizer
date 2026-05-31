/**
 * PRD-08 — Eval Harness
 *
 * Scores the Master EPD Weekly report on three dimensions:
 *   1. Citation Coverage   — % of factual sentences with ≥1 citation (deterministic)
 *   2. Source-Fact Alignment — LLM-as-judge: does the cited row support the claim?
 *   3. Backtest Delta      — LLM-as-judge: how well does the master cover the ground truth?
 *
 * Trust Score = 0.40 × coverage + 0.40 × alignment + 0.20 × backtest
 *
 * Judge model: claude-haiku-4-5-20251001
 *   — Different tier from the summarizer agents (Notion Custom Agents run on Sonnet/Opus).
 *     Using Haiku avoids same-model collusion and keeps per-run cost low.
 *
 * Usage:
 *   pnpm tsx evals/run.ts --week=2026-W21
 *   pnpm tsx evals/run.ts --week=2026-W21 --save-golden
 */

import Anthropic from "@anthropic-ai/sdk";
import { Client, isFullPage } from "@notionhq/client";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// override:true ensures dotenv wins over Node's --env-file pre-loading
// (Node 24 can set vars to empty strings when it sees quoted values in --env-file)
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

// ── Constants ─────────────────────────────────────────────────────────────────

// Different model tier from the summarizer agents (which run on Sonnet/Opus via Notion).
// Haiku is fast, cheap, and provides genuinely independent judgment.
const JUDGE_MODEL = "claude-haiku-4-5-20251001";

const MASTER_EPD_WEEKLY_DB = "36efc8f4-554c-8158-808b-d084ce4c4a16";
const GROUND_TRUTH_PATH    = path.resolve(process.cwd(), "fixtures/ground-truth-report.md");
const REPORTS_DIR          = path.resolve(process.cwd(), "evals/reports");
const GOLDEN_DIR           = path.resolve(process.cwd(), "tests/golden");

// Sample cap for alignment — each sample is one LLM call; 12 gives solid coverage at low cost
const MAX_ALIGNMENT_SAMPLES = 12;

// Trust score weights (PRD-08 spec)
const W_COVERAGE  = 0.40;
const W_ALIGNMENT = 0.40;
const W_BACKTEST  = 0.20;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Citation {
  recordId: string;
  sourceUrl: string;
  claim: string;
}

export interface CitationWithSource extends Citation {
  sourceContent: string;
}

export type AlignmentVerdict = "support" | "partial" | "contradicts" | "unrelated";

export interface AlignmentResult {
  claim: string;
  recordId: string;
  verdict: AlignmentVerdict;
  reason: string;
  score: number; // 1 / 0.5 / 0 / 0
}

export interface EvalReport {
  week: string;
  generatedAt: string;
  judgeModel: string;
  masterPageId: string;
  masterBody: string;

  citationCoverage: {
    score: number;
    totalFactualSentences: number;
    citedSentences: number;
    uncitedSentences: string[];
  };

  sourceFactAlignment: {
    score: number;
    sampledCount: number;
    totalCitations: number;
    verdicts: AlignmentResult[];
  };

  backtestDelta: {
    score: number;
    missingFacts: string[];
    t2Surfaced: boolean; // Lumen Slack-only blocker — known recall gap (PRD-08 review note)
  };

  trustScore: number;
  trustScoreBreakdown: {
    coverageContrib: number;
    alignmentContrib: number;
    backtestContrib: number;
  };

  weakness: string;
}

// ── Notion helpers ────────────────────────────────────────────────────────────

function weekOfToDate(weekOf: string): string {
  const [yearStr, weekStr] = weekOf.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow  = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (dow - 1));
  const monday = new Date(week1Mon);
  monday.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().split("T")[0];
}

function blockText(richTextArr: unknown): string {
  if (!Array.isArray(richTextArr)) return "";
  return (richTextArr as Array<{ plain_text?: string }>)
    .map((t) => t.plain_text ?? "")
    .join("");
}

function richTextProp(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "";
  const p = prop as Record<string, unknown>;
  if ("rich_text" in p && Array.isArray(p.rich_text))
    return (p.rich_text as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  if ("title" in p && Array.isArray(p.title))
    return (p.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join("");
  return "";
}

// Mirror rows (GitHub, Jira, Slack, Figma) store all content in page PROPERTIES
// (Title, Body Excerpt, Source ID, Status, Raw, etc.) — body blocks are empty.
// This function reads properties and builds a text representation for the alignment judge.
async function readPageContent(notion: Client, pageId: string): Promise<string> {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    if (!isFullPage(page)) return "";

    const p = page.properties as Record<string, unknown>;
    const parts: string[] = [];

    for (const [key, val] of Object.entries(p)) {
      if (!val || typeof val !== "object") continue;
      const v = val as Record<string, unknown>;
      const t = v.type as string;

      let text = "";
      if (t === "title")
        text = (v.title as Array<{ plain_text: string }>)?.map((r) => r.plain_text).join("") ?? "";
      else if (t === "rich_text")
        text = (v.rich_text as Array<{ plain_text: string }>)?.map((r) => r.plain_text).join("") ?? "";
      else if (t === "select")
        text = (v.select as { name: string } | null)?.name ?? "";
      else if (t === "number")
        text = v.number != null ? String(v.number) : "";

      if (text) parts.push(`${key}: ${text}`);
    }

    return parts.join("\n");
  } catch {
    return "";
  }
}

// ── Step 1: Fetch master from Notion ─────────────────────────────────────────
//
// The master worker stores Citation Coverage % as a number but does NOT write
// the individual citation entries to the row's Citations property. Instead,
// citations live on the linked HITL Review Sessions pages (squad consolidations)
// in their own Citations rich_text property. We pool those here.

async function fetchMaster(notion: Client, weekOf: string): Promise<{
  pageId: string;
  body: string;
  citations: Citation[];
  squadConsolidationBodies: string[];
  storedCoveragePct: number | null;
}> {
  const weekDate = weekOfToDate(weekOf);
  const resp = await notion.databases.query({
    database_id: MASTER_EPD_WEEKLY_DB,
    filter: { property: "Week Of", date: { equals: weekDate } },
    page_size: 5,
  });

  const page = resp.results.filter(isFullPage)[0];
  if (!page) throw new Error(`No Master EPD Weekly row found for week ${weekOf} (date ${weekDate})`);

  const p = page.properties as Record<string, unknown>;

  // Stored citation coverage % (agent-computed, written to row property)
  const storedCov = (p["Citation Coverage %"] as { number?: number | null } | undefined);
  const storedCoveragePct = storedCov?.number ?? null;

  // Pool citations via a 2-hop traversal:
  //   Master.Squad Consolidations → HITL Review Sessions pages
  //     → Squad Weekly Summaries relation → per-source Squad Weekly Summary rows
  //       → Citations (rich_text JSON) with {recordId (mirror row), sourceUrl, claim}
  //
  // The master worker stores Citation Coverage % but not the citation entries.
  // The citation entries live on the per-source Squad Weekly Summary rows
  // (produced by PRD-04a/04b) and are aggregated upward via a rollup.
  const squadConsolidationIds =
    ((p["Squad Consolidations"] as { relation?: Array<{ id: string }> } | undefined)?.relation ?? [])
      .map((r) => r.id);

  const allCitations: Citation[] = [];
  const squadConsolidationBodies: string[] = [];

  for (const sqId of squadConsolidationIds) {
    try {
      const sqPage = await notion.pages.retrieve({ page_id: sqId });
      if (!isFullPage(sqPage)) continue;
      const sqP = sqPage.properties as Record<string, unknown>;

      // Read squad consolidation body blocks (the narrative text the master synthesizes from)
      const sqBlocks = await notion.blocks.children.list({ block_id: sqId });
      const sqBodyParts: string[] = [];
      for (const block of sqBlocks.results) {
        if (!("type" in block)) continue;
        const b = block as { type: string } & Record<string, unknown>;
        if (b.type === "callout")
          sqBodyParts.push(blockText((b.callout as Record<string, unknown>)?.rich_text));
        else if (b.type === "paragraph")
          sqBodyParts.push(blockText((b.paragraph as Record<string, unknown>)?.rich_text));
        else if (b.type === "heading_2")
          sqBodyParts.push(blockText((b.heading_2 as Record<string, unknown>)?.rich_text));
      }
      const sqBody = sqBodyParts.filter(Boolean).join(" ");
      if (sqBody) squadConsolidationBodies.push(sqBody);

      // Squad Weekly Summaries relation on the HITL Review Sessions page
      const summaryIds =
        ((sqP["Squad Weekly Summaries"] as { relation?: Array<{ id: string }> } | undefined)?.relation ?? [])
          .map((r) => r.id);

      for (const sumId of summaryIds) {
        try {
          const sumPage = await notion.pages.retrieve({ page_id: sumId });
          if (!isFullPage(sumPage)) continue;
          const sumP = sumPage.properties as Record<string, unknown>;
          const citationsJson = richTextProp(sumP["Citations"]);
          let cits: Citation[] = [];
          try { cits = JSON.parse(citationsJson || "[]"); } catch { cits = []; }
          allCitations.push(...cits);
        } catch { /* page not accessible — skip */ }
      }
    } catch { /* page not accessible — skip */ }
  }

  // Reconstruct body text from page blocks
  const bodyParts: string[] = [];
  const blocks = await notion.blocks.children.list({ block_id: page.id });
  for (const block of blocks.results) {
    if (!("type" in block)) continue;
    const b = block as { type: string } & Record<string, unknown>;
    if (b.type === "callout")
      bodyParts.push(blockText((b.callout as Record<string, unknown>)?.rich_text));
    else if (b.type === "paragraph")
      bodyParts.push(blockText((b.paragraph as Record<string, unknown>)?.rich_text));
    else if (b.type === "heading_2")
      bodyParts.push(`## ${blockText((b.heading_2 as Record<string, unknown>)?.rich_text)}`);
  }
  const body = bodyParts.filter(Boolean).join("\n\n");

  return { pageId: page.id, body, citations: allCitations, squadConsolidationBodies, storedCoveragePct };
}

// ── Step 2: Citation Coverage ─────────────────────────────────────────────────
//
// Strategy: extract factual sentences from the master body using a verb+noun
// heuristic, then check each against the citations list via normalized text match.
// This is fully deterministic — no LLM needed.

const FACTUAL_VERBS =
  /\b(shipped|merged|closed|completed|fixed|resolved|deployed|migrated|opened|created|filed|added|removed|deleted|launched|updated|reverted|paused|blocked|failed|succeeded|approved|rejected|increased|decreased|dropped|rose|improved|degraded|found|surfaced|confirmed|missed|caused|enabled|prevented)\b/i;

const FACTUAL_NOUN =
  /([A-Z][A-Z0-9-]{2,}|PR\s*#\d+|\d{1,3}%|\d+\s*(story points?|SP|tickets?|PRs?)|May \d+|Sprint \d+|W\d+|v\d+\b)/;

function isFactualSentence(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 20) return false;
  const hasVerb = FACTUAL_VERBS.test(trimmed) || /\b(is|are|was|were|has|have|had)\b/i.test(trimmed);
  return hasVerb && FACTUAL_NOUN.test(trimmed);
}

function extractSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

function normalizeSentence(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function sentencesMatch(bodySentence: string, claimSentence: string): boolean {
  const nb = normalizeSentence(bodySentence);
  const nc = normalizeSentence(claimSentence);

  // Direct substring match covers exact and slightly-padded cases
  if (nb.includes(nc.slice(0, 70)) || nc.includes(nb.slice(0, 70))) return true;

  // Word-overlap fallback: >70% of the shorter sentence's long words appear in the longer
  const wb = new Set(nb.split(" ").filter((w) => w.length > 4));
  const wc = new Set(nc.split(" ").filter((w) => w.length > 4));
  if (wb.size < 3 || wc.size < 3) return false;
  const [shorter, longer] = wb.size <= wc.size ? [wb, wc] : [wc, wb];
  const overlap = [...shorter].filter((w) => longer.has(w)).length;
  return overlap / shorter.size > 0.70;
}

// Coverage is checked against two pools of evidence:
//   1. The squad consolidation body texts (narrative the master directly synthesizes from).
//      Lower word-overlap threshold (50%) to account for cross-squad paraphrasing.
//   2. The per-source citation claims (verbatim claims from the lower-level summaries).
//      Higher threshold (70%) since these are more precise.
// A sentence is "covered" if it matches in either pool.
export function computeCitationCoverage(
  body: string,
  citations: Citation[],
  squadConsolidationBodies: string[] = [],
): EvalReport["citationCoverage"] {
  const all     = extractSentences(body);
  const factual = all.filter(isFactualSentence);

  // Combine all consolidation text into one searchable blob
  const consolidationText = squadConsolidationBodies.join(" ").toLowerCase();

  const cited: string[]   = [];
  const uncited: string[] = [];

  for (const sentence of factual) {
    // Check per-source citation claims (exact-ish match)
    const inCitations = citations.some((c) => sentencesMatch(sentence, c.claim));

    // Check squad consolidation bodies: use key-word overlap at 50% threshold
    const ns = normalizeSentence(sentence);
    const words = ns.split(" ").filter((w) => w.length > 4);
    const wordHits = words.filter((w) => consolidationText.includes(w)).length;
    const inConsolidation = words.length >= 4 && wordHits / words.length >= 0.50;

    (inCitations || inConsolidation ? cited : uncited).push(sentence);
  }

  return {
    score: factual.length === 0 ? 1 : cited.length / factual.length,
    totalFactualSentences: factual.length,
    citedSentences: cited.length,
    uncitedSentences: uncited,
  };
}

// ── Step 3: Source-Fact Alignment ─────────────────────────────────────────────
//
// For each sampled citation, fetch the referenced Notion page and ask an
// LLM judge whether the page content supports the claim.
// Score = (support + 0.5×partial) / total

const ALIGNMENT_SYSTEM =
  "You are an expert fact-checker. Your only job is to evaluate whether a source document " +
  "supports a specific factual claim. Be strict: partial credit only if the source is " +
  "clearly related but doesn't fully confirm. Never be charitable about vague connections.";

async function judgeOneAlignment(
  anthropic: Anthropic,
  claim: string,
  sourceContent: string,
): Promise<{ verdict: AlignmentVerdict; reason: string }> {
  const msg = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 256,
    system: ALIGNMENT_SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `SOURCE DOCUMENT:\n${sourceContent.slice(0, 3500)}\n\n` +
          `CLAIM TO VERIFY:\n"${claim}"\n\n` +
          `Does the source support this claim?\n` +
          `VERDICT: <support|partial|contradicts|unrelated>\n` +
          `REASON: <one sentence>`,
      },
    ],
  });

  const text   = (msg.content[0] as { text: string }).text;
  const vm     = text.match(/VERDICT:\s*(support|partial|contradicts|unrelated)/i);
  const rm     = text.match(/REASON:\s*(.+)/i);
  const verdict = (vm?.[1]?.toLowerCase() ?? "unrelated") as AlignmentVerdict;
  return { verdict, reason: rm?.[1]?.trim() ?? "No reason" };
}

export async function computeSourceFactAlignment(
  notion: Client,
  anthropic: Anthropic,
  citations: Citation[],
  frozenSources?: CitationWithSource[],
): Promise<EvalReport["sourceFactAlignment"]> {
  if (citations.length === 0)
    return { score: 0, sampledCount: 0, totalCitations: 0, verdicts: [] };

  // Uniform sample across the citation list
  const step    = Math.max(1, Math.ceil(citations.length / MAX_ALIGNMENT_SAMPLES));
  const sampled = citations.filter((_, i) => i % step === 0).slice(0, MAX_ALIGNMENT_SAMPLES);

  const verdicts: AlignmentResult[] = [];
  let totalScore = 0;

  for (const cit of sampled) {
    // Use frozen source content if available (golden replay); otherwise fetch live
    const sourceContent =
      frozenSources?.find((s) => s.recordId === cit.recordId)?.sourceContent ??
      await readPageContent(notion, cit.recordId);

    if (!sourceContent) {
      verdicts.push({ claim: cit.claim, recordId: cit.recordId, verdict: "unrelated", reason: "Source page empty or not found", score: 0 });
      continue;
    }

    const { verdict, reason } = await judgeOneAlignment(anthropic, cit.claim, sourceContent);
    const score = verdict === "support" ? 1 : verdict === "partial" ? 0.5 : 0;
    totalScore += score;
    verdicts.push({ claim: cit.claim, recordId: cit.recordId, verdict, reason, score });
  }

  return {
    score: verdicts.length === 0 ? 0 : totalScore / verdicts.length,
    sampledCount: sampled.length,
    totalCitations: citations.length,
    verdicts,
  };
}

// ── Step 4: Backtest Delta ────────────────────────────────────────────────────
//
// Ask the LLM judge to score how comprehensively the master body covers the
// ground-truth report, and to list any key facts that are missing.
//
// T2 (Tension 2) is explicitly tracked per the PRD-08 review note:
//   "Lumen auth service blocker went untracked — Slack-only, no Jira ticket."
// As of PRD-05 approval, T2 was NOT surfaced in the master's Open Discrepancies.
// This harness reports that gap honestly rather than hiding it.

const BACKTEST_SYSTEM =
  "You are an expert engineering report evaluator. Your job is to assess how well an " +
  "AI-generated report covers the key facts, tensions, and recommendations in a hand-authored " +
  "ground truth. Be strict and honest — the goal is to surface gaps, not to flatter the AI.";

export async function computeBacktestDelta(
  anthropic: Anthropic,
  masterBody: string,
  groundTruth: string,
): Promise<EvalReport["backtestDelta"]> {
  const msg = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    system: BACKTEST_SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `GROUND TRUTH (hand-authored VP report — the benchmark):\n${groundTruth.slice(0, 5500)}\n\n` +
          `AI-GENERATED REPORT (being evaluated):\n${masterBody.slice(0, 4000)}\n\n` +
          `Evaluate the AI report on three questions:\n\n` +
          `COVERAGE: Rate 0-100 how comprehensively the AI report covers the key facts, tensions, ` +
          `and recommendations in the ground truth. Deduct for each missing or inadequately covered item.\n\n` +
          `MISSING:\nList each key fact/tension/recommendation present in the ground truth but ABSENT ` +
          `or inadequately covered in the AI report. One bullet per item, or "None" if complete.\n\n` +
          `T2_CHECK: Does the AI report explicitly surface the following? ` +
          `"A multi-day auth service OOM incident blocked LMNE-25 and was never filed as a Jira ticket — ` +
          `the blocker was resolved entirely via Slack with no ticket created." ` +
          `Answer YES if clearly surfaced, NO if absent or only vaguely mentioned.\n\n` +
          `Respond in exactly this format:\n` +
          `COVERAGE: <0-100>\n` +
          `MISSING:\n- <item>\n- <item>\nT2_CHECK: <YES|NO>`,
      },
    ],
  });

  const text = (msg.content[0] as { text: string }).text;

  const coverageMatch = text.match(/COVERAGE:\s*(\d+(?:\.\d+)?)/);
  const score = Math.min(1, parseFloat(coverageMatch?.[1] ?? "0") / 100);

  // Extract MISSING block (everything between MISSING: and T2_CHECK:)
  const missingBlock = text.match(/MISSING:\s*([\s\S]+?)(?=T2_CHECK:|$)/);
  const missingFacts = (missingBlock?.[1] ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l.length > 3 && l.toLowerCase() !== "none");

  const t2Match    = text.match(/T2_CHECK:\s*(YES|NO)/i);
  const t2Surfaced = t2Match?.[1]?.toUpperCase() === "YES";

  return { score, missingFacts, t2Surfaced };
}

// ── Step 5: Trust Score + honest weakness summary ─────────────────────────────

function computeTrustScore(
  coverage: number,
  alignment: number,
  backtest: number,
): { trustScore: number; breakdown: EvalReport["trustScoreBreakdown"] } {
  const coverageContrib  = W_COVERAGE  * coverage;
  const alignmentContrib = W_ALIGNMENT * alignment;
  const backtestContrib  = W_BACKTEST  * backtest;
  return {
    trustScore: coverageContrib + alignmentContrib + backtestContrib,
    breakdown:  { coverageContrib, alignmentContrib, backtestContrib },
  };
}

function buildWeaknessSummary(report: Omit<EvalReport, "weakness">): string {
  const gaps: string[] = [];

  if (!report.backtestDelta.t2Surfaced) {
    gaps.push(
      "**Tension 2 not surfaced (known gap):** The Lumen auth service blocker (24+ hour OOM, " +
      "resolved via Slack, no Jira ticket filed) did NOT appear in the master's Open Discrepancies. " +
      "Root cause: the prd-fact-check agent does not flag Slack-only blockers with no corresponding ticket. " +
      "Fix path: add explicit heuristic — if Slack thread mentions a delivery blocker not linked to any Jira ticket, " +
      "surface as [PROCESS-GAP]. Measure first (this harness), then patch the prompt."
    );
  }

  if (report.citationCoverage.score < 0.85) {
    gaps.push(
      `**Citation coverage ${Math.round(report.citationCoverage.score * 100)}% is below the 85% target.** ` +
      `${report.citationCoverage.uncitedSentences.length} factual sentences have no matching citation entry. ` +
      `The agent is generating claims that it is not anchoring to source rows.`
    );
  }

  const alignFailures = report.sourceFactAlignment.verdicts.filter(
    (v) => v.verdict === "contradicts" || v.verdict === "unrelated"
  );
  if (alignFailures.length > 0) {
    const examples = alignFailures.slice(0, 2)
      .map((v) => `"${v.claim.slice(0, 70)}…" → ${v.verdict}`)
      .join("; ");
    gaps.push(`**Alignment failures:** ${examples}`);
  }

  if (report.backtestDelta.missingFacts.length > 0) {
    gaps.push(
      `**Missing from master vs ground truth:** ` +
      report.backtestDelta.missingFacts.slice(0, 3).join("; ")
    );
  }

  return gaps.length > 0
    ? gaps.join("\n\n")
    : "No significant weaknesses — all three eval dimensions passed their targets.";
}

// ── Step 6: Write reports ─────────────────────────────────────────────────────

function formatPct(n: number): string { return `${Math.round(n * 100)}%`; }

function buildMarkdown(r: EvalReport): string {
  const alignTable = r.sourceFactAlignment.verdicts
    .map(
      (v) =>
        `| ${v.claim.slice(0, 55).padEnd(55)} | ${v.verdict.padEnd(12)} | ${v.reason.slice(0, 70)} |`
    )
    .join("\n");

  const missingList =
    r.backtestDelta.missingFacts.length > 0
      ? r.backtestDelta.missingFacts.map((f) => `- ${f}`).join("\n")
      : "- None — all key facts surfaced.";

  return `# Eval Report — ${r.week}

**Generated:** ${r.generatedAt}
**Judge model:** ${r.judgeModel}
**Master page ID:** \`${r.masterPageId}\`

---

## Trust Score: **${formatPct(r.trustScore)}** ${r.trustScore >= 0.75 ? "✅ PASS" : "❌ BELOW TARGET (≥75%)"}

| Dimension | Weight | Raw Score | Contribution |
|---|---|---|---|
| Citation Coverage | 40% | ${formatPct(r.citationCoverage.score)} | ${formatPct(r.trustScoreBreakdown.coverageContrib)} |
| Source-Fact Alignment | 40% | ${formatPct(r.sourceFactAlignment.score)} | ${formatPct(r.trustScoreBreakdown.alignmentContrib)} |
| Backtest Delta | 20% | ${formatPct(r.backtestDelta.score)} | ${formatPct(r.trustScoreBreakdown.backtestContrib)} |
| **Trust Score** | 100% | — | **${formatPct(r.trustScore)}** |

---

## 1. Citation Coverage: ${formatPct(r.citationCoverage.score)}

${r.citationCoverage.citedSentences} of ${r.citationCoverage.totalFactualSentences} factual sentences are cited.

${
  r.citationCoverage.uncitedSentences.length > 0
    ? `**Uncited factual sentences (first 5):**\n${r.citationCoverage.uncitedSentences.slice(0, 5).map((s) => `- ${s}`).join("\n")}`
    : "All factual sentences have a matching citation."
}

---

## 2. Source-Fact Alignment: ${formatPct(r.sourceFactAlignment.score)}

Sampled ${r.sourceFactAlignment.sampledCount} of ${r.sourceFactAlignment.totalCitations} citations.

| Claim (truncated to 55 chars) | Verdict | Reason |
|---|---|---|
${alignTable}

---

## 3. Backtest Delta vs Ground Truth: ${formatPct(r.backtestDelta.score)}

**Tension 2 (Lumen Slack-only blocker) surfaced:** ${r.backtestDelta.t2Surfaced ? "YES ✅" : "NO ❌ (known gap — see Weaknesses)"}

**Key facts in ground truth not covered in master:**
${missingList}

---

## Weaknesses (Honest Assessment)

${r.weakness}

---

*PRD-08 Eval Harness v1 · Generated ${r.generatedAt}*
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args      = process.argv.slice(2);
  const weekOf    = args.find((a) => a.startsWith("--week="))?.split("=")[1];
  const saveGolden = args.includes("--save-golden");

  if (!weekOf) {
    console.error("Usage: pnpm tsx evals/run.ts --week=2026-W21 [--save-golden]");
    process.exit(1);
  }

  if (!process.env.NOTION_API_KEY)    throw new Error("NOTION_API_KEY not set — copy .env.local.example → .env.local");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set — add it to .env.local");

  const notion    = new Client({ auth: process.env.NOTION_API_KEY });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`\n━━━ PRD-08 Eval Harness · ${weekOf} ━━━\n`);

  // Step 1 — Fetch master
  console.log("1/4  Fetching master EPD row from Notion…");
  const { pageId, body, citations, squadConsolidationBodies, storedCoveragePct } = await fetchMaster(notion, weekOf);
  console.log(`     pageId=${pageId.slice(0, 8)}… · ${citations.length} citations · stored coverage=${storedCoveragePct ?? "?"}%`);

  // Step 2 — Citation coverage (deterministic)
  console.log("2/4  Computing citation coverage…");
  const citationCoverage = computeCitationCoverage(body, citations, squadConsolidationBodies);
  console.log(`     ${formatPct(citationCoverage.score)} (${citationCoverage.citedSentences}/${citationCoverage.totalFactualSentences} factual sentences cited)`);

  // Step 3 — Source-fact alignment (LLM judge)
  const sampleCount = Math.min(citations.length, MAX_ALIGNMENT_SAMPLES);
  console.log(`3/4  Running source-fact alignment (${sampleCount} LLM judge calls)…`);
  const sourceFactAlignment = await computeSourceFactAlignment(notion, anthropic, citations);
  console.log(`     Score: ${formatPct(sourceFactAlignment.score)}`);

  // Step 4 — Backtest delta (LLM judge)
  console.log("4/4  Running backtest delta vs ground truth…");
  const groundTruth    = fs.readFileSync(GROUND_TRUTH_PATH, "utf-8");
  const backtestDelta  = await computeBacktestDelta(anthropic, body, groundTruth);
  console.log(`     Coverage: ${formatPct(backtestDelta.score)} · T2 surfaced: ${backtestDelta.t2Surfaced}`);

  // Trust score
  const { trustScore, breakdown } = computeTrustScore(
    citationCoverage.score,
    sourceFactAlignment.score,
    backtestDelta.score,
  );

  const reportBase: Omit<EvalReport, "weakness"> = {
    week: weekOf,
    generatedAt: new Date().toISOString(),
    judgeModel: JUDGE_MODEL,
    masterPageId: pageId,
    masterBody: body,
    citationCoverage,
    sourceFactAlignment,
    backtestDelta,
    trustScore,
    trustScoreBreakdown: breakdown,
  };
  const weakness = buildWeaknessSummary(reportBase);
  const report: EvalReport   = { ...reportBase, weakness };

  // Write JSON + Markdown reports
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const jsonPath = path.join(REPORTS_DIR, `${weekOf}.json`);
  const mdPath   = path.join(REPORTS_DIR, `${weekOf}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath,   buildMarkdown(report));

  // Save golden set (frozen inputs for CI replay)
  if (saveGolden) {
    // Fetch source content for each sampled citation so replay works offline
    console.log("\nFetching source content for golden set…");
    const step    = Math.max(1, Math.ceil(citations.length / MAX_ALIGNMENT_SAMPLES));
    const sampled = citations.filter((_, i) => i % step === 0).slice(0, MAX_ALIGNMENT_SAMPLES);
    const alignmentSample: CitationWithSource[] = [];
    for (const cit of sampled) {
      const sourceContent = await readPageContent(notion, cit.recordId);
      alignmentSample.push({ ...cit, sourceContent });
    }

    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    const golden = {
      week: weekOf,
      frozenAt: new Date().toISOString(),
      judgeModel: JUDGE_MODEL,
      inputs: { masterBody: body, groundTruth, citations, squadConsolidationBodies, alignmentSample },
      baselineScores: {
        citationCoverage: citationCoverage.score,
        sourceFactAlignment: sourceFactAlignment.score,
        backtestDelta: backtestDelta.score,
        trustScore,
        t2Surfaced: backtestDelta.t2Surfaced,
      },
    };
    const goldenPath = path.join(GOLDEN_DIR, `${weekOf}.json`);
    fs.writeFileSync(goldenPath, JSON.stringify(golden, null, 2));
    console.log(`Golden saved → ${goldenPath}`);
  }

  // Final summary
  console.log(`\n━━━ Results ━━━`);
  console.log(`  Citation Coverage  : ${formatPct(citationCoverage.score)}`);
  console.log(`  Source-Fact Align  : ${formatPct(sourceFactAlignment.score)}`);
  console.log(`  Backtest Delta     : ${formatPct(backtestDelta.score)}`);
  console.log(`  Trust Score        : ${formatPct(trustScore)} ${trustScore >= 0.75 ? "✅" : "❌ (target ≥75%)"}`);
  console.log(`  T2 (Slack-only gap): ${backtestDelta.t2Surfaced ? "✅ surfaced" : "❌ not surfaced (known — documented in report)"}`);
  console.log(`\n  Reports: ${mdPath}`);
  console.log(`           ${jsonPath}\n`);

  if (trustScore < 0.75) {
    console.warn(`⚠  Trust Score ${formatPct(trustScore)} is below the 75% target.`);
    console.warn(`   See ${mdPath} for the full weakness breakdown.`);
    // Do NOT exit(1) — the PRD says "if not, fix prompts or report honestly, do not tune the metric"
  }
}

// Only run when executed directly — not when imported by golden-replay.ts
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
