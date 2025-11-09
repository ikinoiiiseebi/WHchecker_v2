import fs from 'node:fs';
import path from 'node:path';

type StoreData = { [userId: string]: string };

const STORE_PATH = path.resolve(__dirname, 'user-tokens.json');

function readFile(): StoreData {
  try {
    const s = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

function writeFile(data: StoreData) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function saveUserToken(userId: string, token: string) {
  const db = readFile();
  db[userId] = token;
  writeFile(db);
}

export function getUserToken(userId: string): string | undefined {
  const db = readFile();
  return db[userId];
}

