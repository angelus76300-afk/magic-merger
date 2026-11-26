// The looks revamp (roadmap 5.2.5, phases 3 and 4): items' looks redrawn by a look-only writer,
// judged on frames old against new, kept only when the judge scores the new one higher.
//
// 1. startLooks picks items (the keys and wonders asked, or in bulk: wonders, then cosmic and
//    legendary items, then the most cast), shows the writer each program with its w.model calls
//    numbered, and asks through the Batch API at half price: Sonnet for every tier, Opus for a
//    cosmic one. Each item's estimate is held in its row while it is pending, at its longest answer.
//    A call whose parts do something besides drawing (splice.ts lockedCall) is not offered, and an
//    item with no call to offer and none to gain is skipped before the writer is paid.
// 2. pollLooks collects the answers, records what each cost in the ledger (`spend`, invite
//    'looks'), and splices each new look into its program (shared/looks/splice.ts): only the
//    parts argument of each call changes, every other line stays byte for byte as it was. A
//    program with no model may gain one (a wonder two), inserted and nothing else changed: where
//    its artifact is placed, or at the cast's point. Not a creature (its body is its look) and,
//    unless asked (spells: true), not a spell (each cast would leave one, and a full island gives
//    the oldest looks away for them). The result waits as a candidate.
// 3. The runner (scripts/looks-runner.ts) tests the candidate as any program is tested, frames
//    the old look and the new one alike, and asks judgeLooks: Sonnet scores both on four points.
// 4. looksVerdict puts the new look live only when its test passed and the judge scored it higher.
//    A program goes live as a new version (the old one kept, so votes can roll it back); a
//    wonder's code is replaced, the old code kept in the row.
//
// Money: LOOKS_BUDGET_USD ($25, at most $35 for the promotional credits of 25 November 2026) in all, over the whole revamp, and LOOKS_NIGHT_USD in any 24 hours
// ($3 by default, at most the whole budget); both checked before every call, the writer's estimate held until it is billed. The
// revamp's spend is its own: the game's monthly budget does not count it (ledger.ts hold), and
// nothing but these calls counts against it. LOOKS ("off" by default) turns it on: "pilot" lets
// the admin start a pilot by name, "bulk" lets the nightly cron start the night's share too.
import { elementKey } from "../shared/elements";
import { FIRST_PROGRAM_VERSION, syntaxError } from "../shared/spellcode";
import { isTier, TIERS, type Tier } from "../shared/tiers";
import { PROGRAM_ADD, WONDER_ADD, lockedCall, mayGainModel, modelCalls, numberedProgram, ownLookCall, spliceLooks } from "../shared/looks/splice";
import type { LooksVerdict, Oracle } from "./oracle";
import { getProgram, insertProgram, liveProgram, promote } from "./programs";

export interface LooksEnv {
  DB: D1Database;
  // "off" (default), "pilot" or "bulk".
  LOOKS?: string;
  // Dollars the whole revamp may spend ($25), and in any 24 hours ($3).
  LOOKS_BUDGET_USD?: string;
  LOOKS_NIGHT_USD?: string;
  // The look-only writer for every tier, the one for cosmic items, and the judge.
  LOOKS_MODEL?: string;
  LOOKS_MODEL_COSMIC?: string;
  LOOKS_JUDGE_MODEL?: string;
}

export class LooksError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Who pays: the revamp's own scope in the ledger.
export const LOOKS_PAYER = "looks";
// Calls in the ledger.
export const LOOKS_CALLS = ["looks-write", "looks-judge"] as const;

export function looksMode(env: LooksEnv): "off" | "pilot" | "bulk" {
  return env.LOOKS === "pilot" || env.LOOKS === "bulk" ? env.LOOKS : "off";
}

// The most LOOKS_BUDGET_USD may say: 25 for the revamp, 35 while the promotional credits last
// (the owner, 25 November 2026: "even use stronger models for better results where possible").
export const LOOKS_BUDGET_CEILING = 35;

export function looksBudget(env: LooksEnv): number {
  const v = Number(env.LOOKS_BUDGET_USD);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, LOOKS_BUDGET_CEILING) : 25;
}

