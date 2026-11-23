CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL);
INSERT OR IGNORE INTO users VALUES(1,'admin','Lina');
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assignments(code TEXT PRIMARY KEY, status TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL, due_at TEXT);
CREATE INDEX IF NOT EXISTS assignments_created ON assignments(created_at DESC,code DESC);
CREATE INDEX IF NOT EXISTS assignments_status_created ON assignments(status,created_at DESC,code DESC);
CREATE TABLE IF NOT EXISTS submissions(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL REFERENCES assignments(code), user_id INTEGER NOT NULL REFERENCES users(id),
  attempt TEXT NOT NULL, token TEXT UNIQUE NOT NULL, document TEXT NOT NULL, answers TEXT NOT NULL,
  score REAL, max_score REAL, feedback TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  marks TEXT, due_at TEXT,
  UNIQUE(code,attempt));
CREATE INDEX IF NOT EXISTS submissions_code ON submissions(code,id);
CREATE INDEX IF NOT EXISTS submissions_pending ON submissions(code,id DESC) WHERE score IS NULL;
CREATE INDEX IF NOT EXISTS submissions_reviewed ON submissions(code,id DESC) WHERE score IS NOT NULL;
