// ─── Branch types ────────────────────────────────────────────────────────────

export type BranchKind =
  | "conversation"  // raw captured exchange
  | "issue"         // problem statement / bug
  | "decision"      // architectural / design decision
  | "fix-attempt"   // what was tried and whether it worked
  | "context"       // background knowledge / reference
  | "summary"       // compressed representation of another branch
  | "export";       // a snapshot assembled for reuse

export type CompressionQuality = "none" | "heuristic" | "haiku" | "sonnet";

// ─── Core entities ───────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  source: "claude-desktop" | "manual";
  capturedAt: number; // unix ms
  rawTokenCount: number;
  rootBranchId: string | null;
}

export interface Branch {
  id: string;
  conversationId: string;
  parentBranchId: string | null;
  kind: BranchKind;
  title: string;
  summary: string | null;
  compressionQuality: CompressionQuality;
  compressedTokenCount: number | null;
  rawTokenCount: number;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface Node {
  id: string;
  branchId: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokenCount: number;
  position: number;
  createdAt: number;
}

export interface Export {
  id: string;
  label: string;
  branchIds: string[];
  assembledContent: string;
  tokenCount: number;
  createdAt: number;
}

// ─── UI state ────────────────────────────────────────────────────────────────

export interface TreeNode {
  branch: Branch;
  children: TreeNode[];
}

export interface ExportOptions {
  maxTokens: number;
  includeSystemPrompt: boolean;
  compressionLevel: "heuristic" | "haiku" | "sonnet";
}
