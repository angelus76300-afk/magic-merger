-- 4.6: what an item is, of seven kinds (shared/forms.ts). `elements.kind`
-- stays spell or artifact; `form` says which kind of thing an artifact is
-- (creature, object, building, settlement, place, land), so the engine's own
-- maker builds it and its test run holds it to its size. New merges set it;
-- existing rows keep NULL, read as a guess from the name, until the owner
-- approves the library's sort. New column and table only: no existing row
-- changes.
ALTER TABLE elements ADD COLUMN form TEXT;

-- The library's sort (Haiku, POST /api/admin/forms): one proposal per item,
-- shown to the owner before anything is applied (status proposed, then
-- applied or declined), and the time it was applied, from which the
-- rewrites by form start (startRefresh with forms: true), and the grimoire
-- entry the item had before its first rewrite by form, kept: an entry written
-- for the wrong kind ("a palm-sized model of a thatched hamlet") is written
-- again with the program, and the old one stays here.
CREATE TABLE forms (
  key TEXT PRIMARY KEY,
  form TEXT NOT NULL,
  was TEXT,
  reason TEXT,
  model TEXT,
  at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  applied_at INTEGER,
  entry TEXT
);
