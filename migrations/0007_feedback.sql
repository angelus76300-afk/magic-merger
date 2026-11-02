-- 3.4.1: the Feedback tab. Invited players post ideas and vote for them; the
-- admin sends one to Claude, which opens a GitHub issue and starts a Claude
-- Code routine that answers with a pull request (docs/FEEDBACK.md).

-- status: open (collecting votes), sent (Claude is working on it), review (a
-- pull request is open), shipped (merged), declined (by the admin, or the pull
-- request was closed without merging). brief is what the admin sent to Claude,
-- edited from the player's text. checked_at orders the cron's look at GitHub.
CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invite TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT,
  brief TEXT,
  issue_number INTEGER,
  issue_url TEXT,
  session_url TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  checked_at INTEGER
);

CREATE INDEX suggestions_by_status ON suggestions (status, checked_at);
CREATE INDEX suggestions_by_invite ON suggestions (invite, created_at);

-- One vote per invite per idea, up only: the author's own vote is added when
-- the idea is posted.
CREATE TABLE suggestion_votes (
  suggestion INTEGER NOT NULL,
  invite TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (suggestion, invite)
);
