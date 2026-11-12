-- 4.7: running totals of `spend`, so the budget hold reads a handful of rows
-- instead of the whole month. The hold summed every `spend` row of the month
-- on each paid call: 4,205 rows per call on 10 November, growing by about 470
-- a day, 47% of all rows read. Now it reads one row for the game and one for
-- the invite.
--
-- One row per UTC month (YYYY-MM, the month of the spend row's `at`) and
-- scope: '*' for the whole game, else the invite id ('admin' included).
-- Rows from before 3.4 have no invite and count in '*' only, as the per invite
-- sums never matched them.
--
-- `spend` stays the source of truth: the totals are kept by triggers on it,
-- so every way a row is written (a settled call, a collected batch, a hold the
-- sweep bills, a test seeding the ledger) counts in the same statement, and
-- the cron compares them with the ledger once a day (ledger.ts, checkTotals).
-- Nothing in an existing table changes.
CREATE TABLE spend_totals (
  month TEXT NOT NULL,
  scope TEXT NOT NULL,
  usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (month, scope)
) WITHOUT ROWID;

-- Backfill once, every month, from the ledger: one scan of `spend` at deploy,
-- so the caps are right from the first call after it.
INSERT INTO spend_totals (month, scope, usd)
SELECT strftime('%Y-%m', at / 1000, 'unixepoch'), '*', SUM(usd) FROM spend GROUP BY 1;

INSERT INTO spend_totals (month, scope, usd)
SELECT strftime('%Y-%m', at / 1000, 'unixepoch'), invite, SUM(usd) FROM spend WHERE invite IS NOT NULL GROUP BY 1, 2;

CREATE TRIGGER spend_totals_insert AFTER INSERT ON spend
BEGIN
  INSERT INTO spend_totals (month, scope, usd)
  SELECT strftime('%Y-%m', NEW.at / 1000, 'unixepoch'), '*', NEW.usd WHERE 1
  ON CONFLICT (month, scope) DO UPDATE SET usd = usd + excluded.usd;
  INSERT INTO spend_totals (month, scope, usd)
  SELECT strftime('%Y-%m', NEW.at / 1000, 'unixepoch'), NEW.invite, NEW.usd WHERE NEW.invite IS NOT NULL
  ON CONFLICT (month, scope) DO UPDATE SET usd = usd + excluded.usd;
END;

CREATE TRIGGER spend_totals_delete AFTER DELETE ON spend
BEGIN
  UPDATE spend_totals SET usd = usd - OLD.usd
  WHERE month = strftime('%Y-%m', OLD.at / 1000, 'unixepoch') AND (scope = '*' OR scope = OLD.invite);
END;

CREATE TRIGGER spend_totals_update AFTER UPDATE OF at, usd, invite ON spend
BEGIN
  UPDATE spend_totals SET usd = usd - OLD.usd
  WHERE month = strftime('%Y-%m', OLD.at / 1000, 'unixepoch') AND (scope = '*' OR scope = OLD.invite);
  INSERT INTO spend_totals (month, scope, usd)
  SELECT strftime('%Y-%m', NEW.at / 1000, 'unixepoch'), '*', NEW.usd WHERE 1
  ON CONFLICT (month, scope) DO UPDATE SET usd = usd + excluded.usd;
  INSERT INTO spend_totals (month, scope, usd)
  SELECT strftime('%Y-%m', NEW.at / 1000, 'unixepoch'), NEW.invite, NEW.usd WHERE NEW.invite IS NOT NULL
  ON CONFLICT (month, scope) DO UPDATE SET usd = usd + excluded.usd;
END;
