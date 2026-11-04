-- 4.1 (review L2): who sent each frame time summary, so one invite writes at
-- most one row every 20 seconds, as the page already sends them.
ALTER TABLE perf ADD COLUMN invite TEXT;

CREATE INDEX perf_by_invite ON perf (invite, at);
