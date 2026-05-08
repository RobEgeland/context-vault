/**
 * Persists app settings to <appLocalDataDir>/settings.json.
 *
 * Security notes:
 *  - The API key is written only to this local file, never to the markdown
 *    mirror or the SQLite DB.
 *  - Never log the key (even at debug level). The field is treated as opaque.
 */
import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
} from "@tauri-apps/plugin-fs";
import { appLocalDataDir, join } from "@tauri-apps/api/path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppSettings {
  /** Anthropic API key — never logged, never written to the mirror. */
  anthropicApiKey: string;
  /** How often (minutes) to auto-process queued conversations (future use). */
  processIntervalMinutes: number;
}

const DEFAULTS: AppSettings = {
  anthropicApiKey: "",
  processIntervalMinutes: 5,
};

// ─── Path helpers ─────────────────────────────────────────────────────────────

let _settingsPath: string | null = null;

async function getSettingsPath(): Promise<string> {
  if (_settingsPath) return _settingsPath;
  const base = await appLocalDataDir();
  _settingsPath = await join(base, "settings.json");
  return _settingsPath;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export const SettingsRepository = {
  async load(): Promise<AppSettings> {
    try {
      const path = await getSettingsPath();
      const text = await readTextFile(path);
      const parsed = JSON.parse(text) as Partial<AppSettings>;
      return { ...DEFAULTS, ...parsed };
    } catch {
      // File not found on first run — return defaults silently.
      return { ...DEFAULTS };
    }
  },

  async save(settings: AppSettings): Promise<void> {
    const base = await appLocalDataDir();
    const path = await getSettingsPath();

    // Ensure the vault directory exists.
    if (!(await exists(base))) {
      await mkdir(base, { recursive: true });
    }

    await writeTextFile(path, JSON.stringify(settings, null, 2));
  },

  /** Convenience: update a single field without rewriting the whole object. */
  async patch(patch: Partial<AppSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...patch });
  },
};
