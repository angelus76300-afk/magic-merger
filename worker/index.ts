import { PRIMITIVES, elementKey, pairKey } from "../shared/elements";
import { FIRST_PROGRAM_VERSION, PROGRAM_VERSION, type SpellProgram } from "../shared/spellcode";
import { TIERS, capTier, isTier, tierFromDepth, type Tier } from "../shared/tiers";
import { REASON_PROMPT, isBig, isReason, votedDown, votedUp, votedWorse, votesNeeded, VOTE_WINDOW_MS } from "../shared/votes";
import type {
  CastRecord,
  CastResponse,
  CheckRequest,
  DescribeRequest,
  DescribeResponse,
  ElementKind,
  GameElement,
  HealthResponse,
  LiveResponse,
  MergeRequest,
  MergeResponse,
  MergeTrialRequest,
  PeopleResponse,
  PerfSample,
  ProgramInfo,
  SpendResponse,
  RepairRequest,
  SpellRequest,
  SpellResponse,
  VoteRequest,
  VoteResponse,
} from "../shared/types";
import { ClaudeOracle, MockOracle, OracleError, parseEffort, type Oracle, type SpellRequest as OracleSpellRequest } from "./oracle";
import {
  averageDaily,
  downReasons,
  getProgram,
  insertProgram,
  libraryEntries,
  liveProgram,
  newerTrial,
  pickExamples,
  playerId,
  programOf,
  promote,
  recentRewrite,
  recordActivity,
  rewriteSpendToday,
  setStatus,
  tally,
  type ProgramOrigin,
  type ProgramRow,
} from "./programs";
import type { LibraryExample, Rewrite } from "./prompts";
import {
  ADMIN_PAYER,
  ESTIMATE,
  Ledger,
  LedgerError,
  allowance,
  createInvite,
  hold,
  inviteByToken,
  monthKey,
  monthStart,
  monthTotals,
  once,
  payerOf,
  relink,
  settle,
  spentBy,
  sweep,
  type InviteRow,
  type Payer,
} from "./ledger";

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
  // Dollars of Claude calls allowed per calendar month (UTC), everyone
  // together. Past it, the game keeps working from the stored recipe book but
  // asks Claude nothing new.
  BUDGET_USD?: string;
  // 3.4. Dollars a month each invite may spend, unless the admin tops it up.
  INVITE_CAP_USD?: string;
  // Secrets, set with `wrangler secret put`. All optional.
  ANTHROPIC_API_KEY?: string;
  // The admin: invites people, sees spend, rewrites spells. Players come in
  // with their own invite link (3.4); the shared ACCESS_TOKEN is gone.
  ADMIN_TOKEN?: string;
  // Optional: route Claude calls through a gateway, or a local stub in tests.
  ANTHROPIC_BASE_URL?: string;
  // 3.3. Who looks at Spell Lab frames and guesses the vote (Haiku).
  JUDGE_MODEL?: string;
  // Dollars a day that votes, the judge and failed test runs may spend on rewrites.
  REWRITE_BUDGET_USD?: string;
  // "0" writes big spells with the big model at once, as in 3.2. Otherwise the
  // small model drafts them now and the big one writes them through the Batch API.
  BIG_SPELLS_BATCH?: string;
}

