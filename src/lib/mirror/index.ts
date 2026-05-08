import { BaseDirectory, writeTextFile, readTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import type { Branch, Node } from "../types";

const MIRROR_ROOT = "context-vault-mirror";

function branchPath(b: Branch): string {
  const slug = b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  return `${MIRROR_ROOT}/${b.conversationId}/${b.id}-${slug}.md`;
}

function renderMarkdown(b: Branch, nodes: Node[]): string {
  const header = [
    `---`,
    `id: ${b.id}`,
    `kind: ${b.kind}`,
    `title: ${b.title}`,
    `conversation: ${b.conversationId}`,
    `created: ${new Date(b.createdAt).toISOString()}`,
    `updated: ${new Date(b.updatedAt).toISOString()}`,
    `tokens_raw: ${b.rawTokenCount}`,
    b.compressedTokenCount != null ? `tokens_compressed: ${b.compressedTokenCount}` : null,
    b.summary ? `summary: "${b.summary.replace(/"/g, '\\"')}"` : null,
    `---`,
  ]
    .filter(Boolean)
    .join("\n");

  const body = nodes
    .map((n) => `## [${n.role}]\n\n${n.content}`)
    .join("\n\n---\n\n");

  return `${header}\n\n# ${b.title}\n\n${body}\n`;
}

export async function mirrorBranch(b: Branch, nodes: Node[]): Promise<void> {
  const path = branchPath(b);
  const dir = path.substring(0, path.lastIndexOf("/"));

  const dirExists = await exists(dir, { baseDir: BaseDirectory.Document });
  if (!dirExists) {
    await mkdir(dir, { baseDir: BaseDirectory.Document, recursive: true });
  }

  await writeTextFile(path, renderMarkdown(b, nodes), {
    baseDir: BaseDirectory.Document,
  });
}

export async function readMirroredBranch(b: Branch): Promise<string | null> {
  const path = branchPath(b);
  try {
    return await readTextFile(path, { baseDir: BaseDirectory.Document });
  } catch {
    return null;
  }
}
