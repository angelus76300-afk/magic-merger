-- 4.5: daily challenges and the Community tab.
--
-- Daily challenges. Each night the Worker picks two items of the shared pool
-- that nobody has merged, makes their merge ahead and keeps the pair secret:
-- the result is an element row from that night (its name, emoji, tier and
-- description are shown in the Daily tab), but the recipe is not in
-- `recipes` until someone finds it. Whoever first reaches the item, by the
-- secret pair or by any other merge that gives it, is its finder and its
-- First Discovery. An open challenge never expires (the owner's choice).
-- day is the date in Toronto it was set; found_pair the pair the finder used.
CREATE TABLE daily_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL UNIQUE,
  pair TEXT NOT NULL UNIQUE,
  result TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  usd REAL NOT NULL DEFAULT 0,
  found_by TEXT,
  found_at INTEGER,
  found_pair TEXT
);

CREATE INDEX daily_open ON daily_challenges (found_at);

-- The Community tab: each player's favorite spell (an element key from their
-- own discoveries), and whether they hide themselves from the tab.
ALTER TABLE invites ADD COLUMN favorite TEXT;
ALTER TABLE invites ADD COLUMN community_hidden INTEGER NOT NULL DEFAULT 0;
