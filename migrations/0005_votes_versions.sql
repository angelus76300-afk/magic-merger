-- 3.3: every version of every program is kept, players vote on them, and the
-- votes decide rewrites and rollbacks.

-- Every program ever written for an element. status: trial (written, not yet
-- through its test run), live (the one served), retired (replaced, kept to
-- come back to), rejected (failed its test run, or voted worse than its parent).
-- origin: why it was written (legacy, new, draft, batch, votes, judge, check,
-- repair, admin). checked and judged hold the test run and the judge's verdict as JSON.
CREATE TABLE programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  spec TEXT NOT NULL,
  model TEXT NOT NULL,
  version INTEGER NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL,
  parent INTEGER,
  created_at INTEGER NOT NULL,
  checked TEXT,
  judged TEXT,
  -- Votes when it was replaced, to compare its rewrite against.
  up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0,
  -- 1 when players voted it up: an example the small model is shown.
  library INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX programs_by_key ON programs (key, id);
CREATE INDEX programs_library ON programs (library) WHERE library = 1;

-- The live program of each element, as before, plus which version it is.
ALTER TABLE spells ADD COLUMN pid INTEGER;

INSERT INTO programs (key, spec, model, version, origin, status, created_at)
  SELECT key, spec, model, version, 'legacy', 'live', created_at FROM spells WHERE version >= 2;
UPDATE spells SET pid = (SELECT p.id FROM programs p WHERE p.key = spells.key) WHERE version >= 2;

-- Anonymous players: a random id per browser, and the days each one played,
-- for the number of votes a rewrite needs.
CREATE TABLE activity (
  day INTEGER NOT NULL,
  player TEXT NOT NULL,
  PRIMARY KEY (day, player)
);

-- The last time each player cast each program version: only they may vote on it.
CREATE TABLE casts (
  player TEXT NOT NULL,
  pid INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (player, pid)
);

-- One vote per player per program version. reason is set on down votes.
CREATE TABLE votes (
  player TEXT NOT NULL,
  pid INTEGER NOT NULL,
  key TEXT NOT NULL,
  up INTEGER NOT NULL,
  reason TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (player, pid)
);

CREATE INDEX votes_by_pid ON votes (pid);

-- Rewrites asked for by votes, the judge or a test run, for the cooldown, and
-- the big ones waiting in the Batch API. status: pending (in a batch), done, failed.
CREATE TABLE rewrites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  from_pid INTEGER,
  to_pid INTEGER,
  cause TEXT NOT NULL,
  at INTEGER NOT NULL,
  status TEXT NOT NULL,
  batch TEXT,
  model TEXT,
  request TEXT
);

CREATE INDEX rewrites_by_key ON rewrites (key, at);
CREATE INDEX rewrites_pending ON rewrites (status) WHERE status = 'pending';
