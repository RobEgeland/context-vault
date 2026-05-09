import { useState, useEffect } from "react";
import { Toaster } from "react-hot-toast";
import { Trash2, Upload } from "lucide-react";
import { NodeTree } from "./components/vault/NodeTree";
import { NodeDetail } from "./components/vault/NodeDetail";
import { ConfirmModal } from "./components/vault/ConfirmModal";
import { SettingsModal } from "./components/vault/SettingsModal";
import { IngestModal } from "./components/vault/IngestModal";
import { NodesRepository } from "./lib/storage/NodesRepository";
import { useUIStore } from "./lib/state/uiStore";

// ─── Toolbar icon button ──────────────────────────────────────────────────────

function IconBtn({
  icon,
  label,
  onClick,
  disabled,
  danger,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`flex items-center gap-1 btn-ghost text-xs py-1 transition-colors
        ${disabled ? "opacity-30 cursor-not-allowed" : ""}
        ${danger && !disabled ? "text-red-400 hover:text-red-300" : ""}
      `}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { selectedNodeId, setSelectedNodeId, bumpRefresh, bumpSearchFocus } = useUIStore();

  const [showDelete, setShowDelete]   = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showIngest, setShowIngest]   = useState(false);

  // ── Global Cmd/Ctrl+K → focus search bar ──────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        bumpSearchFocus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bumpSearchFocus]);

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!selectedNodeId) return;
    await NodesRepository.deleteNode(selectedNodeId);
    setSelectedNodeId(null);
    bumpRefresh();
    setShowDelete(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Toast container — positioned top-right, dark theme */}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#1a1d27",
            color: "#e2e8f0",
            border: "1px solid #2a2d3a",
            fontSize: 13,
          },
          success: { iconTheme: { primary: "#4ade80", secondary: "#1a1d27" } },
          error:   { iconTheme: { primary: "#f87171", secondary: "#1a1d27" } },
        }}
      />

      <div className="flex flex-col h-screen bg-vault-bg text-vault-text">

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <header className="shrink-0 flex items-center justify-between px-4 h-10 border-b border-vault-border bg-vault-surface">
          <span className="text-sm font-semibold tracking-tight">Context Vault</span>

          <div className="flex items-center gap-1">
            {/* Ingest button */}
            <button
              className="flex items-center gap-1.5 btn-ghost text-xs text-vault-accent hover:text-vault-accent-hover"
              onClick={() => setShowIngest(true)}
              title="Ingest a conversation transcript"
            >
              <Upload size={13} />
              Ingest
            </button>

            {/* Settings gear */}
            <button
              className="btn-ghost text-xs text-vault-muted px-2"
              onClick={() => setShowSettings(true)}
              title="Settings"
            >
              ⚙
            </button>
          </div>
        </header>

        {/* ── Two-pane body ────────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Left pane — tree ────────────────────────────────────────────── */}
          <aside
            className="flex flex-col shrink-0 border-r border-vault-border bg-vault-bg"
            style={{ width: "30%", minWidth: 200, maxWidth: 400 }}
          >
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-vault-border shrink-0">
              <IconBtn
                icon={<Trash2 size={13} />}
                label="Delete"
                onClick={() => setShowDelete(true)}
                disabled={!selectedNodeId}
                danger
                title="Delete selected node"
              />
            </div>

            <NodeTree />
          </aside>

          {/* ── Right pane — detail editor ──────────────────────────────────── */}
          <main className="flex flex-1 overflow-hidden">
            <NodeDetail />
          </main>
        </div>

        {/* ── Modals ──────────────────────────────────────────────────────────── */}
        {showDelete && selectedNodeId && (
          <ConfirmModal
            title="Delete node?"
            body="This will permanently delete the node and all its message spans. Child nodes will become orphaned at root level."
            confirmLabel="Delete node"
            onConfirm={() => void handleDelete()}
            onCancel={() => setShowDelete(false)}
          />
        )}

        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} />
        )}

        {showIngest && (
          <IngestModal
            onClose={() => setShowIngest(false)}
            onOpenSettings={() => { setShowIngest(false); setShowSettings(true); }}
          />
        )}
      </div>
    </>
  );
}
