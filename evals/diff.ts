/**
 * Pure diff utilities for comparing two eval run outputs.
 * No I/O — accepts plain objects, returns plain objects.
 * Tested by diff.test.ts.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BranchResult {
  title: string;
  type: string;
  span_count: number;
  tags: string[];
}

export interface FactResult {
  key: string;
  span_index: number;
  tags: string[];
}

export interface CaseOutput {
  id: string;
  branch_count: number;
  fact_count: number;
  noise_count: number;
  branches: BranchResult[];
  facts: FactResult[];
  noise_span_indices: number[];
  error?: string;
}

export interface RunSummary {
  timestamp: string;
  cases: CaseOutput[];
}

// ─── Per-case diff ────────────────────────────────────────────────────────────

export interface CaseDiff {
  id: string;
  branch_count_delta: number;        // new - old
  fact_count_delta: number;
  noise_count_delta: number;
  added_branch_titles: string[];     // titles in new but not old
  removed_branch_titles: string[];   // titles in old but not new
  added_fact_keys: string[];
  removed_fact_keys: string[];
  status: "improved" | "regressed" | "unchanged" | "new_case" | "removed_case";
}

export interface RunDiff {
  old_timestamp: string;
  new_timestamp: string;
  total_cases: number;
  new_cases: string[];
  removed_cases: string[];
  case_diffs: CaseDiff[];
  summary: {
    improved: number;
    regressed: number;
    unchanged: number;
    new_cases: number;
    removed_cases: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function symmetricDiff<T>(a: T[], b: T[]): { added: T[]; removed: T[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    added:   b.filter((x) => !setA.has(x)),
    removed: a.filter((x) => !setB.has(x)),
  };
}

function classifyStatus(d: Omit<CaseDiff, "status">): CaseDiff["status"] {
  const better =
    d.branch_count_delta !== 0 || d.fact_count_delta !== 0 || d.noise_count_delta !== 0;
  if (!better && d.added_branch_titles.length === 0 && d.removed_branch_titles.length === 0) {
    return "unchanged";
  }
  // Heuristic: more branches/facts = improved, fewer = regressed
  const score =
    d.branch_count_delta +
    d.fact_count_delta +
    d.added_branch_titles.length -
    d.removed_branch_titles.length;
  return score > 0 ? "improved" : score < 0 ? "regressed" : "unchanged";
}

// ─── Main diff function ───────────────────────────────────────────────────────

export function diffRuns(oldRun: RunSummary, newRun: RunSummary): RunDiff {
  const oldMap = new Map(oldRun.cases.map((c) => [c.id, c]));
  const newMap = new Map(newRun.cases.map((c) => [c.id, c]));

  const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);
  const newCaseIds: string[] = [];
  const removedCaseIds: string[] = [];
  const caseDiffs: CaseDiff[] = [];

  for (const id of allIds) {
    const oldCase = oldMap.get(id);
    const newCase = newMap.get(id);

    if (!oldCase && newCase) {
      newCaseIds.push(id);
      caseDiffs.push({
        id,
        branch_count_delta: newCase.branch_count,
        fact_count_delta: newCase.fact_count,
        noise_count_delta: newCase.noise_count,
        added_branch_titles: newCase.branches.map((b) => b.title),
        removed_branch_titles: [],
        added_fact_keys: newCase.facts.map((f) => f.key),
        removed_fact_keys: [],
        status: "new_case",
      });
      continue;
    }

    if (oldCase && !newCase) {
      removedCaseIds.push(id);
      caseDiffs.push({
        id,
        branch_count_delta: -oldCase.branch_count,
        fact_count_delta: -oldCase.fact_count,
        noise_count_delta: -oldCase.noise_count,
        added_branch_titles: [],
        removed_branch_titles: oldCase.branches.map((b) => b.title),
        added_fact_keys: [],
        removed_fact_keys: oldCase.facts.map((f) => f.key),
        status: "removed_case",
      });
      continue;
    }

    if (oldCase && newCase) {
      const branchTitles = symmetricDiff(
        oldCase.branches.map((b) => b.title),
        newCase.branches.map((b) => b.title)
      );
      const factKeys = symmetricDiff(
        oldCase.facts.map((f) => f.key),
        newCase.facts.map((f) => f.key)
      );

      const partial: Omit<CaseDiff, "status"> = {
        id,
        branch_count_delta: newCase.branch_count - oldCase.branch_count,
        fact_count_delta: newCase.fact_count - oldCase.fact_count,
        noise_count_delta: newCase.noise_count - oldCase.noise_count,
        added_branch_titles: branchTitles.added,
        removed_branch_titles: branchTitles.removed,
        added_fact_keys: factKeys.added,
        removed_fact_keys: factKeys.removed,
      };

      caseDiffs.push({ ...partial, status: classifyStatus(partial) });
    }
  }

  const summary = {
    improved:      caseDiffs.filter((d) => d.status === "improved").length,
    regressed:     caseDiffs.filter((d) => d.status === "regressed").length,
    unchanged:     caseDiffs.filter((d) => d.status === "unchanged").length,
    new_cases:     caseDiffs.filter((d) => d.status === "new_case").length,
    removed_cases: caseDiffs.filter((d) => d.status === "removed_case").length,
  };

  return {
    old_timestamp: oldRun.timestamp,
    new_timestamp: newRun.timestamp,
    total_cases: allIds.size,
    new_cases: newCaseIds,
    removed_cases: removedCaseIds,
    case_diffs: caseDiffs,
    summary,
  };
}