export function looksNightBudget(env: LooksEnv): number {
  // At most the revamp's whole budget (25 November 2026: the whole $25 may go in one day).
  const v = Number(env.LOOKS_NIGHT_USD);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, looksBudget(env)) : 3;
}

// Sonnet 5.5 writes every tier's look, Opus 5.5 a cosmic one's; Sonnet judges.
export function looksModelFor(env: LooksEnv, tier: Tier | "wonder"): string {
  return tier === "cosmic" ? env.LOOKS_MODEL_COSMIC || "claude-opus-5-5" : env.LOOKS_MODEL || "claude-sonnet-5-5";
}

export function looksJudgeModel(env: LooksEnv): string {
  return env.LOOKS_JUDGE_MODEL || "claude-sonnet-5-5";
}

// Dollars per million tokens (oracle.ts PRICES): input and output. The Batch API halves both.
const LOOKS_PRICES: Record<string, [number, number]> = {
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
// The writer's longest answer, by how many looks it may send (the calls it may redraw, or the
// models it may add): its thinking and the plan, then each parts list written out. 16,000 cut off
// big programs with many calls on 25 November 2026 (Yggdrasil, Midgard, $0.18 each for nothing),
// so each look past the first gets 6,000 more, up to 32,000.
export const LOOKS_MAX_TOKENS = 32_000;
export function writerMaxTokens(looks: number): number {
  return Math.min(LOOKS_MAX_TOKENS, 10_000 + 6_000 * Math.max(1, looks));
}
// Held before a writer's item is sent, from its size: the look guide (cached after the first),
// three references and the program in, and the longest answer it may send out (maxTokens), so
// what it is billed never passes what was held, and the budget is never passed.
const GUIDE_TOKENS = 2_200;
const REFERENCE_TOKENS = 3_600;
export function writerEstimate(model: string, programChars: number, maxTokens = writerMaxTokens(1)): number {
  const [i, o] = LOOKS_PRICES[model] ?? [10, 50];
  const input = GUIDE_TOKENS + REFERENCE_TOKENS + Math.ceil(programChars / 3.2);
  return ((input * i + maxTokens * o) / 1e6) * 0.5;
}
// The judge: six frames of 540 by 540 (about 390 tokens each) and the rubric, a short answer.
export const JUDGE_ESTIMATE = ((6 * 400 + 900) * 2 + 1_200 * 10) / 1e6;

// Spent by the revamp so far, with what is held for answers not yet billed.
export async function looksSpent(db: D1Database, since = 0): Promise<{ spent: number; held: number }> {
  const s = await db
    .prepare(`SELECT COALESCE(SUM(usd), 0) AS usd FROM spend WHERE invite = '${LOOKS_PAYER}' AND call IN ('looks-write', 'looks-judge') AND at >= ?`)
    .bind(since)
    .first<{ usd: number }>();
  const h = await db.prepare("SELECT COALESCE(SUM(estimate), 0) AS usd FROM looks WHERE status = 'pending' AND at >= ?").bind(since).first<{ usd: number }>();
  return { spent: s?.usd ?? 0, held: h?.usd ?? 0 };
}

// What may still be spent now: the least of the revamp's room and the night's.
export async function looksRoom(env: LooksEnv, now = Date.now()): Promise<{ total: number; night: number; room: number }> {
  const all = await looksSpent(env.DB);
  const night = await looksSpent(env.DB, now - 24 * 3600_000);
  const total = looksBudget(env) - all.spent - all.held;
  const nightRoom = looksNightBudget(env) - night.spent - night.held;
  return { total, night: nightRoom, room: Math.min(total, nightRoom) };
}

interface Picked {
  target: "program" | "wonder";
  key: string | null;
  wonderId: number | null;
  fromPid: number | null;
  name: string;
  kind: string;
  tier: Tier | "wonder";
  description: string;
  code: string;
}

// Library items with a live program, by key, with what the writer is told.
async function pickProgram(db: D1Database, key: string): Promise<Picked | null> {
  const live = await liveProgram(db, key);
  if (!live) return null;
  const e = await db.prepare("SELECT name, kind, form, tier, description FROM elements WHERE key = ?").bind(key).first<{
    name: string;
    kind: string;
    form: string | null;
    tier: string | null;
    description: string | null;
  }>();
  if (!e) return null;
  let code = "";
  try {
    code = String((JSON.parse(live.row.spec) as { code?: unknown }).code ?? "");
  } catch {
    return null;
  }
  return {
    target: "program",
    key,
    wonderId: null,
    fromPid: live.row.id,
    name: e.name,
    kind: e.form ?? (e.kind === "artifact" ? "object" : "spell"),
    tier: isTier(e.tier) ? e.tier : "minor",
    description: e.description ?? "",
    code,
  };
}

async function pickWonder(db: D1Database, id: number): Promise<Picked | null> {
  const w = await db.prepare("SELECT id, kind, does, summary, code FROM wonders WHERE id = ? AND status = 'live'").bind(id).first<{
    id: number;
    kind: string;
    does: string;
    summary: string;
    code: string;
  }>();
  if (!w) return null;
  return {
    target: "wonder",
    key: null,
    wonderId: w.id,
    fromPid: null,
    name: w.kind.replace(/\b\w/g, (c) => c.toUpperCase()),
    kind: "wonder",
    tier: "wonder",
    description: [w.summary, w.does].filter(Boolean).join(" "),
    code: w.code,
  };
}

// On a pending row's reason: the program may gain a model (startLooks decided it; pollLooks reads it).
const MAY_ADD = "may gain a model";

// Not redrawn yet (any row but a failed one counts: a kept look is not asked again).
const ASKED_KEY = "SELECT 1 FROM looks l WHERE l.key = s.key AND l.status != 'failed'";
const ASKED_WONDER = "SELECT 1 FROM looks l WHERE l.wonder_id = w.id AND l.status != 'failed'";

// The bulk order: wonders, then cosmic and legendary items, then the rest by how often they are cast.
async function bulkOrder(db: D1Database, limit: number): Promise<{ keys: string[]; wonders: number[] }> {
  const wonders = await db
    .prepare(`SELECT w.id FROM wonders w WHERE w.status = 'live' AND NOT EXISTS (${ASKED_WONDER}) ORDER BY w.id LIMIT ?`)
    .bind(limit)
    .all<{ id: number }>();
  // The casts are counted in one pass (casts has no index on pid: a count per item read the whole
  // table once per item, 22 million rows on a library of 1,500, scripts/cron-reads-test.mjs).
  const keys = await db
    .prepare(
      `SELECT s.key FROM spells s JOIN elements e ON e.key = s.key
         LEFT JOIN (SELECT pid, COUNT(*) AS n FROM casts GROUP BY pid) c ON c.pid = s.pid
       WHERE s.pid IS NOT NULL AND NOT EXISTS (${ASKED_KEY})
       ORDER BY CASE e.tier WHEN 'cosmic' THEN 0 WHEN 'legendary' THEN 1 ELSE 2 END,
         COALESCE(c.n, 0) DESC, s.key LIMIT ?`,
    )
    .bind(limit * 3)
    .all<{ key: string }>();
  return { keys: keys.results.map((r) => r.key), wonders: wonders.results.map((r) => r.id) };
}

// Wonders of the pool not redrawn yet, oldest first: the pilot's ten.
async function someWonders(db: D1Database, n: number): Promise<number[]> {
  const rows = await db
    .prepare(`SELECT w.id FROM wonders w WHERE w.status = 'live' AND NOT EXISTS (${ASKED_WONDER}) ORDER BY w.id LIMIT ?`)
    .bind(n)
    .all<{ id: number }>();
  return rows.results.map((r) => r.id);
}

export interface StartBody {
  keys?: unknown;
  wonders?: unknown;
  limit?: unknown;
  // true: a spell with no model may gain one too (mayGainModel).
  spells?: unknown;
}

// Starts a batch of looks: the keys and wonders asked (wonders: ids, or a count of the pool's
// oldest not redrawn), or in bulk the next ones in order. Stops at the room left: the revamp's
// and the night's. `cron`: the nightly bulk run (only when LOOKS is "bulk").
export async function startLooks(env: LooksEnv, oracle: Oracle, body: StartBody, cron = false) {
  const mode = looksMode(env);
  if (mode === "off") throw new LooksError(409, "The looks revamp is off (LOOKS)");
  if (cron && mode !== "bulk") return { queued: [], skipped: [], batches: [], estimate: 0, room: 0 };
  if (oracle.mock) throw new LooksError(400, "The looks revamp needs the Claude API");
  const db = env.DB;
  const limit = Math.max(1, Math.min(60, Number(body.limit) || 30));
  const asked = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string").map(elementKey) : [];
  let wonders = Array.isArray(body.wonders) ? body.wonders.filter((n): n is number => Number.isInteger(n)) : [];
  if (typeof body.wonders === "number") wonders = await someWonders(db, Math.min(20, Math.max(0, Math.floor(body.wonders))));
  const pilot = !cron && (asked.length > 0 || wonders.length > 0);
  // In pilot, only a start that names its items runs: an unnamed one would take the bulk order (review of #179).
  if (!pilot && mode !== "bulk") throw new LooksError(409, "In pilot, name the items to redraw (LOOKS is not bulk)");
  if (!pilot) {
    const order = await bulkOrder(db, limit);
    asked.push(...order.keys);
    wonders = order.wonders;
  }
  const picked: Picked[] = [];
  for (const id of wonders) {
    const w = await pickWonder(db, id);
    if (w && !(await db.prepare("SELECT 1 FROM looks WHERE wonder_id = ? AND status != 'failed'").bind(id).first())) picked.push(w);
  }
  for (const key of asked) {
    if (await db.prepare("SELECT 1 FROM looks WHERE key = ? AND status != 'failed'").bind(key).first()) continue;
    const p = await pickProgram(db, key);
    if (p) picked.push(p);
  }
  const { room } = await looksRoom(env);
  const items: { id: number; model: string; maxTokens: number; request: Parameters<Oracle["submitLooks"]>[0][number]["request"] }[] = [];
  const queued: string[] = [];
  const skipped: string[] = [];
  let estimate = 0;
  const at = Date.now();
  for (const p of picked) {
    if (queued.length >= limit) break;
    const calls = modelCalls(p.code);
    // A program with no model may gain one, unless it is a creature, (not asked) a spell, or an
    // item the island draws already (a building, a village, a built-in wonder: ownLookCall).
    const notAdded = p.target === "wonder" ? null : (mayGainModel(p.kind, body.spells === true) ?? ownLookCall(p.code));
    const mayAdd = !notAdded;
    // The calls the splice would refuse (their parts do something besides drawing) are not shown
    // to the writer as calls to redraw: it is paid only for looks that can be used.
    const locked = (calls ?? []).map((c) => ({ c, why: lockedCall(p.code, c) }));
    const open = locked.filter((l) => !l.why).map((l) => l.c);
    const firstLocked = locked.find((l) => l.why);
    // Nothing to redraw: no model call and none to add, every call's parts doing something (a
    // program with a model never gains one), or code the splice cannot read.
    const why = !calls
      ? "its code could not be read"
      : !calls.length && !mayAdd
        ? `no model call to redraw (${notAdded})`
        : calls.length && !open.length
          ? `no model call it may redraw (call ${firstLocked!.c.index}: ${firstLocked!.why})`
          : null;
    if (!calls || why) {
      await db
        .prepare("INSERT INTO looks (target, key, wonder_id, from_pid, status, pilot, reason, at) VALUES (?, ?, ?, ?, 'skipped', ?, ?, ?)")
        .bind(p.target, p.key, p.wonderId, p.fromPid, pilot ? 1 : 0, why, at)
        .run();
      skipped.push(p.name);
      continue;
    }
    const model = looksModelFor(env, p.tier);
    // How many looks it may send: the calls it may redraw, or the models it may add.
    const maxTokens = writerMaxTokens(calls.length ? open.length : p.target === "wonder" ? WONDER_ADD.max : PROGRAM_ADD.max);
    const cost = writerEstimate(model, p.code.length, maxTokens);
    if (estimate + cost > room) break;
    const ins = await db
      .prepare(
        "INSERT INTO looks (target, key, wonder_id, from_pid, status, pilot, model, estimate, old_code, reason, at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)",
      )
      .bind(p.target, p.key, p.wonderId, p.fromPid, pilot ? 1 : 0, model, cost, p.code, mayAdd && !calls.length ? MAY_ADD : null, at)
      .run();
    items.push({
      id: Number(ins.meta.last_row_id),
      model,
      maxTokens,
      request: {
        name: p.name,
        kind: p.kind,
        tier: p.tier === "wonder" ? "grand" : p.tier,
        description: p.description,
        // Only the calls it may redraw are marked with their number.
        program: numberedProgram(p.code, open),
        calls: calls.length,
        ...(open.length < calls.length ? { redraw: open.map((c) => c.index) } : {}),
        mayAdd: mayAdd && !calls.length,
      },
    });
    estimate += cost;
    queued.push(p.name);
  }
  const batches: string[] = [];
  if (items.length) {
    try {
      const batch = await oracle.submitLooks(items.map((it) => ({ id: `lk${it.id}`, model: it.model, maxTokens: it.maxTokens, request: it.request })));
      batches.push(batch);
      await db.batch(items.map((it) => db.prepare("UPDATE looks SET batch = ? WHERE id = ?").bind(batch, it.id)));
    } catch (err) {
      // Nothing was sent: nothing is held.
      await db.batch(items.map((it) => db.prepare("UPDATE looks SET status = 'failed', estimate = 0, reason = 'not sent' WHERE id = ?").bind(it.id)));
      throw err;
    }
  }
  return { queued, skipped, batches, estimate: Math.round(estimate * 10000) / 10000, room: Math.round((room - estimate) * 100) / 100 };
}

// Collects finished batches: bills each answer once, splices it in, and leaves a candidate.
export async function pollLooks(env: LooksEnv, oracle: Oracle): Promise<{ done: number; failed: number; waiting: number }> {
  const db = env.DB;
  const out = { done: 0, failed: 0, waiting: 0 };
  const pending = await db
    .prepare("SELECT id, target, batch, model, old_code, reason FROM looks WHERE status = 'pending' AND batch IS NOT NULL")
    .all<{ id: number; target: string; batch: string; model: string; old_code: string; reason: string | null }>();
  if (!pending.results.length || oracle.mock) return out;
  for (const batch of new Set(pending.results.map((r) => r.batch))) {
    const outcomes = await oracle.looksResults(batch);
    const rows = pending.results.filter((r) => r.batch === batch);
    if (!outcomes) {
      out.waiting += rows.length;
      continue;
    }
    for (const row of rows) {
      const o = outcomes.find((x) => x.id === `lk${row.id}`);
      let status = "failed";
      let reason = o?.error ?? "missing from the batch";
      let code: string | null = null;
      let refused: string | null = null;
      if (o?.answer) {
        // Who may gain a model was settled when it was asked (MAY_ADD on its row): a call 0 for any
        // other program (a creature, a spell not asked, a building) is refused, whatever the writer sent.
        const r = spliceLooks(row.old_code, o.answer.models, row.target === "wonder" ? WONDER_ADD : row.reason === MAY_ADD ? PROGRAM_ADD : false);
        refused = r?.refused.length ? JSON.stringify(r.refused).slice(0, 1000) : null;
        if (!r) reason = "its code could not be read";
        else if (!r.replaced.length && !r.added) reason = r.refused.length ? `every look was refused: ${r.refused[0].why}` : "the writer redrew nothing";
        else if (syntaxError(r.code)) reason = `the spliced program does not parse: ${syntaxError(r.code)}`;
        else {
          status = "candidate";
          reason = "";
          code = r.code;
        }
      }
      // Billed once, with the new status, only while the row is still pending: two crons
      // reading the same batch bill it once.
      const done = await db.batch([
        db
          .prepare(
            `INSERT INTO spend (at, call, model, usd, invite)
             SELECT ?, 'looks-write', ?, ?, '${LOOKS_PAYER}' WHERE ? > 0 AND EXISTS (SELECT 1 FROM looks WHERE id = ? AND status = 'pending')`,
          )
          .bind(Date.now(), o?.model || row.model, o?.usd ?? 0, o?.usd ?? 0, row.id),
        db
          .prepare(
            "UPDATE looks SET status = ?, estimate = 0, usd = usd + ?, new_code = ?, plan = ?, refused = ?, reason = ? WHERE id = ? AND status = 'pending'",
          )
          .bind(status, o?.usd ?? 0, code, o?.answer?.plan ?? null, refused, reason || null, row.id),
      ]);
      if (!done[1].meta.changes) continue;
      if (status === "candidate") out.done++;
      else out.failed++;
    }
  }
  return out;
}

// For the runner's pilot (scripts/looks-runner.ts start --pilot): the library's live programs not
// asked yet, with their code, how many players cast them and how many w.model calls they have, so
// the runner picks the pilot itself. Read only: one SELECT, whatever LOOKS is.
export async function looksPool(env: LooksEnv, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT s.key, e.name, e.kind, e.form, e.tier, s.spec, (SELECT COUNT(*) FROM casts c WHERE c.pid = s.pid) AS casts
     FROM spells s JOIN elements e ON e.key = s.key
     WHERE s.pid IS NOT NULL AND s.version >= ? AND NOT EXISTS (${ASKED_KEY})
     ORDER BY casts DESC, s.key LIMIT ?`,
  )
    .bind(FIRST_PROGRAM_VERSION, Math.min(1000, Math.max(1, limit)))
    .all<{ key: string; name: string; kind: string; form: string | null; tier: string | null; spec: string; casts: number }>();
  return rows.results.map((r) => {
    let code = "";
    try {
      code = String((JSON.parse(r.spec) as { code?: unknown }).code ?? "");
    } catch {
      code = "";
    }
    const form = r.form ?? (r.kind === "artifact" ? "object" : "spell");
    return { key: r.key, name: r.name, form, tier: isTier(r.tier) ? r.tier : "minor", casts: r.casts, models: modelCalls(code)?.length ?? null, code };
  });
}

// For the runner: candidates with the old code and the new, and what to test them as.
export async function looksCandidates(env: LooksEnv, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT l.id, l.target, l.key, l.wonder_id, l.from_pid, l.model, l.old_code, l.new_code, l.plan, l.pilot,
       e.name, e.kind, e.form, e.tier, e.intents, w.kind AS wonder_kind, w.reach, w.rarity, w.lands, w.spot, w.does, w.source
     FROM looks l LEFT JOIN elements e ON e.key = l.key LEFT JOIN wonders w ON w.id = l.wonder_id
     WHERE l.status = 'candidate' ORDER BY l.id LIMIT ?`,
  )
    .bind(Math.min(100, Math.max(1, limit)))
    .all<{
      id: number;
      target: string;
      key: string | null;
      wonder_id: number | null;
      from_pid: number | null;
      model: string;
      old_code: string;
      new_code: string;
      plan: string | null;
      pilot: number;
      name: string | null;
      kind: string | null;
      form: string | null;
      tier: string | null;
      intents: string | null;
      wonder_kind: string | null;
      reach: number | null;
      rarity: string | null;
      lands: string | null;
      spot: string | null;
      does: string | null;
      source: string | null;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    target: r.target,
    key: r.key,
    wonderId: r.wonder_id,
    name: r.name ?? r.wonder_kind ?? "",
    kind: r.target === "wonder" ? "artifact" : r.kind,
    form: r.form,
    tier: isTier(r.tier) ? r.tier : r.target === "wonder" ? "grand" : "minor",
    intents: (r.intents ?? "").split(",").filter(Boolean),
    reach: r.reach,
    rarity: r.rarity,
    model: r.model,
    plan: r.plan,
    pilot: r.pilot === 1,
    oldCode: r.old_code,
    code: r.new_code,
    // A wonder as islands read it (src/sim/wonders.ts readDef), with the new code: for its test.
    ...(r.target === "wonder"
      ? {
          wonder: {
            id: r.wonder_id,
            kind: r.wonder_kind,
            rarity: r.rarity,
            lands: r.lands ? r.lands.split(",") : [],
            spot: r.spot,
            reach: r.reach,
            does: r.does,
            source: r.source,
            at: 0,
          },
        }
      : {}),
  }));
}

