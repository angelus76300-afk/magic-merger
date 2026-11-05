import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// An in-memory D1 for `npm test` (4.5.1): node:sqlite with every migration
// applied, and enough of the D1 API (prepare, bind, first, all, run, batch)
// for the Worker's own functions to run on it, so a money guard or a cron job
// is tested without wrangler. One statement at a time: it says nothing about
// D1 under concurrency, which scripts/worker-test.mjs checks.
type Arg = string | number | bigint | null;

export function memoryD1(dir = "migrations"): D1Database {
  const db = new DatabaseSync(":memory:");
  let depth = 0;
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`${dir}/${f}`, "utf8"));
  const statement = (sql: string, args: Arg[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v)) as Arg[]),
    first: async (column?: string) => {
      const row = db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
      return row ? (column ? row[column] : row) : null;
    },
    all: async () => ({ results: db.prepare(sql).all(...args), success: true, meta: {} }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql: string) => statement(sql),
    // As D1: a batch is one transaction, rolled back whole when a statement
    // fails. A batch started while another runs joins it (T8): D1 would run
    // both; one connection here cannot nest a transaction.
    batch: async (list: { run: () => Promise<unknown> }[]) => {
      const out = [];
      const outer = depth++ === 0;
      if (outer) db.exec("BEGIN");
      try {
        for (const s of list) out.push(await s.run());
        if (outer) db.exec("COMMIT");
      } catch (err) {
        if (outer) db.exec("ROLLBACK");
        throw err;
      } finally {
        depth--;
      }
      return out;
    },
  } as unknown as D1Database;
}
