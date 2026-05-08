// SQL migrations run in order on first launch and when version advances.
// Each entry is append-only — never mutate a past migration.

export const migrations: string[] = [
  // v1 — initial schema
  `
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS conversations (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    source          TEXT NOT NULL CHECK(source IN ('claude-desktop','manual')),
    captured_at     INTEGER NOT NULL,
    raw_token_count INTEGER NOT NULL DEFAULT 0,
    root_branch_id  TEXT REFERENCES branches(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS branches (
    id                    TEXT PRIMARY KEY,
    conversation_id       TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    parent_branch_id      TEXT REFERENCES branches(id) ON DELETE SET NULL,
    kind                  TEXT NOT NULL,
    title                 TEXT NOT NULL,
    summary               TEXT,
    compression_quality   TEXT NOT NULL DEFAULT 'none',
    compressed_token_count INTEGER,
    raw_token_count       INTEGER NOT NULL DEFAULT 0,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    metadata              TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id          TEXT PRIMARY KEY,
    branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content     TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exports (
    id                TEXT PRIMARY KEY,
    label             TEXT NOT NULL,
    branch_ids        TEXT NOT NULL,  -- JSON array
    assembled_content TEXT NOT NULL,
    token_count       INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');

  CREATE INDEX IF NOT EXISTS idx_branches_conversation ON branches(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_branches_parent ON branches(parent_branch_id);
  CREATE INDEX IF NOT EXISTS idx_nodes_branch ON nodes(branch_id, position);
  CREATE INDEX IF NOT EXISTS idx_conversations_captured ON conversations(captured_at DESC);
  `,
];
