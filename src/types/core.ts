/**
 * SquadId is the canonical identifier for one of the 3 simulated engineering squads.
 * PRD-01 replaces this placeholder with a string-literal union once squad IDs are
 * minted in the Notion workspace schema.
 */
export type SquadId = string;

/**
 * SourceRecord is the normalised shape every mirror DB writes to Notion.
 * All four source-worker PRDs (03a–03d) ingest into this contract.
 */
export type SourceRecord = {
  sourceId: string;
  source: "github" | "jira" | "slack" | "figma";
  squadId: SquadId;
  title: string;
  url: string;
  lastUpdated: string; // ISO 8601
  raw: unknown;
  summary?: string;
};

/**
 * Per-squad, per-data-source summary produced by the source summariser agents (PRD-04a).
 */
export type SquadSummary = {
  squadId: SquadId;
  weekOf: string; // ISO date of the Monday
  source: SourceRecord["source"] | "product";
  notionPageId: string;
  summaryText: string;
  citedRecordIds: string[]; // Notion page IDs of the SourceRecords cited
  approvalState: ApprovalState;
  approvedBy?: string;
  approvedAt?: string; // ISO 8601
};

/**
 * The master EPD weekly readout produced by the master summariser agent (PRD-05).
 */
export type MasterSummary = {
  weekOf: string; // ISO date of the Monday
  notionPageId: string;
  squadIds: SquadId[];
  sourceSummaryIds: string[]; // Notion page IDs of the SquadSummary pages that fed this
  approvalState: ApprovalState;
};

/**
 * One row in the Agent Run Log database (PRD-07 / observability).
 * Records start time, end time, status, and optional notes for every agent invocation.
 */
export type AgentRun = {
  runId: string;
  agentName: string;
  startedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601
  durationMs?: number;
  status: "running" | "completed" | "failed";
  workerId?: string;
  notes?: string;
};

/**
 * HITL approval state shared by SquadSummary and MasterSummary.
 */
export type ApprovalState = "pending" | "approved" | "rejected";
