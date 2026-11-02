-- 3.4: one invite link per person instead of a shared access token, every
-- Claude call paid by the invite that triggered it, and a budget check that
-- two requests cannot both pass.

-- One row per person invited. The link carries a secret; only its SHA-256 is
-- kept, so a lost link is replaced (relink), never shown again. status: active,
-- paused (plays the shared library, no new magic) or revoked (the link is dead).
-- cap_usd is the monthly allowance; topup_usd is added to it for the month
-- topup_month only (YYYY-MM, UTC).
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  cap_usd REAL NOT NULL DEFAULT 5,
  topup_usd REAL NOT NULL DEFAULT 0,
  topup_month TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

-- Who paid for each call: an invite id, 'admin', or NULL for calls from
-- before 3.4.
ALTER TABLE spend ADD COLUMN invite TEXT;
CREATE INDEX spend_by_invite ON spend (invite, at);

-- Who first discovered each element, for the admin's people view.
ALTER TABLE elements ADD COLUMN invite TEXT;

-- Who asked for a rewrite or a big spell in the Batch API: its cost arrives
-- minutes later, and is paid by them. reservation holds the budget meanwhile.
ALTER TABLE rewrites ADD COLUMN invite TEXT;
ALTER TABLE rewrites ADD COLUMN reservation INTEGER;

-- Money held for a Claude call before it is made. A request first inserts its
-- estimate here, in one statement that only succeeds when the month (and the
-- invite's allowance) can still afford it, so two requests at the last dollar
-- cannot both pass. When the call returns, the real cost goes to `spend` and
-- the hold is settled in the same batch. req groups the holds of one request,
-- for the burst guard.
CREATE TABLE reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  req TEXT NOT NULL,
  invite TEXT,
  call TEXT NOT NULL,
  at INTEGER NOT NULL,
  usd REAL NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX reservations_open ON reservations (settled, invite);
CREATE INDEX reservations_by_invite ON reservations (invite, at);

-- Identical requests in flight: the first holds the key, the others wait for
-- it and then read what it stored, so Claude is asked once.
CREATE TABLE inflight (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

-- Requests refused by the burst guard (a bug guard, not a play limit).
CREATE TABLE refusals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  invite TEXT,
  path TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE INDEX refusals_by_invite ON refusals (invite, at);

-- Names players reported from a card. status: open, dismissed.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  invite TEXT,
  reason TEXT,
  at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE INDEX reports_open ON reports (status, at);
