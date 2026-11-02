import { PRIMITIVES, elementKey, pairKey } from "../shared/elements";
import { FIRST_PROGRAM_VERSION, PROGRAM_VERSION, type SpellProgram } from "../shared/spellcode";
import { TIERS, capTier, isTier, tierFromDepth, type Tier } from "../shared/tiers";
import type {
  DescribeRequest,
  DescribeResponse,
  ElementKind,
  GameElement,
  HealthResponse,
  MergeRequest,
  MergeResponse,
  MergeTrialRequest,
  PerfSample,
  SpendResponse,
  RepairRequest,
  SpellRequest,
  SpellResponse,
} from "../shared/types";
import { ClaudeOracle, MockOracle, OracleError, parseEffort, type Oracle } from "./oracle";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MERGE_MODEL: string;
  DESCRIBE_MODEL: string;
  // Spells up to SPELL_SMALL_UP_TO are written by SPELL_MODEL_SMALL, the rest
  // by SPELL_MODEL: small spells are simple and frequent, big ones rare and ambitious.
  SPELL_MODEL: string;
  SPELL_MODEL_SMALL?: string;
  // Who mends a crashing program, whatever its tier. A repair is a small edit
  // of code that already exists: Haiku does it for a fortieth of Opus.
  REPAIR_MODEL?: string;
  // How long the merge model thinks: low unless measured otherwise.
  MERGE_EFFORT?: string;
  SPELL_SMALL_UP_TO?: string;
  // low, medium, high, xhigh or max. How long the spell designer thinks.
  SPELL_EFFORT?: string;
  // Dollars of Claude calls allowed per calendar month (UTC). Past it, the
  // game keeps working from the stored recipe book but asks Claude nothing new.
  BUDGET_USD?: string;
  // Secrets, set with `wrangler secret put`. All optional.
  ANTHROPIC_API_KEY?: string;
  // Locks the API for everyone who does not have it.
  ACCESS_TOKEN?: string;
  // Also grants access, plus forcing a new description or spell.
  ADMIN_TOKEN?: string;
  // Optional: route Claude calls through a gateway, or a local stub in tests.
  ANTHROPIC_BASE_URL?: string;
}

const MAX_NAME_LENGTH = 60;
// A program that keeps crashing is sent back to Claude at most this many times.
const MAX_REPAIRS = 3;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const token = request.headers.get("x-access-token");
    const admin = !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
    if (env.ACCESS_TOKEN && token !== env.ACCESS_TOKEN && !admin) {
      return json({ error: "Wrong or missing access token" }, 401);
    }

    const oracle = oracleFor(env);
    try {
      if (request.method === "POST" && url.pathname === "/api/merge") {
        return json(await handleMerge(await readBody<MergeRequest>(request), env, oracle));
      }
      if (request.method === "POST" && url.pathname === "/api/describe") {
        return json(await handleDescribe(await readBody<DescribeRequest>(request), env, oracle, admin));
      }
      if (request.method === "POST" && url.pathname === "/api/spell") {
        const body = await readBody<SpellRequest>(request);
        // The admin can try another model or effort for one design.
        const tried = admin && (body.model || body.effort) ? oracleFor(env, { spellModel: body.model, spellEffort: body.effort }) : oracle;
        try {
          return json(await handleSpell(body, env, tried, admin));
        } finally {
          if (tried !== oracle) await recordSpend(env.DB, tried);
        }
      }
      if (request.method === "POST" && url.pathname === "/api/spell/repair") {
        return json(await handleRepair(await readBody<RepairRequest>(request), env, oracle, admin));
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true, mock: !env.ANTHROPIC_API_KEY, admin } satisfies HealthResponse);
      }
      if (request.method === "GET" && url.pathname === "/api/spend" && admin) {
        return json(await spendReport(env));
      }
      if (request.method === "POST" && url.pathname === "/api/perf") {
        await recordPerf(env.DB, await readBody<PerfSample>(request), request.headers.get("user-agent") ?? "");
        return json({ ok: true });
      }
      if (request.method === "GET" && url.pathname === "/api/perf" && admin) {
        const rows = await env.DB.prepare("SELECT at, ua, sample FROM perf ORDER BY at DESC LIMIT 200").all<{ at: number; ua: string; sample: string }>();
        return json(rows.results.map((r) => ({ at: r.at, ua: r.ua, ...(JSON.parse(r.sample) as object) })));
      }
      // Admin tools, for measuring: what another model would answer for a
      // pair (nothing is stored), and the one-off tier backfill.
      if (request.method === "POST" && url.pathname === "/api/admin/merge-trial" && admin) {
        const body = await readBody<MergeTrialRequest>(request);
        const trial = oracleFor(env, { mergeModel: body.model, mergeEffort: body.effort });
        try {
          await ensureBudget(env, trial);
          const t0 = Date.now();
          const answer = await trial.merge(String(body.a), String(body.b));
          return json({ answer, ms: Date.now() - t0, usd: trial.spent.reduce((sum, s) => sum + s.usd, 0) });
        } finally {
          await recordSpend(env.DB, trial);
        }
      }
      if (request.method === "POST" && url.pathname === "/api/admin/backfill-tiers" && admin) {
        return json(await backfillTiers(env, oracle));
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err instanceof OracleError) return json({ error: err.message }, 502);
      console.error(err);
      return json({ error: "Something went wrong in the Worker" }, 500);
    } finally {
      // Every call is written down, even when the request failed after it.
      await recordSpend(env.DB, oracle);
    }
  },
} satisfies ExportedHandler<Env>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SPELL_MODELS = new Set(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]);

