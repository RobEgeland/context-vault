import { useState, useRef } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { NodesRepository } from "../lib/storage/NodesRepository";
import type { Node } from "../lib/storage/types";

// ─── Tauri context check ──────────────────────────────────────────────────────
// window.__TAURI_INTERNALS__ is injected by the Tauri WebView runtime.
// If this is false, you are viewing the app in a regular browser — Tauri IPC
// will not work. Always open the app via `pnpm tauri dev`, not a browser.
const IN_TAURI = isTauri();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADJECTIVES = ["Flaky", "Nested", "Async", "Legacy", "Critical", "Silent", "Cascading"];
const NOUNS      = ["auth bug", "race condition", "memory leak", "timeout error", "cache miss", "null deref"];

function randomTitle(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a} ${n}`;
}

interface LogLine {
  ts: string;
  text: string;
  kind: "info" | "ok" | "err" | "data";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StorageSandbox() {
  const [log, setLog]   = useState<LogLine[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  function push(text: string, kind: LogLine["kind"] = "info") {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    console.log(`[StorageSandbox ${ts}]`, text);
    setLog(prev => {
      const next = [...prev, { ts, text, kind }];
      // scroll to bottom on next paint
      setTimeout(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
      }, 0);
      return next;
    });
  }

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    push(`▶ ${label}`, "info");
    try {
      await fn();
    } catch (e) {
      push(`✕  ${String(e)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleCreate() {
    await run("Create test node", async () => {
      const node = await NodesRepository.createNode({
        parent_id: null,
        title: randomTitle(),
        type: "issue",
        summary: "Auto-generated test node for storage verification.",
        compressed_summary_modes: null,
        structured_facts: null,
        entities: null,
        tags: ["test", "sandbox"],
        confidence: null,
        source_chat_id: null,
        last_reused_at: null,
      });
      push(`✓ Created: ${node.id}`, "ok");
      push(`  title: "${node.title}"`, "data");
      push(`  created_at: ${node.created_at}`, "data");
    });
  }

  async function handleList() {
    await run("List all nodes", async () => {
      const all = await NodesRepository.listAllNodes();
      setNodes(all);
      push(`✓ Found ${all.length} node(s)`, "ok");
      for (const n of all) {
        push(`  [${n.type}] ${n.id.slice(0, 8)}… "${n.title}"`, "data");
      }
      console.table(all);
    });
  }

  async function handleReset() {
    await run("Reset DB", async () => {
      await NodesRepository.resetDb();
      setNodes([]);
      push("✓ Tables dropped + recreated. Vault dir cleared.", "ok");
    });
  }

  async function handleOpenVault() {
    await run("Open vault folder", async () => {
      const path = await NodesRepository.getVaultPath();
      await invoke("open_path", { path });
      push(`✓ Opened: ${path}`, "ok");
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const btnBase: React.CSSProperties = {
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid #2a2d3a",
    background: busy ? "#1a1d27" : "#2a2d3a",
    color: busy ? "#6b7280" : "#e2e8f0",
    cursor: busy ? "not-allowed" : "pointer",
    fontSize: 13,
    fontFamily: "inherit",
    transition: "background 0.15s",
  };

  return (
    <div style={{
      padding: 24,
      fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
      background: "#0f1117",
      color: "#e2e8f0",
      minHeight: "100vh",
      boxSizing: "border-box",
    }}>
      <h1 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>
        Context Vault — Storage Sandbox
      </h1>

      {/* Tauri context banner — must be green for IPC to work */}
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        borderRadius: 4,
        marginBottom: 14,
        fontSize: 12,
        background: IN_TAURI ? "#14532d" : "#7f1d1d",
        border: `1px solid ${IN_TAURI ? "#166534" : "#991b1b"}`,
        color: IN_TAURI ? "#86efac" : "#fca5a5",
      }}>
        {IN_TAURI
          ? "✓ Running inside Tauri WebView — IPC available"
          : "⚠ Running in a browser — Tauri IPC unavailable. Open via `pnpm tauri dev`, not a browser tab."}
      </div>

      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 20px" }}>
        Dev tool for verifying SQLite + Markdown mirror. Check the DevTools console for full objects.
      </p>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <button style={btnBase} disabled={busy} onClick={() => void handleCreate()}>
          Create test node
        </button>
        <button style={btnBase} disabled={busy} onClick={() => void handleList()}>
          List all nodes
        </button>
        <button style={{ ...btnBase, borderColor: "#7f1d1d", color: busy ? "#6b7280" : "#fca5a5" }}
          disabled={busy} onClick={() => void handleReset()}>
          Reset DB
        </button>
        <button style={{ ...btnBase, borderColor: "#1e3a5f", color: busy ? "#6b7280" : "#93c5fd" }}
          disabled={busy} onClick={() => void handleOpenVault()}>
          Open vault folder
        </button>
      </div>

      {/* Log output */}
      <div
        ref={logRef}
        style={{
          background: "#1a1d27",
          border: "1px solid #2a2d3a",
          borderRadius: 8,
          padding: 12,
          height: 300,
          overflowY: "auto",
          fontSize: 12,
          lineHeight: 1.6,
          marginBottom: 20,
        }}
      >
        {log.length === 0 && (
          <span style={{ color: "#6b7280" }}>Output will appear here…</span>
        )}
        {log.map((line, i) => {
          const color =
            line.kind === "err"  ? "#f87171" :
            line.kind === "ok"   ? "#4ade80" :
            line.kind === "data" ? "#94a3b8" : "#e2e8f0";
          return (
            <div key={i} style={{ color, whiteSpace: "pre" }}>
              <span style={{ color: "#4b5563", userSelect: "none" }}>{line.ts}  </span>
              {line.text}
            </div>
          );
        })}
      </div>

      {/* Node table (populated after "List all nodes") */}
      {nodes.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
            Last list result — {nodes.length} node(s):
          </p>
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            background: "#1a1d27",
            border: "1px solid #2a2d3a",
            borderRadius: 6,
            overflow: "hidden",
          }}>
            <thead>
              <tr style={{ background: "#0f1117", color: "#6b7280" }}>
                {["id (short)", "type", "title", "tags", "created_at"].map(h => (
                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #2a2d3a" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map((n, i) => (
                <tr key={n.id} style={{ background: i % 2 === 0 ? "#1a1d27" : "#161922" }}>
                  <td style={{ padding: "5px 10px", color: "#94a3b8" }}>{n.id.slice(0, 8)}…</td>
                  <td style={{ padding: "5px 10px" }}>{n.type}</td>
                  <td style={{ padding: "5px 10px" }}>{n.title}</td>
                  <td style={{ padding: "5px 10px", color: "#6366f1" }}>{(n.tags ?? []).join(", ")}</td>
                  <td style={{ padding: "5px 10px", color: "#6b7280" }}>
                    {new Date(n.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
