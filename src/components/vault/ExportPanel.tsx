/**
 * "Export for reuse" panel — the payoff feature.
 *
 * Three buttons generate a compressed context blob for the selected node,
 * copy it to the clipboard, and toast a preview. Results are cached in
 * node.compressed_summary_modes so repeat clicks are instant.
 *
 * Right-click any button → "Regenerate" forces a fresh API call.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Copy, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { compressNode } from "../../lib/pipeline/compress";
import type { CompressMode } from "../../lib/pipeline/compress";
import { SettingsRepository } from "../../lib/storage/SettingsRepository";
import { NodesRepository } from "../../lib/storage/NodesRepository";
import type { Node } from "../../lib/storage/types";

// ─── Mode definitions ─────────────────────────────────────────────────────────

interface ModeConfig {
  id:    CompressMode;
  label: string;
  title: string;
}

const MODES: ModeConfig[] = [
  {
    id:    "short",
    label: "Short",
    title: "≤ 80 tokens — headline + 1–2 sentences, plain prose",
  },
  {
    id:    "technical",
    label: "Technical",
    title: "≤ 300 tokens — Problem / Environment / Known / Open questions",
  },
  {
    id:    "evidence_backed",
    label: "Evidence-backed",
    title: "≤ 800 tokens — Technical sections + verbatim quotes",
  },
];

const MODE_LABEL: Record<CompressMode, string> = {
  short:           "short",
  technical:       "technical",
  evidence_backed: "evidence-backed",
};

// ─── Clipboard helper ─────────────────────────────────────────────────────────

function buildClipboardPayload(node: Node, mode: CompressMode, body: string): string {
  return [
    `[Context Vault — ${node.title} (${node.type}) — mode: ${MODE_LABEL[mode]}]`,
    "",
    body,
    "",
    `[Source chat: ${node.source_chat_id ?? "—"}; node: ${node.id}]`,
  ].join("\n");
}

// ─── Context menu state ───────────────────────────────────────────────────────

interface ContextMenuState {
  mode: CompressMode;
  x:    number;
  y:    number;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  node:           Node;
  onNodeUpdated:  (updated: Node) => void;
}

export function ExportPanel({ node, onNodeUpdated }: Props) {
  const [busy,        setBusy]        = useState<CompressMode | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu when clicking outside it
  const closeMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [contextMenu]);

  // Close on Escape
  useEffect(() => {
    if (!contextMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [contextMenu]);

  async function handleExport(mode: CompressMode, force = false) {
    closeMenu();

    const settings = await SettingsRepository.load();
    if (!settings.anthropicApiKey.trim()) {
      toast.error("No API key — add one in Settings.", { icon: "⚙️", duration: 5000 });
      return;
    }

    setBusy(mode);
    try {
      const compressed = await compressNode(node.id, mode, {
        apiKey:    settings.anthropicApiKey,
        force,
        timeoutMs: 30_000,
      });

      // Write to clipboard
      const payload = buildClipboardPayload(node, mode, compressed);
      await navigator.clipboard.writeText(payload);

      // Toast a short preview (first ~90 chars of the body, single line)
      const preview = compressed.replace(/\n+/g, " ").slice(0, 90);
      toast.success(
        `Copied · ${preview}${compressed.length > 90 ? "…" : ""}`,
        { duration: 4500 }
      );

      // Refresh local node so dot indicators + last_reused_at update
      const refreshed = await NodesRepository.getNode(node.id);
      if (refreshed) onNodeUpdated(refreshed);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err), { duration: 6000 });
    } finally {
      setBusy(null);
    }
  }

  function handleContextMenu(e: React.MouseEvent, mode: CompressMode) {
    e.preventDefault();
    // Clamp so menu stays inside viewport
    const menuW = 160;
    const menuH = 48;
    setContextMenu({
      mode,
      x: Math.min(e.clientX, window.innerWidth  - menuW - 8),
      y: Math.min(e.clientY, window.innerHeight - menuH - 8),
    });
  }

  const cache = node.compressed_summary_modes ?? {};
  const isAnyBusy = busy !== null;

  return (
    <div className="flex flex-col gap-2">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-vault-muted uppercase tracking-wider">
          Export for reuse
        </label>
        {node.last_reused_at && (
          <span className="text-[11px] text-vault-muted italic">
            Last reused {formatDistanceToNow(node.last_reused_at, { addSuffix: true })}
          </span>
        )}
      </div>

      {/* Mode buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {MODES.map(({ id, label, title }) => {
          const isBusy    = busy === id;
          const isCached  = !!cache[id];

          return (
            <button
              key={id}
              title={title}
              disabled={isAnyBusy}
              onClick={() => void handleExport(id)}
              onContextMenu={(e) => handleContextMenu(e, id)}
              className={[
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md",
                "border text-xs font-medium transition-colors select-none",
                isAnyBusy
                  ? "opacity-40 cursor-not-allowed border-vault-border text-vault-muted"
                  : "border-vault-border text-vault-text-dim",
                !isAnyBusy && isCached
                  ? "hover:border-vault-accent hover:text-vault-accent"
                  : !isAnyBusy
                  ? "hover:border-vault-accent/60 hover:text-vault-text"
                  : "",
              ].join(" ")}
            >
              {/* Icon */}
              {isBusy
                ? <Loader2 size={11} className="animate-spin shrink-0" />
                : <Copy size={11} className="shrink-0" />
              }

              {label}

              {/* Cached indicator dot */}
              {isCached && !isBusy && (
                <span
                  className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-vault-accent shadow-sm"
                  title="Cached — click to copy, right-click to regenerate"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Right-click context menu (portal-free, fixed position) */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top:      contextMenu.y,
            left:     contextMenu.x,
            zIndex:   9999,
          }}
          className="bg-vault-surface border border-vault-border rounded-md shadow-2xl py-1 min-w-[152px]"
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-vault-text hover:bg-white/5 transition-colors"
            onClick={() => void handleExport(contextMenu.mode, true)}
          >
            <RefreshCw size={11} className="text-vault-muted" />
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}
