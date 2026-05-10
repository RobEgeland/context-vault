import { useEffect, useRef, useState } from "react";
import { Tree, NodeApi } from "react-arborist";
import { ChevronRight, ChevronDown } from "lucide-react";
import { NodesRepository } from "../../lib/storage/NodesRepository";
import type { Node, NodeType } from "../../lib/storage/types";
import { useUIStore } from "../../lib/state/uiStore";
import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";

// ─── Tree item shape ──────────────────────────────────────────────────────────

export interface TreeItem {
  id: string;
  name: string;
  nodeType: NodeType;
  children?: TreeItem[];
}

// ─── Type badge colours ───────────────────────────────────────────────────────

const TYPE_STYLE: Record<NodeType, { bg: string; text: string; label: string }> = {
  root:          { bg: "bg-purple-900/60", text: "text-purple-300",  label: "ROOT" },
  project:       { bg: "bg-blue-900/60",   text: "text-blue-300",    label: "PROJ" },
  issue:         { bg: "bg-red-900/60",    text: "text-red-300",     label: "ISSUE" },
  subsystem:     { bg: "bg-orange-900/60", text: "text-orange-300",  label: "SYS" },
  decision:      { bg: "bg-yellow-900/60", text: "text-yellow-300",  label: "DEC" },
  fix_attempt:   { bg: "bg-green-900/60",  text: "text-green-300",   label: "FIX" },
  hypothesis:    { bg: "bg-cyan-900/60",   text: "text-cyan-300",    label: "HYP" },
  open_question: { bg: "bg-pink-900/60",   text: "text-pink-300",    label: "Q?" },
  fact:          { bg: "bg-slate-700/60",  text: "text-slate-300",   label: "FACT" },
};

// ─── Flat list → nested tree ──────────────────────────────────────────────────

function buildTree(nodes: Node[]): TreeItem[] {
  const map = new Map<string, TreeItem>();

  for (const n of nodes) {
    map.set(n.id, {
      id: n.id,
      name: n.title,
      nodeType: n.type,
      children: [],
    });
  }

  const roots: TreeItem[] = [];
  for (const n of nodes) {
    const item = map.get(n.id)!;
    if (n.parent_id && map.has(n.parent_id)) {
      map.get(n.parent_id)!.children!.push(item);
    } else {
      roots.push(item);
    }
  }

  // Drop empty children arrays so react-arborist treats them as leaves
  function prune(items: TreeItem[]): TreeItem[] {
    return items.map((item) => ({
      ...item,
      children: item.children?.length ? prune(item.children) : undefined,
    }));
  }

  return prune(roots);
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const EXPAND_KEY = "vault.tree.expanded";

function loadExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(EXPAND_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveExpanded(state: Record<string, boolean>) {
  localStorage.setItem(EXPAND_KEY, JSON.stringify(state));
}

// ─── Row renderer ─────────────────────────────────────────────────────────────

function Row({
  node,
  style,
  dragHandle,
}: {
  node: NodeApi<TreeItem>;
  style: React.CSSProperties;
  dragHandle?: React.Ref<HTMLDivElement>;
}) {
  const ts = TYPE_STYLE[node.data.nodeType] ?? TYPE_STYLE.fact;
  const isSelected = node.isSelected;

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`
        flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer select-none
        text-sm transition-colors
        ${isSelected
          ? "bg-vault-accent/20 text-vault-text"
          : "text-vault-text-dim hover:bg-vault-surface hover:text-vault-text"}
      `}
      onClick={() => node.select()}
    >
      {/* Expand toggle */}
      <span
        className="shrink-0 w-4 h-4 flex items-center justify-center text-vault-muted"
        onClick={(e) => { e.stopPropagation(); node.toggle(); }}
      >
        {node.children?.length
          ? node.isOpen
            ? <ChevronDown size={12} />
            : <ChevronRight size={12} />
          : null}
      </span>

      {/* Type badge */}
      <span className={`shrink-0 badge text-[9px] font-bold tracking-wider ${ts.bg} ${ts.text}`}>
        {ts.label}
      </span>

      {/* Title */}
      <span className="truncate">{node.data.name}</span>
    </div>
  );
}

