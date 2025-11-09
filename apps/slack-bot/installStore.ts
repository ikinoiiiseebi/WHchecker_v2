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
  db[teamId] = installation;
  writeAll(db);
}

export async function fetchInstallation(opts: { teamId?: string; enterpriseId?: string }) {
  const db = readAll();
  const key = opts.teamId || opts.enterpriseId || 'single';
  let inst = db[key];
  if (!inst) {
    const envBot = process.env.SLACK_BOT_TOKEN;
    if (envBot) {
      inst = {
        team: { id: opts.teamId },
        enterprise: opts.enterpriseId ? { id: opts.enterpriseId } : undefined,
        bot: { token: envBot },
      };
    }
  }
  if (!inst) throw new Error('No installation found');
  return inst;
}

