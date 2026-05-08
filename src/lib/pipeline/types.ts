/**
 * Zod schemas for the v2 ingest pipeline output.
 *
 * Three-tier classification:
 *  - Branch       (Tier 1) — multi-turn substantive topic
 *  - NotableFact  (Tier 2) — single Q+A with reuse value
 *  - Noise        (Tier 3) — turns excluded from the vault
 */
import { z } from "zod";

// ─── Tier 1: Branch ───────────────────────────────────────────────────────────

export const BranchSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum([
    "issue",
    "subsystem",
    "decision",
    "fix_attempt",
    "hypothesis",
    "open_question",
    "fact",
  ]),
  summary: z.string().min(1),
  tags: z.array(z.string()),
  entities: z.array(z.string()),
  span_indices: z.array(z.number().int().min(0)),
});

export type IngestBranch = z.infer<typeof BranchSchema>;

// ─── Tier 2: Notable fact ─────────────────────────────────────────────────────

export const NotableFactSchema = z.object({
  /** snake_case identifier, ≤ 6 words */
  key: z.string().min(1).max(80),
  /** One concise sentence stating the fact. */
  value: z.string().min(1),
  /** 0-based index of the transcript turn where the fact appears. */
  span_index: z.number().int().min(0),
  /** Lowercase keyword tags. */
  tags: z.array(z.string()),
});

export type NotableFact = z.infer<typeof NotableFactSchema>;

// ─── Full pipeline output ─────────────────────────────────────────────────────

export const PipelineOutputSchema = z.object({
  branches: z.array(BranchSchema),
  notable_facts: z.array(NotableFactSchema),
  /** Turn indices classified as noise — excluded from all branch/fact coverage. */
  noise_span_indices: z.array(z.number().int().min(0)),
});

export type PipelineOutput = z.infer<typeof PipelineOutputSchema>;

// ─── structured_facts payload stored on nodes ─────────────────────────────────

/**
 * Shape written to `node.structured_facts` for project-root nodes.
 * Branch nodes do not currently use structured_facts.
 */
export interface StructuredFacts {
  facts: NotableFact[];
}
