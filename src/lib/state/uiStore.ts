import { create } from "zustand";

// ─── Search filters ───────────────────────────────────────────────────────────

export interface SearchFilters {
  /** Node types to include (empty = all). */
  types:     string[];
  /** Tags that results must ALL have (AND logic; empty = any). */
  tags:      string[];
  /** Restrict to one project root (null = all projects). */
  projectId: string | null;
}

const EMPTY_FILTERS: SearchFilters = { types: [], tags: [], projectId: null };

// ─── Store ────────────────────────────────────────────────────────────────────

interface UIState {
  selectedNodeId:  string | null;
  refreshTick:     number;

  searchQuery:     string;
  searchFilters:   SearchFilters;
  /** Bump to programmatically focus the search input (Cmd/Ctrl+K). */
  searchFocusTick: number;
}

interface UIActions {
  setSelectedNodeId:  (id: string | null) => void;
  bumpRefresh:        () => void;

  setSearchQuery:     (q: string) => void;
  setSearchFilters:   (f: SearchFilters) => void;
  clearSearch:        () => void;
  bumpSearchFocus:    () => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  selectedNodeId:  null,
  refreshTick:     0,

  searchQuery:     "",
  searchFilters:   EMPTY_FILTERS,
  searchFocusTick: 0,

  setSelectedNodeId:  (id) => set({ selectedNodeId: id }),
  bumpRefresh:        ()  => set((s) => ({ refreshTick: s.refreshTick + 1 })),

  setSearchQuery:     (q) => set({ searchQuery: q }),
  setSearchFilters:   (f) => set({ searchFilters: f }),
  clearSearch:        ()  => set({ searchQuery: "", searchFilters: EMPTY_FILTERS }),
  bumpSearchFocus:    ()  => set((s) => ({ searchFocusTick: s.searchFocusTick + 1 })),
}));
