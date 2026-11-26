// D1's rows read, counted (26 November 2026). Cloudflare's free plan allows
// 5,000,000 rows read a day for the whole account; past it every D1 request
// fails with 7500 until 00:00 UTC, the players' too. That day the admin
// runners passed it, and nothing in the Worker could tell.
//
// `metered` wraps the database once per request (and once per cron run):
// every statement's meta.rows_read and rows_written are added to the meter.
// Results are unchanged. `first()` returns no meta, so it is run as `all()`
// and its first row (or that row's column) returned: D1 runs the whole
// statement for first() too, so it reads the same rows.
//
// What a request read is added to `reads`, one row per UTC day and source
// (admin, cron, player), by one upsert. Admin requests and cron runs write it
// at once (a few thousand writes a day at most, of the free 100,000); players'
// reads are summed in the isolate and written once a minute at most, so a busy
// day costs at most one write per isolate per minute. Reads made elsewhere
// (the staging database, `wrangler d1 execute`, an isolate evicted before it
// wrote) are not counted: the guards below act at half and four fifths of the
// limit for that margin.

export type ReadSource = "admin" | "cron" | "player";

export class Meter {
  read = 0;
  written = 0;
  // Set once the request is known to have the admin powers.
  admin = false;
  add(meta: { rows_read?: number; rows_written?: number } | undefined): void {
    this.read += meta?.rows_read ?? 0;
    this.written += meta?.rows_written ?? 0;
  }
}

const REAL = new WeakMap<object, D1PreparedStatement>();

function meteredStatement(stmt: D1PreparedStatement, meter: Meter): D1PreparedStatement {
  const wrapped = new Proxy(stmt, {
    get(target, key) {
      if (key === "bind") return (...values: unknown[]) => meteredStatement(target.bind(...values), meter);
      if (key === "all" || key === "run")
        return async () => {
          const res = await target[key]();
          meter.add(res.meta);
          return res;
        };
      if (key === "first")
        return async (column?: string) => {
          const res = await target.all<Record<string, unknown>>();
          meter.add(res.meta);
          const row = res.results[0] ?? null;
          if (column === undefined || row === null) return row;
          if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
          return row[column];
        };
      const v: unknown = Reflect.get(target, key, target);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  REAL.set(wrapped, stmt);
  return wrapped;
}

export function metered(db: D1Database, meter: Meter): D1Database {
  return new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => meteredStatement(target.prepare(sql), meter);
      if (key === "batch")
        return async (stmts: D1PreparedStatement[]) => {
          const res = await target.batch(stmts.map((s) => REAL.get(s) ?? s));
          for (const r of res) meter.add(r.meta);
          return res;
        };
      const v: unknown = Reflect.get(target, key, target);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

// The request's context, with every waitUntil promise kept in `later` too, so
// what the request reads in the background is counted before it is recorded.
export function deferring(ctx: ExecutionContext, later: Promise<unknown>[]): ExecutionContext {
  return new Proxy(ctx, {
    get(target, key) {
      if (key === "waitUntil")
        return (p: Promise<unknown>) => {
          later.push(p);
          target.waitUntil(p);
        };
      const v: unknown = Reflect.get(target, key, target);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

export const READS_DAY_DEFAULT = 5_000_000;
// Past these shares of the day's limit, the admin's bulk routes answer 429
// and the cron does only what players need.
export const ADMIN_SHARE = 0.5;
export const CRON_SHARE = 0.8;

export function readsLimit(raw: string | undefined): number {
  const v = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(v) && v >= 0 ? v : READS_DAY_DEFAULT;
}

// D1's limit resets at 00:00 UTC.
export function readsDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

// The day's rows read so far, all sources (three rows of `reads`).
export async function readsToday(db: D1Database, now = Date.now()): Promise<{ read: number; written: number }> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(rows_read), 0) AS r, COALESCE(SUM(rows_written), 0) AS w FROM reads WHERE day = ?")
    .bind(readsDay(now))
    .first<{ r: number; w: number }>();
  return { read: row?.r ?? 0, written: row?.w ?? 0 };
}

export async function addReads(db: D1Database, source: ReadSource, read: number, written: number, now = Date.now()): Promise<void> {
  if (read <= 0 && written <= 0) return;
  await db
    .prepare(
      `INSERT INTO reads (day, source, rows_read, rows_written) VALUES (?, ?, ?, ?)
       ON CONFLICT (day, source) DO UPDATE SET rows_read = rows_read + excluded.rows_read, rows_written = rows_written + excluded.rows_written`,
    )
    .bind(readsDay(now), source, read, written)
    .run();
}

// Players' reads, held in the isolate between writes.
const PLAYER_FLUSH_MS = 60_000;
const held = { read: 0, written: 0, since: 0 };

// Records what a request read: at once for the admin and the cron, at most
// once a minute for players. Never throws: a meter that fails never fails
// the request.
export async function recordReads(db: D1Database, source: ReadSource, meter: Meter, now = Date.now()): Promise<void> {
  try {
    if (source !== "player") return await addReads(db, source, meter.read, meter.written, now);
    held.read += meter.read;
    held.written += meter.written;
    if (held.since === 0) held.since = now;
    if (now - held.since < PLAYER_FLUSH_MS && readsDay(held.since) === readsDay(now)) return;
    const { read, written } = held;
    held.read = 0;
    held.written = 0;
    held.since = 0;
    await addReads(db, "player", read, written, now);
  } catch (err) {
    console.error("reads: could not record", err);
  }
}

export interface ReadsReport {
  day: string;
  rowsRead: number;
  rowsWritten: number;
  limit: number;
  // Past these, the admin's bulk routes and the cron's optional jobs stop.
  adminStopsAt: number;
  cronStopsAt: number;
  bySource: { source: string; rowsRead: number; rowsWritten: number }[];
}

export async function readsReport(db: D1Database, limitRaw: string | undefined, now = Date.now()): Promise<ReadsReport> {
  const limit = readsLimit(limitRaw);
  const day = readsDay(now);
  const rows = await db
    .prepare("SELECT source, rows_read AS r, rows_written AS w FROM reads WHERE day = ? ORDER BY source")
    .bind(day)
    .all<{ source: string; r: number; w: number }>();
  const bySource = rows.results.map((x) => ({ source: x.source, rowsRead: x.r, rowsWritten: x.w }));
  return {
    day,
    rowsRead: bySource.reduce((s, x) => s + x.rowsRead, 0),
    rowsWritten: bySource.reduce((s, x) => s + x.rowsWritten, 0),
    limit,
    adminStopsAt: Math.floor(limit * ADMIN_SHARE),
    cronStopsAt: Math.floor(limit * CRON_SHARE),
    bySource,
  };
}
