import { PRIMITIVES, elementKey, pairKey } from "../shared/elements";
import { maxScaleForDepth, sanitizeSpellSpec } from "../shared/spell";
import type {
  DescribeRequest,
  DescribeResponse,
  ElementKind,
  GameElement,
  HealthResponse,
  MergeRequest,
  MergeResponse,
  SpellRequest,
  SpellResponse,
} from "../shared/types";
import { ClaudeOracle, MockOracle, OracleError, parseEffort, type Oracle } from "./oracle";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MERGE_MODEL: string;
  DESCRIBE_MODEL: string;
  SPELL_MODEL: string;
  // low, medium, high, xhigh or max. How long the spell designer thinks.
  SPELL_EFFORT?: string;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const token = request.headers.get("x-access-token");
    const admin = !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
    if (env.ACCESS_TOKEN && token !== env.ACCESS_TOKEN && !admin) {
      return json({ error: "Wrong or missing access token" }, 401);
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/merge") {
        return json(await handleMerge(await readBody<MergeRequest>(request), env));
      }
      if (request.method === "POST" && url.pathname === "/api/describe") {
        return json(await handleDescribe(await readBody<DescribeRequest>(request), env, admin));
      }
      if (request.method === "POST" && url.pathname === "/api/spell") {
        return json(await handleSpell(await readBody<SpellRequest>(request), env, admin));
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true, mock: !env.ANTHROPIC_API_KEY, admin } satisfies HealthResponse);
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err instanceof OracleError) return json({ error: err.message }, 502);
      console.error(err);
      return json({ error: "Something went wrong in the Worker" }, 500);
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

function oracleFor(env: Env): Oracle {
  if (!env.ANTHROPIC_API_KEY) return new MockOracle();
  const models = {
    merge: env.MERGE_MODEL,
    describe: env.DESCRIBE_MODEL,
    spell: env.SPELL_MODEL,
    spellEffort: parseEffort(env.SPELL_EFFORT, "medium"),
  };
  return new ClaudeOracle(env.ANTHROPIC_API_KEY, models, env.ANTHROPIC_BASE_URL);
}

async function handleMerge(body: MergeRequest, env: Env): Promise<MergeResponse> {
  const oracle = oracleFor(env);
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

  const answer = await oracle.merge(a.name, b.name);
  const candidate: GameElement = {
    name: cleanName(answer.name),
    emoji: cleanEmoji(answer.emoji),
    kind: answer.kind,
    depth: Math.max(a.depth, b.depth) + 1,
  };

  // Mock answers are never stored, so a real key later starts from a clean cache.
  if (oracle.mock) return { element: candidate, firstDiscovery: false, mock: true };

  const key = elementKey(candidate.name);
  const existing = await getElement(env.DB, key);
  let element: GameElement;
  let firstDiscovery = false;
  if (existing) {
    // An element keeps its first emoji and kind forever; only its depth can shrink
    // when a shorter path to it is found.
    element = { ...existing, depth: Math.min(existing.depth, candidate.depth) };
    if (element.depth < existing.depth) {
      await env.DB.prepare("UPDATE elements SET depth = ? WHERE key = ?").bind(element.depth, key).run();
    }
  } else {
    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO elements (key, name, emoji, kind, depth, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(key, candidate.name, candidate.emoji, candidate.kind, candidate.depth, Date.now())
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

async function handleDescribe(body: DescribeRequest, env: Env, admin: boolean): Promise<DescribeResponse> {
  const regenerate = checkRegenerate(body.regenerate, admin);
  const oracle = oracleFor(env);
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  const description = await ensureDescription(env.DB, oracle, element, regenerate);
  return { name: element.name, description, mock: oracle.mock };
}

async function handleSpell(body: SpellRequest, env: Env, admin: boolean): Promise<SpellResponse> {
  const regenerate = checkRegenerate(body.regenerate, admin);
  const oracle = oracleFor(env);
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  if (element.kind !== "spell") throw new HttpError(400, `${element.name} is an artifact and cannot be cast`);
  const key = elementKey(element.name);
  const maxScale = maxScaleForDepth(element.depth);

  if (!oracle.mock && !regenerate) {
    const cached = await env.DB.prepare("SELECT spec FROM spells WHERE key = ?").bind(key).first<{ spec: string }>();
    if (cached) return { name: element.name, spec: sanitizeSpellSpec(JSON.parse(cached.spec), maxScale), mock: false };
  }

  // The spell is designed from its grimoire entry, so that comes first.
  const description = await ensureDescription(env.DB, oracle, element, false);
  const raw = await oracle.spell({
    name: element.name,
    description,
    recipe: await firstRecipe(env.DB, key),
    maxScale,
  });
  const spec = sanitizeSpellSpec(raw, maxScale);

  if (!oracle.mock) {
    await env.DB.prepare(
      `INSERT INTO spells (key, spec, model, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET spec = excluded.spec, model = excluded.model, created_at = excluded.created_at`,
    )
      .bind(key, JSON.stringify(spec), env.SPELL_MODEL, Date.now())
      .run();
  }
  return { name: element.name, spec, mock: oracle.mock };
}

function checkRegenerate(requested: unknown, admin: boolean): boolean {
  if (requested !== true) return false;
  if (!admin) throw new HttpError(403, "Only the admin can regenerate");
  return true;
}

async function ensureDescription(
  db: D1Database,
  oracle: Oracle,
  element: GameElement,
  regenerate: boolean,
): Promise<string> {
  const key = elementKey(element.name);
  if (!oracle.mock && !regenerate) {
    const cached = await db
      .prepare("SELECT description FROM elements WHERE key = ?")
      .bind(key)
      .first<{ description: string | null }>();
    if (cached?.description) return cached.description;
  }

  const description = await oracle.describe(element.name, element.kind, await firstRecipe(db, key));
  if (!oracle.mock) {
    // Primitives have no row until they are first described.
    await db
      .prepare(
        `INSERT INTO elements (key, name, emoji, kind, depth, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET description = excluded.description`,
      )
      .bind(key, element.name, element.emoji, element.kind, element.depth, description, Date.now())
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
  if (lenient) return { name: raw.trim(), emoji: "✨", kind: "spell", depth: 1 };
  throw new HttpError(400, `Nobody has discovered ${raw} yet`);
}

async function getElement(db: D1Database, key: string): Promise<GameElement | null> {
  const primitive = PRIMITIVES.find((p) => elementKey(p.name) === key);
  if (primitive) return primitive;
  const row = await db
    .prepare("SELECT name, emoji, kind, depth FROM elements WHERE key = ?")
    .bind(key)
    .first<{ name: string; emoji: string; kind: ElementKind; depth: number }>();
  return row ?? null;
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