const MAX_NAME_LENGTH = 60;
// A program that keeps crashing is sent back to Claude at most this many times.
const MAX_REPAIRS = 3;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const who = await authenticate(request, env);
    if (who instanceof Response) return who;
    const { admin, payer } = who;
    if (url.pathname === "/api/health" && request.method === "GET") {
      const player = playerId(request);
      if (player && env.ANTHROPIC_API_KEY && payer) ctx.waitUntil(recordActivity(env.DB, player).catch(() => undefined));
      return json(await health(env, admin, payer));
    }
    if (!payer) return json({ error: "Magic Merger is invite only. Ask the person who told you about it for your own link.", code: "invite" }, 401);
    if (payer.invite !== "admin") ctx.waitUntil(seen(env.DB, payer.invite).catch(() => undefined));

    const ledger = new Ledger(payer);
    const oracle = oracleFor(env, {}, ledger);
    const player = playerId(request);
    try {
      if (request.method === "POST" && url.pathname === "/api/merge") {
        const body = await readBody<MergeRequest>(request);
        return json(await onceFor(env, oracle, `merge:${pairKey(String(body.a), String(body.b))}`, () => handleMerge(body, env, oracle)));
      }
      if (request.method === "POST" && url.pathname === "/api/describe") {
        const body = await readBody<DescribeRequest>(request);
        const run = () => handleDescribe(body, env, oracle, admin);
        return json(body.regenerate === true ? await run() : await onceFor(env, oracle, `describe:${elementKey(String(body.name))}`, run));
      }
      if (request.method === "POST" && url.pathname === "/api/spell") {
        const body = await readBody<SpellRequest>(request);
        // The admin can try another model or effort for one design.
        const tried = admin && (body.model || body.effort) ? oracleFor(env, { spellModel: body.model, spellEffort: body.effort }, ledger) : oracle;
        try {
          const run = () => handleSpell(body, env, tried, admin, ctx);
          // A regeneration is asked on purpose; anything else is written once.
          return json(body.regenerate === true ? await run() : await onceFor(env, oracle, `spell:${elementKey(String(body.name))}`, run));
        } finally {
          if (tried !== oracle) await recordSpend(env.DB, tried);
        }
      }
      if (request.method === "POST" && url.pathname === "/api/spell/repair") {
        const body = await readBody<RepairRequest>(request);
        return json(await onceFor(env, oracle, `repair:${elementKey(String(body.name))}`, () => handleRepair(body, env, oracle, admin)));
      }
      if (request.method === "POST" && url.pathname === "/api/spell/check") {
        const body = await readBody<CheckRequest>(request);
        return json(await onceFor(env, oracle, `check:${Number(body.id)}`, () => handleCheck(body, env, oracle)));
      }
      if (request.method === "POST" && url.pathname === "/api/report") {
        return json(await handleReport(await readBody<{ name?: unknown; reason?: unknown }>(request), env, payer));
      }
      if (request.method === "POST" && url.pathname === "/api/spells/live") {
        return json(await handleLive(await readBody<{ names?: unknown }>(request), env));
      }
      if (request.method === "POST" && url.pathname === "/api/cast") {
        return json(await handleCast(await readBody<CastRecord>(request), env, player));
      }
      if (request.method === "POST" && url.pathname === "/api/vote") {
        return json(await handleVote(await readBody<VoteRequest>(request), env, player, payer, ctx));
      }
      if (request.method === "GET" && url.pathname === "/api/spell/info" && admin) {
        return json(await programInfo(env, url.searchParams.get("name") ?? ""));
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
        const trial = oracleFor(env, { mergeModel: body.model, mergeEffort: body.effort }, ledger);
        try {
          await ensureBudget(env, trial, "merge", ESTIMATE.merge);
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
      if (url.pathname.startsWith("/api/admin/") && admin) {
        const handled = await handleAdmin(request, url, env, oracle, ctx);
        if (handled) return handled;
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err instanceof LedgerError) return json({ error: err.message, code: err.code }, err.status);
      if (err instanceof OracleError) return json({ error: err.message }, 502);
      console.error(err);
      return json({ error: "Something went wrong in the Worker" }, 500);
    } finally {
      // Every call is written down, even when the request failed after it,
      // and the money held for it is released in the same batch.
      await closeLedger(env.DB, oracle);
    }
  },

  // Every ten minutes: collects the big spells the Batch API has written, and
  // turns holds of requests that died into spend.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([pollBatches(env), sweep(env.DB).catch((err) => console.error("sweep", err))]).then(() => undefined));
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

// Who pays for each oracle's calls. Oracles made for one request share its ledger.
const LEDGERS = new WeakMap<Oracle, Ledger>();

function ledgerOf(oracle: Oracle): Ledger {
  return LEDGERS.get(oracle) ?? new Ledger(ADMIN_PAYER);
}

function oracleFor(env: Env, o: OracleOverrides, ledger: Ledger): Oracle {
  const oracle = makeOracle(env, o);
  LEDGERS.set(oracle, ledger);
  return oracle;
}

function makeOracle(env: Env, o: OracleOverrides): Oracle {
  if (!env.ANTHROPIC_API_KEY) return new MockOracle();
  const models = {
    merge: o.mergeModel && SPELL_MODELS.has(o.mergeModel) ? o.mergeModel : env.MERGE_MODEL,
    mergeEffort: parseEffort(o.mergeEffort ?? env.MERGE_EFFORT, "low"),
    describe: env.DESCRIBE_MODEL,
    spell: o.spellModel && SPELL_MODELS.has(o.spellModel) ? o.spellModel : env.SPELL_MODEL,
    spellEffort: parseEffort(o.spellEffort ?? env.SPELL_EFFORT, "medium"),
    judge: env.JUDGE_MODEL || "claude-haiku-5-5",
  };
  return new ClaudeOracle(env.ANTHROPIC_API_KEY, models, env.ANTHROPIC_BASE_URL);
}

// Budget: dollars a month for everyone, and for each invite.
function budget(env: Env): number {
  const v = Number(env.BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : 50;
}

function inviteCap(env: Env): number {
  const v = Number(env.INVITE_CAP_USD);
  return Number.isFinite(v) && v >= 0 ? v : 5;
}

// Holds the expected cost of one call before it is made (ledger.ts): throws
// when the month, the invite's allowance or the burst guard says no.
async function ensureBudget(env: Env, oracle: Oracle, call: string, usd: number): Promise<void> {
  if (oracle.mock) return;
  await hold(env.DB, ledgerOf(oracle), call, usd, budget(env));
}

// What a spell call is expected to cost, by the model that writes it.
function spellEstimate(env: Env, model: string): number {
  return model === smallModel(env) || model === (env.REPAIR_MODEL || "claude-haiku-5-5") ? ESTIMATE.small : ESTIMATE.big;
}

// Identical requests in flight ask Claude once (mock answers are not stored,
// so there is nothing to wait for).
function onceFor<T>(env: Env, oracle: Oracle, key: string, fn: () => Promise<T>): Promise<T> {
  return oracle.mock ? fn() : once(env.DB, key, fn);
}

// Records the request's own calls and releases what it held, in one batch.
async function closeLedger(db: D1Database, oracle: Oracle): Promise<void> {
  try {
    await settle(db, ledgerOf(oracle), oracle.spent.splice(0));
  } catch (err) {
    console.error("could not record spend", err);
  }
}

// The admin token, an invite link, or nobody. Without an API key the game runs
// in mock mode and costs nothing, so it is open (local development).
async function authenticate(request: Request, env: Env): Promise<{ admin: boolean; payer: Payer | null } | Response> {
  const token = request.headers.get("x-access-token");
  if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) return { admin: true, payer: ADMIN_PAYER };
  const secret = request.headers.get("x-invite");
  if (secret) {
    const row = await inviteByToken(env.DB, secret);
    if (row?.status === "revoked") return json({ error: "This invite link has been turned off.", code: "revoked" }, 403);
    if (row) return { admin: false, payer: payerOf(row) };
  }
  if (!env.ANTHROPIC_API_KEY) return { admin: false, payer: { ...ADMIN_PAYER, invite: "local", name: "local" } };
  return { admin: false, payer: null };
}

// Last visit, written at most every five minutes.
async function seen(db: D1Database, invite: string): Promise<void> {
  const now = Date.now();
  await db
    .prepare("UPDATE invites SET last_seen = ? WHERE id = ? AND COALESCE(last_seen, 0) < ?")
    .bind(now, invite, now - 300_000)
    .run();
}

async function health(env: Env, admin: boolean, payer: Payer | null): Promise<HealthResponse> {
  const out: HealthResponse = { ok: true, mock: !env.ANTHROPIC_API_KEY, admin, invited: !!payer };
  if (payer && payer.invite !== "admin" && payer.invite !== "local") {
    const spent = await spentBy(env.DB, payer.invite);
    out.invite = { name: payer.name, status: payer.status, spent: round(spent, 3), cap: payer.cap ?? 0 };
  }
  return out;
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
  const rows = await env.DB.prepare("SELECT key, name, kind FROM elements WHERE tier IS NULL LIMIT 300").all<{
    key: string;
    name: string;
    kind: ElementKind;
  }>();
  if (!rows.results.length) return { rated: 0, missing: [] };
  await ensureBudget(env, oracle, "tier", ESTIMATE.tier);
  const tiers = await oracle.tiers(rows.results);
  if (oracle.mock) return { rated: 0, missing: [] };
  const updates = rows.results
    .filter((r) => tiers.has(r.name))
    .map((r) => env.DB.prepare("UPDATE elements SET tier = ? WHERE key = ?").bind(tiers.get(r.name)!, r.key));
  if (updates.length) await env.DB.batch(updates);
  return { rated: updates.length, missing: rows.results.filter((r) => !tiers.has(r.name)).map((r) => r.name) };
}

// Writes down the calls of an oracle made for one step of a request. Its
// holds stay until the request ends (closeLedger): for a moment the call is
// counted twice, which errs on the safe side.
async function recordSpend(db: D1Database, oracle: Oracle): Promise<void> {
  if (!oracle.spent.length) return;
  const at = Date.now();
  const invite = ledgerOf(oracle).payer.invite;
  try {
    await db.batch(
      oracle.spent
        .splice(0)
        .map((s) => db.prepare("INSERT INTO spend (at, call, model, usd, invite) VALUES (?, ?, ?, ?, ?)").bind(at, s.call, s.model, s.usd, invite)),
    );
  } catch (err) {
    console.error("could not record spend", err);
  }
}

async function handleMerge(body: MergeRequest, env: Env, oracle: Oracle): Promise<MergeResponse> {
  const a = await resolveInput(env.DB, body.a, oracle.mock);
  const b = await resolveInput(env.DB, body.b, oracle.mock);
  const pair = pairKey(a.name, b.name);

  const known = await env.DB.prepare("SELECT result FROM recipes WHERE pair = ?").bind(pair).first<{ result: string }>();
  if (known) {
    const element = await getElement(env.DB, known.result);
    if (element) return { element, firstDiscovery: false, mock: oracle.mock };
  }

  await ensureBudget(env, oracle, "merge", ESTIMATE.merge);
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
      "INSERT OR IGNORE INTO elements (key, name, emoji, kind, depth, tier, created_at, invite) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(key, candidate.name, candidate.emoji, candidate.kind, candidate.depth, candidate.tier, Date.now(), ledgerOf(oracle).payer.invite)
      .run();
    firstDiscovery = inserted.meta.changes > 0;
    element = (await getElement(env.DB, key)) ?? candidate;
  }

  const [ka, kb] = pair.split("+");
  await env.DB.prepare("INSERT OR IGNORE INTO recipes (pair, a, b, result, created_at) VALUES (?, ?, ?, ?, ?)").bind(pair, ka, kb, key, Date.now()).run();

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

async function handleSpell(body: SpellRequest, env: Env, oracle: Oracle, admin: boolean, ctx: ExecutionContext): Promise<SpellResponse> {
  const regenerate = checkRegenerate(body.regenerate, admin);
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  const key = elementKey(element.name);
  const tier = tierOf(element);

  const live = oracle.mock ? null : await liveProgram(env.DB, key);
  if (!oracle.mock && !regenerate) {
    // A trial newer than the live program goes to whoever asks, who tests it.
    const trial = await newerTrial(env.DB, key, live?.row.id ?? null);
    const served = trial ?? live?.row;
    const program = served ? programOf(served) : null;
    if (program) return { name: element.name, tier, program, mock: false };
  }

  // The spell is written from its grimoire entry, so that comes first.
  const description = await ensureDescription(env, oracle, element, false);
  // Big spells: drafted now by the small model, written later by the big one
  // through the Batch API at half price. The admin's button still asks the
  // big model at once, and says so.
  const batch = !oracle.mock && !regenerate && !(admin && body.model) && isBig(tier, smallUpTo(env)) && batchEnabled(env);
  const model = body.model && admin ? body.model : batch ? smallModel(env) : spellModelFor(env, tier);
  await ensureBudget(env, oracle, "spell", spellEstimate(env, model));
  const request: OracleSpellRequest = { name: element.name, kind: element.kind, description, recipe: await firstRecipe(env.DB, key), tier };
  if (!oracle.mock && model === smallModel(env)) request.examples = await examplesFor(env, key, request);
  const answer = await writeWith(env, oracle, model, body.effort, (w) => w.spell(request));
  const program: SpellProgram = { version: PROGRAM_VERSION, summary: answer.summary, code: answer.code };
  if (oracle.mock) return { name: element.name, tier, program: { ...program, model }, mock: true };
  const origin: ProgramOrigin = regenerate ? "admin" : batch ? "draft" : "new";
  const id = await insertProgram(env.DB, key, JSON.stringify(program), model, PROGRAM_VERSION, origin, "trial", live?.row.id ?? null);
  // The Opus version through the Batch API is held once the draft exists: a
  // player near their allowance keeps the draft and skips the upgrade.
  const batchHold = batch ? await holdBatch(env, oracle).catch(() => null) : null;
  if (batchHold !== null)
    ctx.waitUntil(queueBatch(env, key, request, id, "upgrade", ledgerOf(oracle).payer.invite, batchHold).catch((err) => console.error("batch", err)));
  return { name: element.name, tier, program: { ...program, model, id, trial: true }, mock: false };
}

// The program crashed in a player's World. The fix is a trial like any new
// program: the browser tests it before it replaces the crashing one.
async function handleRepair(body: RepairRequest, env: Env, oracle: Oracle, admin: boolean): Promise<SpellResponse> {
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  const key = elementKey(element.name);
  const error = typeof body.error === "string" ? body.error.slice(0, 500) : "";
  if (!error) throw new HttpError(400, "A repair needs the error");
  const live = oracle.mock ? null : await liveProgram(env.DB, key);
  if (!oracle.mock && !live) throw new HttpError(404, "There is no program to repair");
  if (live && live.repairs >= MAX_REPAIRS && !admin) throw new HttpError(429, `${element.name} has been mended too often; ask the admin for a new spell`);
  const tier = tierOf(element);
  // A fix or a rewrite is already waiting for its test run (two browsers saw
  // the same crash): that one is served, not mended again.
  const waiting = live ? await newerTrial(env.DB, key, live.row.id) : null;
  const pending = waiting ? programOf(waiting) : null;
  if (pending) return { name: element.name, tier, program: pending, mock: false };
  const stored = live ? programOf(live.row) : null;
  await ensureBudget(env, oracle, "repair", ESTIMATE.small);
  // Repairs always go to the small model: fixing one error in a program that
  // exists is not where Opus earns its price.
  const model = env.REPAIR_MODEL || "claude-haiku-5-5";
  const answer = await writeWith(env, oracle, model, undefined, (w) => w.repair(element.name, tier, stored?.code ?? "", error));
  const program: SpellProgram = { version: PROGRAM_VERSION, summary: answer.summary || stored?.summary || "", code: answer.code };
  if (oracle.mock || !live) return { name: element.name, tier, program: { ...program, model }, mock: oracle.mock };
  await env.DB.prepare("UPDATE spells SET repairs = repairs + 1 WHERE key = ?").bind(key).run();
  const id = await insertProgram(env.DB, key, JSON.stringify(program), model, PROGRAM_VERSION, "repair", "trial", live.row.id);
  return { name: element.name, tier, program: { ...program, model, id, trial: true }, mock: false };
}

// Asks one model for a program, with its own oracle when it is not the default
// one, and records what that cost.
async function writeWith<T>(env: Env, oracle: Oracle, model: string, effort: string | undefined, fn: (o: Oracle) => Promise<T>): Promise<T> {
  const writer = oracle.mock || (model === env.SPELL_MODEL && !effort) ? oracle : oracleFor(env, { spellModel: model, spellEffort: effort }, ledgerOf(oracle));
  try {
    return await fn(writer);
  } finally {
    if (writer !== oracle) await recordSpend(env.DB, writer);
  }
}

function smallModel(env: Env): string {
  return env.SPELL_MODEL_SMALL || "claude-haiku-5-5";
}

function smallUpTo(env: Env): Tier {
  return isTier(env.SPELL_SMALL_UP_TO) ? env.SPELL_SMALL_UP_TO : "grand";
}

function batchEnabled(env: Env): boolean {
  return env.BIG_SPELLS_BATCH !== "0";
}

async function examplesFor(env: Env, key: string, request: OracleSpellRequest): Promise<LibraryExample[]> {
  const entries = await libraryEntries(env.DB);
  return pickExamples(entries, { key, name: request.name, description: request.description, kind: request.kind, tier: request.tier });
}

// The test run of a trial, done in the browser (src/sim/check.ts): pass, and
// it becomes the live program; fail, and it is written once more with what the
// test found, by the small model with the failing code in front of it. A
// second failure keeps the program that was live before, if there is one.
async function handleCheck(body: CheckRequest, env: Env, oracle: Oracle): Promise<SpellResponse> {
  if (oracle.mock) throw new HttpError(400, "Mock programs are not stored");
  const element = await resolveInput(env.DB, body.name, false);
  const key = elementKey(element.name);
  const tier = tierOf(element);
  const row = await getProgram(env.DB, Number(body.id));
  if (!row || row.key !== key) throw new HttpError(404, "There is no such program");
  const served = async (): Promise<SpellResponse> => {
    const live = await liveProgram(env.DB, key);
    const trial = await newerTrial(env.DB, key, live?.row.id ?? null);
    const program = programOf((trial ?? live?.row)!);
    if (!program) throw new HttpError(404, "There is no program");
    return { name: element.name, tier, program, mock: false };
  };
  // Someone else's browser got there first.
  if (row.status !== "trial") return served();
  const detail = String(body.detail ?? "").slice(0, 400);
  const problem = body.problem === "crash" || body.problem === "nothing" || body.problem === "wiped" ? body.problem : null;
  const verdict = { ok: body.ok === true, problem, detail, stats: body.stats ?? {}, at: Date.now() };
  await env.DB.prepare("UPDATE programs SET checked = ? WHERE id = ?").bind(JSON.stringify(verdict).slice(0, 2000), row.id).run();
  if (verdict.ok || !problem) {
    await promote(env.DB, row);
    return served();
  }
  const live = await liveProgram(env.DB, key);
  const others = live && live.row.id !== row.id ? live : null;
  const keep = async (): Promise<SpellResponse> => {
    if (others) await setStatus(env.DB, row.id, "rejected");
    else await promote(env.DB, row);
    return served();
  };
  // Rewrite once: a program written to fix a failed test is not fixed again.
  if (row.origin === "check") return keep();
  let description: string;
  try {
    await ensureBudget(env, oracle, "rewrite", ESTIMATE.small);
    description = await ensureDescription(env, oracle, element, false);
  } catch {
    // Over a budget: the program is kept as it is rather than refused.
    return keep();
  }
  const request: OracleSpellRequest = {
    name: element.name,
    kind: element.kind,
    description,
    recipe: await firstRecipe(env.DB, key),
    tier,
    rewrite: { reasons: [`its test run found: ${detail}`], summary: programOf(row)?.summary, code: programOf(row)?.code },
  };
  let answer;
  try {
    answer = await writeWith(env, oracle, smallModel(env), undefined, (w) => w.spell(request));
  } catch (err) {
    console.error("check rewrite", err);
    return keep();
  }
  await setStatus(env.DB, row.id, "rejected");
  const program: SpellProgram = { version: PROGRAM_VERSION, summary: answer.summary, code: answer.code };
  const id = await insertProgram(env.DB, key, JSON.stringify(program), smallModel(env), PROGRAM_VERSION, "check", "trial", row.parent);
  await env.DB.prepare("INSERT INTO rewrites (key, from_pid, to_pid, cause, at, status, model) VALUES (?, ?, ?, 'check', ?, 'done', ?)")
    .bind(key, row.id, id, Date.now(), smallModel(env))
    .run();
  return { name: element.name, tier, program: { ...program, model: smallModel(env), id, trial: true }, mock: false };
}

// The program each of these elements should have now.
async function handleLive(body: { names?: unknown }, env: Env): Promise<LiveResponse> {
  const names = Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string" && n.length <= MAX_NAME_LENGTH).slice(0, 600) : [];
  const keys = [...new Set(names.map(elementKey))];
  const byKey = new Map(names.map((n) => [elementKey(n), n]));
  const programs: LiveResponse["programs"] = {};
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    const marks = chunk.map(() => "?").join(", ");
    const rows = await env.DB.prepare(
      `SELECT s.key, s.pid, (SELECT MAX(p.id) FROM programs p WHERE p.key = s.key AND p.status = 'trial' AND p.id > COALESCE(s.pid, 0)) AS trial
       FROM spells s WHERE s.key IN (${marks}) AND s.version >= ?`,
    )
      .bind(...chunk, FIRST_PROGRAM_VERSION)
      .all<{ key: string; pid: number | null; trial: number | null }>();
    for (const r of rows.results) {
      const id = r.trial ?? r.pid;
      if (id) programs[byKey.get(r.key) ?? r.key] = { id, trial: !!r.trial };
    }
  }
  return { programs };
}

