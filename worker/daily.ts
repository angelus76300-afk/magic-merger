import { PRIMITIVES, elementKey, pairKey } from "../shared/elements";
import { dayIn, type DailyChallenge, type DailyResponse } from "../shared/daily";
import { TIERS, isTier } from "../shared/tiers";
import type { ElementKind } from "../shared/types";
import { runsOn } from "./cron";

// 4.5: daily challenges (docs/DESIGN.md, "Daily challenges").
//
// Each night the cron picks two items of the shared pool that nobody has
// merged, makes their merge ahead (index.ts, setDailyChallenge) and keeps the
// pair secret: the result is an element row (name, emoji, tier, a
// description that does not say what it is made from) but its recipe stays
// out of `recipes` until someone finds it. Whoever first reaches the item is
// its finder, by the secret pair (free) or by any merge that gives it.
// Players need not own the parents: the owner's rule is that whoever gets to
// it first wins. An open challenge never expires.

export interface DailyRow {
  id: number;
  day: string;
  pair: string;
  result: string;
  created_at: number;
  usd: number;
  found_by: string | null;
  found_at: number | null;
  found_pair: string | null;
}

// The parents a good find is made from: real discoveries (not the primal
// forces, whose pairs are all merged), up to grand, so the result can climb
// to legendary at most, and not too deep, so a friend can reach them.
export const PARENT_TIERS = TIERS.slice(TIERS.indexOf("minor"), TIERS.indexOf("grand") + 1);
export const PARENT_DEPTH = { min: 1, max: 8 } as const;
// Candidates sampled a night, and merges tried before giving up until the
// next run (a merge that lands on an item that exists is kept as an ordinary
// recipe, then the next pair is tried).
export const SAMPLE = 60;
export const TRIES = 3;

export async function openByPair(db: D1Database, ...pairs: string[]): Promise<DailyRow | null> {
  const unique = [...new Set(pairs)];
  return db
    .prepare(`SELECT * FROM daily_challenges WHERE found_at IS NULL AND pair IN (${unique.map(() => "?").join(", ")}) LIMIT 1`)
    .bind(...unique)
    .first<DailyRow>();
}

export async function openByResult(db: D1Database, key: string): Promise<DailyRow | null> {
  return db.prepare("SELECT * FROM daily_challenges WHERE found_at IS NULL AND result = ?").bind(key).first<DailyRow>();
}

// One statement, so two players merging at the same moment make one finder.
// The element becomes the finder's First Discovery, dated the day it was found.
export async function claim(db: D1Database, row: DailyRow, invite: string, pair: string, now = Date.now()): Promise<boolean> {
  const won = await db
    .prepare("UPDATE daily_challenges SET found_by = ?, found_at = ?, found_pair = ? WHERE id = ? AND found_at IS NULL")
    .bind(invite, now, pair, row.id)
    .run();
  if (won.meta.changes === 0) return false;
  await db.prepare("UPDATE elements SET invite = ?, created_at = ? WHERE key = ?").bind(invite, now, row.result).run();
  return true;
}

// Runs of the cron a Toronto day may spend looking for a challenge (TRIES
// pairs each). 4.5.1 (audit): without this, a night whose tries all land on
// existing items wrote no row, so every ten minute run tried three more pairs,
// up to 144 runs a day.
export const RUNS_A_DAY = 3;

// Is a challenge due? The first run after midnight in Toronto sets the day's;
// if it finds nothing new, two more runs may try that day, no more.
export async function due(db: D1Database, now = Date.now()): Promise<string | null> {
  const day = dayIn(now);
  const row = await db.prepare("SELECT 1 AS n FROM daily_challenges WHERE day = ?").bind(day).first<{ n: number }>();
  if (row) return null;
  return (await runsOn(db, "daily", day)) < RUNS_A_DAY ? day : null;
}

export interface Parent {
  key: string;
  name: string;
}

// Pairs nobody has merged, from a random sample of the pool: two different
// items (a self merge is the cheap ladder the owner does not like), neither
// an open challenge, the pair not in `recipes` nor already a challenge.
export async function freePairs(db: D1Database, random = Math.random): Promise<[Parent, Parent][]> {
  const rows = await db
    .prepare(
      `SELECT e.key, e.name FROM elements e
       WHERE e.tier IN (${PARENT_TIERS.map(() => "?").join(", ")}) AND e.depth BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM aliases a WHERE a.alias = e.key)
         AND NOT EXISTS (SELECT 1 FROM daily_challenges d WHERE d.result = e.key AND d.found_at IS NULL)
       ORDER BY RANDOM() LIMIT ?`,
    )
    .bind(...PARENT_TIERS, PARENT_DEPTH.min, PARENT_DEPTH.max, SAMPLE)
    .all<Parent>();
  const pool = rows.results.filter((r) => !PRIMITIVES.some((p) => elementKey(p.name) === r.key));
  const pairs: [Parent, Parent][] = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) pairs.push([pool[i], pool[j]]);
  // Shuffled, then checked against the recipe book a few at a time.
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  const free: [Parent, Parent][] = [];
  for (let i = 0; i < pairs.length && free.length < TRIES; i += 50) {
    const chunk = pairs.slice(i, i + 50);
    const keys = chunk.map(([a, b]) => pairKey(a.name, b.name));
    const taken = await db
      .prepare(
        `SELECT pair FROM recipes WHERE pair IN (${keys.map(() => "?").join(", ")})
         UNION SELECT pair FROM daily_challenges WHERE pair IN (${keys.map(() => "?").join(", ")})`,
      )
      .bind(...keys, ...keys)
      .all<{ pair: string }>();
    const used = new Set(taken.results.map((r) => r.pair));
    for (let k = 0; k < chunk.length && free.length < TRIES; k++) if (!used.has(keys[k])) free.push(chunk[k]);
  }
  return free;
}

interface ListRow {
  id: number;
  day: string;
  found_by: string | null;
  found_at: number | null;
  name: string;
  emoji: string;
  kind: ElementKind;
  tier: string | null;
  description: string | null;
  finder: string | null;
  deleted: number | null;
}

// Every open challenge, oldest first (the longest hunt on top), and the last
// twenty finds. Never the pair.
export async function listDaily(db: D1Database, invite: string): Promise<DailyResponse> {
  const select = `SELECT d.id, d.day, d.found_by, d.found_at, e.name, e.emoji, e.kind, e.tier, e.description, i.name AS finder, i.deleted_at AS deleted
    FROM daily_challenges d JOIN elements e ON e.key = d.result LEFT JOIN invites i ON i.id = d.found_by`;
  const [open, found] = await Promise.all([
    db.prepare(`${select} WHERE d.found_at IS NULL ORDER BY d.day`).all<ListRow>(),
    db.prepare(`${select} WHERE d.found_at IS NOT NULL ORDER BY d.found_at DESC LIMIT 20`).all<ListRow>(),
  ]);
  const card = (r: ListRow): DailyChallenge => ({
    id: r.id,
    day: r.day,
    name: r.name,
    emoji: r.emoji,
    kind: r.kind,
    tier: isTier(r.tier) ? r.tier : null,
    description: r.description ?? "",
    foundBy: r.found_at && r.finder && !r.deleted ? r.finder : null,
    foundDay: r.found_at ? dayIn(r.found_at) : null,
    found: !!r.found_at,
    mine: !!r.found_at && r.found_by === invite,
  });
  return { open: open.results.map(card), found: found.results.map(card) };
}
