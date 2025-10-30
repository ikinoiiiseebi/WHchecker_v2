import { z } from "zod";

export const FiveW1HKeys = [
  "who",
  "what",
  "when",
  "where",
  "why",
  "how",
] as const;

export const FiveW1HKeySchema = z.enum(FiveW1HKeys);

export const RuleMatchSchema = z.object({
  phrase: z.string(),
  category: z.enum(["ambiguous", "negative"]),
  reason: z.string(),
});

export const MissingItemSchema = z.object({
  key: FiveW1HKeySchema,
  reason: z.string(),
});

export const SuggestionSchema = z.object({
  rewrite: z.string().min(1),
  rationale: z.array(z.string()).default([]),
  improvedPoints: z.array(FiveW1HKeySchema).default([]),
});

// Alias for LLM findings JSON schema expected by analyzer/llm.ts
export const FindingsSchema = SuggestionSchema;

export const AnalysisResultSchema = z.object({
  missing: z.array(MissingItemSchema),
  matches: z.array(RuleMatchSchema),
  summary: z.object({
    hasIssues: z.boolean(),
    issueCount: z.number().int().nonnegative(),
  }),
  suggestion: SuggestionSchema.optional(),
});

export type FiveW1HKey = typeof FiveW1HKeys[number];
export type RuleMatch = z.infer<typeof RuleMatchSchema>;
export type MissingItem = z.infer<typeof MissingItemSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
