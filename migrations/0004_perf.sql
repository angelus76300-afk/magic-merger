-- Frame time summaries sent by the frame HUD from real devices (3.2), so a
-- phone session can be read back as numbers. Rows older than 30 days are dropped.
CREATE TABLE perf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  ua TEXT NOT NULL,
  sample TEXT NOT NULL
);

CREATE INDEX perf_by_time ON perf (at);