interface OracleOverrides {
  spellModel?: string;
  spellEffort?: string;
  mergeModel?: string;
  mergeEffort?: string;
}

function oracleFor(env: Env, o: OracleOverrides = {}): Oracle {
  if (!env.ANTHROPIC_API_KEY) return new MockOracle();
  const models = {
    merge: o.mergeModel && SPELL_MODELS.has(o.mergeModel) ? o.mergeModel : env.MERGE_MODEL,
    mergeEffort: parseEffort(o.mergeEffort ?? env.MERGE_EFFORT, "low"),
    describe: env.DESCRIBE_MODEL,
    spell: o.spellModel && SPELL_MODELS.has(o.spellModel) ? o.spellModel : env.SPELL_MODEL,
    spellEffort: parseEffort(o.spellEffort ?? env.SPELL_EFFORT, "medium"),
  };
  return new ClaudeOracle(env.ANTHROPIC_API_KEY, models, env.ANTHROPIC_BASE_URL);
}

// Budget: the sum of this month's calls, checked before asking Claude anything.
function budget(env: Env): number {
  const v = Number(env.BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : 20;
}

async function monthSpend(db: D1Database): Promise<number> {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const row = await db.prepare("SELECT COALESCE(SUM(usd), 0) AS total FROM spend WHERE at >= ?").bind(start).first<{ total: number }>();
  return row?.total ?? 0;
}

async function ensureBudget(env: Env, oracle: Oracle): Promise<void> {
  if (oracle.mock) return;
  if ((await monthSpend(env.DB)) >= budget(env)) {
    throw new HttpError(402, "The magic is spent for this month: the Claude budget is used up. Known recipes still work.");
  }
}

// The month so far, call by call, for the admin badge and `/api/spend`.
async function spendReport(env: Env): Promise<SpendResponse> {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows = await env.DB.prepare(
    `SELECT call, model, COUNT(*) AS n, SUM(usd) AS usd, SUM(CASE WHEN at >= ? THEN usd ELSE 0 END) AS today
     FROM spend WHERE at >= ? GROUP BY call, model ORDER BY usd DESC`,
  )
    .bind(today, start)
    .all<{ call: string; model: string; n: number; usd: number; today: number }>();
  const calls = rows.results.map((r) => ({ call: r.call, model: r.model, n: r.n, usd: round(r.usd), avg: round(r.usd / r.n, 5), today: round(r.today) }));
  return {
    month: round(calls.reduce((sum, c) => sum + c.usd, 0)),
    today: round(calls.reduce((sum, c) => sum + c.today, 0)),
    budget: budget(env),
    calls,
  };
}

function round(v: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// Frame samples sent by the HUD on a real device, kept for a month.
async function recordPerf(db: D1Database, body: PerfSample, ua: string): Promise<void> {
  const sample = JSON.stringify(body ?? {});
  if (sample.length > 4000) throw new HttpError(413, "The sample is too big");
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO perf (at, ua, sample) VALUES (?, ?, ?)").bind(now, ua.slice(0, 300), sample),
    db.prepare("DELETE FROM perf WHERE at < ?").bind(now - 30 * 86400_000),
  ]);
}

