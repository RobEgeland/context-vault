import { NodesRepository } from "../storage/NodesRepository";

/**
 * Seeds the DB with a small realistic tree for development.
 * Safe to call multiple times — each call creates a fresh tree
 * (it does NOT clear existing data; use Reset DB for that first).
 */
export async function seedDevData(): Promise<void> {
  // 1 root node
  const root = await NodesRepository.createNode({
    parent_id: null,
    title: "Context Vault v0.1 — Dev Seed",
    type: "root",
    summary: "Top-level project node seeded for local development testing.",
    compressed_summary_modes: null,
    structured_facts: null,
    entities: null,
    tags: ["dev", "seed"],
    confidence: null,
    source_chat_id: null,
    last_reused_at: null,
  });

  // Child 1 — issue
  const issue = await NodesRepository.createNode({
    parent_id: root.id,
    title: "Tauri IPC not available in browser",
    type: "issue",
    summary:
      "window.__TAURI_INTERNALS__ is undefined when opening the app in a browser tab " +
      "instead of via `pnpm tauri dev`. The fix is to always use the Tauri WebView.",
    compressed_summary_modes: null,
    structured_facts: null,
    entities: ["window.__TAURI_INTERNALS__", "isTauri()"],
    tags: ["tauri", "ipc", "bug"],
    confidence: 1,
    source_chat_id: "chat-seed-001",
    last_reused_at: null,
  });

  // Child 2 — decision
  const decision = await NodesRepository.createNode({
    parent_id: root.id,
    title: "Use custom open_path Rust command instead of shell:open",
    type: "decision",
    summary:
      "The shell plugin's open() only accepts mailto/tel/http/https URLs. " +
      "Opening a filesystem path requires a custom #[tauri::command] that " +
      "shells out to explorer / open / xdg-open directly.",
    compressed_summary_modes: null,
    structured_facts: null,
    entities: ["shell:allow-open", "open_path", "explorer.exe"],
    tags: ["tauri", "shell", "architecture"],
    confidence: 1,
    source_chat_id: "chat-seed-001",
    last_reused_at: null,
  });

  // Spans for issue
  await NodesRepository.appendMessageSpans(issue.id, [
    {
      source_chat_id: "chat-seed-001",
      role: "user",
      content: "When I click any button I get: TypeError: Cannot read properties of undefined (reading 'invoke')",
      timestamp: Date.now() - 3_600_000,
      ordinal: 0,
    },
    {
      source_chat_id: "chat-seed-001",
      role: "assistant",
      content:
        "The error means window.__TAURI_INTERNALS__ is undefined — you're viewing the app " +
        "in a regular browser tab, not the Tauri WebView. Open it with `pnpm tauri dev` instead.",
      timestamp: Date.now() - 3_590_000,
      ordinal: 1,
    },
  ]);

  // Spans for decision
  await NodesRepository.appendMessageSpans(decision.id, [
    {
      source_chat_id: "chat-seed-001",
      role: "user",
      content: "I get: Scoped command argument at position 0 was found, but failed regex validation ^((mailto:\\w+)|(tel:\\w+)|(https?://\\w+)).+",
      timestamp: Date.now() - 1_800_000,
      ordinal: 0,
    },
    {
      source_chat_id: "chat-seed-001",
      role: "assistant",
      content:
        "shell:allow-open only permits URLs matching that regex, not filesystem paths. " +
        "The fix: add a custom Rust command `open_path` that runs explorer/open/xdg-open directly, " +
        "then call invoke('open_path', { path }) from the frontend.",
      timestamp: Date.now() - 1_790_000,
      ordinal: 1,
    },
  ]);
}
