import { AnalysisResult, AnalysisResultSchema, FiveW1HKey, NotificationScore } from "./schema";
import { detectMissing5W1H, detectPhrases } from "./rules";
import { suggestWithLLM } from "./llm";

export async function runAnalyze(text: string): Promise<AnalysisResult> {
  const missing = detectMissing5W1H(text);
  const matches = detectPhrases(text);
  const notification = scoreMessage(text, missing.map(m => m.key), matches);

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
    notification,
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
  const parts: string[] = [];
  const needWho = missingKeys.includes("who");
  const head = needWho ? "＠宛先 " : "";

  // Try to keep original gist, but make it send-ready.
  // Without hallucinating specifics, provide a concise, actionable sentence.
  let core = base;
  // Ensure request form
  if (!/[お願いします。!]$/.test(core)) core = core.replace(/[。.!]*$/, "、お願いします。");

  // Add minimal hints inline when missing
  if (missingKeys.includes("when")) core = core.replace("お願いします。", "本日中（または期限を明記）の対応をお願いします。");
  if (missingKeys.includes("where")) core += " このスレッドに添付・共有してください。";

  parts.push(head + core);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function scoreMessage(
  text: string,
  missingKeys: FiveW1HKey[],
  matches: ReturnType<typeof detectPhrases>
): NotificationScore {
  const t = text.trim();
  let score = 0;
  const reasons: string[] = [];

  // Early exit for clear casual/greeting/ack messages
  if (/^(ありがとうございます|お疲れさま|おはよう|こんにちは|こんばんは|了解です|承知しました|OKです|LGTM|助かります)/.test(t)) {
    return { score: 0, shouldNotify: false, reasons: ["挨拶・了承などのカジュアル/明確なメッセージ"] };
  }

  // Request indicators
  if (/(してください|お願いします|いただけますか|下さい|ください)/.test(t)) {
    score += 3; reasons.push("依頼表現");
  }
  if (/[?？]/.test(t)) { score += 1; reasons.push("疑問/確認"); }
  if (/(期日|期限|までに|本日|明日|\d{1,2}\s*月\s*\d{1,2}\s*日)/.test(t)) {
    score += 2; reasons.push("期限や日時の言及");
  }
  if (/<@[^>]+>/.test(t)) { score += 2; reasons.push("宛先メンション"); }

  // Casual indicators
  const emojiLike = /:[a-z0-9_+-]+:/.test(t) ? 1 : 0;
  const kaomoji = /(\(\^|\^\)|\(\*|\*\)|\(笑\)|笑)/.test(t) ? 1 : 0;
  const manyExclam = (t.match(/!/g) || []).length >= 3 ? 1 : 0;
  const wTrail = /w{2,}$/.test(t) ? 1 : 0;
  const casual = emojiLike + kaomoji + manyExclam + wTrail;
  if (casual > 0) { score -= casual; reasons.push("カジュアル指標"); }

  // Missing 5W1H increase urgency
  if (missingKeys.includes("who")) { score += 1; reasons.push("WHO不足"); }
  if (missingKeys.includes("what")) { score += 1; reasons.push("WHAT不足"); }
  if (missingKeys.includes("when")) { score += 1; reasons.push("WHEN不足"); }

  // Ambiguous/negative phrases
  if (matches.some(m => m.category === "ambiguous")) { score += 1; reasons.push("曖昧表現"); }
  if (matches.some(m => m.category === "negative")) { score += 1; reasons.push("否定的表現"); }

  // Normalize into 0..10
  if (score < 0) score = 0;
  if (score > 10) score = 10;

  // Threshold: Only notify when score >= 3 and there is at least one issue
  const hasIssues = missingKeys.length > 0 || matches.length > 0;
  const shouldNotify = hasIssues && score >= 3;
  return { score, shouldNotify, reasons };
}
