import { FiveW1HKey, FiveW1HKeys, MissingItem, RuleMatch } from "./schema";

const jp = {
  ambiguous: [
    { phrase: "まあ、いいけど", reason: "納得しているのか不明で不安を与える" },
    { phrase: "あとで話そう", reason: "相手がいつか分からず不明確" },
    { phrase: "別に", reason: "感情を隠している印象で不安" },
    { phrase: "なんでもない", reason: "理由を伏せている印象で不安" },
    { phrase: "そう思うなら、それでいい", reason: "投げやり・突き放しに聞こえる" },
    { phrase: "どうでもいい", reason: "拒絶的・関心がないと受け取られる" },
  ],
  negative: [
    { phrase: "なんでそんなこともできないの", reason: "能力否定に受け取られる" },
    { phrase: "前も言ったよね", reason: "責められている印象" },
    { phrase: "普通はこうするでしょ", reason: "相手を普通ではないと示唆" },
    { phrase: "あなたのせいで", reason: "責任の押し付けに感じられる" },
    { phrase: "どうせ無理でしょ", reason: "信頼されていない印象" },
  ],
};

// Heuristic presence checks for 5W1H in Japanese business messages.
const presenceRegex: Record<FiveW1HKey, RegExp[]> = {
  who: [
    /(私|わたし|僕|自分|こちら)/, // speaker
    /<@[^>]+>/, // Slack mention
    /(さん|様|各位|チーム)/,
  ],
  what: [
    /(対応|実施|作成|提案|確認|連絡|共有|レビュー|修正|手配|準備)/,
    /(資料|見積|見積書|報告|依頼|タスク|案件)/,
  ],
  when: [
    /(\d{1,2}\s*時|\d{1,2}\s*日|\d{1,2}\s*月)/,
    /(今日|明日|明後日|今週|来週|今月|来月)/,
    /(まで|頃|までに|期日|期限)/,
  ],
  where: [
    /(Zoom|Meet|Google\s*Meet|Teams|Slack\s*Huddle|電話|現地|会議室|オフィス|URL|リンク|こちら|このリンク)/,
  ],
  why: [
    /(ため|ので|理由|目的|背景|狙い)/,
  ],
  how: [
    /(方法|手順|やり方|テンプレ|フォーマット|進め方|プロセス)/,
  ],
};

function hasPresence(text: string, key: FiveW1HKey): boolean {
  const regs = presenceRegex[key];
  return regs.some((r) => r.test(text));
}

export function detectMissing5W1H(text: string): MissingItem[] {
  const lowered = text.replace(/\s+/g, "");
  const missing: MissingItem[] = [];
  for (const key of FiveW1HKeys) {
    if (!hasPresence(lowered, key)) {
      let reason = "";
      switch (key) {
        case "who":
          reason = "誰が実施するかが明確ではありません";
          break;
        case "what":
          reason = "具体的に何をするかが不明です";
          break;
        case "when":
          reason = "期限や時期が明記されていません";
          break;
        case "where":
          reason = "場所や手段(会議URL等)が不明です";
          break;
        case "why":
          reason = "目的・背景が示されていません";
          break;
        case "how":
          reason = "方法やフォーマットが不明です";
          break;
      }
      missing.push({ key, reason });
    }
  }

  // Heuristic reliefs: if the text is clearly casual chat, avoid over-flagging
  if (/^(ありがとう|お疲れさま|おはよう|こんにちは|こんばんは)/.test(text.trim())) {
    return [];
  }

  return missing;
}

export function detectPhrases(text: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const t = text;
  for (const a of jp.ambiguous) {
    if (t.includes(a.phrase)) {
      matches.push({ phrase: a.phrase, reason: a.reason, category: "ambiguous" });
    }
  }
  for (const n of jp.negative) {
    if (t.includes(n.phrase)) {
      matches.push({ phrase: n.phrase, reason: n.reason, category: "negative" });
    }
  }
  return matches;
}

