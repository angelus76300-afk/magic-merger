-- 3.7 part E: refresh the legacy library, and trim it without deleting.

-- What the refresh decided for each program it wrote: replaced the live one,
-- or kept the old (with why). The new program is a row of programs with
-- origin 'refresh'; until decided it has status 'candidate', which nobody
-- is served. dry: written for the dry run of 20.
CREATE TABLE refresh_verdicts (
  to_pid INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  from_pid INTEGER,
  replaced INTEGER NOT NULL,
  reason TEXT NOT NULL,
  old_score INTEGER,
  new_score INTEGER,
  at INTEGER NOT NULL
);

ALTER TABLE rewrites ADD COLUMN estimate REAL;
ALTER TABLE rewrites ADD COLUMN dry INTEGER NOT NULL DEFAULT 0;

-- Near duplicates and merges that make no sense, found by one cheap pass,
-- for the owner to approve one at a time. kind: duplicate (b becomes an
-- alias of a) or senseless (the pair a + b is asked again on its next merge;
-- result is what it gave). status: pending, approved, declined.
CREATE TABLE trims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  result TEXT,
  why TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  at INTEGER NOT NULL,
  decided_at INTEGER
);

-- An approved duplicate: the alias name still works everywhere (inventories,
-- recipes, First Discoveries) and means the kept element.
CREATE TABLE aliases (
  alias TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- A senseless merge approved for a new answer: the old one, kept.
CREATE TABLE recipe_history (
  pair TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  retired_at INTEGER NOT NULL
);
