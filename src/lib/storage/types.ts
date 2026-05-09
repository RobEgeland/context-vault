// ─── Node ────────────────────────────────────────────────────────────────────

export type NodeType =
  | "root"
  | "project"
  | "issue"
  | "subsystem"
  | "decision"
  | "fix_attempt"
  | "hypothesis"
  | "open_question"
  | "fact";

/** Compressed summary variants stored as a JSON map in the DB. */
export type CompressedSummaryModes = {
  short?: string;
  technical?: string;
  evidence_backed?: string;
};

export interface Node {
  id: string;
  parent_id: string | null;
  title: string;
  type: NodeType;
  summary: string | null;
  compressed_summary_modes: CompressedSummaryModes | null;
  structured_facts: unknown | null;   // JSON blob — schema defined later
  entities: string[] | null;          // JSON array
  tags: string[] | null;              // JSON array
  confidence: number | null;
  source_chat_id: string | null;
  created_at: number;                 // unix ms
  updated_at: number;                 // unix ms
  last_reused_at: number | null;      // unix ms
}

/** Input shape — caller omits generated fields. */
export type NewNode = Omit<Node, "id" | "created_at" | "updated_at">;

// ─── Message span ─────────────────────────────────────────────────────────────

export interface Span {
  id: string;
  node_id: string;
  source_chat_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number | null;  // unix ms, optional
  ordinal: number;
}

/** Input shape — caller omits id and node_id (supplied by appendMessageSpans). */
export type NewSpan = Omit<Span, "id" | "node_id">;

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  node_id:       string;
  title:         string;
  type:          string;
  parent_id:     string | null;
  /** Title of the parent project node, for the breadcrumb. */
  project_title: string | null;
  /** FTS5 snippet with <mark>…</mark> highlight tags, or '' for filter-only hits. */
  snippet:       string;
  rank:          number;
}
