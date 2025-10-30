import OpenAI from "openai";
import { Suggestion } from "./schema";
import { FindingsSchema } from "./schema";

type LlmInput = {
  text: string;
  missingKeys: string[];
  ambiguousPhrases: string[];
  negativePhrases: string[];
};

export async function suggestWithLLM(input: LlmInput): Promise<Suggestion | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const openai = new OpenAI({ apiKey });

  const system =
    "あなたは日本語のビジネスコミュニケーション改善アシスタントです。" +
    "5W1Hの不足と不安を与える表現を踏まえて、相手に伝わる丁寧で具体的な提案文を1つだけ返してください。";

  const jsonSchema = {
    name: "Suggestion",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        rewrite: { type: "string", description: "改善後の提案文。1メッセージ分。" },
        rationale: { type: "array", items: { type: "string" } },
        improvedPoints: {
          type: "array",
          items: { type: "string", enum: ["who", "what", "when", "where", "why", "how"] },
        },
      },
      required: ["rewrite"],
    },
  } as const;

  const prompt = [
    `原文メッセージ: ${input.text}`,
    `不足(5W1H): ${input.missingKeys.join(", ") || "なし"}`,
    `曖昧表現: ${input.ambiguousPhrases.join(", ") || "なし"}`,
    `否定/攻撃的表現: ${input.negativePhrases.join(", ") || "なし"}`,
    "要件:",
    "- 句読点・敬語を含む自然な文",
    "- 具体的な期限や方法を補う（必要な場合）",
    "- 1メッセージ、80〜180文字程度",
  ].join("\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const text = res.choices?.[0]?.message?.content ?? undefined;
  if (!text) return undefined;

  const parsed = FindingsSchema.safeParse(safeJson(text));
  if (parsed.success) return parsed.data;
  return undefined;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