// Elements from before tiers: rated once, all in one call (about 100 names).
async function backfillTiers(env: Env, oracle: Oracle): Promise<{ rated: number; missing: string[] }> {
  const rows = await env.DB.prepare("SELECT key, name, kind FROM elements WHERE tier IS NULL LIMIT 300").all<{ key: string; name: string; kind: ElementKind }>();
  if (!rows.results.length) return { rated: 0, missing: [] };
  await ensureBudget(env, oracle);
  const tiers = await oracle.tiers(rows.results);
  if (oracle.mock) return { rated: 0, missing: [] };
  const updates = rows.results.filter((r) => tiers.has(r.name)).map((r) => env.DB.prepare("UPDATE elements SET tier = ? WHERE key = ?").bind(tiers.get(r.name)!, r.key));
  if (updates.length) await env.DB.batch(updates);
  return { rated: updates.length, missing: rows.results.filter((r) => !tiers.has(r.name)).map((r) => r.name) };
}

async function recordSpend(db: D1Database, oracle: Oracle): Promise<void> {
  if (!oracle.spent.length) return;
  const at = Date.now();
  try {
    await db.batch(oracle.spent.splice(0).map((s) => db.prepare("INSERT INTO spend (at, call, model, usd) VALUES (?, ?, ?, ?)").bind(at, s.call, s.model, s.usd)));
  } catch (err) {
    console.error("could not record spend", err);
  }
}

