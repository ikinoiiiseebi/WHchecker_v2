import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(__dirname, 'installations.json');

type AnyObj = Record<string, any>;

function readAll(): AnyObj {
  try {
    const s = fs.readFileSync(FILE, 'utf8');
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

function writeAll(data: AnyObj) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

export async function storeInstallation(installation: any) {
  const db = readAll();
  const teamId = installation?.team?.id || installation?.enterprise?.id || 'single';
  const prev = db[teamId] || {};

  // Slack でユーザースコープのみ再認可した場合 bot 情報が含まれないため、
  // 既存の bot 情報を上書きしないようにマージする。
  if (!installation?.bot?.token && prev?.bot?.token) {
    db[teamId] = { ...installation, bot: prev.bot };
  } else {
    db[teamId] = installation;
  }
  writeAll(db);
}

export async function fetchInstallation(opts: { teamId?: string; enterpriseId?: string }) {
  const db = readAll();
  const key = opts.teamId || opts.enterpriseId || 'single';
  let inst = db[key];
  if (!inst) {
    inst = {};
  }
  if (!inst.bot?.token) {
    const envBot = process.env.SLACK_BOT_TOKEN;
    if (envBot) {
      inst = {
        ...inst,
        team: inst.team || (opts.teamId ? { id: opts.teamId } : undefined),
        enterprise: inst.enterprise || (opts.enterpriseId ? { id: opts.enterpriseId } : undefined),
        bot: { token: envBot },
      };
    }
  }
  if (!inst?.bot?.token) throw new Error('No installation found for bot token');
  return inst;
}
