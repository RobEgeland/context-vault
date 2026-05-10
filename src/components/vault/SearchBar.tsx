/**
 * Search bar + filter chips for the vault left pane.
 *
 * - Text input with 200 ms debounce → writes searchQuery to uiStore.
 * - Cmd/Ctrl+K anywhere focuses the input (bumpSearchFocus in uiStore triggers it).
 * - Type filter: badge chips (multi-select toggle).
 * - Tag filter: chips from all vault tags (multi-select toggle, AND logic).
 * - Project filter: single-select dropdown (only shown when >1 project exists).
 */
import {
  useEffect, useRef, useState, useCallback,
} from "react";
import { Search, X } from "lucide-react";
import { useUIStore, type SearchFilters } from "../../lib/state/uiStore";
import { NodesRepository } from "../../lib/storage/NodesRepository";

// ─── Node-type badge config ───────────────────────────────────────────────────

const TYPE_CHIPS: { id: string; label: string; bg: string; text: string }[] = [
  { id: "issue",         label: "ISSUE", bg: "bg-red-900/70",    text: "text-red-300"    },
  { id: "fix_attempt",   label: "FIX",   bg: "bg-green-900/70",  text: "text-green-300"  },
  { id: "decision",      label: "DEC",   bg: "bg-yellow-900/70", text: "text-yellow-300" },
  { id: "hypothesis",    label: "HYP",   bg: "bg-cyan-900/70",   text: "text-cyan-300"   },
  { id: "open_question", label: "Q?",    bg: "bg-pink-900/70",   text: "text-pink-300"   },
  { id: "subsystem",     label: "SYS",   bg: "bg-orange-900/70", text: "text-orange-300" },
  { id: "fact",          label: "FACT",  bg: "bg-slate-700/70",  text: "text-slate-300"  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toggleItem<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

function hasActiveFilters(f: SearchFilters): boolean {
  return f.types.length > 0 || f.tags.length > 0 || f.projectId !== null;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Called every time the vault changes so the tag/project lists stay fresh. */
  refreshTick: number;
}

export function SearchBar({ refreshTick }: Props) {
  const {
    searchQuery, searchFilters,
    setSearchQuery, setSearchFilters, clearSearch,
    searchFocusTick,
  } = useUIStore();

  const inputRef   = useRef<HTMLInputElement>(null);
  // Local draft value — flushed to store after debounce
  const [draft, setDraft] = useState(searchQuery);

  // Available options loaded from DB
  const [allTags,     setAllTags]     = useState<string[]>([]);
  const [allProjects, setAllProjects] = useState<{ id: string; title: string }[]>([]);

  // Load available tags + projects whenever the vault changes
  useEffect(() => {
    void Promise.all([
      NodesRepository.listAllTags(),
      NodesRepository.listAllProjects(),
    ]).then(([tags, projects]) => {
      setAllTags(tags);
      setAllProjects(projects);
    });
  }, [refreshTick]);

  // 200 ms debounce: flush draft → store
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(draft), 200);
    return () => clearTimeout(t);
  }, [draft, setSearchQuery]);

  // Sync draft when external clearSearch() fires
  useEffect(() => {
    setDraft(searchQuery);
  }, [searchQuery]);

  // Focus input when bumpSearchFocus() is called (e.g. Cmd/Ctrl+K in App)
  useEffect(() => {
    if (searchFocusTick > 0) inputRef.current?.focus();
  }, [searchFocusTick]);

  const handleClear = useCallback(() => {
    setDraft("");
    clearSearch();
    inputRef.current?.focus();
  }, [clearSearch]);

  const updateFilters = useCallback(
    (patch: Partial<SearchFilters>) =>
      setSearchFilters({ ...searchFilters, ...patch }),
    [searchFilters, setSearchFilters]
  );

  const isActive = draft.length > 0 || hasActiveFilters(searchFilters);

  return (
    <div className="flex flex-col gap-0 shrink-0 border-b border-vault-border">

      {/* ── Text input ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Search size={12} className="shrink-0 text-vault-muted" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search vault…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); handleClear(); }
          }}
          className={[
            "flex-1 bg-transparent text-xs text-vault-text placeholder-vault-muted",
            "outline-none min-w-0",
          ].join(" ")}
        />
        {isActive && (
          <button
            onClick={handleClear}
            className="shrink-0 text-vault-muted hover:text-vault-text transition-colors"
            title="Clear search and filters — show all nodes (Esc)"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* ── Filter chips ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1 px-2 pb-2">

        {/* Type chips row — "Show all" link appears when any filter is active */}
        <div className="flex flex-wrap items-center gap-1">
          {TYPE_CHIPS.map(({ id, label, bg, text }) => {
            const active = searchFilters.types.includes(id);
            return (
              <button
                key={id}
                onClick={() => updateFilters({ types: toggleItem(searchFilters.types, id) })}
                className={[
                  "px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider transition-opacity",
                  bg, text,
                  active ? "opacity-100 ring-1 ring-white/20" : "opacity-40 hover:opacity-70",
                ].join(" ")}
                title={active ? "Click to remove filter" : `Filter by type: ${id}`}
              >
                {label}
              </button>
            );
          })}

          {/* "Show all" appears whenever any filter or text query is active */}
          {isActive && (
            <button
              onClick={handleClear}
              className="ml-auto text-[10px] text-vault-accent hover:text-vault-accent-hover transition-colors underline underline-offset-2"
              title="Clear all filters and search"
            >
              Show all
            </button>
          )}
        </div>

        {/* Tag chips (only if the vault has any tags) */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const active = searchFilters.tags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => updateFilters({ tags: toggleItem(searchFilters.tags, tag) })}
                  className={[
                    "px-1.5 py-0.5 rounded text-[10px] border transition-colors",
                    active
                      ? "border-vault-accent text-vault-accent bg-vault-accent/10"
                      : "border-vault-border text-vault-muted hover:border-vault-accent/50 hover:text-vault-text-dim",
                  ].join(" ")}
                  title={`Filter by tag: ${tag}`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}

        {/* Project select (only if >1 project) */}
        {allProjects.length > 1 && (
          <select
            value={searchFilters.projectId ?? ""}
            onChange={(e) =>
              updateFilters({ projectId: e.target.value || null })
            }
            className={[
              "text-[10px] bg-vault-surface border border-vault-border rounded",
              "px-1.5 py-0.5 text-vault-text-dim outline-none",
              "hover:border-vault-accent/50 transition-colors",
              searchFilters.projectId ? "border-vault-accent text-vault-accent" : "",
            ].join(" ")}
          >
            <option value="">All projects</option>
            {allProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
