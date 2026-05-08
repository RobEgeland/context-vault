# Context Vault — Branching Rubric v2

This rubric governs how the ingest pipeline clusters conversation transcript turns into
knowledge branches. It is loaded at pipeline runtime and injected into the model's system
prompt. It also drives the eval harness scoring.

---

## 1. Three-tier classification

Every turn in the transcript must be assigned to exactly one tier.

| Tier | Name | When to use |
|------|------|-------------|
| **1** | **Branch** | A coherent multi-turn topic that has reuse value across future sessions. Requires at least two turns of substantive back-and-forth (not a single question + short answer). |
| **2** | **Notable fact** | A single Q+A pair that is technically correct, specific, and likely to be useful in a future session, but does not warrant a branch of its own. Examples: a confirmed function signature, a confirmed version number, a one-liner fix. |
| **3** | **Noise** | Chitchat, pleasantries, repetition, failed attempts with no net-new information, or anything that would not be useful context in a future session. |

### 1.1 Substance test for Tier 1 (branches)

A topic qualifies as a **branch** only when **all** of the following hold:

1. It spans **≥ 2 turns** of substantive exchange (a single question answered in one reply does not qualify, even if the answer is long or detailed).
2. The assistant's contribution adds **analysis, decision rationale, or cause/effect reasoning** — not just a fact lookup.
3. The information would be **worth surfacing in a future session** on the same project.

Single-turn Q+A pairs that are substantive but do not meet criteria 1–2 must be classified as **notable facts** (Tier 2), not branches.

### 1.2 Notable facts (the third tier)

Notable facts capture high-value knowledge that doesn't justify a full branch. Each notable fact must include:

- **`key`** — a short identifier, snake_case, ≤ 6 words (e.g. `"plugin_sql_version"`, `"cors_middleware_order"`)
- **`value`** — the fact itself, one concise sentence
- **`span_index`** — the single turn index (0-based) where the fact appears
- **`tags`** — zero or more lowercase keyword tags (same conventions as branch tags)

Notable facts are attached to the **project root node** in the vault, or to an existing branch node whose topic they directly extend.

### 1.3 Noise

Mark a turn as noise when it contains no net-new technical information: greetings, "thanks", "OK", restatements of prior turns, or failed attempts that were superseded without producing any usable finding.

---

## 2. Branch quality rules

### 2.1 Titles

- One concise declarative sentence, 10–25 words, that captures the key finding, decision, or insight
- Write it so the title alone tells you what happened — it is the node's context summary
  - ✅ `"OPTIONS preflight requests fail because cors() middleware was placed after the auth middleware, blocking CORS headers from being set."`
  - ❌ `"CORS issue"` (too vague)
  - ❌ `"The user experienced auth failures after changing CORS settings."` (journey-style, not insight-first)
- Lead with the finding or outcome, not the question that prompted it
- Plain declarative prose — no markdown, no bullet points within the title

### 2.2 Summaries

- 1–3 sentences
- Lead with the **core insight or outcome**, not the journey
  - ✅ `"OPTIONS preflight requests bypass auth when cors() precedes the auth middleware."`
  - ❌ `"The user asked about CORS and we discussed the middleware order."`

### 2.3 Tags

- Lowercase, hyphen-separated where multi-word (`"rate-limit"`, not `"rate_limit"` or `"rateLimit"`)
- 2–6 tags per branch; prefer terms that appear in the transcript

### 2.4 Entities

- Named things only: function names, file paths, error strings, library names, config keys
- Not generic words like `"server"`, `"database"` unless they are the literal name of something

### 2.5 Span attribution

- `span_indices` lists 0-based turn indices that are **directly relevant** to this branch
- A turn may appear in multiple branches only when genuinely relevant to both
- Do not include noise turns in any branch's `span_indices`

---

## 3. Granularity sanity-check

Before finalising the branch list, apply this self-check:

1. **Too coarse**: if a branch's `span_indices` covers more than 40% of the total turns AND the branch summary contains more than one distinct problem or decision, split it.
2. **Too fine**: if two branches share > 60% of their `span_indices`, merge them unless their types are meaningfully different (e.g. one `issue` + one `decision` about the same system is acceptable).
3. **Missing coverage**: every turn that is not in `noise_span_indices` must appear in at least one branch's `span_indices` OR be captured as a notable fact's `span_index`.

---

## 4. Output schema (Zod-ready)

```typescript
// Branch — Tier 1
const BranchSchema = z.object({
  title:         z.string().min(1).max(120),
  type:          z.enum(["issue","subsystem","decision","fix_attempt","hypothesis","open_question","fact"]),
  summary:       z.string().min(1),
  tags:          z.array(z.string()),
  entities:      z.array(z.string()),
  span_indices:  z.array(z.number().int().min(0)),
});

// Notable fact — Tier 2
const NotableFactSchema = z.object({
  key:         z.string().min(1).max(80),
  value:       z.string().min(1),
  span_index:  z.number().int().min(0),
  tags:        z.array(z.string()),
});

// Full pipeline output
const PipelineOutputSchema = z.object({
  branches:           z.array(BranchSchema).min(0),
  notable_facts:      z.array(NotableFactSchema),
  noise_span_indices: z.array(z.number().int().min(0)),
});
```

---

## 5. Worked example

**4-turn transcript:**

```
Turn 0 — user: "Why is auth failing after the CORS change?"
Turn 1 — assistant: "The OPTIONS preflight isn't reaching the handler — add cors() before your auth middleware."
Turn 2 — user: "What version of the cors package should I use?"
Turn 3 — assistant: "Use cors@2.8.5 — it's the last version with full Express 4 support."
```

**Expected output:**

```json
{
  "branches": [
    {
      "title": "Authentication fails because OPTIONS preflight requests never reach the auth handler when cors() is placed after auth middleware.",
      "type": "issue",
      "summary": "Authentication requests started failing after a CORS configuration change. The root cause is that OPTIONS preflight requests are not reaching the auth handler. Fix: register cors() before any auth middleware.",
      "tags": ["auth", "cors", "middleware"],
      "entities": ["OPTIONS", "cors()", "auth middleware"],
      "span_indices": [0, 1]
    },
    {
      "title": "Registering cors() before auth middleware lets OPTIONS preflights bypass authentication and receive proper CORS headers.",
      "type": "decision",
      "summary": "cors() must be registered before any auth middleware so that OPTIONS preflights bypass authentication checks.",
      "tags": ["cors", "express", "middleware-order"],
      "entities": ["cors()", "auth middleware", "Express"],
      "span_indices": [1]
    }
  ],
  "notable_facts": [
    {
      "key": "cors_package_version",
      "value": "cors@2.8.5 is the last version with full Express 4 support.",
      "span_index": 3,
      "tags": ["cors", "express", "versioning"]
    }
  ],
  "noise_span_indices": []
}
```

**Explanation:** Turns 0–1 are a multi-turn substantive exchange (branch). Turns 2–3 are a single Q+A that yields a precise fact (notable_fact). No noise in this transcript.

---

## Changelog

| Version | Date       | Changes |
|---------|------------|---------|
| v1      | 2025-01-01 | Initial rubric: branch-only output, 7 branch types, basic quality rules |
| v2      | 2026-05-06 | Added three-tier classification (branches / notable facts / noise); tightened substance test so single Q+A no longer qualifies as a branch; added Section 1.2 (notable facts tier) with `key`/`value`/`span_index`/`tags` fields; added Section 3 (granularity sanity-check); added `notable_facts` and `noise_span_indices` to output schema |
