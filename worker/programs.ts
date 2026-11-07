import { FIRST_PROGRAM_VERSION, type SpellProgram } from "../shared/spellcode";
import { TIERS } from "../shared/tiers";
import { ACTIVE_DAYS, REASON_PROMPT, REWRITE_COOLDOWN_MS, isReason, type Tally } from "../shared/votes";
import type { LibraryExample } from "./prompts";

// Every version of every program (3.3). The `spells` table still holds the
// live one of each element, as before, plus `pid`, its row here.

// candidate (3.7): written by the refresh of the legacy library, served to
// nobody until the refresh runner decides.
export type ProgramStatus = "trial" | "live" | "retired" | "rejected" | "candidate";
export type ProgramOrigin = "legacy" | "new" | "draft" | "batch" | "votes" | "judge" | "check" | "repair" | "admin" | "promise" | "refresh" | "evidence";

export interface ProgramRow {
  id: number;
  key: string;
  spec: string;
  model: string;
  version: number;
  origin: ProgramOrigin;
  status: ProgramStatus;
  parent: number | null;
  created_at: number;
  checked: string | null;
  judged: string | null;
  library: number;
}

export function programOf(row: ProgramRow): SpellProgram | null {
  try {
    const p = JSON.parse(row.spec) as SpellProgram;
    if (typeof p.code !== "string") return null;
    return { ...p, version: row.version, model: row.model, id: row.id, ...(row.status === "trial" ? { trial: true } : {}) };
  } catch {
    return null;
  }
}

export async function getProgram(db: D1Database, id: number): Promise<ProgramRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.prepare("SELECT * FROM programs WHERE id = ?").bind(id).first<ProgramRow>();
}

// The live program of an element. Rows the 3.2 Worker wrote (or rewrote)
// after the migration have no program row of their own yet: they get one here.
export async function liveProgram(db: D1Database, key: string): Promise<{ row: ProgramRow; repairs: number } | null> {
  const s = await db
    .prepare("SELECT spec, model, version, repairs, created_at, pid FROM spells WHERE key = ? AND version >= ?")
    .bind(key, FIRST_PROGRAM_VERSION)
    .first<{ spec: string; model: string; version: number; repairs: number; created_at: number; pid: number | null }>();
  if (!s) return null;
  const row = s.pid ? await getProgram(db, s.pid) : null;
  if (row && row.created_at === s.created_at) return { row, repairs: s.repairs };
  const id = await insertProgram(db, key, s.spec, s.model, s.version, "legacy", "live", row?.id ?? null, s.created_at);
  await db.batch([
    db.prepare("UPDATE programs SET status = 'retired' WHERE key = ? AND status = 'live' AND id != ?").bind(key, id),
    db.prepare("UPDATE spells SET pid = ? WHERE key = ?").bind(id, key),
  ]);
  return { row: (await getProgram(db, id))!, repairs: s.repairs };
}

// The newest trial, when it is newer than the live program: served so that
// the next browser runs its test.
export async function newerTrial(db: D1Database, key: string, liveId: number | null): Promise<ProgramRow | null> {
  return db
    .prepare("SELECT * FROM programs WHERE key = ? AND status = 'trial' AND id > ? ORDER BY id DESC LIMIT 1")
    .bind(key, liveId ?? 0)
    .first<ProgramRow>();
}

export async function insertProgram(
  db: D1Database,
  key: string,
  spec: string,
  model: string,
  version: number,
  origin: ProgramOrigin,
  status: ProgramStatus,
  parent: number | null,
  at = Date.now(),
): Promise<number> {
  // A new trial replaces an older one nobody tested yet.
  if (status === "trial") await db.prepare("UPDATE programs SET status = 'retired' WHERE key = ? AND status = 'trial'").bind(key).run();
  const r = await db
    .prepare("INSERT INTO programs (key, spec, model, version, origin, status, parent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(key, spec, model, version, origin, status, parent, at)
    .run();
  return Number(r.meta.last_row_id);
}

// Makes a program the one everybody gets. The one it replaces is kept
// (retired), to come back to if the new one is voted worse.
export async function promote(db: D1Database, row: ProgramRow): Promise<void> {
  // A repair keeps the count of repairs; anything else starts again from zero.
  const keepRepairs = row.origin === "repair" || row.origin === "check" ? 1 : 0;
  await db.batch([
    db.prepare("UPDATE programs SET status = 'retired' WHERE key = ? AND status = 'live' AND id != ?").bind(row.key, row.id),
    db.prepare("UPDATE programs SET status = 'live' WHERE id = ?").bind(row.id),
    db
      .prepare(
        `INSERT INTO spells (key, spec, model, version, repairs, created_at, pid) VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT (key) DO UPDATE SET spec = excluded.spec, model = excluded.model, version = excluded.version,
           created_at = excluded.created_at, pid = excluded.pid, repairs = CASE WHEN ? THEN spells.repairs ELSE 0 END`,
      )
      .bind(row.key, row.spec, row.model, row.version, row.created_at, row.id, keepRepairs),
  ]);
}

export async function setStatus(db: D1Database, id: number, status: ProgramStatus): Promise<void> {
  await db.prepare("UPDATE programs SET status = ? WHERE id = ?").bind(status, id).run();
}

// Players, votes and casts.

const PLAYER = /^[a-z0-9-]{8,64}$/i;

export function playerId(request: Request): string | null {
  const id = request.headers.get("x-player");
  return id && PLAYER.test(id) ? id.toLowerCase() : null;
}

export function dayOf(at: number): number {
  return Math.floor(at / 86400_000);
}

export async function recordActivity(db: D1Database, player: string, now = Date.now()): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO activity (day, player) VALUES (?, ?)").bind(dayOf(now), player).run();
}

