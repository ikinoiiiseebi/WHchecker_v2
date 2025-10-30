import { AnalysisResult, AnalysisResultSchema, FiveW1HKey } from "./schema";
import { detectMissing5W1H, detectPhrases } from "./rules";
import { suggestWithLLM } from "./llm";

export async function runAnalyze(text: string): Promise<AnalysisResult> {
  const missing = detectMissing5W1H(text);
  const matches = detectPhrases(text);

  let suggestion = await suggestWithLLM({
    text,
    missingKeys: missing.map((m) => m.key),
    ambiguousPhrases: matches
      .filter((m) => m.category === "ambiguous")
      .map((m) => m.phrase),
    negativePhrases: matches
      .filter((m) => m.category === "negative")
      .map((m) => m.phrase),
  }).catch(() => undefined);

  if (!suggestion && (missing.length > 0 || matches.length > 0)) {
    const hints: string[] = [];
    const mkeys = missing.map((m) => m.key.toUpperCase()).join("・");
    if (mkeys) hints.push(`不足: ${mkeys}`);
    const amb = matches
      .filter((m) => m.category === "ambiguous")
      .map((m) => `「${m.phrase}」`)
      .join("、");
    if (amb) hints.push(`曖昧: ${amb}`);
    const neg = matches
      .filter((m) => m.category === "negative")
      .map((m) => `「${m.phrase}」`)
      .join("、");
    if (neg) hints.push(`否定: ${neg}`);

    const rewrite = buildRuleBasedRewrite(text, missing.map((m) => m.key));
    suggestion = {
      rewrite,
      rationale: hints,
      improvedPoints: missing.map((m) => m.key),
    };
  }

  const result: AnalysisResult = {
    missing,
    matches,
    summary: {
      hasIssues: missing.length > 0 || matches.length > 0,
      issueCount: missing.length + matches.length,
    },
    suggestion,
  };

  const parsed = AnalysisResultSchema.safeParse(result);
  if (parsed.success) return parsed.data;
  return {
    missing: [],
    matches: [],
    summary: { hasIssues: false, issueCount: 0 },
  };
}

export type { AnalysisResult } from "./schema";

function buildRuleBasedRewrite(text: string, missingKeys: FiveW1HKey[]): string {
  const base = text.trim();
  const add: string[] = [];
  if (missingKeys.includes("who"))
    add.push("誰が行うか：ご自身または相手を明記してください。");
  if (missingKeys.includes("what"))
    add.push("何をするか：作業内容を具体的に記載してください。");
  if (missingKeys.includes("when"))
    add.push("いつまでに：期限や時刻（例：明日17時まで）を示してください。");
  if (missingKeys.includes("where"))
    add.push("どこで／どの手段で：会議URLや会場、手段（Zoom 等）を明記してください。");
  if (missingKeys.includes("why"))
    add.push("なぜ：目的や背景を一言で補足してください。");
  if (missingKeys.includes("how"))
    add.push("どのように：方法やフォーマット、進め方を示してください。");

  const suffix = add.length
    ? `\n例）明日17時までに見積書を作成し、Google Driveにアップロードして共有してください。`
    : "";
  const bullets = add.length ? `\n${add.map((s) => `- ${s}`).join("\n")}` : "";
  return `${base}${bullets}${suffix}`.trim();
}

