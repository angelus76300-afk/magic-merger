import { PRIMITIVES, elementKey, pairKey } from "../shared/elements";
import type {
  DescribeRequest,
  DescribeResponse,
  ElementKind,
  GameElement,
  MergeRequest,
  MergeResponse,
} from "../shared/types";
import { ClaudeOracle, MockOracle, OracleError, type Oracle } from "./oracle";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MERGE_MODEL: string;
  DESCRIBE_MODEL: string;
  // Secrets, set with `wrangler secret put`. Both optional.
  ANTHROPIC_API_KEY?: string;
  ACCESS_TOKEN?: string;
  // Optional: route Claude calls through a gateway, or a local stub in tests.
  ANTHROPIC_BASE_URL?: string;
}

const MAX_NAME_LENGTH = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (env.ACCESS_TOKEN && request.headers.get("x-access-token") !== env.ACCESS_TOKEN) {
      return json({ error: "Wrong or missing access token" }, 401);
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/merge") {
        return json(await handleMerge(await readBody<MergeRequest>(request), env));
      }
      if (request.method === "POST" && url.pathname === "/api/describe") {
        return json(await handleDescribe(await readBody<DescribeRequest>(request), env));
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true, mock: !env.ANTHROPIC_API_KEY });
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
  return env.ANTHROPIC_API_KEY
    ? new ClaudeOracle(env.ANTHROPIC_API_KEY, env.MERGE_MODEL, env.DESCRIBE_MODEL, env.ANTHROPIC_BASE_URL)
    : new MockOracle();
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

async function handleDescribe(body: DescribeRequest, env: Env): Promise<DescribeResponse> {
  const oracle = oracleFor(env);
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  const key = elementKey(element.name);

  if (!oracle.mock) {
    const cached = await env.DB.prepare("SELECT description FROM elements WHERE key = ?")
      .bind(key)
      .first<{ description: string | null }>();
    if (cached?.description) return { name: element.name, description: cached.description, mock: false };
  }

  const description = await oracle.describe(element.name, element.kind, await firstRecipe(env.DB, key));
  if (!oracle.mock) {
    // Primitives have no row until they are first described.
    await env.DB.prepare(
      `INSERT INTO elements (key, name, emoji, kind, depth, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET description = excluded.description`,
    )
      .bind(key, element.name, element.emoji, element.kind, element.depth, description, Date.now())
      .run();
  }
  return { name: element.name, description, mock: oracle.mock };
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
