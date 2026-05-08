import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, writeTextFile, remove, readDir } from "@tauri-apps/plugin-fs";
import type { Node } from "./types";

// ─── YAML frontmatter ─────────────────────────────────────────────────────────

function buildFrontmatter(node: Node): string {
  const lines: string[] = [
    "---",
    `id: ${node.id}`,
    `parent_id: ${node.parent_id ?? "null"}`,
    `type: ${node.type}`,
    `title: "${node.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    `tags: ${node.tags ? JSON.stringify(node.tags) : "[]"}`,
    `created_at: ${node.created_at}`,
    `updated_at: ${node.updated_at}`,
    `last_reused_at: ${node.last_reused_at ?? "null"}`,
    "---",
  ];
  return lines.join("\n");
}

function buildMarkdown(node: Node): string {
  const front = buildFrontmatter(node);
  const body = node.summary
    ? `\n# ${node.title}\n\n${node.summary}\n`
    : `\n# ${node.title}\n`;
  return front + body;
}

// ─── Mirror class ─────────────────────────────────────────────────────────────

export class MarkdownMirror {
  /** <app_local_data_dir>/vault — exposed for "Open vault folder" button */
  private vaultRoot: string | null = null;
  /** <app_local_data_dir>/vault/nodes — where .md files live */
  private nodesDir: string | null = null;

  private async resolveVaultRoot(): Promise<string> {
    if (this.vaultRoot) return this.vaultRoot;
    const base = await appLocalDataDir();
    this.vaultRoot = await join(base, "vault");
    return this.vaultRoot;
  }

  private async resolveNodesDir(): Promise<string> {
    if (this.nodesDir) return this.nodesDir;
    const root = await this.resolveVaultRoot();
    this.nodesDir = await join(root, "nodes");
    return this.nodesDir;
  }

  private async ensureNodesDir(): Promise<string> {
    const dir = await this.resolveNodesDir();
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    return dir;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Write (create or overwrite) the markdown file for a node. */
  async write(node: Node): Promise<void> {
    try {
      const dir = await this.ensureNodesDir();
      const path = await join(dir, `${node.id}.md`);
      await writeTextFile(path, buildMarkdown(node));
    } catch (e) {
      console.warn("[MarkdownMirror] write failed:", e);
    }
  }

  /** Delete the markdown file for a node (no-op if file missing). */
  async remove(id: string): Promise<void> {
    try {
      const dir = await this.resolveNodesDir();
      const path = await join(dir, `${id}.md`);
      if (await exists(path)) {
        await remove(path);
      }
    } catch (e) {
      console.warn("[MarkdownMirror] remove failed:", e);
    }
  }

  /** Delete all .md files in the nodes dir (used by "Reset DB"). */
  async clearAll(): Promise<void> {
    try {
      const dir = await this.resolveNodesDir();
      if (!(await exists(dir))) return;
      const entries = await readDir(dir);
      for (const entry of entries) {
        if (entry.name?.endsWith(".md")) {
          const path = await join(dir, entry.name);
          await remove(path);
        }
      }
    } catch (e) {
      console.warn("[MarkdownMirror] clearAll failed:", e);
    }
  }

  /** The vault root path — shown to the user and opened in the file manager. */
  async getVaultPath(): Promise<string> {
    return this.resolveVaultRoot();
  }
}
