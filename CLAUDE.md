# Context Vault

Local-first desktop app that captures AI conversations, structures them into a reusable context tree, and exports token-optimized slices into fresh chats.

## Stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2 (Rust minimal) |
| UI | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS, dark mode by default |
| DB | SQLite via `@tauri-apps/plugin-sql` |
| File mirror | Markdown via `@tauri-apps/plugin-fs` |
| LLM | Anthropic TS SDK (`@anthropic-ai/sdk`) |
| Validation | Zod |
| Package manager | pnpm |

## Key architecture decisions

- **All data is local.** SQLite is the index; `~/Documents/context-vault-mirror/` holds a parallel Markdown mirror for Obsidian compatibility.
- **Compression is lazy.** Heuristic trim + Haiku summary at capture; Sonnet compression only on first reuse, then cached in the DB.
- **Rust stays minimal.** Plugin init in `src-tauri/src/lib.rs` only. All business logic is TypeScript.
- **Single-device, v0.1.** No sync, no cloud.

## Directory layout

```
src/
  lib/
    types.ts          — core domain types
    schemas.ts        — Zod validators
    db/
      index.ts        — all DB read/write helpers
      migrations.ts   — append-only SQL migrations
    llm/
      client.ts       — shared Anthropic client
      compression.ts  — heuristic / Haiku / Sonnet compressors
    mirror/
      index.ts        — Markdown mirror writer
  store/
    vaultStore.ts     — React state (useVaultStore hook + VaultContext)
  components/
    ui/               — generic UI primitives
    vault/            — domain-specific components
  pages/              — top-level route pages
src-tauri/
  src/lib.rs          — plugin registration (keep minimal)
  tauri.conf.json     — window config, plugin preload
  capabilities/       — Tauri 2 permission declarations
```

## Dev setup

```bash
# Prerequisites: Rust toolchain, Node.js ≥ 20, pnpm
pnpm install
pnpm dev        # starts Vite + Tauri dev window
```

## Environment

`VITE_ANTHROPIC_API_KEY` — can be set in `.env.local` or via the Settings page at runtime.

## Adding a migration

Append a new SQL string to the `migrations` array in `src/lib/db/migrations.ts`. Never edit past entries.

## Compression strategy

1. **Capture** → run `heuristicCompress` + `haikusummarizeBranch` (Haiku). Store summary in `branches.summary`.
2. **First reuse** → run `sonnetCompress`, store result, set `compression_quality = 'sonnet'`.
3. **Subsequent reuse** → read cached compressed text directly from DB.
