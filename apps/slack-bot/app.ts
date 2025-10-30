import path from 'node:path';
import dotenv from 'dotenv';
import { App, LogLevel } from '@slack/bolt';
import { runAnalyze } from '@whchecker/analyzer';

// ルートの .env を明示読み込み（CJS なので __dirname が使える）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// 起動前チェック（値は出力しない）
['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_LEVEL_TOKEN', 'OPENAI_API_KEY'].forEach(
  (k) => {
    if (!process.env[k]) throw new Error(`Missing env: ${k}`);
  }
);

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_LEVEL_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

function buildBlocks(result: Awaited<ReturnType<typeof runAnalyze>>) {
  const blocks: any[] = [];
  if (!result.summary.hasIssues) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '問題は検出されませんでした。' } });
    return blocks;
  }
  blocks.push({ type: 'header', text: { type: 'plain_text', text: '⚠ 伝わりづらい表現を検出', emoji: true } });

  const missing = result.missing.map((m) => `• ${m.key.toUpperCase()}: ${m.reason}`).join('\n');
  const ambiguous = result.matches
    .filter((m) => m.category === 'ambiguous')
    .map((m) => `• 「${m.phrase}」 — ${m.reason}`)
    .join('\n');
  const negative = result.matches
    .filter((m) => m.category === 'negative')
    .map((m) => `• 「${m.phrase}」 — ${m.reason}`)
    .join('\n');

  if (missing) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*5W1H 不足*\n${missing}` } });
  }
  if (ambiguous) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*曖昧で不安を生む表現*\n${ambiguous}` } });
  }
  if (negative) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*否定的・攻撃的に受け取られる言い回し*\n${negative}` } });
  }

  if (result.suggestion?.rewrite) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*提案文（参考）*' } });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '```' + result.suggestion.rewrite + '```' } });
  }

  return blocks;
}

app.message(async ({ message, client, logger }) => {
  try {
    const msg = message as any;
    if (!msg || msg.subtype || msg.bot_id) return; // ignore bot/system
    const channel = msg.channel as string;
    const ts = msg.ts as string;
    const text = (msg.text as string) || '';
    if (!text.trim()) return;

    const analysis = await runAnalyze(text);
    if (!analysis.summary.hasIssues) return;

    // Add :warning: reaction
    await client.reactions.add({ channel, timestamp: ts, name: 'warning' });

    // Post threaded feedback
    await client.chat.postMessage({
      channel,
      thread_ts: ts,
      text: '5W1Hの不足・曖昧表現の検出結果をお知らせします。',
      blocks: buildBlocks(analysis),
    });
  } catch (err) {
    logger.error(err);
  }
});

async function start() {
  await app.start();
  // eslint-disable-next-line no-console
  console.log('⚡ WHchecker Slack bot is running (Socket Mode)');
}

start();
