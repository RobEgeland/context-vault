import { useState, useCallback } from "react";
import { createContext, useContext } from "react";
import type { Branch, Conversation, Export } from "../lib/types";
import * as db from "../lib/db";

interface VaultState {
  conversations: Conversation[];
  activeBranches: Branch[];
  exports: Export[];
  selectedConversationId: string | null;
  selectedBranchId: string | null;
  apiKey: string;
  loading: boolean;
  error: string | null;
}

interface VaultActions {
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  selectBranch: (id: string) => void;
  setApiKey: (key: string) => void;
  clearError: () => void;
}

export type VaultStore = VaultState & VaultActions;

// Standalone hook — wrap in a context provider in App.tsx
export function useVaultStore(): VaultStore {
  const [state, setState] = useState<VaultState>({
    conversations: [],
    activeBranches: [],
    exports: [],
    selectedConversationId: null,
    selectedBranchId: null,
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY ?? "",
    loading: false,
    error: null,
  });

  const loadConversations = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const conversations = await db.listConversations();
      setState((s) => ({ ...s, conversations, loading: false }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    setState((s) => ({ ...s, loading: true, selectedConversationId: id, selectedBranchId: null }));
    try {
      const activeBranches = await db.listBranchesForConversation(id);
      setState((s) => ({ ...s, activeBranches, loading: false }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, []);

  const selectBranch = useCallback((id: string) => {
    setState((s) => ({ ...s, selectedBranchId: id }));
  }, []);

  const setApiKey = useCallback((apiKey: string) => {
    setState((s) => ({ ...s, apiKey }));
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return {
    ...state,
    loadConversations,
    selectConversation,
    selectBranch,
    setApiKey,
    clearError,
  };
}

// Context for passing store through the tree
export const VaultContext = createContext<VaultStore | null>(null);

export function useVault(): VaultStore {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used inside VaultProvider");
  return ctx;
}
