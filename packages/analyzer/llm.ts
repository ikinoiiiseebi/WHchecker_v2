import { SuggestionSchema, FiveW1HKeys, FiveW1HKey } from "./schema";

export type SuggestWithLLMInput = {
  text: string;
  missingKeys: FiveW1HKey[];
  ambiguousPhrases: string[];
  negativePhrases: string[];
};

// Use Gemini (free tier) via @google/generative-ai
export async function suggestWithLLM(input: SuggestWithLLMInput) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY (or GEMINI_API_KEY)");
  }

  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const schemaHint = `必ず次のJSONスキーマに厳密に一致するJSONだけを返してください。余計な文章・注釈は禁止。
{
  "rewrite": string,                // そのまま送れる完成文（1〜2文）
  "rationale": string[],            // 改善理由の箇条書き（短文）
  "improvedPoints": ["who"|"what"|"when"|"where"|"why"|"how"]
}`;

  const sys = [
    "あなたは日本語のビジネスチャット文面を、相手に伝わりやすく丁寧かつ実用的に書き直すアシスタントです。",
    "5W1Hの不足を補い、依頼・期限・対象・手段が明確な“送信可能な完成文”を1〜2文で出力します。",
    "宛先メンションが無い場合は文頭に『＠宛先』を付けてください（実在ユーザー名は創作しない）。",
    "曖昧さを避け、Slackメッセージとして自然で簡潔な敬体で記述してください。",
  ].join("\n");

  const prompt = [
    sys,
    "\n【原文】\n" + input.text,
    input.missingKeys.length
      ? "\n【不足している5W1H】\n- " + input.missingKeys.join(", ")
      : "",
    input.ambiguousPhrases.length
      ? "\n【曖昧表現】\n- " + input.ambiguousPhrases.join("\n- ")
      : "",
    input.negativePhrases.length
      ? "\n【否定的/攻撃的に受け取られる可能性のある表現】\n- " +
        input.negativePhrases.join("\n- ")
      : "",
    "\n" + schemaHint,
    "\n出力はJSONのみ。'rewrite'はそのまま送れる形（箇条書き・プレースホルダ説明文を含めない）。",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
      // ask for JSON output; SDK accepts this in recent versions
      responseMimeType: "application/json",
    } as any,
  });

  const text = res.response.text() || "{}";
  const parsed = SuggestionSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error("Failed to parse Gemini response into SuggestionSchema");
  }
  return parsed.data;
}
