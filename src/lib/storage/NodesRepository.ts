import Database from "@tauri-apps/plugin-sql";
import type { Node, NewNode, Span, NewSpan, SearchResult } from "./types";
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

  CREATE TABLE IF NOT EXISTS migrations (
    name       TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`;

const DROP_SQL = `
  DROP TRIGGER IF EXISTS nodes_fts_insert;
  DROP TRIGGER IF EXISTS nodes_fts_update;
  DROP TRIGGER IF EXISTS nodes_fts_delete;
  DROP TRIGGER IF EXISTS nodes_fts_spans_insert;
  DROP TRIGGER IF EXISTS nodes_fts_spans_delete;
  DROP TABLE IF EXISTS nodes_fts;
  DROP TABLE IF EXISTS message_spans;
  DROP TABLE IF EXISTS nodes;
  DROP TABLE IF EXISTS migrations;
`;

// Module-level singleton — shared across all callers in this process.
let _db: Database | null = null;
const mirror = new MarkdownMirror();

// ─── FTS5 setup ───────────────────────────────────────────────────────────────

/**
 * Creates the FTS5 virtual table, sync triggers, and backfills existing rows.
 * Each step is idempotent (IF NOT EXISTS / migration guard).
 * Called once per process from getDb().
 */
async function setupFts(db: Database): Promise<void> {
  // 1. Virtual table (porter stemming + unicode support)
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts
    USING fts5(
      node_id UNINDEXED,
      title,
      summary,
      tags,
      span_content,
      tokenize='porter unicode61'
    )
  `);

  // 2. Trigger: new node inserted → add FTS row (span_content starts empty)
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS nodes_fts_insert
    AFTER INSERT ON nodes BEGIN
      INSERT INTO nodes_fts(node_id, title, summary, tags, span_content)
      VALUES (new.id, new.title, COALESCE(new.summary,''), COALESCE(new.tags,''), '');
    END
  `);

  // 3. Trigger: node title/summary/tags updated → rebuild FTS row
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS nodes_fts_update
    AFTER UPDATE OF title, summary, tags ON nodes BEGIN
      DELETE FROM nodes_fts WHERE node_id = old.id;
      INSERT INTO nodes_fts(node_id, title, summary, tags, span_content)
      SELECT old.id, new.title, COALESCE(new.summary,''), COALESCE(new.tags,''),
             COALESCE(
               (SELECT GROUP_CONCAT(ms.content,' ')
                FROM message_spans ms WHERE ms.node_id = old.id),
               ''
             );
    END
  `);

  // 4. Trigger: node deleted → remove FTS row
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS nodes_fts_delete
    AFTER DELETE ON nodes BEGIN
      DELETE FROM nodes_fts WHERE node_id = old.id;
    END
  `);

  // 5. Trigger: span inserted → rebuild span_content for its node
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS nodes_fts_spans_insert
    AFTER INSERT ON message_spans BEGIN
      DELETE FROM nodes_fts WHERE node_id = new.node_id;
      INSERT INTO nodes_fts(node_id, title, summary, tags, span_content)
      SELECT n.id, n.title, COALESCE(n.summary,''), COALESCE(n.tags,''),
             COALESCE(
               (SELECT GROUP_CONCAT(ms.content,' ')
                FROM message_spans ms WHERE ms.node_id = n.id),
               ''
             )
      FROM nodes n WHERE n.id = new.node_id;
    END
  `);

  // 6. Trigger: span deleted → rebuild span_content for its node
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS nodes_fts_spans_delete
    AFTER DELETE ON message_spans BEGIN
      DELETE FROM nodes_fts WHERE node_id = old.node_id;
      INSERT INTO nodes_fts(node_id, title, summary, tags, span_content)
      SELECT n.id, n.title, COALESCE(n.summary,''), COALESCE(n.tags,''),
             COALESCE(
               (SELECT GROUP_CONCAT(ms.content,' ')
                FROM message_spans ms WHERE ms.node_id = n.id),
               ''
             )
      FROM nodes n WHERE n.id = old.node_id;
    END
  `);

  // 7. One-time backfill of nodes that existed before FTS was set up
  const migRows = await db.select<{ name: string }[]>(
    "SELECT name FROM migrations WHERE name = 'fts_backfill_v1'"
  );
  if (!migRows.length) {
    await db.execute(`
      INSERT INTO nodes_fts(node_id, title, summary, tags, span_content)
      SELECT n.id, n.title, COALESCE(n.summary,''), COALESCE(n.tags,''),
             COALESCE(
               (SELECT GROUP_CONCAT(ms.content,' ')
                FROM message_spans ms WHERE ms.node_id = n.id),
               ''
             )
      FROM nodes n
    `);
    await db.execute(
      "INSERT OR IGNORE INTO migrations(name, applied_at) VALUES ('fts_backfill_v1', ?)",
      [Date.now()]
    );
  }
}

async function getDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load(DB_URL);
  await _db.execute(SCHEMA_SQL);
  await setupFts(_db);
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

function rowToSearchResult(r: Record<string, unknown>): SearchResult {
  return {
    node_id:       r.node_id as string,
    title:         r.title as string,
    type:          r.type as string,
    parent_id:     (r.parent_id as string | null) ?? null,
    project_title: (r.project_title as string | null) ?? null,
    snippet:       (r.snippet as string) ?? "",
    rank:          (r.rank as number) ?? 0,
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

  // ── Search ───────────────────────────────────────────────────────────────────

  /**
   * Full-text + filter search across nodes.
   *
   * - `query`  — free-text; prefix-matched via FTS5 porter tokenizer.
   *              Pass '' to get filter-only results.
   * - `filters` — type multi-select, tag multi-select (AND), project single-select.
   *
   * Returns at most 50 results ordered by FTS rank (relevance) or created_at.
   */
  async searchNodes(
    query: string,
    filters: { types: string[]; tags: string[]; projectId: string | null }
  ): Promise<SearchResult[]> {
    const db = await getDb();

    const hasText   = query.trim().length > 0;
    const hasTypes  = filters.types.length > 0;
    const hasTags   = filters.tags.length > 0;
    const hasProj   = !!filters.projectId;

    if (!hasText && !hasTypes && !hasTags && !hasProj) return [];

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (hasText) {
      // Prefix-match each whitespace-separated token
      const ftsQuery = query
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => `"${w.replace(/"/g, '""')}*"`)
        .join(" ");
      whereClauses.push("nodes_fts MATCH ?");
      params.push(ftsQuery);
    }

    if (hasTypes) {
      const placeholders = filters.types.map(() => "?").join(",");
      whereClauses.push(`n.type IN (${placeholders})`);
      params.push(...filters.types);
    }

    if (hasTags) {
      // AND logic: node must have ALL selected tags (tags stored as JSON array)
      const tagClauses = filters.tags.map(() => 'n.tags LIKE ?');
      whereClauses.push(`(${tagClauses.join(" AND ")})`);
      params.push(...filters.tags.map((t) => `%"${t}"%`));
    }

    if (hasProj) {
      // Match the project root itself OR any direct child
      whereClauses.push("(n.parent_id = ? OR n.id = ?)");
      params.push(filters.projectId, filters.projectId);
    }

    const where = whereClauses.join(" AND ");

    if (hasText) {
      // FTS path — uses snippet() for highlighted excerpts
      const sql = `
        SELECT
          f.node_id,
          n.title,
          n.type,
          n.parent_id,
          p.title  AS project_title,
          snippet(nodes_fts, -1, '<mark>', '</mark>', '…', 12) AS snippet,
          f.rank
        FROM nodes_fts f
        JOIN  nodes n ON n.id = f.node_id
        LEFT JOIN nodes p ON p.id = n.parent_id
        WHERE ${where}
        ORDER BY rank
        LIMIT 50
      `;
      const rows = await db.select<Record<string, unknown>[]>(sql, params);
      return rows.map(rowToSearchResult);
    } else {
      // Filter-only path — no FTS join needed
      const sql = `
        SELECT
          n.id   AS node_id,
          n.title,
          n.type,
          n.parent_id,
          p.title AS project_title,
          ''      AS snippet,
          0       AS rank
        FROM nodes n
        LEFT JOIN nodes p ON p.id = n.parent_id
        WHERE ${where}
        ORDER BY n.created_at DESC
        LIMIT 50
      `;
      const rows = await db.select<Record<string, unknown>[]>(sql, params);
      return rows.map(rowToSearchResult);
    }
  },

  /** Returns all unique tags across all nodes, sorted alphabetically. */
  async listAllTags(): Promise<string[]> {
    const nodes = await this.listAllNodes();
    const tagSet = new Set<string>();
    for (const n of nodes) {
      if (n.tags) {
        for (const t of n.tags) tagSet.add(t);
      }
    }
    return Array.from(tagSet).sort();
  },

  /** Returns all project-root nodes (parent_id IS NULL), for the project filter. */
  async listAllProjects(): Promise<{ id: string; title: string }[]> {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT id, title FROM nodes WHERE parent_id IS NULL ORDER BY title ASC"
    );
    return rows.map((r) => ({ id: r.id as string, title: r.title as string }));
  },

  // ── Dev / maintenance ─────────────────────────────────────────────────────────

  /** Drop all tables and recreate — used by the dev sandbox Reset button. */
  async resetDb(): Promise<void> {
    const db = await getDb();
    await db.execute(DROP_SQL);
    await db.execute(SCHEMA_SQL);
    await setupFts(db);
    await mirror.clearAll();
  },

  /** Returns the vault root path for display / file manager. */
  async getVaultPath(): Promise<string> {
    return mirror.getVaultPath();
  },
};