async function handleCast(body: CastRecord, env: Env, player: string | null): Promise<CastResponse> {
  if (!env.ANTHROPIC_API_KEY || !player) return { canVote: false };
  const element = await resolveInput(env.DB, body.name, false);
  const row = await getProgram(env.DB, Number(body.id));
  if (!row || row.key !== elementKey(element.name)) return { canVote: false };
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO casts (player, pid, at) VALUES (?, ?, ?) ON CONFLICT (player, pid) DO UPDATE SET at = excluded.at").bind(player, row.id, now),
    env.DB.prepare("INSERT OR IGNORE INTO activity (day, player) VALUES (?, ?)").bind(Math.floor(now / 86400_000), player),
  ]);
  const voted = await env.DB.prepare("SELECT 1 AS x FROM votes WHERE player = ? AND pid = ?").bind(player, row.id).first();
  return { canVote: !voted };
}

// One vote per player per version, only from players who cast that version
// in the last two days. A changed mind replaces the earlier vote.
async function handleVote(body: VoteRequest, env: Env, player: string | null, payer: Payer, ctx: ExecutionContext): Promise<VoteResponse> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(400, "Votes need the real magic (mock mode)");
  if (!player) throw new HttpError(400, "A vote needs a player id");
  const element = await resolveInput(env.DB, body.name, false);
  const key = elementKey(element.name);
  const row = await getProgram(env.DB, Number(body.id));
  if (!row || row.key !== key) throw new HttpError(404, "There is no such program");
  const up = body.up === true;
  if (!up && !isReason(body.reason)) throw new HttpError(400, "A down vote needs a reason");
  const cast = await env.DB.prepare("SELECT at FROM casts WHERE player = ? AND pid = ?").bind(player, row.id).first<{ at: number }>();
  if (!cast || Date.now() - cast.at > VOTE_WINDOW_MS) throw new HttpError(403, "Only players who cast this version of the spell lately can vote on it");
  await env.DB.prepare(
    `INSERT INTO votes (player, pid, key, up, reason, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (player, pid) DO UPDATE SET up = excluded.up, reason = excluded.reason, at = excluded.at`,
  )
    .bind(player, row.id, key, up ? 1 : 0, up ? null : body.reason, Date.now())
    .run();
  const t = await tally(env.DB, row.id);
  const needed = votesNeeded(await averageDaily(env.DB));
  // Acting on the vote may call Claude: done after the answer.
  // The rewrite it may ask for is paid by the voter, who must have the allowance.
  ctx.waitUntil(afterVote(env, key, payer).catch((err) => console.error("after vote", err)));
  return { ...t, needed };
}

