-- 4.7: the cron's look for elements with no promise yet (backfillIntents) read
-- the whole elements table at every run, 144 times a day, to find none. This
-- index holds only those elements, so it is empty (and reads nothing) once
-- they all have one. Creating it writes no row while none lacks one.
CREATE INDEX elements_without_intents ON elements (created_at) WHERE intents IS NULL;

-- The evidence job asks, for each program that failed its test run, whether a
-- rewrite started from it: with no index on from_pid that was a scan of the
-- whole rewrites table per program. Creating it writes one index row per
-- existing rewrite, a few thousand.
CREATE INDEX rewrites_by_from ON rewrites (from_pid);
