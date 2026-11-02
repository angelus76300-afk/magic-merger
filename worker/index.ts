import { PRIMITIVES, elementKey, pairKey } from "../shared/elements";
import type { SpellProgram } from "../shared/spellcode";
import { TIERS, capTier, isTier, tierFromDepth, type Tier } from "../shared/tiers";
import type {
  DescribeRequest,
  DescribeResponse,
  ElementKind,
  GameElement,
  HealthResponse,
  MergeRequest,
  MergeResponse,
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
        const tried = admin && (body.model || body.effort) ? oracleFor(env, body.model, body.effort) : oracle;
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
        return json({ month: await monthSpend(env.DB), budget: budget(env) });
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

function oracleFor(env: Env, spellModel?: string, spellEffort?: string): Oracle {
  if (!env.ANTHROPIC_API_KEY) return new MockOracle();
  const models = {
    merge: env.MERGE_MODEL,
    describe: env.DESCRIBE_MODEL,
    spell: spellModel && SPELL_MODELS.has(spellModel) ? spellModel : env.SPELL_MODEL,
    spellEffort: parseEffort(spellEffort ?? env.SPELL_EFFORT, "medium"),
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
  if (element.kind !== "spell") throw new HttpError(400, `${element.name} is an artifact and cannot be cast`);
  const key = elementKey(element.name);

  if (!oracle.mock && !regenerate) {
    const cached = await storedProgram(env.DB, key);
    if (cached) return { name: element.name, tier: await ensureTier(env, oracle, element), program: cached, mock: false };
  }

  // The spell is written from its grimoire entry, so that comes first.
  const description = await ensureDescription(env, oracle, element, false);
  const tier = await ensureTier(env, oracle, element);
  await ensureBudget(env, oracle);
  const model = body.model && admin ? body.model : spellModelFor(env, tier);
  const writer = model === env.SPELL_MODEL || oracle.mock ? oracle : oracleFor(env, model, body.effort);
  try {
    const answer = await writer.spell({ name: element.name, description, recipe: await firstRecipe(env.DB, key), tier });
    const program: SpellProgram = { version: 2, summary: answer.summary, code: answer.code };
    if (!oracle.mock) await storeProgram(env, key, program, 0, model);
    return { name: element.name, tier, program, mock: oracle.mock };
  } finally {
    if (writer !== oracle) await recordSpend(env.DB, writer);
  }
}

async function handleRepair(body: RepairRequest, env: Env, oracle: Oracle, admin: boolean): Promise<SpellResponse> {
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  if (element.kind !== "spell") throw new HttpError(400, `${element.name} cannot be cast`);
  const key = elementKey(element.name);
  const error = typeof body.error === "string" ? body.error.slice(0, 500) : "";
  if (!error) throw new HttpError(400, "A repair needs the error");
  const row = await env.DB.prepare("SELECT spec, repairs FROM spells WHERE key = ? AND version = 2").bind(key).first<{ spec: string; repairs: number }>();
  if (!row) throw new HttpError(404, "There is no program to repair");
  if (row.repairs >= MAX_REPAIRS && !admin) throw new HttpError(429, `${element.name} has been mended too often; ask the admin for a new spell`);
  const tier = await ensureTier(env, oracle, element);
  const stored = JSON.parse(row.spec) as SpellProgram;
  await ensureBudget(env, oracle);
  const model = spellModelFor(env, tier);
  const writer = model === env.SPELL_MODEL || oracle.mock ? oracle : oracleFor(env, model);
  try {
    const answer = await writer.repair(element.name, tier, stored.code, error);
    const program: SpellProgram = { version: 2, summary: answer.summary || stored.summary, code: answer.code };
    if (!oracle.mock) await storeProgram(env, key, program, row.repairs + 1, model);
    return { name: element.name, tier, program, mock: oracle.mock };
  } finally {
    if (writer !== oracle) await recordSpend(env.DB, writer);
  }
}

async function storedProgram(db: D1Database, key: string): Promise<SpellProgram | null> {
  const row = await db.prepare("SELECT spec FROM spells WHERE key = ? AND version = 2").bind(key).first<{ spec: string }>();
  if (!row) return null;
  try {
    const program = JSON.parse(row.spec) as SpellProgram;
    return typeof program.code === "string" ? program : null;
  } catch {
    return null;
  }
}

async function storeProgram(env: Env, key: string, program: SpellProgram, repairs: number, model?: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO spells (key, spec, model, version, repairs, created_at) VALUES (?, ?, ?, 2, ?, ?)
     ON CONFLICT (key) DO UPDATE SET spec = excluded.spec, model = excluded.model, version = 2,
       repairs = excluded.repairs, created_at = excluded.created_at`,
  )
    .bind(key, JSON.stringify(program), model ?? env.SPELL_MODEL, repairs, Date.now())
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

// Elements from before tiers get one the first time it matters, then keep it.
async function ensureTier(env: Env, oracle: Oracle, element: GameElement): Promise<Tier> {
  if (element.tier) return element.tier;
  if (oracle.mock) return tierFromDepth(element.depth);
  await ensureBudget(env, oracle);
  const tier = await oracle.tier(element.name, element.kind);
  element.tier = tier;
  await env.DB.prepare("UPDATE elements SET tier = ? WHERE key = ?").bind(tier, elementKey(element.name)).run();
  return tier;
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
