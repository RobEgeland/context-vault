/**
 * Unit tests for the v2 ingest pipeline.
 *
 * The Anthropic SDK is mocked so tests run without network access.
 * The Tauri APIs (NodesRepository, rubric loader) are also mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared mock state ────────────────────────────────────────────────────────
// Defined before vi.mock() calls so factory closures can close over them.

const mockCreate = vi.fn();
const mockNodes: import("../storage/types").Node[] = [];

// ─── Mock: @anthropic-ai/sdk ──────────────────────────────────────────────────

vi.mock("@anthropic-ai/sdk", () => {
  class AuthenticationError extends Error {
    status: number;
    constructor(status: number, _error: unknown, message: string, _headers: unknown) {
      super(message);
      this.status = status;
    }
  }
  class APIConnectionTimeoutError extends Error {}
  class RateLimitError extends Error {}

  // Must use `function` (not arrow) so `new Anthropic(...)` works as a constructor.
  function MockAnthropic(this: Record<string, unknown>) {
    this["messages"] = { create: mockCreate };
  }

  return {
    default: MockAnthropic,
    AuthenticationError,
    APIConnectionTimeoutError,
    RateLimitError,
  };
});

// ─── Mock: rubric loader ──────────────────────────────────────────────────────

vi.mock("./rubric", () => ({
  loadRubric: vi.fn().mockResolvedValue("# Stub rubric"),
  clearRubricCache: vi.fn(),
}));

// ─── Mock: NodesRepository ────────────────────────────────────────────────────

vi.mock("../storage/NodesRepository", () => ({
  NodesRepository: {
    listAllNodes: vi.fn().mockImplementation(async () => [...mockNodes]),
    createNode: vi.fn().mockImplementation(async (n) => {
      const node = {
        ...n,
        id: `node-${mockNodes.length + 1}`,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      mockNodes.push(node as import("../storage/types").Node);
      return node;
    }),
    updateNode: vi.fn().mockResolvedValue(undefined),
    appendMessageSpans: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { runIngest, parseTranscript } from "./ingest";
import { NodesRepository } from "../storage/NodesRepository";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApiResponse(input: unknown) {
  return {
    content: [{ type: "tool_use", id: "tu_1", name: "extract_knowledge", input }],
    stop_reason: "tool_use",
  };
}

const BASE_OPTS = {
  transcript: "",
  projectName: "Test Project",
  sourceChatId: null,
  apiKey: "sk-ant-test",
};

// ─── parseTranscript ──────────────────────────────────────────────────────────

describe("parseTranscript", () => {
  it("parses User/Assistant turns", () => {
    const raw = "User: Hello\nAssistant: World";
    const spans = parseTranscript(raw);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ role: "user", content: "Hello", ordinal: 0 });
    expect(spans[1]).toMatchObject({ role: "assistant", content: "World", ordinal: 1 });
  });

  it("merges continuation lines into the previous turn", () => {
    const raw = "User: Line one\nstill user\nAssistant: Done";
    const spans = parseTranscript(raw);
    expect(spans[0].content).toBe("Line one\nstill user");
  });

  it("is case-insensitive for role markers", () => {
    const spans = parseTranscript("USER: hi\nASSISTANT: hey");
    expect(spans[0].role).toBe("user");
    expect(spans[1].role).toBe("assistant");
  });

  it("discards lines before first marker", () => {
    const spans = parseTranscript("preamble\nUser: hello");
    expect(spans).toHaveLength(1);
  });

  it("returns empty array for blank input", () => {
    expect(parseTranscript("")).toHaveLength(0);
  });
});

// ─── runIngest ────────────────────────────────────────────────────────────────

describe("runIngest", () => {
  beforeEach(() => {
    mockNodes.length = 0;
    vi.clearAllMocks();
    // Re-apply default implementations cleared by clearAllMocks
    vi.mocked(NodesRepository.listAllNodes).mockImplementation(async () => [...mockNodes]);
    vi.mocked(NodesRepository.createNode).mockImplementation(async (n) => {
      const node = {
        ...n,
        id: `node-${mockNodes.length + 1}`,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      mockNodes.push(node as import("../storage/types").Node);
      return node;
    });
    vi.mocked(NodesRepository.updateNode).mockResolvedValue(undefined);
    vi.mocked(NodesRepository.appendMessageSpans).mockResolvedValue(undefined);
  });

  it("throws when transcript has no role markers", async () => {
    await expect(
      runIngest({ ...BASE_OPTS, transcript: "just some text" })
    ).rejects.toThrow("No turns found");
  });

  it("creates project root and branch nodes", async () => {
    mockCreate.mockResolvedValue(
      makeApiResponse({
        branches: [
          {
            title: "Auth failure after CORS change",
            type: "issue",
            summary: "OPTIONS preflight bypasses auth.",
            tags: ["auth", "cors"],
            entities: ["cors()"],
            span_indices: [0, 1],
          },
        ],
        notable_facts: [],
        noise_span_indices: [],
      })
    );

    const result = await runIngest({
      ...BASE_OPTS,
      transcript: "User: Why auth failing?\nAssistant: CORS order is wrong.",
    });

    expect(result.branchCount).toBe(1);
    expect(result.factCount).toBe(0);
    expect(NodesRepository.createNode).toHaveBeenCalledTimes(2); // root + branch
  });

  it("attaches notable_facts to new project root's structured_facts", async () => {
    mockCreate.mockResolvedValue(
      makeApiResponse({
        branches: [],
        notable_facts: [
          {
            key: "cors_package_version",
            value: "cors@2.8.5 is the last version with full Express 4 support.",
            span_index: 1,
            tags: ["cors", "versioning"],
          },
        ],
        noise_span_indices: [],
      })
    );

    const result = await runIngest({
      ...BASE_OPTS,
      transcript: "User: What cors version?\nAssistant: Use cors@2.8.5.",
    });

    expect(result.factCount).toBe(1);
    const createCalls = vi.mocked(NodesRepository.createNode).mock.calls;
    // The project root call (first createNode) should include structured_facts
    const rootCall = createCalls[0][0];
    expect(rootCall.structured_facts).toMatchObject({
      facts: [{ key: "cors_package_version" }],
    });
  });

  it("merges notable_facts into existing project root without duplicates", async () => {
    // Pre-seed an existing project root with one fact
    const existingRoot: import("../storage/types").Node = {
      id: "node-existing",
      parent_id: null,
      title: "Test Project",
      type: "project",
      summary: null,
      compressed_summary_modes: null,
      structured_facts: {
        facts: [{ key: "old_fact", value: "An old fact.", span_index: 0, tags: [] }],
      },
      entities: null,
      tags: [],
      confidence: null,
      source_chat_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      last_reused_at: null,
    };
    mockNodes.push(existingRoot);

    mockCreate.mockResolvedValue(
      makeApiResponse({
        branches: [],
        notable_facts: [
          {
            key: "new_fact",
            value: "A new fact.",
            span_index: 1,
            tags: ["new"],
          },
          {
            // duplicate key — should be deduplicated
            key: "old_fact",
            value: "An old fact (duplicate).",
            span_index: 0,
            tags: [],
          },
        ],
        noise_span_indices: [],
      })
    );

    await runIngest({
      ...BASE_OPTS,
      transcript: "User: Old?\nAssistant: Yes.\nUser: New?\nAssistant: Yes.",
    });

    const updateCalls = vi.mocked(NodesRepository.updateNode).mock.calls;
    expect(updateCalls).toHaveLength(1);
    const [, patch] = updateCalls[0];
    const mergedFacts = (patch as { structured_facts: { facts: unknown[] } })
      .structured_facts.facts;
    // old_fact from existing + new_fact only (duplicate old_fact dropped)
    expect(mergedFacts).toHaveLength(2);
    expect(mergedFacts.map((f: unknown) => (f as { key: string }).key)).toContain("old_fact");
    expect(mergedFacts.map((f: unknown) => (f as { key: string }).key)).toContain("new_fact");
  });

  it("routes noise turns correctly (no branch/fact created for them)", async () => {
    mockCreate.mockResolvedValue(
      makeApiResponse({
        branches: [
          {
            title: "Main topic",
            type: "fact",
            summary: "The main insight.",
            tags: [],
            entities: [],
            span_indices: [0, 1],
          },
        ],
        notable_facts: [],
        noise_span_indices: [2], // turn 2 is noise
      })
    );

    const result = await runIngest({
      ...BASE_OPTS,
      transcript:
        "User: Real question?\nAssistant: Real answer.\nUser: Thanks!",
    });

    expect(result.branchCount).toBe(1);
    // appendMessageSpans called only for the branch (turns 0+1), not for noise turn 2
    const appendCalls = vi.mocked(NodesRepository.appendMessageSpans).mock.calls;
    const allSpanOrdinals = appendCalls.flatMap(([, spans]) =>
      spans.map((s: { ordinal: number }) => s.ordinal)
    );
    expect(allSpanOrdinals).not.toContain(2);
  });

  it("throws a friendly message on AuthenticationError", async () => {
    const { AuthenticationError } = await import("@anthropic-ai/sdk");
    mockCreate.mockRejectedValue(
      new AuthenticationError(401, {} as never, "bad key", {} as never)
    );

    await expect(
      runIngest({
        ...BASE_OPTS,
        transcript: "User: Hi\nAssistant: Hello",
      })
    ).rejects.toThrow("Invalid API key");
  });
});
