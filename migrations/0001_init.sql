-- Every element ever discovered. The primitives live in code, not here.
CREATE TABLE elements (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spell', 'artifact')),
  depth INTEGER NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL
);

-- The frozen answer for every pair ever tried. pair is "a+b" with a <= b.
CREATE TABLE recipes (
  pair TEXT PRIMARY KEY,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX recipes_by_result ON recipes (result);