async function handleMerge(body: MergeRequest, env: Env, oracle: Oracle): Promise<MergeResponse> {
  const a = await resolveInput(env.DB, body.a, oracle.mock);
  const b = await resolveInput(env.DB, body.b, oracle.mock);
  const pair = pairKey(a.name, b.name);

  const known = await env.DB.prepare("SELECT result FROM recipes WHERE pair = ?")
    .bind(pair)
    .first<{ result: string }>();
  if (known) {
    const element = await getElement(env.DB, known.result);
    if (element) return { element, firstDiscovery: false, mock: oracle.mock };
  }

  await ensureBudget(env, oracle);
  const answer = await oracle.merge(a.name, b.name);
  const candidate: GameElement = {
    name: cleanName(answer.name),
    emoji: cleanEmoji(answer.emoji),
    kind: answer.kind,
    depth: Math.max(a.depth, b.depth) + 1,
    tier: capTier(answer.tier, [tierOf(a), tierOf(b)]),
  };

  // Mock answers are never stored, so a real key later starts from a clean cache.
  if (oracle.mock) return { element: candidate, firstDiscovery: false, mock: true };

  const key = elementKey(candidate.name);
  const existing = await getElement(env.DB, key);
  let element: GameElement;
  let firstDiscovery = false;
  if (existing) {
    // An element keeps its first emoji, kind and tier forever; only its depth
    // can shrink when a shorter path to it is found.
    element = { ...existing, depth: Math.min(existing.depth, candidate.depth) };
    if (element.depth < existing.depth) {
      await env.DB.prepare("UPDATE elements SET depth = ? WHERE key = ?").bind(element.depth, key).run();
    }
    if (!existing.tier) {
      element.tier = candidate.tier;
      await env.DB.prepare("UPDATE elements SET tier = ? WHERE key = ?").bind(candidate.tier, key).run();
    }
  } else {
    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO elements (key, name, emoji, kind, depth, tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(key, candidate.name, candidate.emoji, candidate.kind, candidate.depth, candidate.tier, Date.now())
      .run();
    firstDiscovery = inserted.meta.changes > 0;
    element = (await getElement(env.DB, key)) ?? candidate;
  }

  const [ka, kb] = pair.split("+");
  await env.DB.prepare("INSERT OR IGNORE INTO recipes (pair, a, b, result, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(pair, ka, kb, key, Date.now())
    .run();

  return { element, firstDiscovery, mock: false };
}

// Every element gets its tier in the merge answer; the ones from before tiers
// were rated once by /api/admin/backfill-tiers. A row still without one falls
// back to its depth, without a call.
function tierOf(element: GameElement): Tier {
  return element.tier ?? tierFromDepth(element.depth);
}

async function handleDescribe(body: DescribeRequest, env: Env, oracle: Oracle, admin: boolean): Promise<DescribeResponse> {
  const regenerate = checkRegenerate(body.regenerate, admin);
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  const description = await ensureDescription(env, oracle, element, regenerate);
  return { name: element.name, description, mock: oracle.mock };
}

async function handleSpell(body: SpellRequest, env: Env, oracle: Oracle, admin: boolean): Promise<SpellResponse> {
  const regenerate = checkRegenerate(body.regenerate, admin);
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  const key = elementKey(element.name);

  if (!oracle.mock && !regenerate) {
    const cached = await storedProgram(env.DB, key);
    if (cached) return { name: element.name, tier: tierOf(element), program: cached, mock: false };
  }

  // The spell is written from its grimoire entry, so that comes first.
  const description = await ensureDescription(env, oracle, element, false);
  const tier = tierOf(element);
  await ensureBudget(env, oracle);
  const model = body.model && admin ? body.model : spellModelFor(env, tier);
  const writer = model === env.SPELL_MODEL || oracle.mock ? oracle : oracleFor(env, { spellModel: model, spellEffort: body.effort });
  try {
    const answer = await writer.spell({ name: element.name, kind: element.kind, description, recipe: await firstRecipe(env.DB, key), tier });
    const program: SpellProgram = { version: PROGRAM_VERSION, summary: answer.summary, code: answer.code };
    if (!oracle.mock) await storeProgram(env, key, program, 0, model);
    return { name: element.name, tier, program: { ...program, model }, mock: oracle.mock };
  } finally {
    if (writer !== oracle) await recordSpend(env.DB, writer);
  }
}

async function handleRepair(body: RepairRequest, env: Env, oracle: Oracle, admin: boolean): Promise<SpellResponse> {
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  const key = elementKey(element.name);
  const error = typeof body.error === "string" ? body.error.slice(0, 500) : "";
  if (!error) throw new HttpError(400, "A repair needs the error");
  const row = await env.DB.prepare("SELECT spec, repairs FROM spells WHERE key = ? AND version >= ?")
    .bind(key, FIRST_PROGRAM_VERSION)
    .first<{ spec: string; repairs: number }>();
  if (!row) throw new HttpError(404, "There is no program to repair");
  if (row.repairs >= MAX_REPAIRS && !admin) throw new HttpError(429, `${element.name} has been mended too often; ask the admin for a new spell`);
  const tier = tierOf(element);
  const stored = JSON.parse(row.spec) as SpellProgram;
  await ensureBudget(env, oracle);
  // Repairs always go to the small model: fixing one error in a program that
  // exists is not where Opus earns its price.
  const model = env.REPAIR_MODEL || "claude-haiku-5-5";
  const writer = model === env.SPELL_MODEL || oracle.mock ? oracle : oracleFor(env, { spellModel: model });
  try {
    const answer = await writer.repair(element.name, tier, stored.code, error);
    const program: SpellProgram = { version: PROGRAM_VERSION, summary: answer.summary || stored.summary, code: answer.code };
    if (!oracle.mock) await storeProgram(env, key, program, row.repairs + 1, model);
    return { name: element.name, tier, program: { ...program, model }, mock: oracle.mock };
  } finally {
    if (writer !== oracle) await recordSpend(env.DB, writer);
  }
}

// Whatever version a program was written for, it is served as it is: the
// World API stays backward compatible, and a version bump must never rewrite
// every spell again. Only version 1 rows (declarative specs, not code) are
// written anew, once, on their next cast.
async function storedProgram(db: D1Database, key: string): Promise<SpellProgram | null> {
  const row = await db
    .prepare("SELECT spec, version, model FROM spells WHERE key = ? AND version >= ?")
    .bind(key, FIRST_PROGRAM_VERSION)
    .first<{ spec: string; version: number; model: string }>();
  if (!row) return null;
  try {
    const program = JSON.parse(row.spec) as SpellProgram;
    return typeof program.code === "string" ? { ...program, version: row.version, model: row.model } : null;
  } catch {
    return null;
  }
}

async function storeProgram(env: Env, key: string, program: SpellProgram, repairs: number, model?: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO spells (key, spec, model, version, repairs, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET spec = excluded.spec, model = excluded.model, version = excluded.version,
       repairs = excluded.repairs, created_at = excluded.created_at`,
  )
    .bind(key, JSON.stringify(program), model ?? env.SPELL_MODEL, PROGRAM_VERSION, repairs, Date.now())
    .run();
}

// Measured in November 2026 on six spells: Haiku wrote small and mid spells as
// well as Opus for a thirtieth of the price, but only Opus made a World Tree
// that looks like one. Big spells are rare, so the average stays near 3 cents.
function spellModelFor(env: Env, tier: Tier): string {
  const small = env.SPELL_MODEL_SMALL;
  const upTo = isTier(env.SPELL_SMALL_UP_TO) ? env.SPELL_SMALL_UP_TO : "grand";
  return small && TIERS.indexOf(tier) <= TIERS.indexOf(upTo) ? small : env.SPELL_MODEL;
}


function checkRegenerate(requested: unknown, admin: boolean): boolean {
  if (requested !== true) return false;
  if (!admin) throw new HttpError(403, "Only the admin can regenerate");
  return true;
}

async function ensureDescription(env: Env, oracle: Oracle, element: GameElement, regenerate: boolean): Promise<string> {
  const db = env.DB;
  const key = elementKey(element.name);
  if (!oracle.mock && !regenerate) {
    const cached = await db
      .prepare("SELECT description FROM elements WHERE key = ?")
      .bind(key)
      .first<{ description: string | null }>();
    if (cached?.description) return cached.description;
  }

  await ensureBudget(env, oracle);
  const description = await oracle.describe(element.name, element.kind, await firstRecipe(db, key));
  if (!oracle.mock) {
    // Primitives have no row until they are first described.
    await db
      .prepare(
        `INSERT INTO elements (key, name, emoji, kind, depth, tier, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET description = excluded.description`,
      )
      .bind(key, element.name, element.emoji, element.kind, element.depth, element.tier ?? null, description, Date.now())
      .run();
  }
  return description;
}

async function resolveInput(db: D1Database, raw: unknown, lenient: boolean): Promise<GameElement> {
  if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, "Each element needs a name");
  }
  const element = await getElement(db, elementKey(raw));
  if (element) return element;
  // In mock mode nothing is stored, so unknown names are accepted as they come.
  if (lenient) return { name: raw.trim(), emoji: "✨", kind: "spell", depth: 1, tier: "major" };
  throw new HttpError(400, `Nobody has discovered ${raw} yet`);
}

async function getElement(db: D1Database, key: string): Promise<GameElement | null> {
  const primitive = PRIMITIVES.find((p) => elementKey(p.name) === key);
  if (primitive) return { ...primitive };
  const row = await db
    .prepare("SELECT name, emoji, kind, depth, tier FROM elements WHERE key = ?")
    .bind(key)
    .first<{ name: string; emoji: string; kind: ElementKind; depth: number; tier: string | null }>();
  if (!row) return null;
  return { name: row.name, emoji: row.emoji, kind: row.kind, depth: row.depth, ...(isTier(row.tier) ? { tier: row.tier } : {}) };
}

async function firstRecipe(db: D1Database, key: string): Promise<[string, string] | null> {
  const row = await db
    .prepare("SELECT a, b FROM recipes WHERE result = ? ORDER BY created_at LIMIT 1")
    .bind(key)
    .first<{ a: string; b: string }>();
  if (!row) return null;
  const [a, b] = await Promise.all([getElement(db, row.a), getElement(db, row.b)]);
  return a && b ? [a.name, b.name] : null;
}

const MINOR_WORDS = new Set(["of", "the", "and", "a", "an", "in", "on", "to", "from"]);

function cleanName(raw: string): string {
  const words = raw
    .replace(/["*_`]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((word, i) =>
      i > 0 && MINOR_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1),
    );
  const name = words.join(" ").slice(0, 40).trim();
  if (!name) throw new OracleError("The merge answer had no name");
  return name;
}

function cleanEmoji(raw: string): string {
  const first = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(raw.trim())[Symbol.iterator]().next();
  const emoji = first.done ? "" : first.value.segment;
  return emoji && !/[\p{L}\p{N}]/u.test(emoji) ? emoji : "✨";
}

async function readBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "The request body must be JSON");
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
