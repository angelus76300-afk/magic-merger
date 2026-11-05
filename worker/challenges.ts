import { CHALLENGES, challengeById, fewestMerges, leastMerges, parOf, starsFor, strongEnough, type ChallengeDef, type Recipe } from "../shared/challenges";
import { HttpError } from "./http";
import { elementKey } from "../shared/elements";
import { isTier, tierFromDepth, type Tier } from "../shared/tiers";
import type { Payer } from "./ledger";

// Challenges from nothing (3.7, shared/challenges.ts): which are shown, their
// par and stars, wins, and the verification of solvers. Nothing here calls
// Claude: merges on a challenge's board go through /api/merge like any other
// (known pairs free, new ones within the player's allowance).

export interface ChallengeCard {
  id: string;
  title: string;
  brief: string;
  start: string[];
  minTier: Tier | null;
  live: boolean;
  par: number | null;
  // The fewest merges any friend needed, and who.
  best: { merges: number; name: string } | null;
  mine: number | null;
  stars: number;
}

async function recipes(db: D1Database): Promise<Recipe[]> {
  return (await db.prepare("SELECT a, b, result FROM recipes").all<Recipe>()).results;
}

// Solvers still verified: they won, for the program that is live now.
async function verified(db: D1Database): Promise<Map<string, string[]>> {
  const rows = await db
    .prepare("SELECT c.challenge, c.key FROM challenge_solvers c JOIN spells s ON s.key = c.key WHERE c.ok = 1 AND c.pid = s.pid")
    .all<{ challenge: string; key: string }>();
  const out = new Map<string, string[]>();
  for (const r of rows.results) out.set(r.challenge, [...(out.get(r.challenge) ?? []), r.key]);
  return out;
}

async function bestWins(db: D1Database): Promise<Map<string, { merges: number; name: string }>> {
  const rows = await db
    .prepare(
      `SELECT w.challenge, w.merges, COALESCE(i.name, CASE WHEN w.invite = 'admin' THEN 'the admin' ELSE 'a friend' END) AS name
       FROM challenge_wins w LEFT JOIN invites i ON i.id = w.invite
       WHERE w.id IN (SELECT (SELECT id FROM challenge_wins x WHERE x.challenge = y.challenge ORDER BY merges, at LIMIT 1) FROM challenge_wins y GROUP BY challenge)`,
    )
    .all<{ challenge: string; merges: number; name: string }>();
  return new Map(rows.results.map((r) => [r.challenge, { merges: r.merges, name: r.name }]));
}

// The challenges this player sees, in order: only those with a verified solution.
export async function listChallenges(db: D1Database, payer: Payer): Promise<{ challenges: ChallengeCard[] }> {
  const [graph, solvers, best, mine] = await Promise.all([
    recipes(db),
    verified(db),
    bestWins(db),
    db
      .prepare("SELECT challenge, MIN(merges) AS merges FROM challenge_wins WHERE invite = ? GROUP BY challenge")
      .bind(payer.invite)
      .all<{ challenge: string; merges: number }>(),
  ]);
  const myBest = new Map(mine.results.map((r) => [r.challenge, r.merges]));
  const out: ChallengeCard[] = [];
  for (const def of CHALLENGES) {
    const keys = solvers.get(def.id) ?? [];
    if (!keys.length) continue;
    const b = best.get(def.id) ?? null;
    const { par } = parOf(graph, def.start.map(elementKey), keys, b?.merges ?? null);
    const m = myBest.get(def.id) ?? null;
    out.push({
      id: def.id,
      title: def.title,
      brief: def.brief,
      start: def.start,
      minTier: def.minTier ?? null,
      live: !!def.live,
      par,
      best: b,
      mine: m,
      stars: m === null ? 0 : starsFor(m, par),
    });
  }
  return { challenges: out };
}

// A win in a browser: recorded with its merges, and the spell, if it was not
// a known solver, becomes one (the win is a run of the challenge itself).
export async function recordWin(
  db: D1Database,
  payer: Payer,
  body: { id?: unknown; merges?: unknown; spell?: unknown },
): Promise<{ stars: number; par: number | null; best: boolean }> {
  const def = challengeById(String(body.id ?? ""));
  const merges = Number(body.merges);
  if (!def || !Number.isInteger(merges) || merges < 0 || merges > 500) throw new HttpError(400, "That is not a win of this challenge");
  const key = elementKey(String(body.spell ?? "")).slice(0, 120);
  const row = await db
    .prepare("SELECT s.pid, e.tier, e.depth FROM spells s JOIN elements e ON e.key = s.key WHERE s.key = ?")
    .bind(key)
    .first<{ pid: number | null; tier: string | null; depth: number }>();
  if (!row) throw new HttpError(400, "That is not a win of this challenge");
  const tier = isTier(row.tier) ? row.tier : tierFromDepth(row.depth);
  if (!strongEnough(def, tier)) throw new HttpError(400, "That is not a win of this challenge");
  // The merge count comes from the browser: it can never be below what the
  // recipe graph says that spell takes from this start set, and the spell
  // must be reachable at all, or one client could set par to 0 for everyone.
  const graph = await recipes(db);
  const least = leastMerges(graph, def.start.map(elementKey), key);
  if (least === null) throw new HttpError(400, "That spell cannot be made from this challenge's start set");
  if (merges < least) throw new HttpError(400, `That spell takes at least ${least} merges from this start set`);
  const before = (await bestWins(db)).get(def.id)?.merges ?? null;
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO challenge_wins (challenge, invite, merges, spell, at) VALUES (?, ?, ?, ?, ?)").bind(def.id, payer.invite, merges, key, now),
    db
      .prepare(
        `INSERT INTO challenge_solvers (challenge, key, pid, ok, wins, runs, origin, at) VALUES (?, ?, ?, 1, 1, 1, 'player', ?)
         ON CONFLICT (challenge, key) DO UPDATE SET origin = CASE WHEN ok = 1 AND pid = excluded.pid THEN origin ELSE 'player' END,
           ok = 1, pid = excluded.pid, at = excluded.at`,
      )
      .bind(def.id, key, row.pid, now),
  ]);
  const solvers = (await verified(db)).get(def.id) ?? [key];
  const { par } = parOf(graph, def.start.map(elementKey), solvers, Math.min(merges, before ?? merges));
  return { stars: starsFor(merges, par), par, best: before === null || merges < before };
}

