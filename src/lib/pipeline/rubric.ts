/**
 * Rubric loader for the ingest pipeline.
 *
 * In Tauri production builds the rubric is a bundled resource accessed via
 * resolveResource(). In dev mode (Vite server) or Node/CLI contexts we fall
 * back to reading the file directly from the project root via the Tauri fs
 * plugin or — when neither is available — via a fetch to the dev server.
 *
 * The loaded text is cached in module scope for the lifetime of the process.
 */

// ─── Cache ────────────────────────────────────────────────────────────────────

let _cache: string | null = null;

/** Clear the module-level cache (used by tests). */
export function clearRubricCache(): void {
  _cache = null;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load the branching rubric markdown.
 *
 * Resolution order:
 *  1. Module cache (fast path after first call).
 *  2. Tauri `resolveResource` + `readTextFile` (production bundle).
 *  3. `fetch("/BRANCHING_RUBRIC.md")` (Vite dev server, file served from /public).
 *  4. Hard-coded minimal stub (CI / unit-test environments with no file access).
 */
export async function loadRubric(): Promise<string> {
  if (_cache !== null) return _cache;

  // ── Attempt 1: Tauri bundled resource ──────────────────────────────────────
  try {
    // Dynamic imports so the module doesn't hard-crash in Node CLI contexts
    // where @tauri-apps/* packages are unavailable.
    const { resolveResource } = await import("@tauri-apps/api/path");
    const { readTextFile }    = await import("@tauri-apps/plugin-fs");
    const resourcePath = await resolveResource("BRANCHING_RUBRIC.md");
    _cache = await readTextFile(resourcePath);
    return _cache;
  } catch {
    // Not in a Tauri context, or resource not bundled yet — fall through.
  }

  // ── Attempt 2: Vite dev server public asset ────────────────────────────────
  try {
    if (typeof fetch !== "undefined") {
      const res = await fetch("/BRANCHING_RUBRIC.md");
      if (res.ok) {
        _cache = await res.text();
        return _cache;
      }
    }
  } catch {
    // fetch unavailable or server not running — fall through.
  }

  // ── Fallback: minimal stub so the pipeline can still run in dev ──────────────
  _cache = `# Branching Rubric (stub)
Classify conversation turns into branches (multi-turn topics), notable_facts (single Q+A), or noise.
`;
  return _cache;
}
