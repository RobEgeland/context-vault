/**
 * Conversation ingest pipeline (v2).
 *
 * Security notes:
 *  - The API key is passed in at call time and never stored inside this module.
 *  - Transcript content is not logged at console.log / info level.
 *  - Only structural metadata (branch count, fact count, span count) is safe to log.
 */
import Anthropic, {
  AuthenticationError,
  APIConnectionTimeoutError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { NodesRepository } from "../storage/NodesRepository";
import type { Node } from "../storage/types";
import { loadRubric } from "./rubric";
import {
  PipelineOutputSchema,
  type StructuredFacts,
} from "./types";

// ─── Transcript parsing ───────────────────────────────────────────────────────

export interface ParsedSpan {
  role: "user" | "assistant";
  content: string;
  ordinal: number;
}

/**
 * Parse a plain-text transcript with "User:" / "Assistant:" role markers.
 * Lines not starting with a recognised marker are appended to the current turn.
 */
export function parseTranscript(raw: string): ParsedSpan[] {
  const lines = raw.split("\n");
  const spans: ParsedSpan[] = [];
  let current: { role: "user" | "assistant"; lines: string[] } | null = null;

  function flush() {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    if (content) {
      spans.push({ role: current.role, content, ordinal: spans.length });
    }
    current = null;
  }

  for (const line of lines) {
    const lower = line.trimStart().toLowerCase();
    if (lower.startsWith("user:")) {
      flush();
      current = { role: "user", lines: [line.trimStart().slice(5).trim()] };
    } else if (lower.startsWith("assistant:")) {
      flush();
      current = { role: "assistant", lines: [line.trimStart().slice(10).trim()] };
    } else if (current) {
      current.lines.push(line);
    }
    // Lines before the first marker are silently discarded.
  }
  flush();
  return spans;
}

// ─── System prompt scaffold ───────────────────────────────────────────────────

/**
 * Build the system prompt by wrapping the rubric in <rubric> tags.
 * The model is instructed to follow the rubric's three-tier classification
 * and use the extract_knowledge tool to return structured output.
 */
function buildSystemPrompt(rubric: string): string {
  return `\
You analyze AI conversation transcripts and extract structured knowledge using the three-tier classification defined in the rubric below.

<rubric>
${rubric.trim()}
</rubric>

Use the extract_knowledge tool to return your output. Follow the rubric exactly.`;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface IngestOptions {
  transcript: string;
  projectName: string;
  sourceChatId: string | null;
  apiKey: string;
  /** Timeout in milliseconds (default 30 s). */
  timeoutMs?: number;
}

export interface IngestResult {
  projectRoot: Node;
  branchCount: number;
  factCount: number;
}

export async function runIngest(opts: IngestOptions): Promise<IngestResult> {
  const { transcript, projectName, sourceChatId, apiKey, timeoutMs = 30_000 } = opts;

  // 1. Parse transcript
  const spans = parseTranscript(transcript);
  if (spans.length === 0) {
    throw new Error("No turns found. Make sure lines start with 'User:' or 'Assistant:'.");
  }

  // 2. Load rubric (cached after first call)
  const rubric = await loadRubric();
  const systemPrompt = buildSystemPrompt(rubric);

  // 3. Build user message (not logged — only span count)
  const turnLines = spans
    .map(
      (s) =>
        `  Turn ${s.ordinal} — ${s.role}: "${s.content.slice(0, 400)}${s.content.length > 400 ? "…" : ""}"`
    )
    .join("\n");

  const userMessage =
    `Analyze this conversation transcript (${spans.length} turns) and extract all branches, notable facts, and noise spans using the extract_knowledge tool.\n\n` +
    `Project context: ${projectName}\n\n` +
    `Transcript:\n${turnLines}`;

  // 4. Call Anthropic API with structured output via tool use
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    timeout: timeoutMs,
  });

  let rawOutput: unknown;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: systemPrompt,
      tools: [
        {
          name: "extract_knowledge",
          description:
            "Extract branches (Tier 1), notable facts (Tier 2), and noise turn indices (Tier 3) from the conversation transcript.",
          input_schema: {
            type: "object" as const,
            properties: {
              branches: {
                type: "array",
                description:
                  "Tier-1: multi-turn substantive topics. Each must span ≥ 2 turns of substantive exchange.",
                items: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description: "One concise declarative sentence (10–25 words) that captures the key finding, decision, or insight — the title IS the context summary.",
                    },
                    type: {
                      type: "string",
                      enum: [
                        "issue",
                        "subsystem",
                        "decision",
                        "fix_attempt",
                        "hypothesis",
                        "open_question",
                        "fact",
                      ],
                      description: "The category of knowledge this branch represents.",
                    },
                    summary: {
                      type: "string",
                      description: "1–3 sentence summary capturing the core insight.",
                    },
                    tags: {
                      type: "array",
                      items: { type: "string" },
                      description: "Lowercase keyword tags.",
                    },
                    entities: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Named entities: functions, files, error messages, libraries, etc.",
                    },
                    span_indices: {
                      type: "array",
                      items: { type: "integer", minimum: 0 },
                      description:
                        "0-based indices of transcript turns relevant to this branch.",
                    },
                  },
                  required: ["title", "type", "summary", "tags", "entities", "span_indices"],
                },
              },
              notable_facts: {
                type: "array",
                description:
                  "Tier-2: single Q+A pairs with reuse value that don't qualify as branches.",
                items: {
                  type: "object",
                  properties: {
                    key: {
                      type: "string",
                      description: "snake_case identifier, ≤ 6 words.",
                    },
                    value: {
                      type: "string",
                      description: "The fact in one concise sentence.",
                    },
                    span_index: {
                      type: "integer",
                      minimum: 0,
                      description: "0-based index of the turn where the fact appears.",
                    },
                    tags: {
                      type: "array",
                      items: { type: "string" },
                      description: "Lowercase keyword tags.",
                    },
                  },
                  required: ["key", "value", "span_index", "tags"],
                },
              },
              noise_span_indices: {
                type: "array",
                items: { type: "integer", minimum: 0 },
                description:
                  "Tier-3: 0-based indices of turns classified as noise (chitchat, repetition, no net-new information).",
              },
            },
            required: ["branches", "notable_facts", "noise_span_indices"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_knowledge" },
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract tool input from response
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Model did not return a tool_use block.");
    }
    rawOutput = toolUse.input;
  } catch (err: unknown) {
    // Humanise common API errors
    if (err instanceof AuthenticationError) {
      throw new Error("Invalid API key — check Settings.");
    }
    if (err instanceof APIConnectionTimeoutError) {
      throw new Error("Request timed out (30 s) — the transcript may be too long.");
    }
    if (err instanceof RateLimitError) {
      throw new Error("Rate limit hit — wait a moment and try again.");
    }
    throw err;
  }

  // 5. Validate with Zod
  const parsed = PipelineOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    throw new Error(`Model returned unexpected structure: ${parsed.error.message}`);
  }
  const { branches, notable_facts, noise_span_indices } = parsed.data;

  // Log only safe structural metadata (never content)
  console.info(
    `[ingest] Parsed ${spans.length} spans → ${branches.length} branch(es), ` +
      `${notable_facts.length} notable fact(s), ${noise_span_indices.length} noise turn(s) for "${projectName}"`
  );

  // 6. Find or create project root
  const allNodes = await NodesRepository.listAllNodes();
  let projectRoot = allNodes.find(
    (n) => n.type === "project" && n.parent_id === null && n.title === projectName
  );
  if (!projectRoot) {
    projectRoot = await NodesRepository.createNode({
      parent_id: null,
      title: projectName,
      type: "project",
      summary: null,
      compressed_summary_modes: null,
      structured_facts: notable_facts.length ? ({ facts: notable_facts } satisfies StructuredFacts) : null,
      entities: null,
      tags: [],
      confidence: null,
      source_chat_id: sourceChatId,
      last_reused_at: null,
    });
  } else if (notable_facts.length) {
    // Merge notable_facts into existing project root's structured_facts
    const existing = (projectRoot.structured_facts as StructuredFacts | null) ?? { facts: [] };
    const existingKeys = new Set(existing.facts.map((f) => f.key));
    const merged: StructuredFacts = {
      facts: [
        ...existing.facts,
        ...notable_facts.filter((f) => !existingKeys.has(f.key)),
      ],
    };
    await NodesRepository.updateNode(projectRoot.id, { structured_facts: merged });
    // Refresh local reference
    projectRoot = { ...projectRoot, structured_facts: merged };
  }

  // 7. Create branch nodes + attach spans
  for (const branch of branches) {
    const node = await NodesRepository.createNode({
      parent_id: projectRoot.id,
      title: branch.title,
      type: branch.type,
      summary: branch.summary,
      compressed_summary_modes: null,
      structured_facts: null,
      entities: branch.entities.length ? branch.entities : null,
      tags: branch.tags.length ? branch.tags : null,
      confidence: null,
      source_chat_id: sourceChatId,
      last_reused_at: null,
    });

    // Attach the referenced spans
    const referencedSpans = branch.span_indices
      .filter((i) => i >= 0 && i < spans.length)
      .map((i) => spans[i]);

    if (referencedSpans.length) {
      await NodesRepository.appendMessageSpans(
        node.id,
        referencedSpans.map((s) => ({
          source_chat_id: sourceChatId,
          role: s.role,
          content: s.content,
          timestamp: null,
          ordinal: s.ordinal,
        }))
      );
    }
  }

  return { projectRoot, branchCount: branches.length, factCount: notable_facts.length };
}
