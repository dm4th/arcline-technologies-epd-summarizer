export type Citation = {
  recordId: string;    // Notion page ID of the mirror row
  sourceUrl: string;   // URL field from the mirror row
  claim: string;       // The factual sentence this citation supports
};

export type SummarySections = {
  whatShipped: string;  // completed/merged work
  inProgress: string;   // active work in flight
  risks: string;        // blockers, risks, open questions
  notable: string;      // cross-team deps, process notes, highlights
};

export type SummaryOutput = {
  sections: SummarySections;
  citations: Citation[];
};

export type MirrorRow = {
  notionPageId: string;
  sourceId: string;
  title: string;
  url: string;
  excerpt: string;      // body excerpt, AC text, slack excerpt, or comment
  lastUpdated: string;
  status?: string;
};