// What the votes on an element's live program decide, in this order: going
// back to the previous version, joining the library, a rewrite.
async function afterVote(env: Env, key: string, payer: Payer): Promise<string> {
  const db = env.DB;
  const live = await liveProgram(db, key);
  if (!live) return "no program";
  const row = live.row;
  const needed = votesNeeded(await averageDaily(db));
  const t = await tally(db, row.id);

  // A repair's parent is the program that crashed: never gone back to.
  if (row.parent && row.origin !== "repair" && row.origin !== "legacy") {
    const parent = await getProgram(db, row.parent);
    if (parent && parent.status === "retired" && votedWorse(t, await tally(db, parent.id), needed)) {
      await promote(db, parent);
      await setStatus(db, row.id, "rejected");
      await db
        .prepare("INSERT INTO rewrites (key, from_pid, to_pid, cause, at, status) VALUES (?, ?, ?, 'rollback', ?, 'done')")
        .bind(key, row.id, parent.id, Date.now())
        .run();
      return "rolled back";
    }
  }

  const library = votedUp(t, needed) ? 1 : 0;
  if (library !== row.library) await db.prepare("UPDATE programs SET library = ? WHERE id = ?").bind(library, row.id).run();

  if (!votedDown(t, needed)) return library ? "library" : "kept";
  return requestRewrite(env, row, "votes", await downReasons(db, row.id), payer);
}

