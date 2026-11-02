-- Power tier of each element, chosen by the merge model. NULL for elements
-- discovered before tiers existed: they get one the first time it is needed.
ALTER TABLE elements ADD COLUMN tier TEXT;

-- Spells are now programs (version 2). Version 1 rows are old declarative specs
-- and are redesigned the first time they are cast.
ALTER TABLE spells ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
-- How many times a crashing program was sent back to Claude for a fix.
ALTER TABLE spells ADD COLUMN repairs INTEGER NOT NULL DEFAULT 0;

-- Every Claude call and what it cost, for the monthly budget cap.
CREATE TABLE spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  call TEXT NOT NULL,
  model TEXT NOT NULL,
  usd REAL NOT NULL
);

CREATE INDEX spend_by_time ON spend (at);
