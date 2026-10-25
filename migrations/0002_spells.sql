-- The spell spec of every spell that was ever prepared for casting, as JSON.
CREATE TABLE spells (
  key TEXT PRIMARY KEY,
  spec TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
