import { z } from "zod";
import type { BranchKind, CompressionQuality } from "./types";

export const branchKindSchema = z.enum([
  "conversation",
  "issue",
  "decision",
  "fix-attempt",
  "context",
  "summary",
  "export",
]) satisfies z.ZodType<BranchKind>;

export const compressionQualitySchema = z.enum([
  "none",
  "heuristic",
  "haiku",
  "sonnet",
]) satisfies z.ZodType<CompressionQuality>;

export const conversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  source: z.enum(["claude-desktop", "manual"]),
  capturedAt: z.number().int().positive(),
  rawTokenCount: z.number().int().nonnegative(),
  rootBranchId: z.string().uuid().nullable(),
});

export const branchSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  parentBranchId: z.string().uuid().nullable(),
  kind: branchKindSchema,
  title: z.string().min(1).max(500),
  summary: z.string().nullable(),
  compressionQuality: compressionQualitySchema,
  compressedTokenCount: z.number().int().nonnegative().nullable(),
  rawTokenCount: z.number().int().nonnegative(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  metadata: z.record(z.unknown()),
});

export const nodeSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  tokenCount: z.number().int().nonnegative(),
  position: z.number().int().nonnegative(),
  createdAt: z.number().int().positive(),
});

export const exportOptionsSchema = z.object({
  maxTokens: z.number().int().positive().max(200_000),
  includeSystemPrompt: z.boolean(),
  compressionLevel: z.enum(["heuristic", "haiku", "sonnet"]),
});

// Input shapes (no ids, no timestamps — caller supplies those)

export const createBranchInputSchema = branchSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    summary: z.string().nullable().default(null),
    compressionQuality: compressionQualitySchema.default("none"),
    compressedTokenCount: z.number().int().nonnegative().nullable().default(null),
    rawTokenCount: z.number().int().nonnegative().default(0),
    metadata: z.record(z.unknown()).default({}),
  });

export type CreateBranchInput = z.infer<typeof createBranchInputSchema>;