// ─── Search-active check ─────────────────────────────────────────────────────
//
// Type-chip filters are applied directly to the tree (see filterTreeByTypes).
// Only a text query, tag filter, or project filter triggers the SearchResults view.

function isSearchActive(query: string, filters: { tags: string[]; projectId: string | null }): boolean {
  return (
    query.trim().length > 0 ||
    filters.tags.length > 0 ||
    filters.projectId !== null
  );
}

// ─── In-tree type filter ──────────────────────────────────────────────────────
//
// Recursively keeps items whose nodeType is in `types`, plus any parent
// items that still have matching children after filtering.
// Returns the original array unchanged when `types` is empty (show all).

function filterTreeByTypes(items: TreeItem[], types: string[]): TreeItem[] {
  if (!types.length) return items;

  return items.reduce<TreeItem[]>((acc, item) => {
    const filteredChildren = item.children
      ? filterTreeByTypes(item.children, types)
      : undefined;

    if (types.includes(item.nodeType)) {
      // This item matches — keep it (with its children also filtered)
      acc.push({ ...item, children: filteredChildren });
    } else if (filteredChildren?.length) {
      // This item doesn't match but has matching descendants — keep as container
      acc.push({ ...item, children: filteredChildren });
    }
    return acc;
  }, []);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NodeTree() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 280, height: 400 });
  const [treeData, setTreeData] = useState<TreeItem[]>([]);
  const [openState, setOpenState] = useState<Record<string, boolean>>(loadExpanded);

  const {
    selectedNodeId, setSelectedNodeId, refreshTick,
    searchQuery, searchFilters,
  } = useUIStore();

  // SearchResults replaces the tree only for text/tag/project queries.
  // Type chips filter the tree data directly (see below).
  const searching = isSearchActive(searchQuery, {
    tags: searchFilters.tags,
    projectId: searchFilters.projectId,
  });

  // Resize observer — re-attaches whenever the tree div mounts/unmounts
  // (the div is removed from the DOM while SearchResults is showing).
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setDims({ width: rect.width, height: rect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [searching]); // re-run when toggling between tree and results

  // Reload tree whenever a mutation fires.
  useEffect(() => {
    void NodesRepository.listAllNodes().then((nodes) => {
      setTreeData(buildTree(nodes));
      setOpenState(loadExpanded());
    });
  }, [refreshTick]);

  function handleToggle(id: string) {
    setOpenState((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveExpanded(next);
      return next;
    });
  }

  function handleSelect(nodes: NodeApi<TreeItem>[]) {
    setSelectedNodeId(nodes[0]?.id ?? null);
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ── Search bar + filters (always visible) ────────────────────────── */}
      <SearchBar refreshTick={refreshTick} />

      {/* ── Tree or results ───────────────────────────────────────────────── */}
      {searching ? (
        <SearchResults />
      ) : (
        <div ref={containerRef} className="flex-1 overflow-hidden">
          {(() => {
            // Apply type chips as a client-side tree filter.
            // Empty selection = no filter = show everything.
            const visibleData = filterTreeByTypes(treeData, searchFilters.types);

            if (treeData.length === 0) {
              return (
                <p className="px-4 py-6 text-xs text-vault-muted text-center">
                  No nodes yet — use "Ingest" to add a conversation.
                </p>
              );
            }

            if (visibleData.length === 0) {
              return (
                <p className="px-4 py-6 text-xs text-vault-muted text-center">
                  No nodes match the selected types.
                </p>
              );
            }

            return (
              <Tree<TreeItem>
                data={visibleData}
                width={dims.width}
                height={dims.height}
                rowHeight={30}
                indent={16}
                openByDefault={false}
                initialOpenState={openState}
                onToggle={handleToggle}
                selection={selectedNodeId ?? undefined}
                onSelect={handleSelect}
                disableDrag
                disableDrop
              >
                {Row}
              </Tree>
            );
          })()}
        </div>
      )}
    </div>
  );
}
