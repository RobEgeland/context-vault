/**
 * Node compression pipeline.
 *
 * compressNode() produces a mode-specific compressed export of a node and
 * caches the result in node.compressed_summary_modes so subsequent calls
 * are instant.
 *
 * Security: API key is passed at call time, never stored here.
 * Transcript content is not logged.
 */
import Anthropic, {
  AuthenticationError,
  APIConnectionTimeoutError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { NodesRepository } from "../storage/NodesRepository";
import type { CompressedSummaryModes } from "../storage/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CompressMode = "short" | "technical" | "evidence_backed";

// ─── Per-mode configuration ───────────────────────────────────────────────────

/** Token budgets are intentionally generous so the model isn't cut off mid-sentence. */
const MODE_MAX_TOKENS: Record<CompressMode, number> = {
  short:           150,   // target ≤ 80 output tokens
  technical:       500,   // target ≤ 300
  evidence_backed: 1100,  // target ≤ 800
};

const MODE_SYSTEM: Record<CompressMode, string> = {
  short: `\
You write ultra-compact context summaries for pasting into AI sessions.

Requirements:
- ≤ 80 tokens total.
- Start with a single headline sentence capturing the key finding or decision.
- Add 1–2 follow-up sentences with the essential details.
- Plain prose only — no markdown headers, no bullet points, no code blocks.
- Model-agnostic language: avoid "the user said", "I said", "the assistant". State facts directly.`,

  technical: `\
You write technical context summaries for pasting into AI sessions.

Requirements:
- ≤ 300 tokens total.
- Use exactly these markdown sections (omit any section that has nothing to say):

## Problem
## Environment
## What's known
## Open questions`,

  evidence_backed: `\
You write evidence-backed context summaries for pasting into AI sessions.

Requirements:
- ≤ 800 tokens total.
- Use exactly these markdown sections (omit empty ones):

## Problem
## Environment
## What's known
## Open questions
## Evidence

For the Evidence section, include 2–4 short verbatim quotes from the conversation spans.
Format each quote as:
> [user] "…"
> [assistant] "…"`,
};

// ─── Main function ────────────────────────────────────────────────────────────

export interface CompressOptions {
  apiKey: string;
  /** When true, skip cache and regenerate unconditionally. */
  force?: boolean;
  /** Timeout in milliseconds (default 30 s). */
  timeoutMs?: number;
}

/**
 * Produce and cache a compressed export of a node in the requested mode.
 *
 * Returns the compressed text.
 */
export async function compressNode(
  nodeId: string,
  mode: CompressMode,
  opts: CompressOptions
): Promise<string> {
  const { apiKey, force = false, timeoutMs = 30_000 } = opts;

  // 1. Load node
  const node = await NodesRepository.getNode(nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found.`);

  // 2. Cache hit
  const cached = node.compressed_summary_modes?.[mode];
  if (cached && !force) return cached;

  // 3. Load spans (for evidence_backed; included for all modes so the model
  //    has full context even if it only uses a subset)
  const spans = await NodesRepository.listSpans(nodeId);

  // 4. Build user message (content not logged)
  const spanSection = spans.length
    ? spans.map((s) => `[${s.role}] "${s.content}"`).join("\n\n")
    : "(no conversation spans attached)";

  const metaLines: string[] = [
    `Title: ${node.title}`,
    `Type: ${node.type}`,
  ];
  if (node.summary)          metaLines.push(`Summary: ${node.summary}`);
  if (node.entities?.length) metaLines.push(`Entities: ${node.entities.join(", ")}`);
  if (node.tags?.length)     metaLines.push(`Tags: ${node.tags.join(", ")}`);

  const userMessage = [...metaLines, "", "Conversation spans:", spanSection].join("\n");

  // 5. Call Anthropic
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    timeout: timeoutMs,
  });

  let compressed: string;
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: MODE_MAX_TOKENS[mode],
      system: MODE_SYSTEM[mode],
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Model returned no text block.");
    }
    compressed = textBlock.text.trim();
  } catch (err: unknown) {
    if (err instanceof AuthenticationError)
      throw new Error("Invalid API key — check Settings.");
    if (err instanceof APIConnectionTimeoutError)
      throw new Error("Request timed out (30 s) — try a node with fewer spans.");
    if (err instanceof RateLimitError)
      throw new Error("Rate limit hit — wait a moment and try again.");
    throw err;
  }

  // 6. Persist cache + bump last_reused_at
  const updatedModes: CompressedSummaryModes = {
    ...(node.compressed_summary_modes ?? {}),
    [mode]: compressed,
  };

  await NodesRepository.updateNode(nodeId, {
    compressed_summary_modes: updatedModes,
    last_reused_at: Date.now(),
  });

  return compressed;
}
