// 3.4: who may play, who pays for each Claude call, and the budget check.
//
// Every person has an invite link. The link carries a secret the browser keeps
// and sends with each request; the Worker keeps only its SHA-256. Every Claude
// call is paid by an invite (or 'admin'), in the `spend` table.
//
// Before a call, the request holds its estimated cost in `reservations` with
// one INSERT ... SELECT that only succeeds when the month's spend plus every
// open hold plus this one stays under the budget, and under the invite's own
// allowance. D1 runs one statement at a time, so two requests at the last
// dollar cannot both pass. When the call returns, its real cost goes to
// `spend` and the hold is settled, in one batch.

export type InviteStatus = "active" | "paused" | "revoked";

export interface InviteRow {
  id: string;
  token_hash: string;
  name: string;
  status: InviteStatus;
  cap_usd: number;
  topup_usd: number;
  topup_month: string | null;
  created_at: number;
  last_seen: number | null;
  // 4.0: when the account was made with a passkey, when the person asked
  // for deletion, and an email for sign in links, if the person set one.
  claimed_at?: number | null;
  deleted_at?: number | null;
  email?: string | null;
  // 4.4.6: the owner's account ('admin'): the admin powers on every device
  // signed in to it, and no allowance of its own (only the monthly budget).
  admin?: number;
}

// Who pays: an invite, or the admin (no allowance, only the monthly budget).
export interface Payer {
  invite: string;
  name: string;
  status: InviteStatus;
  // Dollars this month, null for the admin.
  cap: number | null;
}

export const ADMIN_PAYER: Payer = { invite: "admin", name: "admin", status: "active", cap: null };

// Holds of one request: settled together when it ends.
export class Ledger {
  readonly req = crypto.randomUUID();
  readonly held: number[] = [];
  // How long each Claude call of this request took (4.2), for Server-Timing.
  readonly timings: { call: string; ms: number }[] = [];
  // A background job (4.2, ahead.ts) is not a client in a loop: the burst
  // guard does not count it. Its money is held like any other call.
  burstFree = false;
  // Dollars already written to spend by the request's other oracles (a
  // writer with another model), so a job knows what it cost in all (4.2).
  recorded = 0;
  constructor(readonly payer: Payer) {}
}

// What a call is expected to cost at most, held before it is made. Measured
// averages (docs/SETUP.md) are lower: a merge $0.0013, a description $0.0001,
// a Haiku spell $0.002, an Opus spell $0.076, an Opus batch item $0.04.
export const ESTIMATE = {
  merge: 0.004,
  describe: 0.001,
  intent: 0.001,
  design: 0.4,
  tier: 0.05,
  judge: 0.004,
  chronicle: 0.006,
  trim: 0.1,
  small: 0.008,
  big: 0.15,
  batch: 0.06,
} as const;

// The bug guard: more paid requests than this from one invite within the
// window are refused and logged. Not a play limit: a player merging by hand
// never comes near it; a client stuck in a loop does at once.
export const BURST = { requests: 10, windowMs: 5000 };

// Identical requests in flight wait this long for the first one at most.
const INFLIGHT_WAIT_MS = 60_000;
// A key held longer than this belongs to a request that died.
const INFLIGHT_STALE_MS = 90_000;

export class LedgerError extends Error {
  constructor(
    readonly status: number,
    readonly code: "budget" | "spent" | "paused" | "burst",
    message: string,
  ) {
    super(message);
  }
}

export function monthStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function monthKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

// This month's allowance of an invite: its cap plus this month's top-up.
export function allowance(row: Pick<InviteRow, "cap_usd" | "topup_usd" | "topup_month">, now = Date.now()): number {
  return row.cap_usd + (row.topup_month === monthKey(now) ? row.topup_usd : 0);
}