const total = (s: LooksVerdict["a"]) => s.silhouette + s.name + s.tones + s.bricks;

// The judge on one candidate's frames: the old look and the new, shown as A and B in an order
// the Worker picks (so the judge cannot favour "the second one"), scored on four points. Its
// cost is checked against the room before the call and billed to the revamp.
export async function judgeLooks(
  env: LooksEnv,
  oracle: Oracle,
  body: { id?: unknown; old?: unknown; new?: unknown; description?: unknown },
): Promise<{ old: number; new: number; better: "old" | "new" | "same"; note: string; usd: number }> {
  const db = env.DB;
  const id = Number(body.id);
  const row = await db
    .prepare(
      "SELECT l.*, e.name, e.form, e.kind, e.tier, e.description, w.kind AS wonder_kind, w.summary FROM looks l LEFT JOIN elements e ON e.key = l.key LEFT JOIN wonders w ON w.id = l.wonder_id WHERE l.id = ?",
    )
    .bind(Number.isInteger(id) ? id : 0)
    .first<{
      id: number;
      status: string;
      target: string;
      name: string | null;
      form: string | null;
      kind: string | null;
      tier: string | null;
      description: string | null;
      wonder_kind: string | null;
      summary: string | null;
    }>();
  if (!row || row.status !== "candidate") throw new LooksError(404, "There is no such candidate");
  const frames = (v: unknown) => (Array.isArray(v) ? v.filter((f): f is string => typeof f === "string" && f.startsWith("data:image/")).slice(0, 3) : []);
  const oldFrames = frames(body.old);
  const newFrames = frames(body.new);
  if (!oldFrames.length || !newFrames.length) throw new LooksError(400, "The judge needs frames of the old look and the new");
  if (!oracle.mock && (await looksRoom(env)).room < JUDGE_ESTIMATE) throw new LooksError(402, "The looks budget is spent");
  // The order: by the row's id, so it is the same on a retry and half the items show the new one first.
  const newFirst = row.id % 2 === 0;
  const spentBefore = oracle.spent.length;
  const v = await oracle.judgeLooks({
    model: looksJudgeModel(env),
    name: row.name ?? (row.wonder_kind ?? "").replace(/\b\w/g, (c) => c.toUpperCase()),
    kind: row.target === "wonder" ? "wonder" : (row.form ?? row.kind ?? "spell"),
    tier: isTier(row.tier) ? row.tier : "grand",
    description: row.description ?? row.summary ?? "",
    a: newFirst ? newFrames : oldFrames,
    b: newFirst ? oldFrames : newFrames,
  });
  const usd = oracle.spent.slice(spentBefore).reduce((s, c) => s + c.usd, 0);
  const model = oracle.spent.at(-1)?.model ?? looksJudgeModel(env);
  const oldScores = newFirst ? v.b : v.a;
  const newScores = newFirst ? v.a : v.b;
  const better = v.better === "same" ? "same" : (v.better === "a") === newFirst ? "new" : "old";
  await db.batch([
    db
      .prepare(`INSERT INTO spend (at, call, model, usd, invite) SELECT ?, 'looks-judge', ?, ?, '${LOOKS_PAYER}' WHERE ? > 0`)
      .bind(Date.now(), model, usd, usd),
    db
      .prepare("UPDATE looks SET old_score = ?, new_score = ?, judged = ?, usd = usd + ? WHERE id = ?")
      .bind(total(oldScores), total(newScores), JSON.stringify({ old: oldScores, new: newScores, better, note: v.note, newFirst }), usd, row.id),
  ]);
  return { old: total(oldScores), new: total(newScores), better, note: v.note, usd };
}

