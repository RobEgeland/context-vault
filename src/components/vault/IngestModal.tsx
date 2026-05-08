import { useState } from "react";
import { X, Upload, Loader2, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { runIngest } from "../../lib/pipeline/ingest";
import { SettingsRepository } from "../../lib/storage/SettingsRepository";
import { useUIStore } from "../../lib/state/uiStore";

// ─── localStorage helper (mirrors NodeTree's expand state) ───────────────────

function markNodeExpanded(id: string) {
  try {
    const key = "vault.tree.expanded";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, boolean>;
    state[id] = true;
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // non-fatal
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onOpenSettings: () => void;
}

export function IngestModal({ onClose, onOpenSettings }: Props) {
  const [projectName, setProjectName] = useState("");
  const [sourceChatId, setSourceChatId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>("");

  const { setSelectedNodeId, bumpRefresh } = useUIStore();

  // Quick sanity check: does the transcript look parseable?
  const hasTurns = /^\s*(user|assistant)\s*:/im.test(transcript);

  async function handleIngest() {
    // 1. Load settings and check API key
    const settings = await SettingsRepository.load();
    if (!settings.anthropicApiKey.trim()) {
      toast.error("No API key found — add one in Settings (gear icon).", {
        icon: "⚙️",
        duration: 5000,
      });
      return;
    }

    if (!hasTurns) {
      toast.error('Transcript must contain lines starting with "User:" or "Assistant:".');
      return;
    }

    setRunning(true);
    setPhase("Analyzing conversation…");

    try {
      const { projectRoot, branchCount } = await runIngest({
        transcript,
        projectName: projectName.trim() || "Untitled project",
        sourceChatId: sourceChatId.trim() || null,
        apiKey: settings.anthropicApiKey,
      });

      // Expand the project root in the tree before refreshing
      markNodeExpanded(projectRoot.id);

      setPhase("Saving nodes…");
      bumpRefresh();
      setSelectedNodeId(projectRoot.id);

      toast.success(
        `Ingested ${branchCount} branch${branchCount !== 1 ? "es" : ""} into "${projectRoot.title}"`,
        { duration: 4000 }
      );

      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message, { duration: 6000 });
    } finally {
      setRunning(false);
      setPhase("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={running ? undefined : onClose}
    >
      <div
        className="w-[640px] card shadow-2xl flex flex-col"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-vault-border shrink-0">
          <div>
            <h2 className="font-semibold text-vault-text text-sm">Ingest conversation</h2>
            <p className="text-xs text-vault-muted mt-0.5">
              Paste a transcript → AI clusters it into knowledge branches
            </p>
          </div>
          {!running && (
            <button onClick={onClose} className="btn-ghost p-1 text-vault-muted">
              <X size={15} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-6 py-4 overflow-y-auto flex-1">
          {/* Project name */}
          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-medium text-vault-muted uppercase tracking-wider">
                Project name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Untitled project"
                disabled={running}
                className="
                  bg-vault-bg border border-vault-border rounded-md
                  px-3 py-2 text-sm text-vault-text placeholder:text-vault-border
                  outline-none focus:border-vault-accent transition-colors disabled:opacity-50
                "
              />
            </div>

            <div className="flex flex-col gap-1.5 w-44">
              <label className="text-xs font-medium text-vault-muted uppercase tracking-wider">
                Source chat ID <span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={sourceChatId}
                onChange={(e) => setSourceChatId(e.target.value)}
                placeholder="chat-abc123"
                disabled={running}
                className="
                  bg-vault-bg border border-vault-border rounded-md
                  px-3 py-2 text-sm text-vault-text placeholder:text-vault-border
                  outline-none focus:border-vault-accent transition-colors disabled:opacity-50
                "
              />
            </div>
          </div>

          {/* Transcript */}
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-vault-muted uppercase tracking-wider">
                Transcript
              </label>
              {transcript.length > 0 && !hasTurns && (
                <span className="flex items-center gap-1 text-[11px] text-yellow-400">
                  <AlertCircle size={11} />
                  No User:/Assistant: markers found
                </span>
              )}
            </div>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={
                "User: Why is the build failing?\nAssistant: The TypeScript compiler can't find the types for @tauri-apps/plugin-sql…\nUser: How do I fix it?\nAssistant: Add a triple-slash reference…"
              }
              disabled={running}
              rows={14}
              className="
                w-full bg-vault-bg border border-vault-border rounded-md
                px-3 py-2 text-sm text-vault-text placeholder:text-vault-border
                outline-none focus:border-vault-accent transition-colors resize-none
                font-mono leading-relaxed disabled:opacity-50
              "
            />
            <p className="text-[11px] text-vault-muted">
              Lines must start with <code className="bg-vault-border px-1 rounded">User:</code> or{" "}
              <code className="bg-vault-border px-1 rounded">Assistant:</code> (case-insensitive).
              Continuation lines are merged into the previous turn.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-vault-border shrink-0">
          {/* Progress indicator */}
          <div className="flex items-center gap-2 text-xs text-vault-muted">
            {running && (
              <>
                <Loader2 size={13} className="animate-spin text-vault-accent" />
                {phase}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn-ghost text-xs"
              onClick={onOpenSettings}
              disabled={running}
              title="Open settings to configure API key"
            >
              ⚙ Settings
            </button>

            <button
              onClick={() => void handleIngest()}
              disabled={running || !transcript.trim()}
              className="flex items-center gap-1.5 btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                !transcript.trim()
                  ? "Paste a transcript first"
                  : running
                  ? "Processing…"
                  : "Ingest conversation"
              }
            >
              {running ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Upload size={13} />
              )}
              {running ? "Analyzing…" : "Ingest"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
