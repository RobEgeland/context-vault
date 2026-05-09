/**
 * Flat result list rendered while a search or filter is active.
 *
 * Features:
 * - Renders FTS5 snippets with <mark> highlight tags → styled with CSS.
 * - Keyboard navigation: ArrowDown/Up to move, Enter to select, Esc to clear.
 * - Clicking a row selects the node and clears search.
 */
import {
  useEffect, useRef, useState, useCallback,
} from "react";
import { useUIStore } from "../../lib/state/uiStore";
import { NodesRepository } from "../../lib/storage/NodesRepository";
import type { SearchResult } from "../../lib/storage/types";

// ─── Type badge colours (matches NodeTree) ────────────────────────────────────

const TYPE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  root:          { bg: "bg-purple-900/60", text: "text-purple-300",  label: "ROOT" },
  project:       { bg: "bg-blue-900/60",   text: "text-blue-300",    label: "PROJ" },
  issue:         { bg: "bg-red-900/60",    text: "text-red-300",     label: "ISSUE" },
  subsystem:     { bg: "bg-orange-900/60", text: "text-orange-300",  label: "SYS"  },
  decision:      { bg: "bg-yellow-900/60", text: "text-yellow-300",  label: "DEC"  },
  fix_attempt:   { bg: "bg-green-900/60",  text: "text-green-300",   label: "FIX"  },
  hypothesis:    { bg: "bg-cyan-900/60",   text: "text-cyan-300",    label: "HYP"  },
  open_question: { bg: "bg-pink-900/60",   text: "text-pink-300",    label: "Q?"   },
  fact:          { bg: "bg-slate-700/60",  text: "text-slate-300",   label: "FACT" },
};

function typeBadge(type: string) {
  const ts = TYPE_STYLE[type] ?? TYPE_STYLE.fact;
  return { ...ts };
}

// ─── Result row ───────────────────────────────────────────────────────────────

interface RowProps {
  result:    SearchResult;
  focused:   boolean;
  onSelect:  () => void;
  rowRef?:   React.Ref<HTMLButtonElement>;
}

function ResultRow({ result, focused, onSelect, rowRef }: RowProps) {
  const ts = typeBadge(result.type);

  return (
    <button
      ref={rowRef}
      onClick={onSelect}
      className={[
        "w-full text-left px-2.5 py-2 flex items-start gap-1.5",
        "border-b border-vault-border/50 transition-colors focus:outline-none",
        focused
          ? "bg-vault-accent/15 text-vault-text"
          : "hover:bg-vault-surface text-vault-text-dim",
      ].join(" ")}
    >
      {/* Badge — fixed-width column */}
      <span
        className={`shrink-0 badge text-[9px] font-bold tracking-wider mt-0.5 w-10 justify-center ${ts.bg} ${ts.text}`}
      >
        {ts.label}
      </span>

      {/* Text column */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium leading-snug line-clamp-2">
          {result.title}
        </span>

        {result.project_title && (
          <span className="text-[10px] text-vault-muted leading-none">
            {result.project_title}
          </span>
        )}

        {result.snippet && (
          <p
            className="text-[10px] text-vault-muted leading-snug line-clamp-2 [&_mark]:bg-vault-accent/30 [&_mark]:text-vault-accent [&_mark]:rounded-[2px] [&_mark]:px-0.5"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: result.snippet }}
          />
        )}
      </div>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SearchResults() {
  const {
    searchQuery, searchFilters,
    setSelectedNodeId, clearSearch,
  } = useUIStore();

  const [results,      setResults]      = useState<SearchResult[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [loading,      setLoading]      = useState(false);

  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // ── Run search whenever query or filters change ───────────────────────────

  useEffect(() => {
    setFocusedIndex(-1);
    setLoading(true);

    void NodesRepository.searchNodes(searchQuery, searchFilters).then((res) => {
      setResults(res);
      setLoading(false);
    });
  }, [searchQuery, searchFilters]);

  // ── Scroll focused row into view ──────────────────────────────────────────

  useEffect(() => {
    if (focusedIndex >= 0) {
      rowRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        const hit = results[focusedIndex];
        if (hit) { setSelectedNodeId(hit.node_id); clearSearch(); }
      } else if (e.key === "Escape") {
        e.preventDefault();
        clearSearch();
      }
    },
    [results, focusedIndex, setSelectedNodeId, clearSearch]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-vault-muted">
        Searching…
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-vault-muted">
        No results
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {results.map((r, i) => (
        <ResultRow
          key={r.node_id}
          result={r}
          focused={i === focusedIndex}
          rowRef={(el) => { rowRefs.current[i] = el; }}
          onSelect={() => {
            setSelectedNodeId(r.node_id);
            clearSearch();
          }}
        />
      ))}
    </div>
  );
}