// Dollars a day for rewrites, and what one is expected to cost before it is asked.
function rewriteBudget(env: Env): number {
  const v = Number(env.REWRITE_BUDGET_USD);
  return Number.isFinite(v) && v >= 0 ? v : 0.5;
}

// Measured: a Haiku program costs about $0.002, an Opus one $0.076 (half in a batch).
const REWRITE_ESTIMATE = { small: 0.003, batch: 0.04, big: 0.08 };

// Writes a live program again because of votes or the judge: at most once per
// spell every three days, within the daily rewrite budget. Small spells are
// written at once; big ones go to the Batch API, and the live version stays
// until the new one is back and through its test run.
async function requestRewrite(env: Env, row: ProgramRow, cause: "votes" | "judge", reasons: string[], payer: Payer): Promise<string> {
  const db = env.DB;
  const oracle = oracleFor(env, {}, new Ledger(payer));
  try {
    return await rewriteWith(env, oracle, row, cause, reasons);
  } finally {
    await closeLedger(db, oracle);
  }
}

async function rewriteWith(env: Env, oracle: Oracle, row: ProgramRow, cause: "votes" | "judge", reasons: string[]): Promise<string> {
  const db = env.DB;
  if (await recentRewrite(db, row.key)) return "cooldown";
  const element = await getElement(db, row.key);
  if (!element) return "unknown element";
  const tier = tierOf(element);
  const big = isBig(tier, smallUpTo(env));
  const viaBatch = big && batchEnabled(env);
  const estimate = viaBatch ? REWRITE_ESTIMATE.batch : big ? REWRITE_ESTIMATE.big : REWRITE_ESTIMATE.small;
  if ((await rewriteSpendToday(db, REWRITE_ESTIMATE.batch)) + estimate > rewriteBudget(env)) return "over the daily rewrite budget";
  let description: string;
  let batchHold: number | null = null;
  try {
    if (viaBatch) batchHold = await holdBatch(env, oracle);
    else await ensureBudget(env, oracle, "rewrite", big ? ESTIMATE.big : ESTIMATE.small);
    description = await ensureDescription(env, oracle, element, false);
  } catch (err) {
    if (batchHold !== null) await releaseHold(db, batchHold);
    if (err instanceof LedgerError) return err.code === "budget" ? "over the monthly budget" : `the voter's invite: ${err.code}`;
    throw err;
  }
  const rewrite: Rewrite = { reasons, summary: programOf(row)?.summary };
  const request: OracleSpellRequest = { name: element.name, kind: element.kind, description, recipe: await firstRecipe(db, row.key), tier, rewrite };
  if (batchHold !== null) {
    await queueBatch(env, row.key, request, row.id, cause, ledgerOf(oracle).payer.invite, batchHold);
    return "queued in a batch";
  }
  const model = big ? env.SPELL_MODEL : smallModel(env);
  if (!big) request.examples = await examplesFor(env, row.key, request);
  const at = Date.now();
  try {
    const answer = await writeWith(env, oracle, model, undefined, (w) => w.spell(request));
    const program: SpellProgram = { version: PROGRAM_VERSION, summary: answer.summary, code: answer.code };
    const id = await insertProgram(db, row.key, JSON.stringify(program), model, PROGRAM_VERSION, cause, "trial", row.id);
    await db
      .prepare("INSERT INTO rewrites (key, from_pid, to_pid, cause, at, status, model) VALUES (?, ?, ?, ?, ?, 'done', ?)")
      .bind(row.key, row.id, id, cause, at, model)
      .run();
    return "rewritten";
  } catch (err) {
    await db
      .prepare("INSERT INTO rewrites (key, from_pid, cause, at, status, model) VALUES (?, ?, ?, ?, 'failed', ?)")
      .bind(row.key, row.id, cause, at, model)
      .run();
    throw err;
  }
}

// Holds a Batch API item's cost for the payer until the cron collects it
// (minutes, sometimes hours): it is not released when the request ends.
async function holdBatch(env: Env, oracle: Oracle): Promise<number | null> {
  if (oracle.mock) return null;
  const ledger = ledgerOf(oracle);
  const id = await hold(env.DB, ledger, "batch", ESTIMATE.batch, budget(env));
  ledger.held.splice(ledger.held.indexOf(id), 1);
  return id;
}

async function releaseHold(db: D1Database, id: number | null): Promise<void> {
  if (id !== null) await db.prepare("UPDATE reservations SET settled = 1 WHERE id = ?").bind(id).run();
}

// Asks the big model for one program through the Batch API. The cron
// (every ten minutes) collects it, and the invite that asked pays for it.
async function queueBatch(
  env: Env,
  key: string,
  request: OracleSpellRequest,
  fromPid: number,
  cause: string,
  invite: string,
  reservation: number,
): Promise<void> {
  const db = env.DB;
  const r = await db
    .prepare("INSERT INTO rewrites (key, from_pid, cause, at, status, model, request, invite, reservation) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)")
    .bind(key, fromPid, cause, Date.now(), env.SPELL_MODEL, JSON.stringify(request), invite, reservation)
    .run();
  const id = Number(r.meta.last_row_id);
  try {
    const batch = await makeOracle(env, {}).submitBatch([{ id: batchItemId(cause, id), request }]);
    await db.prepare("UPDATE rewrites SET batch = ? WHERE id = ?").bind(batch, id).run();
  } catch (err) {
    await db.batch([
      db.prepare("UPDATE rewrites SET status = 'failed' WHERE id = ?").bind(id),
      db.prepare("UPDATE reservations SET settled = 1 WHERE id = ?").bind(reservation),
    ]);
    throw err;
  }
}

// "up" for a big spell's first real version, "rw" for a rewrite (oracle.ts
// counts those against the daily rewrite budget).
function batchItemId(cause: string, id: number): string {
  return `${cause === "upgrade" ? "up" : "rw"}${id}`;
}