// Words that name what may answer a hazard, to try those spells first. Only
// the order of the search: the simulation decides.
const FITS: Record<string, RegExp> = {
  wildfire: /rain|water|wave|tide|flood|storm|ice|frost|snow|blizzard|mist|cloud|monsoon|deluge|douse|quench|winter|freez/i,
  lava: /wall|stone|rock|earth|mountain|ice|frost|freez|cold|water|wave|tide|golem|bulwark|rampart|fortress|petrif|glacier|barrier|dike|levee/i,
  flood: /wall|dike|levee|earth|mountain|stone|ice|frost|freez|glacier|ark|island|levitat|float|rampart|barrier|drain/i,
  river: /ice|frost|freez|glacier|bridge|earth|stone|teleport|portal|lift|levitat|wind|float|winter|snow|ford/i,
  drought: /rain|water|life|grow|bloom|garden|forest|monsoon|spring|oasis|flood|storm|harvest|verdant|nature/i,
};
function fits(scenario: string, name: string): number {
  return FITS[scenario]?.test(name) ? 1 : 0;
}

// For scripts/challenge-runner.ts: spells worth trying on each challenge.
// Every spell reachable from its start set through the recipe graph, strong
// enough, with a live program, fewest merges first; never tried for its
// current program, or verified for an older one (rewritten since).
export async function candidates(
  db: D1Database,
  limit: number,
): Promise<{ challenge: string; key: string; name: string; tier: Tier; pid: number; code: string; spots: [number, number][] }[]> {
  const graph = await recipes(db);
  const rows = await db
    .prepare("SELECT s.key, s.pid, s.spec, e.name, e.tier, e.depth, e.kind FROM spells s JOIN elements e ON e.key = s.key WHERE s.pid IS NOT NULL")
    .all<{ key: string; pid: number; spec: string; name: string; tier: string | null; depth: number; kind: string }>();
  const byKey = new Map(rows.results.map((r) => [r.key, r]));
  const tried = await db.prepare("SELECT challenge, key, pid FROM challenge_solvers").all<{ challenge: string; key: string; pid: number | null }>();
  const done = new Set(tried.results.map((t) => `${t.challenge}|${t.key}|${t.pid}`));
  const out: Awaited<ReturnType<typeof candidates>> = [];
  for (const def of CHALLENGES) {
    const reach = fewestMerges(graph, def.start.map(elementKey));
    const list = [...reach.entries()]
      .map(([key, set]) => ({ key, n: set.size, r: byKey.get(key) }))
      .filter((c) => c.r && !done.has(`${def.id}|${c.key}|${c.r.pid}`))
      .filter((c) => strongEnough(def, isTier(c.r!.tier) ? c.r!.tier : tierFromDepth(c.r!.depth)))
      // What fits the hazard first (a rain for a fire, a wall for lava), then fewest merges.
      .sort((a, b) => fits(def.scenario, b.r!.name) - fits(def.scenario, a.r!.name) || a.n - b.n)
      .slice(0, limit);
    for (const c of list) {
      let code = "";
      try {
        code = String((JSON.parse(c.r!.spec) as { code?: unknown }).code ?? "");
      } catch {
        continue;
      }
      if (!code) continue;
      out.push({
        challenge: def.id,
        key: c.key,
        name: c.r!.name,
        tier: isTier(c.r!.tier) ? c.r!.tier : tierFromDepth(c.r!.depth),
        pid: c.r!.pid,
        code,
        spots: def.spots,
      });
    }
  }
  return out;
}

// What the runner found for one spell on one challenge.
export async function recordVerification(
  db: D1Database,
  body: { challenge?: unknown; key?: unknown; pid?: unknown; ok?: unknown; wins?: unknown; runs?: unknown },
): Promise<{ ok: true }> {
  const def: ChallengeDef | undefined = challengeById(String(body.challenge ?? ""));
  if (!def) throw new HttpError(404, "There is no such challenge");
  await db
    .prepare(
      `INSERT INTO challenge_solvers (challenge, key, pid, ok, wins, runs, origin, at) VALUES (?, ?, ?, ?, ?, ?, 'probe', ?)
       ON CONFLICT (challenge, key) DO UPDATE SET pid = excluded.pid, ok = excluded.ok, wins = excluded.wins, runs = excluded.runs, origin = 'probe', at = excluded.at`,
    )
    .bind(
      def.id,
      elementKey(String(body.key ?? "")),
      Number(body.pid) || null,
      body.ok === true ? 1 : 0,
      Number(body.wins) || 0,
      Number(body.runs) || 0,
      Date.now(),
    )
    .run();
  return { ok: true };
}
