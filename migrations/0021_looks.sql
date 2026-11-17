-- The looks revamp (roadmap 5.2.5): one row per item whose look the look-only writer redrew.
-- Only adds a table: nothing in an existing table changes.
--
-- target: 'program' (a library item's live program, by key and from_pid) or 'wonder' (a wonder
-- of the pool, by wonder_id). status: pending (in a batch), candidate (spliced, waiting for the
-- runner's test, frames and judge), replaced (the new look went live), kept (the old one stayed),
-- failed (the writer's answer could not be spliced, or the batch failed), skipped (nothing to
-- redraw: no model call). old_code is kept, so a replaced look can be put back.
CREATE TABLE looks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL CHECK (target IN ('program', 'wonder')),
  key TEXT,
  wonder_id INTEGER,
  from_pid INTEGER,
  to_pid INTEGER,
  status TEXT NOT NULL,
  pilot INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  batch TEXT,
  -- Dollars held for the writer's answer while it is pending, and what it really cost (writer
  -- and judge together).
  estimate REAL NOT NULL DEFAULT 0,
  usd REAL NOT NULL DEFAULT 0,
  old_code TEXT,
  new_code TEXT,
  plan TEXT,
  refused TEXT,
  old_score INTEGER,
  new_score INTEGER,
  judged TEXT,
  reason TEXT,
  at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX looks_by_status ON looks (status);
CREATE INDEX looks_by_key ON looks (key);
CREATE INDEX looks_by_wonder ON looks (wonder_id);
