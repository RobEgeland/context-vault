import { useEffect } from "react";
import { useVault } from "../../store/vaultStore";
import { Spinner } from "../ui/Spinner";

export function ConversationList() {
  const { conversations, selectedConversationId, loading, loadConversations, selectConversation } =
    useVault();

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  if (loading && conversations.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spinner />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="p-4 text-vault-muted text-sm text-center">
        No conversations yet.
        <br />
        Capture one from Claude Desktop to get started.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-vault-border">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            onClick={() => void selectConversation(c.id)}
            className={`w-full text-left px-4 py-3 hover:bg-vault-border/30 transition-colors ${
              selectedConversationId === c.id ? "bg-vault-border/50" : ""
            }`}
          >
            <p className="text-sm font-medium text-vault-text truncate">{c.title}</p>
            <p className="text-xs text-vault-muted mt-0.5">
              {new Date(c.capturedAt).toLocaleDateString()} · {c.rawTokenCount.toLocaleString()} tokens
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}