// Collects finished batches: each program comes back as a trial, tested by
// the next browser that asks for the spell.
async function pollBatches(env: Env): Promise<{ done: number; failed: number; waiting: number }> {
  const db = env.DB;
  const pending = await db
    .prepare("SELECT id, key, from_pid, cause, batch, model, invite, reservation FROM rewrites WHERE status = 'pending' AND batch IS NOT NULL")
    .all<{ id: number; key: string; from_pid: number; cause: string; batch: string; model: string; invite: string | null; reservation: number | null }>();
  const out = { done: 0, failed: 0, waiting: 0 };
  if (!pending.results.length || !env.ANTHROPIC_API_KEY) return out;
  const oracle = makeOracle(env, {});
  for (const batch of new Set(pending.results.map((r) => r.batch))) {
    const outcomes = await oracle.batchResults(batch);
    const rows = pending.results.filter((r) => r.batch === batch);
    if (!outcomes) {
      out.waiting += rows.length;
      continue;
    }
    for (const row of rows) {
      const o = outcomes.find((x) => x.id === batchItemId(row.cause, row.id));
      // Billed once, when the item is taken: a later read of the same batch
      // finds it done. Paid by the invite that asked, and its hold released.
      // The bill and the new status go in one batch, and the bill only while the
      // row is still pending: two crons reading the same batch bill it once.
      const bill = [
        db
          .prepare(
            `INSERT INTO spend (at, call, model, usd, invite)
             SELECT ?, ?, ?, ?, ? WHERE ? > 0 AND EXISTS (SELECT 1 FROM rewrites WHERE id = ? AND status = 'pending')`,
          )
          .bind(Date.now(), o?.call ?? "batch-spell", o?.model ?? row.model, o?.usd ?? 0, row.invite, o?.usd ?? 0, row.id),
        db.prepare("UPDATE reservations SET settled = 1 WHERE id = ?").bind(row.reservation ?? 0),
        db.prepare("UPDATE rewrites SET status = ? WHERE id = ? AND status = 'pending'").bind(o?.answer ? "taken" : "failed", row.id),
      ];
      const taken = (await db.batch(bill))[2].meta.changes > 0;
      if (!o?.answer) {
        out.failed++;
        console.error("batch item failed", row.key, o?.error ?? "missing");
        continue;
      }
      if (taken) {
        const program: SpellProgram = { version: PROGRAM_VERSION, summary: o.answer.summary, code: o.answer.code };
        const origin: ProgramOrigin = row.cause === "upgrade" ? "batch" : row.cause === "judge" ? "judge" : "votes";
        // Its parent is what is live now: the draft may have been fixed, or the
        // spell rolled back, while the batch ran.
        const live = await liveProgram(db, row.key);
        const id = await insertProgram(db, row.key, JSON.stringify(program), o.model, PROGRAM_VERSION, origin, "trial", live?.row.id ?? row.from_pid);
        await db.prepare("UPDATE rewrites SET status = 'done', to_pid = ?, model = ? WHERE id = ?").bind(id, o.model, row.id).run();
        out.done++;
      }
    }
  }
  return out;
}

async function programInfo(env: Env, name: string): Promise<ProgramInfo[]> {
  const key = elementKey(name);
  const rows = await env.DB.prepare(
    `SELECT p.*, (SELECT COALESCE(SUM(up), 0) FROM votes v WHERE v.pid = p.id) AS ups, (SELECT COUNT(*) FROM votes v WHERE v.pid = p.id) AS n
     FROM programs p WHERE p.key = ? ORDER BY p.id DESC LIMIT 20`,
  )
    .bind(key)
    .all<ProgramRow & { ups: number; n: number }>();
  const parse = (v: string | null) => (v ? (JSON.parse(v) as unknown) : null);
  return rows.results.map((r) => ({
    id: r.id,
    status: r.status,
    origin: r.origin,
    model: r.model,
    version: r.version,
    created_at: r.created_at,
    up: r.ups,
    down: r.n - r.ups,
    library: r.library === 1,
    checked: parse(r.checked),
    judged: parse(r.judged),
  }));
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
    const cached = await db.prepare("SELECT description FROM elements WHERE key = ?").bind(key).first<{ description: string | null }>();
    if (cached?.description) return cached.description;
  }

  await ensureBudget(env, oracle, "describe", ESTIMATE.describe);
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
  const row = await db.prepare("SELECT a, b FROM recipes WHERE result = ? ORDER BY created_at LIMIT 1").bind(key).first<{ a: string; b: string }>();
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
    .map((word, i) => (i > 0 && MINOR_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1)));
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

// Admin tools of 3.3: the judge and its calibration, the programs it still has
// to look at, batches, and trials that store nothing (for measurements).
async function handleAdmin(request: Request, url: URL, env: Env, oracle: Oracle, ctx: ExecutionContext): Promise<Response | null> {
  const path = url.pathname.slice("/api/admin/".length);
  const post = request.method === "POST";
  if (!post && path === "programs") return json(await programsToJudge(env, Number(url.searchParams.get("limit")) || 20));
  if (post && path === "judge") return json(await handleJudge(await readBody<JudgeBody>(request), env, oracle, ctx, true));
  if (post && path === "judge-trial") return json(await handleJudge(await readBody<JudgeBody>(request), env, oracle, ctx, false));
  if (!post && path === "judge-stats") return json(await calibration(env.DB));
  if (post && path === "poll-batches") return json(await pollBatches(env));
  if (post && path === "spell-trial") return json(await spellTrial(await readBody<SpellTrialBody>(request), env, oracle));
  if (post && path === "batch-trial") return json(await batchTrial(await readBody<SpellTrialBody & { names?: string[] }>(request), env, oracle));
  if (!post && path === "batch-trial") return json(await batchTrialResults(url.searchParams.get("batch") ?? "", env));
  // 3.4: invites, people and reports.
  if (!post && path === "people") return json(await people(env));
  if (post && path === "invites") return json(await newInvite(await readBody<{ name?: unknown; cap?: unknown }>(request), env, url));
  if (post && path === "invite") return json(await changeInvite(await readBody<InviteChange>(request), env, url));
  if (post && path === "report") return json(await closeReport(await readBody<{ id?: unknown }>(request), env));
  return null;
}

interface InviteChange {
  id?: unknown;
  action?: unknown;
  usd?: unknown;
}

// The link a person opens. The secret is after the #, so it never reaches a
// server log or another site's Referer; the page stores it and removes it.
function inviteLink(url: URL, secret: string): string {
  return `${url.origin}/#invite=${secret}`;
}

async function newInvite(body: { name?: unknown; cap?: unknown }, env: Env, url: URL) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) throw new HttpError(400, "An invite needs a name");
  const cap = typeof body.cap === "number" && body.cap >= 0 && body.cap <= 50 ? body.cap : inviteCap(env);
  const { row, secret } = await createInvite(env.DB, name, cap);
  return { id: row.id, name: row.name, cap: row.cap_usd, link: inviteLink(url, secret) };
}

// pause, resume, revoke (for good), topup (dollars added for this month only)
// and relink (a new secret, when a link was lost or shared too far).
async function changeInvite(body: InviteChange, env: Env, url: URL) {
  const id = typeof body.id === "string" ? body.id : "";
  const row = await env.DB.prepare("SELECT * FROM invites WHERE id = ?").bind(id).first<InviteRow>();
  if (!row) throw new HttpError(404, "There is no such invite");
  const db = env.DB;
  switch (body.action) {
    case "pause":
    case "resume":
      if (row.status === "revoked") throw new HttpError(400, "A revoked invite stays revoked; make a new one");
      await db
        .prepare("UPDATE invites SET status = ? WHERE id = ?")
        .bind(body.action === "pause" ? "paused" : "active", id)
        .run();
      return { ok: true };
    case "revoke":
      await db.prepare("UPDATE invites SET status = 'revoked' WHERE id = ?").bind(id).run();
      return { ok: true };
    case "topup": {
      const usd = Number(body.usd);
      if (!Number.isFinite(usd) || usd <= 0 || usd > 50) throw new HttpError(400, "A top-up is between $0 and $50");
      const month = monthKey();
      const current = row.topup_month === month ? row.topup_usd : 0;
      await db
        .prepare("UPDATE invites SET topup_usd = ?, topup_month = ? WHERE id = ?")
        .bind(round(current + usd, 2), month, id)
        .run();
      return { ok: true, allowance: round(allowance({ ...row, topup_usd: current + usd, topup_month: month }), 2) };
    }
    case "relink": {
      const secret = await relink(db, id);
      if (!secret) throw new HttpError(400, "A revoked invite cannot get a new link");
      return { ok: true, link: inviteLink(url, secret) };
    }
    default:
      throw new HttpError(400, "pause, resume, revoke, topup or relink");
  }
}

