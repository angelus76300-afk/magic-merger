-- 4.5.1 (audit, risk 2): the paid nightly jobs record each attempt, whatever
-- its answer, so a design answered "none" or refused, or a night whose three
-- tries all land on existing items, is not asked again by the next ten
-- minute cron. New table only; no existing row changes.
CREATE TABLE job_runs (
  job TEXT NOT NULL,
  day TEXT NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (job, day)
);
