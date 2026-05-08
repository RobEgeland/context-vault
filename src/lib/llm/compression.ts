import type { Node } from "../types";
import { getClient } from "./client";

// ─── Token estimation ─────────────────────────────────────────────────────────
// Rough 4-chars-per-token heuristic — good enough for budget checks.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Heuristic compression (no LLM call) ─────────────────────────────────────
// Strips assistant messages beyond a recency window and trims long tool outputs.
export function heuristicCompress(nodes: Node[], targetTokens: number): string {
  const TOOL_TRIM_CHARS = 800;
  let budget = targetTokens;
  const kept: string[] = [];

  // Always keep system nodes in full
  for (const n of nodes.filter((x) => x.role === "system")) {
    const line = `[system]\n${n.content}`;
    budget -= estimateTokens(line);
    kept.push(line);
  }

  // Walk user+assistant pairs newest-first, keep while budget allows
  const convo = nodes.filter((x) => x.role !== "system");
  for (let i = convo.length - 1; i >= 0; i--) {
    const n = convo[i];
    let text = n.content;
    // Trim suspiciously large assistant blobs (tool outputs, code fences)
    if (n.role === "assistant" && text.length > TOOL_TRIM_CHARS * 2) {
      text = text.slice(0, TOOL_TRIM_CHARS) + "\n… [trimmed]";
    }
    const line = `[${n.role}]\n${text}`;
    const cost = estimateTokens(line);
    if (budget - cost < 0) break;
    budget -= cost;
    kept.unshift(line);
  }

  return kept.join("\n\n---\n\n");
}

// ─── Haiku summary (cheap, at capture) ───────────────────────────────────────
export async function haikusummarizeBranch(
  title: string,
  rawContent: string,
  apiKey?: string
): Promise<string> {
  const client = getClient(apiKey);
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system:
      "You are a concise technical summarizer. Produce a 2-4 sentence summary of the conversation fragment below, capturing the core problem, key decisions, and outcome. Output only the summary — no preamble.",
    messages: [
      {
        role: "user",
        content: `Title: ${title}\n\n${rawContent.slice(0, 6000)}`,
      },
    ],
  });

  const block = msg.content[0];
  return block.type === "text" ? block.text : "";
}

// ─── Sonnet compression (high-quality, cached after first use) ────────────────
export async function sonnetCompress(
  title: string,
  nodes: Node[],
  targetTokens: number,
  apiKey?: string
): Promise<string> {
  const client = getClient(apiKey);
  const raw = nodes.map((n) => `[${n.role}]\n${n.content}`).join("\n\n---\n\n");

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: Math.min(targetTokens, 4096),
    system: [
      {
        type: "text",
        text: "You are an expert context compressor for AI conversations. Given a conversation, produce a dense, semantically rich reconstruction that preserves every important fact, decision, code snippet, and error message while eliminating filler, repetition, and meta-commentary. Retain exact identifiers, file paths, and values. Output only the compressed content.",
        // Enable prompt caching so repeated compressions of the same branch are free
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Compress the following conversation branch titled "${title}" to fit within ${targetTokens} tokens.\n\n${raw}`,
      },
    ],
  });

  const block = msg.content[0];
  return block.type === "text" ? block.text : heuristicCompress(nodes, targetTokens);
}