// The admin's view of everyone: spend, discoveries and last visit per person,
// and what is left of the month.
async function people(env: Env): Promise<PeopleResponse> {
  const db = env.DB;
  const start = monthStart();
  const [invites, spend, found, refused, reports, totals] = await Promise.all([
    db.prepare("SELECT * FROM invites ORDER BY created_at").all<InviteRow>(),
    db
      .prepare(
        `SELECT invite, SUM(usd) AS usd FROM (
           SELECT invite, usd FROM spend WHERE at >= ?1
           UNION ALL SELECT invite, usd FROM reservations WHERE settled = 0)
         GROUP BY invite`,
      )
      .bind(start)
      .all<{ invite: string | null; usd: number }>(),
    db.prepare("SELECT invite, COUNT(*) AS n FROM elements WHERE invite IS NOT NULL GROUP BY invite").all<{ invite: string; n: number }>(),
    db.prepare("SELECT invite, COUNT(*) AS n FROM refusals WHERE at >= ? GROUP BY invite").bind(start).all<{ invite: string; n: number }>(),
    db
      .prepare(
        "SELECT r.id, r.name, r.reason, i.name AS by, r.at FROM reports r LEFT JOIN invites i ON i.id = r.invite WHERE r.status = 'open' ORDER BY r.at DESC LIMIT 50",
      )
      .all<{ id: number; name: string; reason: string | null; by: string | null; at: number }>(),
    monthTotals(db),
  ]);
  const spentOf = new Map(spend.results.map((r) => [r.invite, r.usd]));
  const count = (rows: { invite: string; n: number }[], id: string) => rows.find((r) => r.invite === id)?.n ?? 0;
  const ids = new Set(invites.results.map((r) => r.id));
  const month = monthKey();
  return {
    budget: budget(env),
    spent: round(totals.spent, 3),
    held: round(totals.held, 3),
    left: round(Math.max(0, budget(env) - totals.spent - totals.held), 3),
    people: invites.results.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      cap: r.cap_usd,
      topup: r.topup_month === month ? r.topup_usd : 0,
      spent: round(spentOf.get(r.id) ?? 0, 3),
      discoveries: count(found.results, r.id),
      refusals: count(refused.results, r.id),
      lastSeen: r.last_seen,
      createdAt: r.created_at,
    })),
    others: spend.results.filter((r) => !r.invite || !ids.has(r.invite)).map((r) => ({ who: r.invite ?? "before invites", spent: round(r.usd, 3) })),
    reports: reports.results,
  };
}

async function closeReport(body: { id?: unknown }, env: Env) {
  await env.DB.prepare("UPDATE reports SET status = 'dismissed' WHERE id = ?").bind(Number(body.id)).run();
  return { ok: true };
}

// A player reports a name (an element Claude named) as offensive or wrong.
// One open report per name and person; the admin reads them in the people view.
async function handleReport(body: { name?: unknown; reason?: unknown }, env: Env, payer: Payer) {
  const element = await resolveInput(env.DB, body.name, false);
  const key = elementKey(element.name);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) || null : null;
  const already = await env.DB.prepare("SELECT 1 AS x FROM reports WHERE key = ? AND invite IS ? AND status = 'open'").bind(key, payer.invite).first();
  if (!already) {
    await env.DB.prepare("INSERT INTO reports (key, name, invite, reason, at) VALUES (?, ?, ?, ?, ?)")
      .bind(key, element.name, payer.invite, reason, Date.now())
      .run();
  }
  return { ok: true };
}

interface JudgeBody {
  // A stored program, or for a trial the element's name.
  id?: number;
  name?: string;
  frames: string[];
  shots?: number[];
  facts?: string;
}

interface SpellTrialBody {
  name: string;
  model?: string;
  effort?: string;
  // "library" picks from the library; a list is used as given.
  examples?: "library" | LibraryExample[];
  rewrite?: Rewrite;
}