export function payerOf(row: InviteRow): Payer {
  return { invite: row.id, name: row.name, status: row.status, cap: row.admin ? null : allowance(row) };
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 24 random bytes, URL safe: the secret in a link (32 for a session token).
export function newSecret(size = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function inviteByToken(db: D1Database, token: string): Promise<InviteRow | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return db
    .prepare("SELECT * FROM invites WHERE token_hash = ?")
    .bind(await sha256(token))
    .first<InviteRow>();
}

export async function createInvite(db: D1Database, name: string, cap: number): Promise<{ row: InviteRow; secret: string }> {
  const secret = newSecret();
  const id = crypto.randomUUID().slice(0, 8);
  const row: InviteRow = {
    id,
    token_hash: await sha256(secret),
    name,
    status: "active",
    cap_usd: cap,
    topup_usd: 0,
    topup_month: null,
    created_at: Date.now(),
    last_seen: null,
  };
  await db
    .prepare("INSERT INTO invites (id, token_hash, name, status, cap_usd, topup_usd, created_at) VALUES (?, ?, ?, 'active', ?, 0, ?)")
    .bind(row.id, row.token_hash, row.name, row.cap_usd, row.created_at)
    .run();
  return { row, secret };
}

// A new secret for the same person: the old link stops working, the history stays.
export async function relink(db: D1Database, id: string): Promise<string | null> {
  const secret = newSecret();
  const r = await db
    .prepare("UPDATE invites SET token_hash = ? WHERE id = ? AND status != 'revoked'")
    .bind(await sha256(secret), id)
    .run();
  return r.meta.changes ? secret : null;
}

// Holds `usd` for one call, or throws why it may not be made. The burst guard
// counts requests, not calls: a spell that needs its description first holds
// twice under the same request.
export async function hold(db: D1Database, ledger: Ledger, call: string, usd: number, budget: number, now = Date.now()): Promise<number> {
  const p = ledger.payer;
  if (p.status === "paused") throw new LedgerError(402, "paused", "Your invite is paused for now. Everything already discovered still works.");
  const start = monthStart(now);
  const guarded = p.invite !== "admin" && !ledger.burstFree;
  const r = await db
    .prepare(
      `INSERT INTO reservations (req, invite, call, at, usd)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE (SELECT COALESCE(SUM(usd), 0) FROM spend WHERE at >= ?6)
           + (SELECT COALESCE(SUM(usd), 0) FROM reservations WHERE settled = 0) + ?5 <= ?7
         AND (?8 IS NULL OR (SELECT COALESCE(SUM(usd), 0) FROM spend WHERE invite = ?2 AND at >= ?6)
           + (SELECT COALESCE(SUM(usd), 0) FROM reservations WHERE settled = 0 AND invite = ?2) + ?5 <= ?8)
         AND (?9 = 0 OR (SELECT COUNT(DISTINCT req) FROM reservations WHERE invite = ?2 AND at >= ?10 AND req != ?1) < ?11)`,
    )
    .bind(ledger.req, p.invite, call, now, usd, start, budget, p.cap, guarded ? 1 : 0, now - BURST.windowMs, BURST.requests)
    .run();
  if (r.meta.changes) {
    const id = Number(r.meta.last_row_id);
    ledger.held.push(id);
    return id;
  }
  // Refused: say which rule, in words a player understands.
  if (guarded) {
    const burst = await db
      .prepare("SELECT COUNT(DISTINCT req) AS n FROM reservations WHERE invite = ? AND at >= ? AND req != ?")
      .bind(p.invite, now - BURST.windowMs, ledger.req)
      .first<{ n: number }>();
    if ((burst?.n ?? 0) >= BURST.requests) {
      console.warn(JSON.stringify({ guard: "burst", invite: p.invite, call, requests: burst?.n }));
      await db.prepare("INSERT INTO refusals (at, invite, path, reason) VALUES (?, ?, ?, 'burst')").bind(now, p.invite, call).run();
      throw new LedgerError(429, "burst", "Too much magic at once. Wait a few seconds and try again.");
    }
  }
  if (p.cap !== null && (await spentBy(db, p.invite, now)) + usd > p.cap) {
    throw new LedgerError(
      402,
      "spent",
      "Your magic is spent for now. Everything already discovered still works: merge known recipes and cast any spell in the library.",
    );
  }
  throw new LedgerError(402, "budget", "The magic is spent for this month, for everyone. Known recipes and every spell in the library still work.");
}

// Records what calls really cost and settles this request's holds, at once.
export async function settle(db: D1Database, ledger: Ledger, spent: { call: string; model: string; usd: number }[]): Promise<void> {
  if (!spent.length && !ledger.held.length) return;
  const at = Date.now();
  const statements = spent.map((s) =>
    db.prepare("INSERT INTO spend (at, call, model, usd, invite) VALUES (?, ?, ?, ?, ?)").bind(at, s.call, s.model, s.usd, ledger.payer.invite),
  );
  const ids = ledger.held.splice(0);
  if (ids.length) statements.push(db.prepare(`UPDATE reservations SET settled = 1 WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(...ids));
  await db.batch(statements);
}

// Spent this month by one invite, open holds included.
export async function spentBy(db: D1Database, invite: string, now = Date.now()): Promise<number> {
  const start = monthStart(now);
  const row = await db
    .prepare(
      `SELECT (SELECT COALESCE(SUM(usd), 0) FROM spend WHERE invite = ?1 AND at >= ?2)
            + (SELECT COALESCE(SUM(usd), 0) FROM reservations WHERE settled = 0 AND invite = ?1) AS total`,
    )
    .bind(invite, start)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

// The whole month: spent, and held by calls still running.
export async function monthTotals(db: D1Database, now = Date.now()): Promise<{ spent: number; held: number }> {
  const row = await db
    .prepare(
      `SELECT (SELECT COALESCE(SUM(usd), 0) FROM spend WHERE at >= ?) AS spent,
              (SELECT COALESCE(SUM(usd), 0) FROM reservations WHERE settled = 0) AS held`,
    )
    .bind(monthStart(now))
    .first<{ spent: number; held: number }>();
  return { spent: row?.spent ?? 0, held: row?.held ?? 0 };
}

// Holds a request died with are turned into spend at their estimate (the call
// may have been made), and old settled holds are dropped. Batch holds wait for
// their batch; one no pending batch refers to after two days (the Batch API
// gives up after one) was never submitted and is released. Run by the cron.
export async function sweep(db: D1Database, now = Date.now()): Promise<void> {
  const stale = now - 3600_000;
  await db.batch([
    db
      .prepare(
        `UPDATE reservations SET settled = 1
         WHERE settled = 0 AND call = 'batch' AND at < ? AND id NOT IN (SELECT reservation FROM rewrites WHERE reservation IS NOT NULL AND status = 'pending')`,
      )
      .bind(now - 2 * 86400_000),
    db
      .prepare(
        `INSERT INTO spend (at, call, model, usd, invite)
         SELECT at, call || '-unsettled', 'unknown', usd, invite FROM reservations
         WHERE settled = 0 AND at < ? AND call != 'batch' AND id NOT IN (SELECT reservation FROM rewrites WHERE reservation IS NOT NULL AND status = 'pending')`,
      )
      .bind(stale),
    db
      .prepare(
        `UPDATE reservations SET settled = 1
         WHERE settled = 0 AND at < ? AND call != 'batch' AND id NOT IN (SELECT reservation FROM rewrites WHERE reservation IS NOT NULL AND status = 'pending')`,
      )
      .bind(stale),
    db.prepare("DELETE FROM reservations WHERE settled = 1 AND at < ?").bind(now - 2 * 86400_000),
    db.prepare("DELETE FROM inflight WHERE at < ?").bind(now - INFLIGHT_STALE_MS),
  ]);
}

// Runs `fn` once for identical requests in flight anywhere: the first takes
// the key, the others wait until it is done and then run `fn` themselves,
// which by then finds what the first one stored (a recipe, a description, a
// program) instead of asking Claude again.
export async function once<T>(db: D1Database, key: string, fn: () => Promise<T>): Promise<T> {
  const until = Date.now() + INFLIGHT_WAIT_MS;
  let pause = 150;
  let at = 0;
  for (;;) {
    at = Date.now();
    const r = await db
      .prepare("INSERT INTO inflight (key, at) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET at = excluded.at WHERE inflight.at < ?3")
      .bind(key, at, at - INFLIGHT_STALE_MS)
      .run();
    if (r.meta.changes) break;
    if (Date.now() > until) {
      at = 0;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pause));
    pause = Math.min(1000, pause * 1.5);
  }
  try {
    return await fn();
  } finally {
    if (at) await db.prepare("DELETE FROM inflight WHERE key = ? AND at = ?").bind(key, at).run();
  }
}