// What the runner decided. The new look goes live only when its test run passed (`tested`) and
// the judge scored it higher than the old one, whatever the runner asks.
export async function looksVerdict(env: LooksEnv, body: { id?: unknown; tested?: unknown; reason?: unknown }) {
  const db = env.DB;
  const id = Number(body.id);
  const row = await db
    .prepare("SELECT * FROM looks WHERE id = ?")
    .bind(Number.isInteger(id) ? id : 0)
    .first<{
      id: number;
      target: string;
      key: string | null;
      wonder_id: number | null;
      from_pid: number | null;
      status: string;
      model: string;
      old_code: string;
      new_code: string;
      old_score: number | null;
      new_score: number | null;
    }>();
  if (!row || row.status !== "candidate") throw new LooksError(404, "There is no such candidate");
  const tested = body.tested === true;
  const judged = row.old_score !== null && row.new_score !== null;
  const higher = judged && row.new_score! > row.old_score!;
  let reason = String(body.reason ?? "").slice(0, 300);
  let replace = tested && higher;
  if (!tested) reason = reason || "its test run failed";
  else if (!judged) reason = "not judged";
  else if (!higher) reason = `the judge did not score it higher (${row.new_score} against ${row.old_score})`;
  else reason = `passed its test run, judged ${row.new_score} against ${row.old_score}`;
  let toPid: number | null = null;
  if (replace && row.target === "program" && row.key) {
    // The program it was drawn from must still be the live one: a rewrite since wins.
    const live = await liveProgram(db, row.key);
    const from = row.from_pid ? await getProgram(db, row.from_pid) : null;
    if (!live || !from || live.row.id !== from.id) {
      replace = false;
      reason = "its program changed since the look was drawn";
    } else {
      let spec: Record<string, unknown> = {};
      try {
        spec = JSON.parse(from.spec) as Record<string, unknown>;
      } catch {
        spec = {};
      }
      // The same program, its looks redrawn: the same version (no PROGRAM_VERSION bump), a new row.
      toPid = await insertProgram(db, row.key, JSON.stringify({ ...spec, code: row.new_code }), from.model, from.version, "looks", "live", from.id);
      await promote(db, (await getProgram(db, toPid))!);
    }
  } else if (replace && row.target === "wonder" && row.wonder_id !== null) {
    // Its code only, and only while it is the code the look was drawn from.
    const r = await db.prepare("UPDATE wonders SET code = ? WHERE id = ? AND code = ?").bind(row.new_code, row.wonder_id, row.old_code).run();
    if (!r.meta.changes) {
      replace = false;
      reason = "the wonder changed since the look was drawn";
    }
  }
  await db
    .prepare("UPDATE looks SET status = ?, to_pid = ?, reason = ?, decided_at = ? WHERE id = ? AND status = 'candidate'")
    .bind(replace ? "replaced" : "kept", toPid, reason, Date.now(), row.id)
    .run();
  return { ok: true, replaced: replace, reason };
}

