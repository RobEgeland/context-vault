import { ConversationList } from "../components/vault/ConversationList";
import { BranchTree } from "../components/vault/BranchTree";
import { useVault } from "../store/vaultStore";

export function VaultPage() {
  const { error, clearError } = useVault();

  return (
    <div className="flex h-full">
      {/* Sidebar — conversation list */}
      <aside className="w-72 shrink-0 border-r border-vault-border flex flex-col">
        <div className="px-4 py-3 border-b border-vault-border">
          <h2 className="text-xs font-semibold text-vault-muted uppercase tracking-wider">
            Conversations
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ConversationList />
        </div>
      </aside>

      {/* Middle — branch tree */}
      <aside className="w-80 shrink-0 border-r border-vault-border flex flex-col">
        <div className="px-4 py-3 border-b border-vault-border">
          <h2 className="text-xs font-semibold text-vault-muted uppercase tracking-wider">
            Branch Tree
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <BranchTree />
        </div>
      </aside>

      {/* Main — branch detail / export panel */}
      <main className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 p-3 bg-red-900/40 border border-red-700/50 rounded-md text-sm text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={clearError} className="ml-4 text-red-400 hover:text-red-200">
              ✕
            </button>
          </div>
        )}
        <div className="flex items-center justify-center h-64 text-vault-muted text-sm">
          Select a branch to view its content and export options.
        </div>
      </main>
    </div>
  );
}
