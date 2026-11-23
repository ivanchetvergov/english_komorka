import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openDatabase(dataDir) {
  const db = new DatabaseSync(resolve(dataDir, 'homework.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec(schema);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