// The revamp so far, for the admin and the lead: money, counts, and every decision.
export async function looksReport(env: LooksEnv) {
  const db = env.DB;
  const counts = await db.prepare("SELECT status, pilot, COUNT(*) AS n FROM looks GROUP BY status, pilot").all<{ status: string; pilot: number; n: number }>();
  const all = await looksSpent(db);
  const room = await looksRoom(env);
  const byCall = await db
    .prepare(`SELECT call, model, COUNT(*) AS n, COALESCE(SUM(usd), 0) AS usd FROM spend WHERE invite = '${LOOKS_PAYER}' GROUP BY call, model`)
    .all<{ call: string; model: string; n: number; usd: number }>();
  const decided = await db
    .prepare(
      `SELECT l.id, l.target, l.key, l.wonder_id, l.status, l.pilot, l.model, l.usd, l.old_score, l.new_score, l.reason, l.plan, e.name
       FROM looks l LEFT JOIN elements e ON e.key = l.key WHERE l.status IN ('replaced', 'kept', 'failed') ORDER BY l.id`,
    )
    .all<Record<string, unknown>>();
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return {
    mode: looksMode(env),
    budget: looksBudget(env),
    night: looksNightBudget(env),
    spent: r4(all.spent),
    held: r4(all.held),
    room: { total: r4(room.total), night: r4(room.night) },
    byCall: byCall.results.map((c) => ({ ...c, usd: r4(c.usd) })),
    counts: counts.results,
    decided: decided.results,
  };
}

// The nightly rebuild by kind waits while the revamp runs: in bulk, or while any look is in flight.
export async function looksBusy(env: LooksEnv): Promise<boolean> {
  if (looksMode(env) === "bulk") return true;
  return !!(await env.DB.prepare("SELECT 1 FROM looks WHERE status IN ('pending', 'candidate') LIMIT 1").first());
}

export const LOOKS_TIERS: readonly Tier[] = TIERS;
