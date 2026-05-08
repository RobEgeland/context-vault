import Database from "@tauri-apps/plugin-sql";
import type { Node, NewNode, Span, NewSpan } from "./types";
import { MarkdownMirror } from "./MarkdownMirror";

// ─── DB setup ─────────────────────────────────────────────────────────────────

const DB_URL = "sqlite:context-vault.db";

/**
 * Migration is intentionally inline here so the repository is self-contained.
 * All statements are idempotent (IF NOT EXISTS / IF EXISTS).
 */
const SCHEMA_SQL = `
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS nodes (
    id                       TEXT PRIMARY KEY,
    parent_id                TEXT REFERENCES nodes(id),
    title                    TEXT NOT NULL,
    type                     TEXT NOT NULL,
    summary                  TEXT,
    compressed_summary_modes TEXT,
    structured_facts         TEXT,
    entities                 TEXT,
    tags                     TEXT,
    confidence               REAL,
    source_chat_id           TEXT,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    last_reused_at           INTEGER
  );

  CREATE TABLE IF NOT EXISTS message_spans (
    id             TEXT PRIMARY KEY,
    node_id        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    source_chat_id TEXT,
    role           TEXT NOT NULL,
    content        TEXT NOT NULL,
    timestamp      INTEGER,
    ordinal        INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_nodes_parent   ON nodes(parent_id);
  CREATE INDEX IF NOT EXISTS idx_spans_node_ord ON message_spans(node_id, ordinal);
`;

const DROP_SQL = `
  DROP TABLE IF EXISTS message_spans;
  DROP TABLE IF EXISTS nodes;
`;

// Module-level singleton — shared across all callers in this process.
let _db: Database | null = null;
const mirror = new MarkdownMirror();

async function getDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load(DB_URL);
  await _db.execute(SCHEMA_SQL);
  return _db;
}

// ─── Row ↔ Domain mappers ─────────────────────────────────────────────────────

function rowToNode(r: Record<string, unknown>): Node {
  return {
    id: r.id as string,
    parent_id: (r.parent_id as string | null) ?? null,
    title: r.title as string,
    type: r.type as Node["type"],
    summary: (r.summary as string | null) ?? null,
    compressed_summary_modes: r.compressed_summary_modes
      ? (JSON.parse(r.compressed_summary_modes as string) as Node["compressed_summary_modes"])
      : null,
    structured_facts: r.structured_facts
      ? JSON.parse(r.structured_facts as string)
      : null,
    entities: r.entities ? (JSON.parse(r.entities as string) as string[]) : null,
    tags: r.tags ? (JSON.parse(r.tags as string) as string[]) : null,
    confidence: (r.confidence as number | null) ?? null,
    source_chat_id: (r.source_chat_id as string | null) ?? null,
    created_at: r.created_at as number,
    updated_at: r.updated_at as number,
    last_reused_at: (r.last_reused_at as number | null) ?? null,
  };
}

function rowToSpan(r: Record<string, unknown>): Span {
  return {
    id: r.id as string,
    node_id: r.node_id as string,
    source_chat_id: (r.source_chat_id as string | null) ?? null,
    role: r.role as Span["role"],
    content: r.content as string,
    timestamp: (r.timestamp as number | null) ?? null,
    ordinal: r.ordinal as number,
  };
}

