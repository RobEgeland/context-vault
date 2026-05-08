/**
 * Unit tests for evals/diff.ts (pure, no I/O).
 */
import { describe, it, expect } from "vitest";
import { diffRuns } from "./diff";
import type { RunSummary } from "./diff";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_CASE = {
  id: "case-1",
  branch_count: 2,
  fact_count: 1,
  noise_count: 0,
  branches: [
    { title: "Auth failure", type: "issue", span_count: 2, tags: ["auth"] },
    { title: "CORS ordering", type: "decision", span_count: 1, tags: ["cors"] },
  ],
  facts: [{ key: "cors_version", span_index: 3, tags: ["cors"] }],
  noise_span_indices: [],
};

function makeRun(timestamp: string, cases: RunSummary["cases"]): RunSummary {
  return { timestamp, cases };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("diffRuns", () => {
  it("returns unchanged for identical runs", () => {
    const run = makeRun("2026-01-01T00:00:00Z", [BASE_CASE]);
    const diff = diffRuns(run, run);
    expect(diff.summary.unchanged).toBe(1);
    expect(diff.summary.improved).toBe(0);
    expect(diff.summary.regressed).toBe(0);
  });

  it("detects a new branch (improved)", () => {
    const oldRun = makeRun("2026-01-01T00:00:00Z", [BASE_CASE]);
    const newRun = makeRun("2026-01-02T00:00:00Z", [
      {
        ...BASE_CASE,
        branch_count: 3,
        branches: [
          ...BASE_CASE.branches,
          { title: "New branch", type: "fact", span_count: 2, tags: [] },
        ],
      },
    ]);
    const diff = diffRuns(oldRun, newRun);
    expect(diff.summary.improved).toBe(1);
    expect(diff.case_diffs[0].added_branch_titles).toContain("New branch");
    expect(diff.case_diffs[0].branch_count_delta).toBe(1);
  });

  it("detects a removed branch (regressed)", () => {
    const oldRun = makeRun("2026-01-01T00:00:00Z", [BASE_CASE]);
    const newRun = makeRun("2026-01-02T00:00:00Z", [
      {
        ...BASE_CASE,
        branch_count: 1,
        branches: [BASE_CASE.branches[0]],
      },
    ]);
    const diff = diffRuns(oldRun, newRun);
    expect(diff.summary.regressed).toBe(1);
    expect(diff.case_diffs[0].removed_branch_titles).toContain("CORS ordering");
  });

  it("marks new cases correctly", () => {
    const oldRun = makeRun("2026-01-01T00:00:00Z", []);
    const newRun = makeRun("2026-01-02T00:00:00Z", [BASE_CASE]);
    const diff = diffRuns(oldRun, newRun);
    expect(diff.summary.new_cases).toBe(1);
    expect(diff.new_cases).toContain("case-1");
  });

  it("marks removed cases correctly", () => {
    const oldRun = makeRun("2026-01-01T00:00:00Z", [BASE_CASE]);
    const newRun = makeRun("2026-01-02T00:00:00Z", []);
    const diff = diffRuns(oldRun, newRun);
    expect(diff.summary.removed_cases).toBe(1);
    expect(diff.removed_cases).toContain("case-1");
  });

  it("detects added and removed facts", () => {
    const oldRun = makeRun("2026-01-01T00:00:00Z", [BASE_CASE]);
    const newRun = makeRun("2026-01-02T00:00:00Z", [
      {
        ...BASE_CASE,
        fact_count: 2,
        facts: [
          { key: "cors_version", span_index: 3, tags: ["cors"] },
          { key: "express_version", span_index: 5, tags: ["express"] },
        ],
      },
    ]);
    const diff = diffRuns(oldRun, newRun);
    expect(diff.case_diffs[0].added_fact_keys).toContain("express_version");
    expect(diff.case_diffs[0].removed_fact_keys).toHaveLength(0);
    expect(diff.case_diffs[0].fact_count_delta).toBe(1);
  });

  it("handles multiple cases independently", () => {
    const oldRun = makeRun("2026-01-01T00:00:00Z", [
      BASE_CASE,
      { ...BASE_CASE, id: "case-2", branch_count: 3 },
    ]);
    const newRun = makeRun("2026-01-02T00:00:00Z", [
      { ...BASE_CASE, branch_count: 1, branches: [BASE_CASE.branches[0]] },
      { ...BASE_CASE, id: "case-2", branch_count: 4, branches: [...BASE_CASE.branches, { title: "Extra", type: "fact", span_count: 1, tags: [] }] },
    ]);
    const diff = diffRuns(oldRun, newRun);
    expect(diff.summary.regressed).toBe(1);
    expect(diff.summary.improved).toBe(1);
  });

  it("preserves timestamps in output", () => {
    const diff = diffRuns(
      makeRun("2026-01-01T00:00:00Z", []),
      makeRun("2026-01-02T00:00:00Z", [])
    );
    expect(diff.old_timestamp).toBe("2026-01-01T00:00:00Z");
    expect(diff.new_timestamp).toBe("2026-01-02T00:00:00Z");
  });
});
