import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openDatabase(dataDir) {
  const db = new DatabaseSync(resolve(dataDir, 'homework.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec(schema);
    if (!db.prepare('PRAGMA table_info(submissions)').all().some(column=>column.name==='marks')) {
      db.exec('ALTER TABLE submissions ADD COLUMN marks TEXT');
    }
    if (!db.prepare('PRAGMA table_info(assignments)').all().some(column=>column.name==='due_at')) {
      db.exec('ALTER TABLE assignments ADD COLUMN due_at TEXT');
    }
    if (!db.prepare('PRAGMA table_info(submissions)').all().some(column=>column.name==='due_at')) {
      db.exec('ALTER TABLE submissions ADD COLUMN due_at TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS submissions_due ON submissions(code,due_at,created_at) WHERE due_at IS NOT NULL');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
