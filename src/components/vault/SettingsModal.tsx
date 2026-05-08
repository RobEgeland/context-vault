import { useEffect, useState } from "react";
import { X, Eye, EyeOff, Save, CheckCircle } from "lucide-react";
import { SettingsRepository, type AppSettings } from "../../lib/storage/SettingsRepository";

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>({
    anthropicApiKey: "",
    processIntervalMinutes: 5,
  });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load on mount
  useEffect(() => {
    SettingsRepository.load()
      .then((s) => setSettings(s))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await SettingsRepository.save(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[480px] card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-vault-text text-sm">Settings</h2>
          <button onClick={onClose} className="btn-ghost p-1 text-vault-muted">
            <X size={15} />
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-vault-muted text-center py-8">Loading…</p>
        ) : (
          <div className="flex flex-col gap-5">
            {/* API key */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-vault-muted uppercase tracking-wider">
                Anthropic API Key
              </label>
              <div className="relative flex items-center">
                <input
                  type={showKey ? "text" : "password"}
                  value={settings.anthropicApiKey}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, anthropicApiKey: e.target.value }))
                  }
                  placeholder="sk-ant-…"
                  autoComplete="off"
                  spellCheck={false}
                  className="
                    w-full bg-vault-bg border border-vault-border rounded-md
                    px-3 py-2 pr-9 text-sm text-vault-text placeholder:text-vault-border
                    outline-none focus:border-vault-accent transition-colors font-mono
                  "
                />
                <button
                  type="button"
                  className="absolute right-2.5 text-vault-muted hover:text-vault-text transition-colors"
                  onClick={() => setShowKey((v) => !v)}
                  title={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[11px] text-vault-muted">
                Stored locally in settings.json — never synced or logged.
                Get yours at{" "}
                <a
                  href="#"
                  className="text-vault-accent hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    // shell:allow-open only works for URLs — open in default browser
                    void import("@tauri-apps/plugin-shell").then((m) =>
                      m.open("https://console.anthropic.com/settings/keys")
                    );
                  }}
                >
                  console.anthropic.com
                </a>
                .
              </p>
            </div>

            {/* Process interval */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-vault-muted uppercase tracking-wider">
                Auto-process Interval (minutes)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.processIntervalMinutes}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      processIntervalMinutes: Math.max(1, Number(e.target.value)),
                    }))
                  }
                  className="
                    w-24 bg-vault-bg border border-vault-border rounded-md
                    px-3 py-2 text-sm text-vault-text outline-none
                    focus:border-vault-accent transition-colors
                  "
                />
                <span className="text-xs text-vault-muted">minutes (used in a future chunk)</span>
              </div>
            </div>

            {/* Save button */}
            <div className="flex items-center justify-end gap-3 pt-1 border-t border-vault-border">
              <button onClick={onClose} className="btn-ghost text-xs">
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-1.5 btn-primary text-xs"
              >
                {saved ? (
                  <>
                    <CheckCircle size={13} />
                    Saved
                  </>
                ) : (
                  <>
                    <Save size={13} />
                    {saving ? "Saving…" : "Save settings"}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
