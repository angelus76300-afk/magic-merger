import { BUILT_IN_WONDERS, RARITIES, REACH, SPOTS, type Rarity } from "../shared/wonders";
import { syntaxError } from "../shared/spellcode";
import { TIERS, type Tier } from "../shared/tiers";
import { wonderUserMessage, type WonderDraw } from "./prompts";
import type { Oracle, SortAnswer, WonderAnswer } from "./oracle";

// A library of nature that keeps growing (4.4.5 part C).
//
// 1. Once a day the cron draws a rarity, a land and a change of time, and
//    asks for a new wonder through the Batch API at half price: Haiku for a
//    common one, Opus from uncommon up (the owner's choice on 4 November:
//    a wonder lasts for ever and every new island may show it). Its own cap,
//    WONDER_BUDGET_USD ($2 a month), holds each call's estimate before it is
//    sent, inside the game's monthly budget.
// 2. The answer is checked here (a kind no island has yet, its rarity, lands,
//    spot and reach, code that parses) and stored as a trial. The nightly
//    Action tests it in Node (scripts/wonder-runner.ts, src/sim/wondercheck.ts)
//    and only then is it live: in the pool every new island draws from,
//    beside the seventeen built-in kinds, for every player.
// 3. Players' discoveries grow into the world: an artifact up to grand that
//    is a place, a material or a creature (asked once, with Haiku, for all of
//    a day's new ones) becomes a rare wonder with its own live program and
//    the name of the friend who found it first, tested the same way.
//    Nothing goes into anyone's inventory.
// 4. The owner retires any wonder from the admin view; a retired one stays on
//    the islands that have it (its code is in their save) and goes on no new one.

export type WonderStatus = "pending" | "trial" | "live" | "rejected" | "retired" | "failed";

export interface WonderRow {
  id: number;
  source: "daily" | "player";
  key: string | null;
  kind: string;
  rarity: Rarity;
  lands: string;
  spot: string;
  reach: number;
  does: string;
  summary: string;
  code: string;
  missing: string;
  change: string | null;
  by_name: string | null;
  status: WonderStatus;
  model: string;
  batch: string | null;
  reservation: number | null;
  estimate: number;
  usd: number;
  checked: string | null;
  judged: string | null;
  created_at: number;
  live_at: number | null;
}

// A wonder as islands get it: what src/sim/wonders.ts readDef reads.
export interface PoolWonder {
  id: number;
  kind: string;
  rarity: Rarity;
  lands: string[];
  spot: string;
  reach: number;
  does: string;
  code: string;
  source: "daily" | "player";
  by?: string;
  at: number;
}

const LANDS = ["temperate", "desert", "tundra", "jungle", "swamp", "volcanic", "mesa"] as const;
// The draw of a day: commons the most, legendary one day in ten.
const DRAW: Record<Rarity, number> = { common: 35, uncommon: 30, rare: 25, legendary: 10 };
const CHANGES = ["at night", "at dawn", "at dusk", "in a drought", "in fire", "in the cold", "on a full moon"] as const;
// Held before a call, per model: above the ledger's worst batch item of each
// ($0.077 for Opus, $0.004 for Haiku), so the cap can never be passed.
export const WONDER_ESTIMATE = { big: 0.1, small: 0.01, sort: 0.003 } as const;
// A daily wonder at most this often, and a day's new artifacts sorted at most this many at a time.
export const WONDER_EVERY_MS = 20 * 3600_000;
const SORT_PER_DAY = 25;
// The pool islands draw from: the newest live ones first.
const POOL_SIZE = 120;
const WEEK_MS = 7 * 24 * 3600_000;

export function wonderBudget(raw: string | undefined): number {
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 2;
}

// Dollars this month: what wonder calls cost, plus what pending ones hold.
export async function wonderSpent(db: D1Database, monthStart: number): Promise<number> {
  const spent = await db
    .prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM spend WHERE call LIKE 'wonder%' AND at >= ?")
    .bind(monthStart)
    .first<{ usd: number }>();
  const held = await db.prepare("SELECT COALESCE(SUM(estimate), 0) AS usd FROM wonders WHERE status = 'pending'").first<{ usd: number }>();
  return (spent?.usd ?? 0) + (held?.usd ?? 0);
}

