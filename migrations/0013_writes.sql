-- 4.2: every new item is written at the merge, by a background job
-- (worker/ahead.ts, through the WRITES queue), and so is a known item without
-- a program the first time a player gets it. One row per item, ever: the
-- primary key is what makes the job idempotent, so two players never pay
-- twice. status: queued, writing, done, failed, capped (over the day's cap:
-- written on first use instead), unpaid (the player's allowance or the month
-- could not take it: written on first use too).
CREATE TABLE writes (
  key TEXT PRIMARY KEY,
  -- Who pays: the player whose merge started it.
  invite TEXT NOT NULL,
  -- new (the merge made the item) or first (a known item, first got).
  cause TEXT NOT NULL,
  status TEXT NOT NULL,
  -- The UTC day it was queued, for the daily cap (AHEAD_DAILY_USD).
  day TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  done_at INTEGER,
  -- Held against the day's cap while it is written, then what it cost.
  est REAL NOT NULL DEFAULT 0,
  usd REAL NOT NULL DEFAULT 0,
  model TEXT,
  pid INTEGER,
  error TEXT
);

CREATE INDEX writes_by_day ON writes (day, status);
