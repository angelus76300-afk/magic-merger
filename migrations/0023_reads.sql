-- 26 November 2026: D1's rows read, by UTC day and source (worker/meter.ts).
-- The free plan stops every D1 request past 5,000,000 rows read a day; the
-- Worker now counts what it reads, and its guards stop the admin's bulk routes
-- past half the day's limit and the cron's optional jobs past four fifths.
-- source: admin (requests with the admin powers), cron (the ten minute
-- cron), player (everyone else, summed in the isolate and written once a
-- minute at most). Three rows a day. Only adds a table.
CREATE TABLE IF NOT EXISTS reads (
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
) WITHOUT ROWID;
