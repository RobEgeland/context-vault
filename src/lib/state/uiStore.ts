import { create } from "zustand";

interface UIState {
  selectedNodeId: string | null;
  refreshTick: number;
}

interface UIActions {
  setSelectedNodeId: (id: string | null) => void;
  bumpRefresh: () => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  selectedNodeId: null,
  refreshTick: 0,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