export async function dailyDue(db: D1Database, now = Date.now()): Promise<boolean> {
  const last = await db.prepare("SELECT MAX(created_at) AS at FROM wonders WHERE source = 'daily' AND status != 'failed'").first<{ at: number | null }>();
  return !last?.at || now - last.at >= WONDER_EVERY_MS;
}

// Today's rarity, land and change. The land with the fewest wonders of the
// pool comes first, so every land gets its own.
export async function drawWonder(db: D1Database, random = Math.random): Promise<WonderDraw> {
  let r = random() * Object.values(DRAW).reduce((a, b) => a + b, 0);
  let rarity: Rarity = "common";
  for (const k of RARITIES) {
    r -= DRAW[k];
    if (r <= 0) {
      rarity = k;
      break;
    }
  }
  const rows = await db.prepare("SELECT lands FROM wonders WHERE status IN ('trial', 'live', 'pending')").all<{ lands: string }>();
  const count = new Map<string, number>(LANDS.map((l) => [l, 0]));
  for (const row of rows.results) for (const l of row.lands.split(",")) if (count.has(l)) count.set(l, count.get(l)! + 1);
  const fewest = Math.min(...count.values());
  const lands = LANDS.filter((l) => count.get(l) === fewest);
  const land = lands[Math.floor(random() * lands.length)];
  const change = CHANGES[Math.floor(random() * CHANGES.length)];
  return { rarity, land, change };
}

export function modelFor(rarity: Rarity, models: { big: string; small: string }): string {
  return rarity === "common" ? models.small : models.big;
}

// The message of a day: the draw, then everything islands already have.
export async function dailyMessage(db: D1Database, draw: WonderDraw): Promise<string> {
  const rows = await db
    .prepare("SELECT kind, rarity, does, source FROM wonders WHERE status IN ('trial', 'live') ORDER BY id DESC LIMIT 200")
    .all<{ kind: string; rarity: string; does: string; source: string }>();
  const daily = rows.results.filter((r) => r.source === "daily");
  const players = rows.results.filter((r) => r.source === "player");
  return wonderUserMessage(draw, [...BUILT_IN_WONDERS], daily, players);
}

