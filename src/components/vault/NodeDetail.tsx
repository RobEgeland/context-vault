import { useEffect, useRef, useState } from "react";
import { Tag, X, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { NodesRepository } from "../../lib/storage/NodesRepository";
import type { Node, NodeType, Span } from "../../lib/storage/types";
import { useUIStore } from "../../lib/state/uiStore";
import { ExportPanel } from "./ExportPanel";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_TYPES: NodeType[] = [
  "root", "project", "issue", "subsystem", "decision",
  "fix_attempt", "hypothesis", "open_question", "fact",
];

const TYPE_LABELS: Record<NodeType, string> = {
  root:          "Root",
  project:       "Project",
  issue:         "Issue",
  subsystem:     "Subsystem",
  decision:      "Decision",
  fix_attempt:   "Fix Attempt",
  hypothesis:    "Hypothesis",
  open_question: "Open Question",
  fact:          "Fact",
};

// ─── Inline title editor ──────────────────────────────────────────────────────

function TitleEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className="w-full bg-transparent text-lg font-semibold text-vault-text border-b border-vault-accent outline-none pb-0.5"
      />
    );
  }

  return (
    <h1
      className="text-lg font-semibold text-vault-text cursor-text hover:text-vault-text/80 transition-colors"
      onClick={() => setEditing(true)}
      title="Click to edit title"
    >
      {value}
    </h1>
  );
}

// ─── Tag chip editor ──────────────────────────────────────────────────────────

function TagEditor({
  tags,
  onSave,
}: {
  tags: string[];
  onSave: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const t = input.trim().toLowerCase();
    if (t && !tags.includes(t)) onSave([...tags, t]);
    setInput("");
  }

  function removeTag(t: string) {
    onSave(tags.filter((x) => x !== t));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tag size={12} className="text-vault-muted shrink-0" />
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 badge bg-vault-border text-vault-text-dim text-xs"
        >
          {t}
          <button
            onClick={() => removeTag(t)}
            className="hover:text-red-400 transition-colors"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
        }}
        onBlur={addTag}
        placeholder="add tag…"
        className="bg-transparent text-xs text-vault-muted placeholder:text-vault-border outline-none w-20"
      />
    </div>
  );
}

// ─── Span list (read-only) ────────────────────────────────────────────────────

function SpanList({ spans }: { spans: Span[] }) {
  if (!spans.length) {
    return <p className="text-xs text-vault-muted italic">No message spans attached.</p>;
  }
  return (
    <div className="space-y-2">
      {spans.map((s) => (
        <div
          key={s.id}
          className="rounded-md bg-vault-bg border border-vault-border p-3 text-xs"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={`font-semibold ${
              s.role === "user"      ? "text-vault-accent" :
              s.role === "assistant" ? "text-green-400"    : "text-vault-muted"
            }`}>
              {s.role}
            </span>
            {s.timestamp && (
              <span className="text-vault-muted">
                {new Date(s.timestamp).toLocaleString()}
              </span>
            )}
          </div>
          <p className="text-vault-text-dim whitespace-pre-wrap leading-relaxed">{s.content}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NodeDetail() {
  const { selectedNodeId, bumpRefresh } = useUIStore();
  const [node,    setNode]    = useState<Node | null>(null);
  const [spans,   setSpans]   = useState<Span[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedNodeId) { setNode(null); setSpans([]); return; }
    setLoading(true);
    Promise.all([
      NodesRepository.getNode(selectedNodeId),
      NodesRepository.listSpans(selectedNodeId),
    ]).then(([n, s]) => {
      setNode(n);
      setSpans(s);
    }).finally(() => setLoading(false));
  }, [selectedNodeId]);

  async function patch(update: Partial<Node>) {
    if (!node) return;
    await NodesRepository.updateNode(node.id, update);
    const updated = await NodesRepository.getNode(node.id);
    setNode(updated);
    bumpRefresh();
  }

  // ── Empty states ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-vault-muted text-sm">
        Loading…
      </div>
    );
  }

  if (!node) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-vault-muted select-none">
        <span className="text-4xl opacity-20">🌳</span>
        <p className="text-sm">Select a node in the tree to view and edit it.</p>
      </div>
    );
  }

  // ── Editor ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

      {/* Title */}
      <TitleEditor
        value={node.title}
        onSave={(title) => void patch({ title })}
      />

      {/* Meta row: type + timestamps */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Type selector */}
        <select
          value={node.type}
          onChange={(e) => void patch({ type: e.target.value as NodeType })}
          className="bg-vault-surface border border-vault-border rounded-md px-2 py-1 text-xs text-vault-text-dim outline-none focus:border-vault-accent transition-colors"
        >
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>

        {/* Timestamps */}
        <span className="flex items-center gap-1 text-xs text-vault-muted">
          <Clock size={11} />
          Created {formatDistanceToNow(node.created_at, { addSuffix: true })}
        </span>
        {node.updated_at !== node.created_at && (
          <span className="text-xs text-vault-muted">
            · Updated {formatDistanceToNow(node.updated_at, { addSuffix: true })}
          </span>
        )}
        {node.last_reused_at && (
          <span className="text-xs text-vault-accent/80">
            · Reused {formatDistanceToNow(node.last_reused_at, { addSuffix: true })}
          </span>
        )}
      </div>

      {/* Tags */}
      <TagEditor
        tags={node.tags ?? []}
        onSave={(tags) => void patch({ tags })}
      />

      {/* Summary */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-vault-muted uppercase tracking-wider">
          Summary
        </label>
        <textarea
          value={node.summary ?? ""}
          onChange={(e) => {
            setNode((n) => n ? { ...n, summary: e.target.value } : n);
          }}
          onBlur={(e) => void patch({ summary: e.target.value || null })}
          placeholder="Write a summary for this node…"
          rows={6}
          className="
            w-full bg-vault-bg border border-vault-border rounded-md
            px-3 py-2 text-sm text-vault-text placeholder:text-vault-border
            outline-none focus:border-vault-accent transition-colors resize-y
          "
        />
      </div>

      {/* ── Export for reuse ──────────────────────────────────────────────────── */}
      <div className="border border-vault-border/60 rounded-lg p-4 bg-vault-surface/40">
        <ExportPanel
          node={node}
          onNodeUpdated={(updated) => {
            setNode(updated);
            // Bump the tree refresh so last_reused_at shows in the tree if we add it later
            bumpRefresh();
          }}
        />
      </div>

      {/* Message spans */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-vault-muted uppercase tracking-wider">
          Message Spans ({spans.length})
        </label>
        <SpanList spans={spans} />
      </div>

      {/* Node ID (debug) */}
      <p className="text-[10px] text-vault-border font-mono mt-auto pt-4 border-t border-vault-border/50">
        id: {node.id}
      </p>
    </div>
  );
}
