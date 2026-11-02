-- 3.4.1: what each element promises, and an API that grows from what spells lacked.

-- One or two intents, as "protect" or "protect,harm" (shared/promises.ts).
-- Decided once, from the name and grimoire entry, before a program is written.
ALTER TABLE elements ADD COLUMN intents TEXT;

-- What a program's writer said the World API lacked for it, one row per
-- program that said so. extension is the change the API made in answer.
CREATE TABLE gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  pid INTEGER,
  missing TEXT NOT NULL,
  at INTEGER NOT NULL,
  extension INTEGER
);

CREATE INDEX gaps_open ON gaps (extension, at);

-- How the API grew. kind: helper (a sandboxed function spells call as
-- lib.name, tested before it goes live), hint (a line in the writers' prompt
-- for what the API could already do), engine (a change to the simulation,
-- proposed for a developer to review). status: trial, live, retired,
-- rejected for helpers and hints; open, done, rejected for engine proposals.
CREATE TABLE extensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  doc TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  spec TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  -- What the spells it answers promise: its example faces the same test run.
  intents TEXT,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- The test run of a helper's example, as JSON; for an engine proposal, its issue.
  checked TEXT,
  issue TEXT
);

CREATE INDEX extensions_by_status ON extensions (status, kind);