// Serialize JSON columns; undefined → null for SQLite binding.
function jsonOrNull(v: unknown): string | null {
  return v != null ? JSON.stringify(v) : null;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export const NodesRepository = {
  // ── Nodes ────────────────────────────────────────────────────────────────────

  async createNode(input: NewNode): Promise<Node> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = Date.now();
    const node: Node = { ...input, id, created_at: now, updated_at: now };

    await db.execute(
      `INSERT INTO nodes
         (id, parent_id, title, type, summary, compressed_summary_modes,
          structured_facts, entities, tags, confidence, source_chat_id,
          created_at, updated_at, last_reused_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        node.id,
        node.parent_id,
        node.title,
        node.type,
        node.summary,
        jsonOrNull(node.compressed_summary_modes),
        jsonOrNull(node.structured_facts),
        jsonOrNull(node.entities),
        jsonOrNull(node.tags),
        node.confidence,
        node.source_chat_id,
        node.created_at,
        node.updated_at,
        node.last_reused_at,
      ]
    );

    await mirror.write(node);
    return node;
  },

  async getNode(id: string): Promise<Node | null> {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM nodes WHERE id = ?",
      [id]
    );
    return rows.length ? rowToNode(rows[0]) : null;
  },

  async listChildren(parentId: string | null): Promise<Node[]> {
    const db = await getDb();
    const rows =
      parentId === null
        ? await db.select<Record<string, unknown>[]>(
            "SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY created_at ASC"
          )
        : await db.select<Record<string, unknown>[]>(
            "SELECT * FROM nodes WHERE parent_id = ? ORDER BY created_at ASC",
            [parentId]
          );
    return rows.map(rowToNode);
  },

  async listAllNodes(): Promise<Node[]> {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM nodes ORDER BY created_at ASC"
    );
    return rows.map(rowToNode);
  },

  async updateNode(id: string, patch: Partial<Node>): Promise<void> {
    const db = await getDb();
    const now = Date.now();

    const sets: string[] = ["updated_at = ?"];
    const vals: unknown[] = [now];

    // Scalar columns
    const scalarCols: (keyof Node)[] = [
      "parent_id", "title", "type", "summary",
      "confidence", "source_chat_id", "last_reused_at",
    ];
    for (const col of scalarCols) {
      if (col in patch) {
        sets.push(`${col} = ?`);
        vals.push(patch[col] ?? null);
      }
    }

    // JSON columns
    const jsonCols: (keyof Node)[] = [
      "compressed_summary_modes", "structured_facts", "entities", "tags",
    ];
    for (const col of jsonCols) {
      if (col in patch) {
        sets.push(`${col} = ?`);
        vals.push(jsonOrNull(patch[col]));
      }
    }

    vals.push(id);
    await db.execute(
      `UPDATE nodes SET ${sets.join(", ")} WHERE id = ?`,
      vals
    );

    const updated = await this.getNode(id);
    if (updated) await mirror.write(updated);
  },

  async deleteNode(id: string): Promise<void> {
    const db = await getDb();
    // message_spans cascade-delete via FK
    await db.execute("DELETE FROM nodes WHERE id = ?", [id]);
    await mirror.remove(id);
  },

  // ── Spans ─────────────────────────────────────────────────────────────────────

  async appendMessageSpans(nodeId: string, spans: NewSpan[]): Promise<void> {
    const db = await getDb();
    for (const span of spans) {
      await db.execute(
        `INSERT INTO message_spans
           (id, node_id, source_chat_id, role, content, timestamp, ordinal)
         VALUES (?,?,?,?,?,?,?)`,
        [
          crypto.randomUUID(),
          nodeId,
          span.source_chat_id,
          span.role,
          span.content,
          span.timestamp,
          span.ordinal,
        ]
      );
    }
  },

  async listSpans(nodeId: string): Promise<Span[]> {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM message_spans WHERE node_id = ? ORDER BY ordinal ASC",
      [nodeId]
    );
    return rows.map(rowToSpan);
  },

  // ── Dev / maintenance ─────────────────────────────────────────────────────────

  /** Drop all tables and recreate — used by the dev sandbox Reset button. */
  async resetDb(): Promise<void> {
    const db = await getDb();
    await db.execute(DROP_SQL);
    await db.execute(SCHEMA_SQL);
    await mirror.clearAll();
  },

  /** Returns the vault root path for display / file manager. */
  async getVaultPath(): Promise<string> {
    return mirror.getVaultPath();
  },
};
