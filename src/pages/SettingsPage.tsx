import { useState } from "react";
import { useVault } from "../store/vaultStore";
import { resetClient } from "../lib/llm/client";

export function SettingsPage() {
  const { apiKey, setApiKey } = useVault();
  const [draft, setDraft] = useState(apiKey);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setApiKey(draft);
    resetClient();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-xl mx-auto p-8">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      <div className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-vault-text-dim mb-1">
            Anthropic API Key
          </label>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full bg-vault-bg border border-vault-border rounded-md px-3 py-2 text-sm font-mono text-vault-text placeholder:text-vault-muted focus:outline-none focus:ring-1 focus:ring-vault-accent"
          />
          <p className="mt-1.5 text-xs text-vault-muted">
            Used for Haiku capture summaries and Sonnet compression. Never leaves your device.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleSave} className="btn-primary">
            Save
          </button>
          {saved && (
            <span className="text-sm text-emerald-400">Saved.</span>
          )}
        </div>
      </div>

      <div className="card p-6 mt-4">
        <h2 className="text-sm font-semibold mb-3">About</h2>
        <dl className="space-y-1 text-sm">
          <div className="flex gap-4">
            <dt className="text-vault-muted w-32">Version</dt>
            <dd className="text-vault-text">0.1.0</dd>
          </div>
          <div className="flex gap-4">
            <dt className="text-vault-muted w-32">Storage</dt>
            <dd className="text-vault-text">Local SQLite + Markdown mirror</dd>
          </div>
          <div className="flex gap-4">
            <dt className="text-vault-muted w-32">Sync</dt>
            <dd className="text-vault-muted">Single-device (v0.1)</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
