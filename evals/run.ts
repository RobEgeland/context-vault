#!/usr/bin/env tsx
/**
 * Eval harness CLI — runs all golden fixtures through the ingest pipeline
 * and produces a structured report.
 *
 * Usage:
 *   pnpm eval                        # run all golden cases
 *   pnpm eval --filter cors          # run cases whose id contains "cors"
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm eval
 *
 * Output:
 *   evals/runs/<timestamp>/          # one directory per run
 *     summary.json                   # RunSummary (consumed by diff_runs.ts)
 *     report.md                      # human-readable report
 *     <id>.output.json               # raw pipeline output per case
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// ─── Paths ────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const GOLDEN_DIR   = path.join(__dirname, "golden");
const RUNS_DIR     = path.join(__dirname, "runs");

// ─── API key resolution ───────────────────────────────────────────────────────

async function resolveApiKey(): Promise<string> {
  // 1. Environment variable (CI / local override)
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

  // 2. App settings.json (same path the app uses in dev mode)
  try {
    const os = await import("node:os");
    const settingsPath = path.join(
      os.default.homedir(),
      "AppData",
      "Local",
      "com.contextVault.app",
      "settings.json"
    );
    const raw = JSON.parse(await fs.readFile(settingsPath, "utf8")) as Record<string, string>;
    if (raw.anthropicApiKey) return raw.anthropicApiKey;
  } catch {
    // settings.json not found or malformed — fall through
  }

  throw new Error(
    "No Anthropic API key found.\n" +
    "Set ANTHROPIC_API_KEY env var, or add a key via the app Settings."
  );
}

// ─── Golden fixture schema ────────────────────────────────────────────────────

interface GoldenExpectedBranch {
  title_contains?: string;
  type?: string;
  min_span_count?: number;
  required_tags?: string[];
  required_entities_any?: string[];
}

interface GoldenExpectedFact {
  key_contains?: string;
  span_index?: number;
  required_tags_any?: string[];
}

interface GoldenSuccess {
  min_branch_count?: number;
  max_branch_count?: number;
  min_fact_count?: number;
  all_turns_covered?: boolean;
  no_single_turn_branches?: boolean;
}

interface GoldenFixture {
  id: string;
  project_name: string;
  transcript_file: string;
  expected: {
    branches?: GoldenExpectedBranch[];
    notable_facts?: GoldenExpectedFact[];
    noise_span_indices?: number[];
    success?: GoldenSuccess;
  };
}

// ─── Pipeline output types (mirrors ingest.ts but no Tauri deps) ─────────────

interface Branch {
  title: string;
  type: string;
  summary: string;
  tags: string[];
  entities: string[];
  span_indices: number[];
}

interface NotableFact {
  key: string;
  value: string;
  span_index: number;
  tags: string[];
}

interface PipelineOutput {
  branches: Branch[];
  notable_facts: NotableFact[];
  noise_span_indices: number[];
}

// ─── Run ingest directly via Anthropic SDK (no Tauri) ────────────────────────

async function runPipelineCLI(opts: {
  transcript: string;
  projectName: string;
  apiKey: string;
  rubric: string;
}): Promise<PipelineOutput> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");

  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 60_000 });

  const systemPrompt = `You analyze AI conversation transcripts and extract structured knowledge using the three-tier classification defined in the rubric below.\n\n<rubric>\n${opts.rubric.trim()}\n</rubric>\n\nUse the extract_knowledge tool to return your output. Follow the rubric exactly.`;

  // Parse transcript
  const lines = opts.transcript.split("\n");
  const spans: { role: string; content: string; ordinal: number }[] = [];
  let current: { role: string; lines: string[] } | null = null;
  function flush() {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    if (content) spans.push({ role: current.role, content, ordinal: spans.length });
    current = null;
  }
  for (const line of lines) {
    const lower = line.trimStart().toLowerCase();
    if (lower.startsWith("user:")) {
      flush(); current = { role: "user", lines: [line.trimStart().slice(5).trim()] };
    } else if (lower.startsWith("assistant:")) {
      flush(); current = { role: "assistant", lines: [line.trimStart().slice(10).trim()] };
    } else if (current) { current.lines.push(line); }
  }
  flush();

  if (spans.length === 0) throw new Error("No turns found in transcript.");

  const turnLines = spans
    .map((s) => `  Turn ${s.ordinal} — ${s.role}: "${s.content.slice(0, 400)}${s.content.length > 400 ? "…" : ""}"`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: systemPrompt,
    tools: [
      {
        name: "extract_knowledge",
        description: "Extract branches, notable facts, and noise spans.",
        input_schema: {
          type: "object" as const,
          properties: {
            branches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  type: { type: "string", enum: ["issue","subsystem","decision","fix_attempt","hypothesis","open_question","fact"] },
                  summary: { type: "string" },
                  tags: { type: "array", items: { type: "string" } },
                  entities: { type: "array", items: { type: "string" } },
                  span_indices: { type: "array", items: { type: "integer", minimum: 0 } },
                },
                required: ["title","type","summary","tags","entities","span_indices"],
              },
            },
            notable_facts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  value: { type: "string" },
                  span_index: { type: "integer", minimum: 0 },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["key","value","span_index","tags"],
              },
            },
            noise_span_indices: { type: "array", items: { type: "integer", minimum: 0 } },
          },
          required: ["branches","notable_facts","noise_span_indices"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "extract_knowledge" },
    messages: [{ role: "user", content: `Analyze this transcript (${spans.length} turns).\n\nProject: ${opts.projectName}\n\nTranscript:\n${turnLines}` }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("No tool_use block in response.");
  return toolUse.input as PipelineOutput;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface CheckResult {
  label: string;
  passed: boolean;
  detail?: string;
}

function scoreOutput(fixture: GoldenFixture, output: PipelineOutput, totalTurns: number): CheckResult[] {
  const results: CheckResult[] = [];
  const { expected } = fixture;

  // Coverage check
  if (expected.success?.all_turns_covered) {
    const coveredTurns = new Set<number>([
      ...output.branches.flatMap((b) => b.span_indices),
      ...output.notable_facts.map((f) => f.span_index),
      ...output.noise_span_indices,
    ]);
    const uncovered = Array.from({ length: totalTurns }, (_, i) => i).filter((i) => !coveredTurns.has(i));
    results.push({
      label: "Coverage: all turns covered",
      passed: uncovered.length === 0,
      detail: uncovered.length ? `Uncovered turns: ${uncovered.join(", ")}` : undefined,
    });
  }

  // Branch count
  if (expected.success?.min_branch_count !== undefined) {
    results.push({
      label: `Branch count ≥ ${expected.success.min_branch_count}`,
      passed: output.branches.length >= expected.success.min_branch_count,
      detail: `Got ${output.branches.length}`,
    });
  }
  if (expected.success?.max_branch_count !== undefined) {
    results.push({
      label: `Branch count ≤ ${expected.success.max_branch_count}`,
      passed: output.branches.length <= expected.success.max_branch_count,
      detail: `Got ${output.branches.length}`,
    });
  }

  // No single-turn branches
  if (expected.success?.no_single_turn_branches) {
    const singleTurn = output.branches.filter((b) => b.span_indices.length < 2);
    results.push({
      label: "No single-turn branches",
      passed: singleTurn.length === 0,
      detail: singleTurn.length ? `Single-turn branches: ${singleTurn.map((b) => b.title).join(", ")}` : undefined,
    });
  }

  // Notable fact count
  if (expected.success?.min_fact_count !== undefined) {
    results.push({
      label: `Fact count ≥ ${expected.success.min_fact_count}`,
      passed: output.notable_facts.length >= expected.success.min_fact_count,
      detail: `Got ${output.notable_facts.length}`,
    });
  }

  // Noise span check
  if (expected.noise_span_indices !== undefined) {
    const expectedNoise = new Set(expected.noise_span_indices);
    const gotNoise = new Set(output.noise_span_indices);
    const missing = [...expectedNoise].filter((i) => !gotNoise.has(i));
    results.push({
      label: "Noise spans correct",
      passed: missing.length === 0,
      detail: missing.length ? `Missing noise turns: ${missing.join(", ")}` : undefined,
    });
  }

  // Per-branch checks
  for (const eb of expected.branches ?? []) {
    const matches = output.branches.filter((b) =>
      !eb.title_contains || b.title.toLowerCase().includes(eb.title_contains.toLowerCase())
    );
    const label = `Branch matching "${eb.title_contains ?? "*"}" exists`;
    if (matches.length === 0) {
      results.push({ label, passed: false, detail: "No matching branch found" });
      continue;
    }
    results.push({ label, passed: true });

    const b = matches[0];
    if (eb.type) {
      results.push({ label: `  type = ${eb.type}`, passed: b.type === eb.type, detail: `Got: ${b.type}` });
    }
    if (eb.min_span_count !== undefined) {
      results.push({ label: `  span_count ≥ ${eb.min_span_count}`, passed: b.span_indices.length >= eb.min_span_count, detail: `Got: ${b.span_indices.length}` });
    }
    if (eb.required_tags) {
      for (const tag of eb.required_tags) {
        results.push({ label: `  has tag "${tag}"`, passed: b.tags.includes(tag) });
      }
    }
    if (eb.required_entities_any) {
      const hasAny = eb.required_entities_any.some((e) => b.entities.some((be) => be.toLowerCase().includes(e.toLowerCase())));
      results.push({ label: `  has entity (any of ${eb.required_entities_any.join("|")})`, passed: hasAny, detail: `Entities: ${b.entities.join(", ")}` });
    }
  }

  // Per-fact checks
  for (const ef of expected.notable_facts ?? []) {
    const matches = output.notable_facts.filter((f) =>
      !ef.key_contains || f.key.toLowerCase().includes(ef.key_contains.toLowerCase())
    );
    const label = `Notable fact matching key "${ef.key_contains ?? "*"}" exists`;
    if (matches.length === 0) {
      results.push({ label, passed: false, detail: "No matching fact found" });
      continue;
    }
    results.push({ label, passed: true });

    const f = matches[0];
    if (ef.span_index !== undefined) {
      results.push({ label: `  span_index = ${ef.span_index}`, passed: f.span_index === ef.span_index, detail: `Got: ${f.span_index}` });
    }
    if (ef.required_tags_any) {
      const hasAny = ef.required_tags_any.some((t) => f.tags.includes(t));
      results.push({ label: `  has tag (any of ${ef.required_tags_any.join("|")})`, passed: hasAny, detail: `Tags: ${f.tags.join(", ")}` });
    }
  }

  return results;
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(results: Array<{
  id: string;
  output: PipelineOutput | null;
  checks: CheckResult[];
  error?: string;
  totalTurns: number;
}>, timestamp: string): string {
  const lines: string[] = [
    `# Eval Run Report`,
    `**Timestamp:** ${timestamp}`,
    `**Cases:** ${results.length}`,
    "",
  ];

  let totalChecks = 0;
  let passedChecks = 0;

  for (const r of results) {
    const icon = r.error ? "❌" : r.checks.every((c) => c.passed) ? "✅" : "⚠️";
    lines.push(`## ${icon} Case: \`${r.id}\``);

    if (r.error) {
      lines.push(`**Error:** ${r.error}`);
      lines.push("");
      continue;
    }

    const o = r.output!;
    lines.push(`- **Branches:** ${o.branches.length}`);
    lines.push(`- **Notable facts:** ${o.notable_facts.length}`);
    lines.push(`- **Noise turns:** ${o.noise_span_indices.length}`);
    lines.push(`- **Total transcript turns:** ${r.totalTurns}`);
    lines.push("");

    // Coverage section
    const coveredTurns = new Set([
      ...o.branches.flatMap((b) => b.span_indices),
      ...o.notable_facts.map((f) => f.span_index),
      ...o.noise_span_indices,
    ]);
    const coverage = r.totalTurns > 0 ? Math.round((coveredTurns.size / r.totalTurns) * 100) : 0;
    lines.push(`### Coverage`);
    lines.push(`${coverage}% of turns attributed (${coveredTurns.size}/${r.totalTurns})`);
    lines.push("");

    // Branches section
    lines.push("### Branches");
    if (o.branches.length === 0) {
      lines.push("_No branches extracted._");
    } else {
      for (const b of o.branches) {
        lines.push(`- **[${b.type}]** ${b.title} _(spans: ${b.span_indices.join(", ")})_`);
        lines.push(`  Tags: ${b.tags.join(", ") || "—"}`);
      }
    }
    lines.push("");

    // Notable facts section
    lines.push("### Notable Facts");
    if (o.notable_facts.length === 0) {
      lines.push("_No notable facts extracted._");
    } else {
      for (const f of o.notable_facts) {
        lines.push(`- \`${f.key}\` _(turn ${f.span_index})_: ${f.value}`);
        lines.push(`  Tags: ${f.tags.join(", ") || "—"}`);
      }
    }
    lines.push("");

    // Noise section
    lines.push("### Noise");
    lines.push(o.noise_span_indices.length > 0 ? `Turns: ${o.noise_span_indices.join(", ")}` : "_No noise turns._");
    lines.push("");

    // Success criteria
    lines.push("### Success Criteria");
    for (const check of r.checks) {
      totalChecks++;
      if (check.passed) passedChecks++;
      const mark = check.passed ? "✅" : "❌";
      const detail = check.detail ? ` — ${check.detail}` : "";
      lines.push(`${mark} ${check.label}${detail}`);
    }
    lines.push("");
  }

  // Summary
  const successRate = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
  lines.unshift(
    `**Checks passed:** ${passedChecks}/${totalChecks} (${successRate}%)`,
    "",
  );
  lines.unshift(`---`);

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const filter = process.argv.includes("--filter")
    ? process.argv[process.argv.indexOf("--filter") + 1]
    : null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(RUNS_DIR, timestamp);
  await fs.mkdir(runDir, { recursive: true });

  // Load API key + rubric
  const [apiKey, rubric] = await Promise.all([
    resolveApiKey(),
    fs.readFile(path.join(__dirname, "BRANCHING_RUBRIC.md"), "utf8"),
  ]);

  // Discover golden fixtures
  const goldenFiles = (await fs.readdir(GOLDEN_DIR))
    .filter((f) => f.endsWith(".yaml"))
    .filter((f) => !filter || f.includes(filter));

  if (goldenFiles.length === 0) {
    console.error("No golden fixtures found" + (filter ? ` matching "${filter}"` : "") + ".");
    process.exit(1);
  }

  console.log(`Running ${goldenFiles.length} eval case(s)…\n`);

  const caseResults: Parameters<typeof buildReport>[0] = [];
  const summaryCases: import("./diff").RunSummary["cases"] = [];

  for (const goldenFile of goldenFiles) {
    const fixture = yaml.load(
      await fs.readFile(path.join(GOLDEN_DIR, goldenFile), "utf8")
    ) as GoldenFixture;

    if (filter && !fixture.id.includes(filter)) continue;

    const transcriptPath = path.join(GOLDEN_DIR, fixture.transcript_file);
    const transcript = await fs.readFile(transcriptPath, "utf8");

    // Count total turns for coverage calculation
    const totalTurns = (transcript.match(/^(user|assistant)\s*:/gim) ?? []).length;

    process.stdout.write(`  [${fixture.id}] running… `);

    let output: PipelineOutput | null = null;
    let errorMsg: string | undefined;

    try {
      output = await runPipelineCLI({
        transcript,
        projectName: fixture.project_name,
        apiKey,
        rubric,
      });

      // Save raw output
      await fs.writeFile(
        path.join(runDir, `${fixture.id}.output.json`),
        JSON.stringify(output, null, 2)
      );

      const checks = scoreOutput(fixture, output, totalTurns);
      const passed = checks.filter((c) => c.passed).length;
      console.log(`${passed}/${checks.length} checks passed`);

      caseResults.push({ id: fixture.id, output, checks, totalTurns });
      summaryCases.push({
        id: fixture.id,
        branch_count: output.branches.length,
        fact_count: output.notable_facts.length,
        noise_count: output.noise_span_indices.length,
        branches: output.branches.map((b) => ({
          title: b.title, type: b.type, span_count: b.span_indices.length, tags: b.tags,
        })),
        facts: output.notable_facts.map((f) => ({ key: f.key, span_index: f.span_index, tags: f.tags })),
        noise_span_indices: output.noise_span_indices,
      });
    } catch (err: unknown) {
      errorMsg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${errorMsg}`);
      caseResults.push({ id: fixture.id, output: null, checks: [], error: errorMsg, totalTurns });
      summaryCases.push({
        id: fixture.id,
        branch_count: 0,
        fact_count: 0,
        noise_count: 0,
        branches: [],
        facts: [],
        noise_span_indices: [],
        error: errorMsg,
      });
    }
  }

  // Write summary.json
  const summary: import("./diff").RunSummary = { timestamp, cases: summaryCases };
  await fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));

  // Write report.md
  const report = buildReport(caseResults, timestamp);
  const reportPath = path.join(runDir, "report.md");
  await fs.writeFile(reportPath, report);

  console.log(`\nReport: ${reportPath}`);
  console.log(`Summary: ${path.join(runDir, "summary.json")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