// Players a day, on average over the last seven days (today included).
export async function averageDaily(db: D1Database, now = Date.now()): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM activity WHERE day > ?")
    .bind(dayOf(now) - ACTIVE_DAYS)
    .first<{ n: number }>();
  return (row?.n ?? 0) / ACTIVE_DAYS;
}

export async function tally(db: D1Database, pid: number): Promise<Tally> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(up), 0) AS up, COUNT(*) - COALESCE(SUM(up), 0) AS down FROM votes WHERE pid = ?")
    .bind(pid)
    .first<{ up: number; down: number }>();
  return { up: row?.up ?? 0, down: row?.down ?? 0 };
}

// What players said about a version, one line per reason, for the rewrite prompt.
export async function downReasons(db: D1Database, pid: number): Promise<string[]> {
  const rows = await db
    .prepare("SELECT reason, COUNT(*) AS n FROM votes WHERE pid = ? AND up = 0 GROUP BY reason ORDER BY n DESC")
    .bind(pid)
    .all<{ reason: string | null; n: number }>();
  return rows.results.map((r) => {
    const why = isReason(r.reason) ? REASON_PROMPT[r.reason] : "they did not like it";
    return `${r.n} ${r.n === 1 ? "player" : "players"} voted it down: ${why}`;
  });
}

export async function recentRewrite(db: D1Database, key: string, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM rewrites WHERE key = ? AND at > ? AND cause IN ('votes', 'judge', 'evidence') AND status != 'failed' LIMIT 1")
    .bind(key, now - REWRITE_COOLDOWN_MS)
    .first();
  return !!row;
}

// Rewrites a session may ask in a day through scripts/rewrite-one.mjs (docs/DAILY.md,
// "One spell at a time"). Every admin rewrite of the last 24 hours counts, the
// owner's card included, so the fourth one a session asks is refused whatever
// the order. The owner's card itself is never refused.
export const SESSION_REWRITES_PER_DAY = 3;

export async function adminRewritesSince(db: D1Database, since: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM programs WHERE origin = 'admin' AND created_at >= ?").bind(since).first<{ n: number }>();
  return row?.n ?? 0;
}

// Calls that rewrite an existing spell, counted against the daily rewrite budget.
export const REWRITE_CALLS = ["rewrite", "rewrite-retry", "batch-rewrite"];

// Dollars spent on rewrites today, plus an estimate for those still in a batch.
export async function rewriteSpendToday(db: D1Database, pendingEstimate: number, now = Date.now()): Promise<number> {
  const today = dayOf(now) * 86400_000;
  const spent = await db
    .prepare(`SELECT COALESCE(SUM(usd), 0) AS usd FROM spend WHERE at >= ? AND call IN (${REWRITE_CALLS.map(() => "?").join(", ")})`)
    .bind(today, ...REWRITE_CALLS)
    .first<{ usd: number }>();
  // The refresh of the library (3.7) has its own cap, not the daily rewrites'.
  const pending = await db
    .prepare("SELECT COUNT(*) AS n FROM rewrites WHERE status = 'pending' AND cause NOT IN ('upgrade', 'refresh')")
    .first<{ n: number }>();
  return (spent?.usd ?? 0) + (pending?.n ?? 0) * pendingEstimate;
}

// The library: programs players voted up, retrieved by the words they share
// with the spell being written. A hundred programs at most are compared, in
// the Worker, without embeddings: the names and grimoire entries are short
// and the words that matter (fire, tree, storm, vampire) are literal.

const STOP = new Set(
  "a an the of and or to in on at by for with from into over under it its is are be as that this their them they which when where who while each every all any its you your one two few many more most much very than then so up out off not no can will would"
    .split(" ")
    .filter(Boolean),
);

export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "") || raw);
  }
  return out;
}

export interface LibraryEntry extends LibraryExample {
  key: string;
  description: string;
}

// Best two: shared words (the name counts double), same kind, nearby tier.
export function pickExamples(
  entries: LibraryEntry[],
  target: { key: string; name: string; description: string; kind: string; tier: string },
  k = 2,
): LibraryExample[] {
  const name = words(target.name);
  const text = words(`${target.name} ${target.description}`);
  const scored = entries
    .filter((e) => e.key !== target.key)
    .map((e) => {
      const ew = words(`${e.name} ${e.description}`);
      let s = 0;
      for (const w of ew) if (text.has(w)) s += name.has(w) ? 2 : 1;
      if (e.kind === target.kind) s += 1;
      s -= Math.abs(TIERS.indexOf(e.tier as never) - TIERS.indexOf(target.tier as never)) * 0.5;
      return { e, s };
    })
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map(({ e }) => ({ name: e.name, tier: e.tier, kind: e.kind, code: e.code.slice(0, 3000) }));
}

export async function libraryEntries(db: D1Database): Promise<LibraryEntry[]> {
  const rows = await db
    .prepare(
      `SELECT p.key, p.spec, e.name, e.tier, e.kind, e.description FROM programs p JOIN elements e ON e.key = p.key
       WHERE p.library = 1 AND p.status = 'live' ORDER BY p.id DESC LIMIT 200`,
    )
    .all<{ key: string; spec: string; name: string; tier: string | null; kind: string; description: string | null }>();
  const out: LibraryEntry[] = [];
  for (const r of rows.results) {
    try {
      const code = (JSON.parse(r.spec) as SpellProgram).code;
      if (typeof code === "string") out.push({ key: r.key, name: r.name, tier: r.tier ?? "major", kind: r.kind, description: r.description ?? "", code });
    } catch {
      // Not a program: skipped.
    }
  }
  return out;
}
