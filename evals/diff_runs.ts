#!/usr/bin/env tsx
/**
 * Compare two eval run outputs by timestamp.
 *
 * Usage:
 *   pnpm eval:diff                              # compare latest two runs
 *   pnpm eval:diff 2026-05-06T12-00-00 2026-05-07T09-30-00
 *   pnpm eval:diff --list                       # list available run timestamps
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffRuns } from "./diff";
import type { RunSummary, RunDiff } from "./diff";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR   = path.join(__dirname, "runs");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function listRuns(): Promise<string[]> {
  try {
    const entries = await fs.readdir(RUNS_DIR);
    // Filter to directories that contain summary.json
    const valid: string[] = [];
    for (const entry of entries) {
      try {
        await fs.access(path.join(RUNS_DIR, entry, "summary.json"));
        valid.push(entry);
      } catch {
        // no summary.json — skip
      }
    }
    return valid.sort();
  } catch {
    return [];
  }
}

async function loadSummary(timestamp: string): Promise<RunSummary> {
  const summaryPath = path.join(RUNS_DIR, timestamp, "summary.json");
  const raw = await fs.readFile(summaryPath, "utf8");
  return JSON.parse(raw) as RunSummary;
}

function formatDiff(diff: RunDiff): string {
  const lines: string[] = [
    `# Eval Diff Report`,
    `**Old run:** ${diff.old_timestamp}`,
    `**New run:** ${diff.new_timestamp}`,
    `**Total cases:** ${diff.total_cases}`,
    "",
    `## Summary`,
    `- ✅ Improved: ${diff.summary.improved}`,
    `- ❌ Regressed: ${diff.summary.regressed}`,
    `- ➖ Unchanged: ${diff.summary.unchanged}`,
    `- 🆕 New cases: ${diff.summary.new_cases}`,
    `- 🗑️  Removed cases: ${diff.summary.removed_cases}`,
    "",
  ];

  if (diff.new_cases.length > 0) {
    lines.push(`### New cases`);
    for (const id of diff.new_cases) lines.push(`- \`${id}\``);
    lines.push("");
  }

  if (diff.removed_cases.length > 0) {
    lines.push(`### Removed cases`);
    for (const id of diff.removed_cases) lines.push(`- \`${id}\``);
    lines.push("");
  }

  // Changed cases only
  const changed = diff.case_diffs.filter(
    (d) => d.status !== "unchanged" && d.status !== "new_case" && d.status !== "removed_case"
  );

  if (changed.length > 0) {
    lines.push(`## Changed cases`);
    for (const d of changed) {
      const icon = d.status === "improved" ? "✅" : "❌";
      lines.push(`### ${icon} \`${d.id}\` — ${d.status}`);

      if (d.branch_count_delta !== 0) {
        lines.push(`- Branches: ${d.branch_count_delta > 0 ? "+" : ""}${d.branch_count_delta}`);
      }
      if (d.fact_count_delta !== 0) {
        lines.push(`- Facts: ${d.fact_count_delta > 0 ? "+" : ""}${d.fact_count_delta}`);
      }
      if (d.added_branch_titles.length > 0) {
        lines.push(`- Added branches: ${d.added_branch_titles.map((t) => `"${t}"`).join(", ")}`);
      }
      if (d.removed_branch_titles.length > 0) {
        lines.push(`- Removed branches: ${d.removed_branch_titles.map((t) => `"${t}"`).join(", ")}`);
      }
      if (d.added_fact_keys.length > 0) {
        lines.push(`- Added facts: ${d.added_fact_keys.join(", ")}`);
      }
      if (d.removed_fact_keys.length > 0) {
        lines.push(`- Removed facts: ${d.removed_fact_keys.join(", ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // --list mode
  if (args.includes("--list")) {
    const runs = await listRuns();
    if (runs.length === 0) {
      console.log("No runs found. Run `pnpm eval` first.");
    } else {
      console.log(`Available runs (${runs.length}):\n`);
      for (const r of runs) console.log(`  ${r}`);
    }
    return;
  }

  // Resolve timestamps
  const runs = await listRuns();
  if (runs.length < 2) {
    console.error("Need at least 2 runs to diff. Run `pnpm eval` twice.");
    process.exit(1);
  }

  let oldTs: string;
  let newTs: string;

  if (args.length >= 2) {
    [oldTs, newTs] = args;
  } else {
    // Default: latest two
    oldTs = runs[runs.length - 2];
    newTs = runs[runs.length - 1];
  }

  console.log(`Comparing:\n  old: ${oldTs}\n  new: ${newTs}\n`);

  const [oldSummary, newSummary] = await Promise.all([
    loadSummary(oldTs),
    loadSummary(newTs),
  ]);

  const diff = diffRuns(oldSummary, newSummary);
  const report = formatDiff(diff);

  // Print to console
  console.log(report);

  // Save diff report next to the new run's directory
  const diffPath = path.join(RUNS_DIR, newTs, "diff.md");
  await fs.writeFile(diffPath, report);
  console.log(`\nDiff saved: ${diffPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
