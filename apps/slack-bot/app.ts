import path from 'node:path';
import dotenv from 'dotenv';
import { App, LogLevel } from '@slack/bolt';
import url from 'node:url';
import { saveUserToken, getUserToken } from './tokenStore';
import * as instore from './installStore';
import { runAnalyze } from '@whchecker/analyzer';

// ルートの .env を明示読み込み（CommonJS なので __dirname 使用）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// 起動前チェック（値は出力しない）
['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_LEVEL_TOKEN', 'GOOGLE_API_KEY'].forEach(
  (k) => {
    if (!process.env[k]) throw new Error(`Missing env: ${k}`);
  }
);

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_LEVEL_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
  // OAuth (user token for editing original messages)
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: [],
  installerOptions: {
    redirectUriPath: '/slack/oauth_redirect',
    userScopes: ['chat:write', 'reactions:write'],
  },
  installationStore: {
    storeInstallation: async (installation) => {
      await instore.storeInstallation(installation);
      try {
        const userId = installation.user?.id as string | undefined;
        const userToken = (installation.user as any)?.token as string | undefined;
        if (userId && userToken) saveUserToken(userId, userToken);
      } catch {}
      return;
    },
    fetchInstallation: async (opts) => instore.fetchInstallation(opts as any),
    deleteInstallation: async () => { return; },
  },
});

function buildBlocks(result: Awaited<ReturnType<typeof runAnalyze>>) {
  const blocks: any[] = [];
  if (!result.summary.hasIssues) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '問題は検出されませんでした。' } });
    return blocks;
  }
  blocks.push({ type: 'header', text: { type: 'plain_text', text: '⚠ 伝わりづらい表現の検出', emoji: true } });

  const missing = result.missing.map((m) => `• ${m.key.toUpperCase()}: ${m.reason}`).join('\n');
  const ambiguous = result.matches
    .filter((m) => m.category === 'ambiguous')
    .map((m) => `• 「${m.phrase}」— ${m.reason}`)
    .join('\n');
  const negative = result.matches
    .filter((m) => m.category === 'negative')
    .map((m) => `• 「${m.phrase}」— ${m.reason}`)
    .join('\n');

  if (missing) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*5W1H 不足*\n${missing}` } });
  }
  if (ambiguous) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*曖昧で不安を生む表現*\n${ambiguous}` } });
  }
  if (negative) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*否定的・攻撃的に受け取られる可能性のある表現*\n${negative}` } });
  }

  if (result.suggestion?.rewrite) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*提案文（編集して送信できます）*' } });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '```' + result.suggestion.rewrite + '```' } });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '編集して送信' },
          action_id: 'whc_open_modal',
          value: Buffer.from(result.suggestion.rewrite).toString('base64'),
        },
      ],
    });
  }

  return blocks;
}

app.message(async ({ message, client, logger, context }) => {
  try {
    const msg = message as any;
    if (!msg || msg.subtype || msg.bot_id) return; // ignore bot/system
    const channel = msg.channel as string;
    const ts = msg.ts as string;
    const text = (msg.text as string) || '';
    if (!text.trim()) return;

    const analysis = await runAnalyze(text);
    if (!analysis.summary.hasIssues) return;
    if (analysis.notification && !analysis.notification.shouldNotify) return;

    // Add :warning: reaction
    await client.reactions.add({ token: context.botToken, channel, timestamp: ts, name: 'warning' });

    // Post threaded feedback
    await client.chat.postMessage({
      token: context.botToken,
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

// --- Interactivity handlers ---

type AnyAction = any;

function decodeSuggestion(val?: string): string {
  try { return val ? Buffer.from(val, 'base64').toString('utf8') : ''; } catch { return val || ''; }
}

function getInstallBaseUrl(): string | undefined {
  const redirect = process.env.SLACK_REDIRECT_URL;
  if (!redirect) return undefined;
  try {
    const u = new url.URL(redirect);
    // strip oauth path to get base
    return redirect.replace(/\/?slack\/oauth_redirect$/, '');
  } catch {
    return undefined;
  }
}

app.action('whc_open_modal', async ({ ack, body, action, client, logger, context }) => {
  await ack();
  try {
    const a = action as AnyAction;
    const initial = decodeSuggestion(a?.value);
    const channel = (body as any).channel?.id || (body as any).container?.channel_id;
    const thread_ts = (body as any).message?.thread_ts || (body as any).container?.thread_ts || (body as any).message?.ts;
    const original_ts = (body as any).message?.thread_ts || (body as any).message?.ts; // 親（元メッセージ）のTSを優先

    const userId = (body as any).user?.id as string | undefined;
    const userToken = userId ? getUserToken(userId) : undefined;
    if (!userToken) {
      const installBase = getInstallBaseUrl();
      const installUrl = installBase ? `${installBase}/slack/install` : undefined;
      const text = installUrl
        ? `元のメッセージを編集するには認可が必要です。以下のリンクから許可をお願いします。\n${installUrl}`
        : `元のメッセージを編集するには認可が必要です。管理者にお問い合わせください。`;
      await client.chat.postEphemeral({
        token: context.botToken,
        channel,
        user: userId!,
        text,
        blocks: installUrl ? [
          { type: 'section', text: { type: 'mrkdwn', text: '元のメッセージを編集するには認可が必要です。' } },
          { type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: '認可する' }, url: installUrl } ] }
        ] : undefined,
      });
      return;
    }
    await client.views.open({
      token: context.botToken,
      trigger_id: (body as any).trigger_id,
      view: {
        type: 'modal',
        callback_id: 'whc_modal_submit',
        private_metadata: JSON.stringify({ channel, thread_ts, original_ts }),
        title: { type: 'plain_text', text: '提案文を編集して送信' },
        submit: { type: 'plain_text', text: '送信' },
        close: { type: 'plain_text', text: 'キャンセル' },
        blocks: [
          {
            type: 'input',
            block_id: 'textblk',
            element: {
              type: 'plain_text_input',
              action_id: 'textact',
              initial_value: initial,
              multiline: true,
            },
            label: { type: 'plain_text', text: '送信内容' },
          },
        ],
      },
    });
  } catch (err) {
    logger.error(err as any);
  }
});

app.view('whc_modal_submit', async ({ ack, body, view, client, logger, context }) => {
  await ack();
  try {
    const md = JSON.parse((view as any).private_metadata || '{}');
    const channel = md.channel as string;
    const thread_ts = md.thread_ts as string | undefined;
    const original_ts = md.original_ts as string | undefined;
    const txt = (view as any).state.values?.textblk?.textact?.value as string;
    if (!channel || !txt) return;

    // 可能なら元メッセージを更新（ユーザーOAuthトークンがある場合のみ）。
    const userId = (body as any).user?.id as string | undefined;
    const userToken = userId ? getUserToken(userId) : undefined;
    if (userToken && original_ts) {
      await client.chat.update({ token: userToken, channel, ts: original_ts, text: txt });
    } else {
      // フォールバック: スレッドに投稿
      await client.chat.postMessage({ token: context.botToken, channel, thread_ts, text: txt });
    }
  } catch (err) {
    logger.error(err as any);
  }
});
