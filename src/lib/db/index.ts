import Database from "@tauri-apps/plugin-sql";
import { migrations } from "./migrations";
import type { Branch, Conversation, Export, Node } from "../types";

const DB_PATH = "sqlite:context-vault.db";

let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load(DB_PATH);
  await runMigrations(_db);
  return _db;
}

async function runMigrations(db: Database): Promise<void> {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM meta WHERE key = 'schema_version'"
  );
  const currentVersion = rows.length ? parseInt(rows[0].value, 10) : 0;

  for (let i = currentVersion; i < migrations.length; i++) {
    await db.execute(migrations[i]);
    await db.execute(
      "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)",
      [String(i + 1)]
    );
  }
}

// ─── Conversations ────────────────────────────────────────────────────────────

function rowToConversation(r: Record<string, unknown>): Conversation {
  return {
    id: r.id as string,
    title: r.title as string,
    source: r.source as Conversation["source"],
    capturedAt: r.captured_at as number,
    rawTokenCount: r.raw_token_count as number,
    rootBranchId: (r.root_branch_id as string | null) ?? null,
  };
}

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM conversations ORDER BY captured_at DESC"
  );
  return rows.map(rowToConversation);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM conversations WHERE id = ?",
    [id]
  );
  return rows.length ? rowToConversation(rows[0]) : null;
}

export async function insertConversation(c: Conversation): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO conversations(id,title,source,captured_at,raw_token_count,root_branch_id)
     VALUES(?,?,?,?,?,?)`,
    [c.id, c.title, c.source, c.capturedAt, c.rawTokenCount, c.rootBranchId]
  );
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, "title" | "rawTokenCount" | "rootBranchId">>
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.title !== undefined) { sets.push("title=?"); vals.push(patch.title); }
  if (patch.rawTokenCount !== undefined) { sets.push("raw_token_count=?"); vals.push(patch.rawTokenCount); }
  if (patch.rootBranchId !== undefined) { sets.push("root_branch_id=?"); vals.push(patch.rootBranchId); }
  if (!sets.length) return;
  vals.push(id);
  await db.execute(`UPDATE conversations SET ${sets.join(",")} WHERE id=?`, vals);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM conversations WHERE id=?", [id]);
}

// ─── Branches ────────────────────────────────────────────────────────────────

function rowToBranch(r: Record<string, unknown>): Branch {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    parentBranchId: (r.parent_branch_id as string | null) ?? null,
    kind: r.kind as Branch["kind"],
    title: r.title as string,
    summary: (r.summary as string | null) ?? null,
    compressionQuality: r.compression_quality as Branch["compressionQuality"],
    compressedTokenCount: (r.compressed_token_count as number | null) ?? null,
    rawTokenCount: r.raw_token_count as number,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    metadata: JSON.parse((r.metadata as string) ?? "{}") as Record<string, unknown>,
  };
}

export async function listBranchesForConversation(
  conversationId: string
): Promise<Branch[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM branches WHERE conversation_id=? ORDER BY created_at ASC",
    [conversationId]
  );
  return rows.map(rowToBranch);
}

export async function getBranch(id: string): Promise<Branch | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM branches WHERE id=?",
    [id]
  );
  return rows.length ? rowToBranch(rows[0]) : null;
}

export async function insertBranch(b: Branch): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO branches(id,conversation_id,parent_branch_id,kind,title,summary,
      compression_quality,compressed_token_count,raw_token_count,created_at,updated_at,metadata)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      b.id, b.conversationId, b.parentBranchId, b.kind, b.title, b.summary,
      b.compressionQuality, b.compressedTokenCount, b.rawTokenCount,
      b.createdAt, b.updatedAt, JSON.stringify(b.metadata),
    ]
  );
}

export async function updateBranch(
  id: string,
  patch: Partial<Pick<Branch, "title" | "summary" | "compressionQuality" | "compressedTokenCount" | "rawTokenCount" | "metadata">>
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const sets: string[] = ["updated_at=?"];
  const vals: unknown[] = [now];
  if (patch.title !== undefined) { sets.push("title=?"); vals.push(patch.title); }
  if (patch.summary !== undefined) { sets.push("summary=?"); vals.push(patch.summary); }
  if (patch.compressionQuality !== undefined) { sets.push("compression_quality=?"); vals.push(patch.compressionQuality); }
  if (patch.compressedTokenCount !== undefined) { sets.push("compressed_token_count=?"); vals.push(patch.compressedTokenCount); }
  if (patch.rawTokenCount !== undefined) { sets.push("raw_token_count=?"); vals.push(patch.rawTokenCount); }
  if (patch.metadata !== undefined) { sets.push("metadata=?"); vals.push(JSON.stringify(patch.metadata)); }
  vals.push(id);
  await db.execute(`UPDATE branches SET ${sets.join(",")} WHERE id=?`, vals);
}

export async function deleteBranch(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM branches WHERE id=?", [id]);
}

// ─── Nodes ───────────────────────────────────────────────────────────────────

function rowToNode(r: Record<string, unknown>): Node {
  return {
    id: r.id as string,
    branchId: r.branch_id as string,
    role: r.role as Node["role"],
    content: r.content as string,
    tokenCount: r.token_count as number,
    position: r.position as number,
    createdAt: r.created_at as number,
  };
}

export async function listNodesForBranch(branchId: string): Promise<Node[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM nodes WHERE branch_id=? ORDER BY position ASC",
    [branchId]
  );
  return rows.map(rowToNode);
}

export async function insertNode(n: Node): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO nodes(id,branch_id,role,content,token_count,position,created_at)
     VALUES(?,?,?,?,?,?,?)`,
    [n.id, n.branchId, n.role, n.content, n.tokenCount, n.position, n.createdAt]
  );
}

export async function insertNodes(nodes: Node[]): Promise<void> {
  for (const n of nodes) await insertNode(n);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

function rowToExport(r: Record<string, unknown>): Export {
  return {
    id: r.id as string,
    label: r.label as string,
    branchIds: JSON.parse(r.branch_ids as string) as string[],
    assembledContent: r.assembled_content as string,
    tokenCount: r.token_count as number,
    createdAt: r.created_at as number,
  };
}

export async function listExports(): Promise<Export[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM exports ORDER BY created_at DESC"
  );
  return rows.map(rowToExport);
}

export async function insertExport(e: Export): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO exports(id,label,branch_ids,assembled_content,token_count,created_at)
     VALUES(?,?,?,?,?,?)`,
    [e.id, e.label, JSON.stringify(e.branchIds), e.assembledContent, e.tokenCount, e.createdAt]
  );
}
