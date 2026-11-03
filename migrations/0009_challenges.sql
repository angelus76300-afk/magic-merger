-- 3.7: challenges from nothing. Which spells solve each challenge, verified
-- in the simulation, and every win with its number of merges.

-- A spell tried against a challenge: ok when it won, for the program it was
-- (pid). A program rewritten since is no longer verified and is tried again.
-- origin: probe (scripts/challenge-runner.ts) or player (a win in a browser).
CREATE TABLE challenge_solvers (
  challenge TEXT NOT NULL,
  key TEXT NOT NULL,
  pid INTEGER,
  ok INTEGER NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (challenge, key)
);

-- A win: who, how many merges, with what. The fewest merges is the par
-- players beat, and the best friend on the challenge card.
CREATE TABLE challenge_wins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge TEXT NOT NULL,
  invite TEXT NOT NULL,
  merges INTEGER NOT NULL,
  spell TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX challenge_wins_by ON challenge_wins (challenge, merges);