// Why an answer cannot be stored, or null. `taken` are the kinds islands
// already have (built in and stored, lower case).
export function wonderProblem(a: WonderAnswer, draw: WonderDraw, taken: Set<string>): string | null {
  const kind = a.kind.trim().toLowerCase();
  if (!/^[a-z][a-z' -]{2,38}[a-z]$/.test(kind) || kind.split(" ").length > 4) return `"${a.kind}" is not a usable kind`;
  if (/^(a|an|the) /.test(kind)) return `"${a.kind}" starts with an article`;
  if (taken.has(kind)) return `${kind} exists already`;
  if (a.rarity !== draw.rarity) return `it is ${a.rarity}, not ${draw.rarity}`;
  if (!a.lands.length || a.lands.some((l) => !(LANDS as readonly string[]).includes(l))) return "its lands are not lands of the game";
  if (!a.lands.includes(draw.land)) return `it does not belong to ${draw.land}`;
  if (!(SPOTS as readonly string[]).includes(a.spot)) return `${a.spot} is not a spot`;
  const [lo, hi] = REACH[draw.rarity as Rarity];
  if (!Number.isInteger(a.reach) || a.reach < lo || a.reach > hi) return `a reach of ${a.reach} is out of ${lo} to ${hi}`;
  if (a.does.trim().length < 12 || a.does.length > 110) return "its line for the first look is missing or too long";
  const err = syntaxError(a.code);
  if (err) return `its program does not parse: ${err}`;
  if (!/\bw\.artifact\s*\(|\bw\.landmark\s*\(|creatures\s*:/.test(a.code)) return "its program places nothing that acts";
  return null;
}

export async function takenKinds(db: D1Database): Promise<Set<string>> {
  const rows = await db.prepare("SELECT kind FROM wonders WHERE status NOT IN ('failed')").all<{ kind: string }>();
  return new Set([...BUILT_IN_WONDERS.map((w) => w.kind), ...rows.results.map((r) => r.kind.toLowerCase())]);
}

// The live pool, newest first, for islands. 4.5.1 (audit, B.RC4c, DC15): the
// finder's name is read from the account now, not from the copy made when the
// wonder grew, so a player who deleted their account, or hid from the
// Community tab, is not named on everyone's islands, and the owner never is.
export async function livePool(db: D1Database, now = Date.now()): Promise<{ wonders: PoolWonder[]; week: PoolWonder[] }> {
  const rows = await db
    .prepare(
      `SELECT w.*, CASE WHEN w.source = 'player' AND i.deleted_at IS NULL AND i.community_hidden = 0 AND i.admin = 0 THEN i.name END AS finder
       FROM wonders w LEFT JOIN elements e ON e.key = w.key LEFT JOIN invites i ON i.id = e.invite
       WHERE w.status = 'live' ORDER BY COALESCE(w.live_at, w.created_at) DESC, w.id DESC LIMIT ?`,
    )
    .bind(POOL_SIZE)
    .all<WonderRow & { finder: string | null }>();
  const wonders = rows.results.map((r) => poolOf({ ...r, by_name: r.finder ? r.finder.slice(0, 40) : null }));
  return { wonders, week: wonders.filter((w) => now - w.at < WEEK_MS) };
}

export function poolOf(r: WonderRow): PoolWonder {
  return {
    id: r.id,
    kind: r.kind,
    rarity: r.rarity,
    lands: r.lands ? r.lands.split(",") : [],
    spot: r.spot,
    reach: r.reach,
    does: r.does,
    code: r.code,
    source: r.source,
    ...(r.by_name ? { by: r.by_name } : {}),
    at: r.live_at ?? r.created_at,
  };
}

// --- Players' discoveries -------------------------------------------------

// The reach of a player's wonder, from its tier.
const PLAYER_REACH: Partial<Record<Tier, number>> = { cantrip: 4, minor: 5, major: 7, grand: 9 };

export interface Candidate {
  key: string;
  name: string;
  description: string;
  tier: Tier;
  code: string;
  finder: string | null;
}

// Artifacts up to grand with a live program, not sorted yet: the oldest
// discoveries first, so the library grows from the start of the game.
export async function unsorted(db: D1Database, limit = SORT_PER_DAY): Promise<Candidate[]> {
  const grand = TIERS.indexOf("grand");
  const tiers = TIERS.slice(0, grand + 1);
  const rows = await db
    .prepare(
      `SELECT e.key, e.name, e.description, e.tier, p.spec, i.name AS finder FROM elements e
       JOIN spells s ON s.key = e.key JOIN programs p ON p.id = s.pid
       LEFT JOIN invites i ON i.id = e.invite
       WHERE e.kind = 'artifact' AND e.tier IN (${tiers.map(() => "?").join(", ")}) AND p.status = 'live'
         AND NOT EXISTS (SELECT 1 FROM wonder_sorts w WHERE w.key = e.key)
         AND NOT EXISTS (SELECT 1 FROM daily_challenges d WHERE d.result = e.key AND d.found_at IS NULL)
       ORDER BY e.created_at LIMIT ?`,
    )
    .bind(...tiers, limit)
    .all<{ key: string; name: string; description: string | null; tier: Tier; spec: string; finder: string | null }>();
  const out: Candidate[] = [];
  for (const r of rows.results) {
    let code = "";
    try {
      code = String((JSON.parse(r.spec) as { code?: unknown }).code ?? "");
    } catch {
      continue;
    }
    if (code) out.push({ key: r.key, name: r.name, description: r.description ?? "", tier: r.tier, code, finder: r.finder });
  }
  return out;
}

// Sorts a day's new artifacts and stores those that are places, materials or
// creatures as trials, with the friend who found them first.
export async function growDiscoveries(db: D1Database, oracle: Oracle, list: Candidate[], now = Date.now()): Promise<{ sorted: number; trials: string[] }> {
  if (!list.length) return { sorted: 0, trials: [] };
  const answers = await oracle.sortItems(list.map((c) => ({ name: c.name, description: c.description })));
  const byName = new Map<string, SortAnswer>(answers.map((a) => [a.name.trim().toLowerCase(), a]));
  const taken = await takenKinds(db);
  const trials: string[] = [];
  for (const c of list) {
    const a = byName.get(c.name.trim().toLowerCase());
    // Unanswered: asked again another day.
    if (!a) continue;
    await db.prepare("INSERT OR IGNORE INTO wonder_sorts (key, sort, at) VALUES (?, ?, ?)").bind(c.key, a.sort, now).run();
    if (a.sort === "object" || a.sort === "person") continue;
    const kind = c.name.trim().toLowerCase().slice(0, 40);
    if (taken.has(kind) || syntaxError(c.code)) continue;
    const lands = a.lands.filter((l) => (LANDS as readonly string[]).includes(l)).slice(0, 4);
    const spot = (SPOTS as readonly string[]).includes(a.spot) ? a.spot : "flat";
    // The admin's own discoveries carry no name: there is no friend to thank.
    const by = c.finder && c.finder !== "admin" ? c.finder.slice(0, 40) : null;
    await db
      .prepare(
        `INSERT OR IGNORE INTO wonders (source, key, kind, rarity, lands, spot, reach, does, summary, code, status, model, by_name, created_at)
         VALUES ('player', ?, ?, 'rare', ?, ?, ?, ?, ?, ?, 'trial', '', ?, ?)`,
      )
      .bind(
        c.key,
        kind,
        (lands.length ? lands : ["temperate"]).join(","),
        spot,
        PLAYER_REACH[c.tier] ?? 6,
        a.does.slice(0, 110),
        `${c.name}, a ${a.sort} a player found.`,
        c.code,
        by,
        now,
      )
      .run();
    taken.add(kind);
    trials.push(c.name);
  }
  return { sorted: list.length, trials };
}

// --- The nightly test's verdict, and the owner's say -----------------------

export async function trialWonders(db: D1Database): Promise<WonderRow[]> {
  return (await db.prepare("SELECT * FROM wonders WHERE status = 'trial' ORDER BY id LIMIT 20").all<WonderRow>()).results;
}

export async function settleWonder(
  db: D1Database,
  id: number,
  ok: boolean,
  detail: string,
  problem: string | null,
  now = Date.now(),
): Promise<WonderStatus | null> {
  const row = await db.prepare("SELECT status FROM wonders WHERE id = ?").bind(id).first<{ status: WonderStatus }>();
  if (!row || row.status !== "trial") return row?.status ?? null;
  const status: WonderStatus = ok ? "live" : "rejected";
  await db
    .prepare("UPDATE wonders SET status = ?, checked = ?, live_at = ? WHERE id = ? AND status = 'trial'")
    .bind(status, JSON.stringify({ ok, problem, detail: detail.slice(0, 1200), at: now }), ok ? now : null, id)
    .run();
  return status;
}

// The owner retires a wonder, or puts one back (a rejected one too: the
// owner's eyes outrank the test).
export async function changeWonder(db: D1Database, id: number, status: string, now = Date.now()): Promise<WonderStatus> {
  if (status !== "retired" && status !== "live") throw new Error("A wonder can be retired or put live");
  const row = await db.prepare("SELECT status FROM wonders WHERE id = ?").bind(id).first<{ status: WonderStatus }>();
  if (!row) throw new Error("There is no such wonder");
  if (status === "live" && !["retired", "rejected", "live"].includes(row.status)) throw new Error(`A ${row.status} wonder cannot be put live yet`);
  await db
    .prepare("UPDATE wonders SET status = ?, live_at = CASE WHEN ? = 'live' THEN COALESCE(live_at, ?) ELSE live_at END WHERE id = ?")
    .bind(status, status, now, id)
    .run();
  return status;
}

export async function wonderList(db: D1Database): Promise<Omit<WonderRow, "code">[]> {
  const rows = await db
    .prepare(
      "SELECT id, source, key, kind, rarity, lands, spot, reach, does, summary, missing, change, by_name, status, model, batch, estimate, usd, checked, judged, created_at, live_at FROM wonders ORDER BY id DESC LIMIT 200",
    )
    .all<Omit<WonderRow, "code">>();
  return rows.results;
}