// Live programs the judge has not looked at, newest first, for scripts/judge-runner.mjs.
async function programsToJudge(env: Env, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.key, p.spec, e.name, e.tier, e.kind, e.depth FROM programs p JOIN elements e ON e.key = p.key
     WHERE p.status = 'live' AND p.judged IS NULL ORDER BY p.id DESC LIMIT ?`,
  )
    .bind(Math.min(100, Math.max(1, limit)))
    .all<ProgramRow & { name: string; tier: string | null; kind: string; depth: number }>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    tier: isTier(r.tier) ? r.tier : tierFromDepth(r.depth),
    code: programOf(r)?.code ?? "",
  }));
}

// The judge's score is on a scale of 1 to 5; it says "voted down" at or below
// the threshold. The threshold is the one that best matches the player's
// votes on programs it judged, once there are five of them; the judge may ask
// for rewrites by itself only once it agrees with ten or more votes at least
// 70% of the time. Until then it only advises (admin card, judge-stats).
const JUDGE_THRESHOLD = 2;
const JUDGE_MIN_VOTED = 5;
const JUDGE_TRUST = { n: 10, agreement: 0.7 };

interface Judged {
  score: number;
  reason: string;
  note: string;
  verdict: "up" | "down";
  threshold: number;
  model: string;
  at: number;
}

interface Calibration {
  threshold: number;
  voted: number;
  agreement: number | null;
  trusted: boolean;
  confusion: { judgeUpVotedUp: number; judgeUpVotedDown: number; judgeDownVotedUp: number; judgeDownVotedDown: number };
  // Disagreements, worded for the judge's prompt, newest first.
  notes: string[];
}

const UNCALIBRATED: Calibration = {
  threshold: JUDGE_THRESHOLD,
  voted: 0,
  agreement: null,
  trusted: false,
  confusion: { judgeUpVotedUp: 0, judgeUpVotedDown: 0, judgeDownVotedUp: 0, judgeDownVotedDown: 0 },
  notes: [],
};

async function calibration(db: D1Database): Promise<Calibration> {
  const rows = await db
    .prepare(
      `SELECT p.id, p.judged, e.name, SUM(v.up) AS up, COUNT(*) AS n, GROUP_CONCAT(v.reason) AS reasons, MAX(v.at) AS at
       FROM programs p JOIN votes v ON v.pid = p.id JOIN elements e ON e.key = p.key
       WHERE p.judged IS NOT NULL GROUP BY p.id ORDER BY at DESC LIMIT 300`,
    )
    .all<{ id: number; judged: string; name: string; up: number; n: number; reasons: string | null }>();
  const labeled = rows.results
    .map((r) => {
      const j = JSON.parse(r.judged) as Judged;
      const share = r.up / r.n;
      const vote = share >= 0.6 ? "up" : share <= 0.4 ? "down" : null;
      const reason = (r.reasons ?? "").split(",").find(isReason);
      return { name: r.name, score: j.score, note: j.note, vote, reason };
    })
    .filter((r): r is typeof r & { vote: "up" | "down" } => r.vote !== null);
  const agreementAt = (t: number) => labeled.filter((r) => (r.score <= t ? "down" : "up") === r.vote).length / (labeled.length || 1);
  let threshold = JUDGE_THRESHOLD;
  if (labeled.length >= JUDGE_MIN_VOTED) {
    for (const t of [1, 2, 3, 4]) if (agreementAt(t) > agreementAt(threshold) + 1e-9) threshold = t;
  }
  const confusion = { judgeUpVotedUp: 0, judgeUpVotedDown: 0, judgeDownVotedUp: 0, judgeDownVotedDown: 0 };
  const notes: string[] = [];
  for (const r of labeled) {
    const judge = r.score <= threshold ? "down" : "up";
    if (judge === "up") confusion[r.vote === "up" ? "judgeUpVotedUp" : "judgeUpVotedDown"]++;
    else confusion[r.vote === "up" ? "judgeDownVotedUp" : "judgeDownVotedDown"]++;
    if (judge !== r.vote && notes.length < 8) {
      const why = r.vote === "down" && r.reason ? ` because ${REASON_PROMPT[r.reason]}` : "";
      notes.push(`${r.name}: you gave ${r.score} ("${r.note}"); the player voted it ${r.vote}${why}.`);
    }
  }
  const agreement = labeled.length ? Math.round(agreementAt(threshold) * 100) / 100 : null;
  return {
    threshold,
    voted: labeled.length,
    agreement,
    trusted: labeled.length >= JUDGE_TRUST.n && (agreement ?? 0) >= JUDGE_TRUST.agreement,
    confusion,
    notes,
  };
}

// The judge looks at three Spell Lab frames of a stored program (or, for a
// trial, of any program, storing nothing). A trusted judge that sees a bad
// live program nobody voted on yet asks for its rewrite, like votes would.
async function handleJudge(body: JudgeBody, env: Env, oracle: Oracle, ctx: ExecutionContext, store: boolean) {
  const frames = Array.isArray(body.frames) ? body.frames.filter((f) => typeof f === "string" && f.length < 2_000_000).slice(0, 3) : [];
  if (frames.length < 1) throw new HttpError(400, "The judge needs frames");
  const row = store ? await getProgram(env.DB, Number(body.id)) : null;
  if (store && !row) throw new HttpError(404, "There is no such program");
  const element = row ? await getElement(env.DB, row.key) : await resolveInput(env.DB, body.name, oracle.mock);
  if (!element) throw new HttpError(404, "There is no such element");
  const description = await ensureDescription(env, oracle, element, false);
  // Before the 0005 migration (a preview version measuring on the live
  // database), there are no votes to calibrate on.
  const cal = await calibration(env.DB).catch((): Calibration => ({ ...UNCALIBRATED }));
  await ensureBudget(env, oracle, "judge", ESTIMATE.judge);
  const shots = Array.isArray(body.shots) ? body.shots.map(Number).slice(0, 3) : [1, 3, 6];
  const answer = await oracle.judge({
    name: element.name,
    kind: element.kind,
    tier: tierOf(element),
    description,
    facts: String(body.facts ?? "not measured").slice(0, 600),
    frames,
    shots,
    notes: cal.notes,
  });
  const judged: Judged = {
    ...answer,
    verdict: answer.score <= cal.threshold ? "down" : "up",
    threshold: cal.threshold,
    model: env.JUDGE_MODEL || "claude-haiku-5-5",
    at: Date.now(),
  };
  let action = "advice only";
  if (row && !oracle.mock) {
    await env.DB.prepare("UPDATE programs SET judged = ? WHERE id = ?").bind(JSON.stringify(judged), row.id).run();
    const t = await tally(env.DB, row.id);
    if (judged.verdict === "down" && cal.trusted && row.status === "live" && t.up + t.down === 0 && row.origin !== "judge") {
      const why = isReason(answer.reason) ? REASON_PROMPT[answer.reason] : "it looked weak";
      action = "asked for a rewrite";
      ctx.waitUntil(
        requestRewrite(env, row, "judge", [`a judge who watched it cast said: ${why} (${answer.note})`], ledgerOf(oracle).payer).catch((err) =>
          console.error("judge rewrite", err),
        ),
      );
    }
  }
  return { ...judged, action, calibration: { threshold: cal.threshold, voted: cal.voted, agreement: cal.agreement, trusted: cal.trusted } };
}

// Writes a program as the game would, and stores nothing: for measuring
// models, prompts and the library on a fixed set of spells.
async function spellTrial(body: SpellTrialBody, env: Env, oracle: Oracle) {
  const element = await resolveInput(env.DB, body.name, oracle.mock);
  const key = elementKey(element.name);
  const tier = tierOf(element);
  const description = await ensureDescription(env, oracle, element, false);
  await ensureBudget(env, oracle, "spell", ESTIMATE.big);
  const model = body.model && SPELL_MODELS.has(body.model) ? body.model : spellModelFor(env, tier);
  const request: OracleSpellRequest = { name: element.name, kind: element.kind, description, recipe: await firstRecipe(env.DB, key), tier };
  if (body.examples === "library") request.examples = await examplesFor(env, key, request);
  else if (Array.isArray(body.examples)) request.examples = body.examples.slice(0, 3);
  if (body.rewrite && Array.isArray(body.rewrite.reasons)) request.rewrite = body.rewrite;
  const trial = oracleFor(env, { spellModel: model, spellEffort: body.effort }, ledgerOf(oracle));
  const t0 = Date.now();
  try {
    const answer = await trial.spell(request);
    return {
      name: element.name,
      tier,
      kind: element.kind,
      model,
      ms: Date.now() - t0,
      usd: trial.spent.reduce((s, x) => s + x.usd, 0),
      program: answer,
      examples: (request.examples ?? []).map((e) => e.name),
    };
  } finally {
    await recordSpend(env.DB, trial);
  }
}

// Submits a batch of programs for these names to the big model, storing
// nothing: the measurement collects them with batchTrialResults.
async function batchTrial(body: SpellTrialBody & { names?: string[] }, env: Env, oracle: Oracle) {
  if (oracle.mock) throw new HttpError(400, "No Batch API in mock mode");
  await ensureBudget(env, oracle, "batch", ESTIMATE.batch * Math.max(1, Array.isArray(body.names) ? Math.min(40, body.names.length) : 1));
  const names = Array.isArray(body.names) ? body.names.slice(0, 40) : [];
  const items = [];
  for (const [i, n] of names.entries()) {
    const element = await resolveInput(env.DB, n, false);
    const key = elementKey(element.name);
    const description = await ensureDescription(env, oracle, element, false);
    items.push({
      id: `trial${i}`,
      request: { name: element.name, kind: element.kind, description, recipe: await firstRecipe(env.DB, key), tier: tierOf(element) },
    });
  }
  const model = body.model && SPELL_MODELS.has(body.model) ? body.model : env.SPELL_MODEL;
  const batch = await oracleFor(env, { spellModel: model, spellEffort: body.effort }, ledgerOf(oracle)).submitBatch(items);
  return { batch, names: items.map((i) => i.request.name), model };
}

async function batchTrialResults(batch: string, env: Env) {
  if (!/^[a-z0-9_]+$/i.test(batch)) throw new HttpError(400, "Which batch?");
  const oracle = oracleFor(env, {}, new Ledger(ADMIN_PAYER));
  try {
    const outcomes = await oracle.batchResults(batch);
    for (const o of outcomes ?? []) if (o.usd) oracle.spent.push({ call: o.call, model: o.model, usd: o.usd });
    return outcomes ? { ended: true, outcomes } : { ended: false };
  } finally {
    await recordSpend(env.DB, oracle);
  }
}
