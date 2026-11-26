-- 26 November 2026: the account passed D1's free 5,000,000 rows read a day and
-- every request failed until midnight UTC. The admin runners' routes scanned
-- whole tables at each call, some once per row (scripts/read-plan.mjs lists
-- every scan of a growing table and fails on a new one). Indexes only: no row
-- of any table changes. Creating each reads its table once and writes one
-- index row per row it holds; afterwards each insert into the table writes one
-- more row (D1 counts index rows as rows written).

-- The refresh's candidates (/api/admin/refresh-candidates): the programs
-- waiting for the runner's verdict were found by reading every program.
CREATE INDEX IF NOT EXISTS programs_candidates ON programs (origin, id) WHERE status = 'candidate';

-- The rewrite that wrote a program, by the program: refresh-candidates asked
-- it twice per candidate, each a scan of the whole rewrites table, and
-- refresh-verdict once per verdict.
CREATE INDEX IF NOT EXISTS rewrites_by_to ON rewrites (to_pid);

-- The refresh's own rewrites (refresh-report, and the month's refresh holds
-- that every refresh start reads). Partial, on the literal the code uses: a
-- full index on cause was preferred by the planner over rewrites_by_key for
-- `key = ? AND cause = 'refresh'`, once per item of the refresh start.
CREATE INDEX IF NOT EXISTS rewrites_refresh ON rewrites (at) WHERE cause = 'refresh';

-- What the refresh cost (refresh-report). Partial too: an index on (call, at)
-- led /api/spend's month to read every spend row in call order.
CREATE INDEX IF NOT EXISTS spend_refresh ON spend (at) WHERE call = 'refresh';

-- Casts by program: the primary key is (player, pid), so a count of one
-- program's casts read every cast. looks-pool did it once per item, and the
-- refresh start built a temporary index of all casts at each call.
CREATE INDEX IF NOT EXISTS casts_by_pid ON casts (pid);
