import { PRIMITIVES, elementKey, pairKey } from "../shared/elements";
import { FIRST_PROGRAM_VERSION, PROGRAM_VERSION, type SpellProgram } from "../shared/spellcode";
import { TIERS, capByDepth, capTier, isTier, tierFromDepth, type Tier } from "../shared/tiers";
import { REASON_PROMPT, isBig, isReason, voteReasons, votedDown, votedUp, votedWorse, votesNeeded, VOTE_WINDOW_MS } from "../shared/votes";
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
import { changeFeedback, ideaPull, listFeedback, postFeedback, syncFeedback, voteFeedback } from "./feedback";
import type { FeedbackAction } from "../shared/feedback";
import { candidates, listChallenges, recordVerification, recordWin } from "./challenges";
import { HttpError } from "./http";
import {
  accountInfo,
  claimLink,
  deleteAccount,
  emailClaim,
  emailLink,
  emailReady,
  exportAccount,
  getProgress,
  loginOptions,
  loginVerify,
  logout,
  putProgress,
  registrationOptions,
  registrationVerify,
  revokeSession,
  sessionByToken,
  setEmail,
  type SessionRow,
} from "./accounts";
import { PROGRESS_KINDS, type ProgressPut, type StoredKind } from "../shared/account";
import { ClaudeOracle, MockOracle, OracleError, parseEffort, type Oracle, type ProgramAnswer, type SpellRequest as OracleSpellRequest } from "./oracle";
import { PROBED, parseIntents, type Intent } from "../shared/promises";
import { isForm, kindOfForm, saysGiant, type Form } from "../shared/forms";
import { AGAIN_BY_FORM_SQL, applyForms, givenEntry, mayAskAgain, requestIntents, formList, proposeForms } from "./forms";
import { designDue, evolution, liveLibrary, openGaps, recordGap, settleHelper, storeDesign, trialHelpers, withLibrary, type Library } from "./evolve";
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
  SESSION_REWRITES_PER_DAY,
  setStatus,
  tally,
  type ProgramOrigin,
  type ProgramRow,
} from "./programs";
import type { LibraryExample, Rewrite } from "./prompts";
import { joinsBoth, looksLikeRefusal } from "./prompts";
import { noDescription } from "../shared/refusal";
import { readDigest } from "../shared/chronicle";
import { cronJobs, runsOn, takeRun } from "./cron";
import { nextEvidence } from "./evidence";
import { community, setProfile } from "./community";
import { dayIn as dayInZone } from "../shared/daily";
import { RUNS_A_DAY, claim as claimDaily, due as dailyChallengeDue, freePairs, listDaily, openByPair, openByResult, type DailyRow } from "./daily";
import {
  WONDER_ESTIMATE,
  changeWonder,
  dailyDue,
  dailyMessage,
  drawWonder,
  growDiscoveries,
  livePool,
  modelFor,
  poolOf,
  settleWonder,
  takenKinds,
  trialWonders,
  unsorted,
  wonderBudget,
  wonderList,
  wonderProblem,
  wonderSpent,
  type WonderRow,
} from "./wonders";
import { AHEAD_ESTIMATE, activeWrite, aheadCap, aheadReport, claimWrite, finishWrite, getWrite, hasProgram, startWrite, type WriteJob } from "./ahead";
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
  // 3.7. Dollars a month the refresh of the legacy library may spend.
  REFRESH_BUDGET_USD?: string;
  // 3.3. Who looks at Spell Lab frames and guesses the vote (Haiku).
  JUDGE_MODEL?: string;
  // Dollars a day that votes, the judge and failed test runs may spend on rewrites.
  REWRITE_BUDGET_USD?: string;
  // "0" writes big spells with the big model at once, as in 3.2. Otherwise the
  // small model drafts them now and the big one writes them through the Batch API.
  BIG_SPELLS_BATCH?: string;
  // 3.4.1, the Feedback tab (worker/feedback.ts, docs/FEEDBACK.md): the
  // repository (owner/name), and three secrets: a GitHub token for that
  // repository only, the routine's fire URL and its bearer token.
  GITHUB_REPO?: string;
  GITHUB_TOKEN?: string;
  ROUTINE_URL?: string;
  ROUTINE_TOKEN?: string;
  // Tests point this at a stub.
  GITHUB_API_URL?: string;
  // 3.4.2. Who decides how the API grows (worker/evolve.ts); SPELL_MODEL by default.
  DESIGN_MODEL?: string;
  // "0" stops the API from growing on its own (the admin can still ask).
  EVOLVE?: string;
  // 4.0: sign in links by email, through a Resend compatible endpoint. All
  // three or nothing; without them the account page does not offer email.
  EMAIL_API_URL?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  // 4.2: every new item written at the merge (worker/ahead.ts): the queue the
  // jobs go through, and the dollars a day they may spend together.
  WRITES?: Queue<WriteJob>;
  AHEAD_DAILY_USD?: string;
  // 4.4.5 part C: dollars a month a new wonder a day may spend ($2), inside
  // BUDGET_USD; "0" in WONDERS stops the daily call (the admin can still ask).
  WONDER_BUDGET_USD?: string;
  WONDERS?: string;
  // 4.5: "0" stops the night's daily challenge (the admin can still set one).
  DAILY_CHALLENGES?: string;
  // Daily 2026-11-05: "0" stops the daily rewrite by evidence (worker/evidence.ts).
  EVIDENCE_REWRITES?: string;
  // 4.5: "1" on the staging Worker the previews run on (wrangler.jsonc, env.staging).
  STAGING?: string;
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
    const { admin, payer, session, invite, owner } = who;
    // A signed in person is the player for votes and casts, on every device.
    const player = session ? session.invite : playerId(request);
    if (url.pathname === "/api/health" && request.method === "GET") {
      if (player && env.ANTHROPIC_API_KEY && payer) ctx.waitUntil(recordActivity(env.DB, player).catch(() => undefined));
      return json(await health(env, who));
    }
    try {
      // 4.0: accounts. Sign in needs no invite; a one use link claims its account.
      if (url.pathname.startsWith("/api/account/") && request.method === "POST") {
        const path = url.pathname.slice("/api/account/".length);
        if (path === "login/options") return json(await loginOptions(env, url));
        if (path === "login/verify") return json(await loginVerify(env, url, request, await readBody(request)));
        if (path === "email-link") return json(await emailLink(env, url, await readBody(request)));
        if (path === "email-claim") return json(await emailClaim(env, request, await readBody(request)));
        if (path === "claim-link" && invite && !owner) return json(await claimLink(env, request, invite));
        if (path === "register/options" && invite) return json(await registrationOptions(env, url, invite, !!session));
        if (path === "register/verify" && invite) return json(await registrationVerify(env, url, request, invite, !!session, await readBody(request)));
      }
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...(err.detail ? { detail: err.detail } : {}) }, err.status);
      console.error(err);
      return json({ error: "Something went wrong in the Worker" }, 500);
    }
    if (!payer) return json({ error: "Magic Merger is invite only. Ask the person who told you about it for your own link.", code: "invite" }, 401);
    if (payer.invite !== "admin") ctx.waitUntil(seen(env.DB, payer.invite).catch(() => undefined));

    const ledger = new Ledger(payer);
    const oracle = oracleFor(env, {}, ledger);
    const started = Date.now();
    return withTiming(await route(payer), ledger, started);
    async function route(payer: Payer): Promise<Response> {
      try {
        if (session && invite && url.pathname.startsWith("/api/account")) {
          const r = await handleAccount(request, url, env, session, invite);
          if (r) return r;
        }
        if (session && url.pathname === "/api/progress") {
          if (request.method === "GET") {
            const asked = url.searchParams.get("kind");
            const kinds = asked ? asked.split(",").filter((k): k is StoredKind => k === "island_previous" || PROGRESS_KINDS.some((p) => p === k)) : undefined;
            return json(await getProgress(env, session.invite, kinds?.length ? kinds : undefined));
          }
          if (request.method === "PUT")
            return json(await putProgress(env, session.invite, await readBody<ProgressPut>(request, MAX_PROGRESS_BODY), session.token_hash));
        }
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
          // A job started at the merge is writing it (4.2): wait for it, never write it twice.
          if (body.regenerate !== true && !oracle.mock) {
            const waiting = await waitForWrite(env, body.name, body.ahead === true);
            if (waiting) return json(waiting, 202);
          }
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
        if (request.method === "POST" && url.pathname === "/api/library") {
          return json(await handleLibrary(await readBody<{ names?: unknown }>(request), env));
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
        // 3.7: the island's chronicle, once a session, about $0.002.
        if (request.method === "POST" && url.pathname === "/api/chronicle") {
          return json(await handleChronicle(await readBody<{ digest?: unknown }>(request), env, oracle));
        }
        // 3.7: challenges from nothing. Free: merges go through /api/merge.
        if (request.method === "GET" && url.pathname === "/api/challenges") return json(await listChallenges(env.DB, payer));
        // 4.4.5 part C: the pool of wonders new islands draw from, and what came this week.
        if (request.method === "GET" && url.pathname === "/api/wonders") return json(await livePool(env.DB));
        // 4.5: the daily challenges not found yet, and the last finds.
        if (request.method === "GET" && url.pathname === "/api/daily") return json(await listDaily(env.DB, payer.invite));
        if (request.method === "POST" && url.pathname === "/api/admin/daily" && admin) return json(await setDailyChallenge(env, true));
        // 4.5: the Community tab, and the player's own favorite spell and hide switch.
        if (request.method === "GET" && url.pathname === "/api/community") return json(await community(env.DB, payer.invite));
        if (request.method === "POST" && url.pathname === "/api/profile") return json(await setProfile(env.DB, payer.invite, await readBody(request)));
        if (request.method === "POST" && url.pathname === "/api/challenge/win") {
          return json(await recordWin(env.DB, payer, await readBody<{ id?: unknown; merges?: unknown; spell?: unknown }>(request)));
        }
        // 3.4.1: ideas and their votes, for every invite.
        if (url.pathname === "/api/feedback") {
          if (request.method === "GET") return json(await listFeedback(env, payer, admin));
          if (request.method === "POST") return json(await postFeedback(env, payer, await readBody<{ title?: unknown; body?: unknown }>(request)));
        }
        if (request.method === "POST" && url.pathname === "/api/feedback/vote") {
          return json(await voteFeedback(env, payer, await readBody<{ id?: unknown; up?: unknown }>(request)));
        }
        if (request.method === "GET" && url.pathname === "/api/spell/info" && admin) {
          return json(await programInfo(env, url.searchParams.get("name") ?? ""));
        }
        if (request.method === "GET" && url.pathname === "/api/spend" && admin) {
          return json(await spendReport(env));
        }
        if (request.method === "POST" && url.pathname === "/api/perf") {
          const kept = await recordPerf(env.DB, payer.invite, await readBody<PerfSample>(request), request.headers.get("user-agent") ?? "");
          return json({ ok: true, kept });
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
        if (err instanceof HttpError) return json({ error: err.message, ...(err.detail ? { detail: err.detail } : {}) }, err.status);
        if (err instanceof LedgerError) return json({ error: err.message, code: err.code }, err.status);
        if (err instanceof OracleError) return json({ error: err.message }, 502);
        console.error(err);
        return json({ error: "Something went wrong in the Worker" }, 500);
      } finally {
        // Every call is written down, even when the request failed after it,
        // and the money held for it is released in the same batch.
        await closeLedger(env.DB, oracle);
      }
    }
  },

  // Every ten minutes: collects the big spells the Batch API has written,
  // turns holds of requests that died into spend, and reads what became of
  // the ideas sent to Claude.
  // 4.2: the programs of new items, written at the merge (worker/ahead.ts).
  // Each message is acknowledged whatever happens: a job that failed is
  // written on first use, never retried into a second bill.
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await Promise.all(
      batch.messages.map(async (m) => {
        try {
          const body = m.body as Partial<WriteJob> | null;
          if (body?.poll) await pollAhead(env, Number(body.poll));
          else await runAhead(env, String(body?.key ?? ""));
        } catch (err) {
          console.error("ahead", m.body, err);
        }
        m.ack();
      }),
    );
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      cronJobs({
        "poll batches": () => pollBatches(env),
        sweep: () => sweep(env.DB),
        "feedback sync": () => syncFeedback(env),
        evolve: env.EVOLVE === "0" ? null : () => evolve(env, false),
        "intents backfill": () => backfillIntents(env),
        wonders: () => wonderDaily(env, env.WONDERS !== "0" ? "due" : "collect"),
        "daily challenge": env.DAILY_CHALLENGES === "0" ? null : () => setDailyChallenge(env, false),
        "rewrite by evidence": env.EVIDENCE_REWRITES === "0" ? null : () => rewriteByEvidence(env),
      }),
    );
  },
} satisfies ExportedHandler<Env>;

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
  oracle.timings = ledger.timings;
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
    design: env.DESIGN_MODEL || env.SPELL_MODEL,
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

// 4.2: how long the request and each of its Claude calls took, readable by
// the page (same origin) through PerformanceResourceTiming.serverTiming. Two
// calls of one kind (a spell and its retry) are summed.
function withTiming(res: Response, ledger: Ledger, started: number): Response {
  const by = new Map<string, number>();
  for (const t of ledger.timings) by.set(t.call, (by.get(t.call) ?? 0) + t.ms);
  const parts = [...by].map(([call, ms]) => `${call.replace(/[^a-z-]/gi, "")};dur=${ms}`);
  parts.push(`total;dur=${Date.now() - started}`);
  try {
    res.headers.set("Server-Timing", parts.join(", "));
    return res;
  } catch {
    return res;
  }
}

// Records the request's own calls and releases what it held, in one batch.
async function closeLedger(db: D1Database, oracle: Oracle): Promise<void> {
  try {
    await settle(db, ledgerOf(oracle), oracle.spent.splice(0));
  } catch (err) {
    console.error("could not record spend", err);
  }
}

// Who is asking: a signed in person (4.0, x-session), the admin token, an
// invite link, or nobody. An invite whose link was claimed is not a player
// by its link any more: the link is one use (claim-link), and the person
// plays with a session. Without an API key the game runs in mock mode and
// costs nothing, so it is open (local development).
// 4.4.6: a session comes first, and the token never hides it: a session on
// the owner's account ('admin', with the admin flag) has the admin powers on
// every device with no token, and the token next to any session adds them.
// The token alone, for scripts and the nightly Action, is the admin as
// before, with the owner's account in `invite` so that the device holding it
// can make the owner's first passkey (and nothing else: `owner` stops the
// one use link routes).
interface Who {
  admin: boolean;
  payer: Payer | null;
  session?: SessionRow;
  // The invite behind the session or the link, for the account routes.
  invite?: InviteRow;
  // The owner's account, reached by the admin token alone.
  owner?: boolean;
}

async function authenticate(request: Request, env: Env): Promise<Who | Response> {
  const token = request.headers.get("x-access-token");
  const tokenAdmin = !!(env.ADMIN_TOKEN && token && (await sameSecret(token, env.ADMIN_TOKEN)));
  const sessionToken = request.headers.get("x-session");
  if (sessionToken) {
    const found = await sessionByToken(env.DB, sessionToken);
    if (found) return { admin: tokenAdmin || !!found.invite.admin, payer: payerOf(found.invite), session: found.session, invite: found.invite };
  }
  if (tokenAdmin) {
    const owner = await env.DB.prepare("SELECT * FROM invites WHERE id = ? AND admin = 1").bind(ADMIN_PAYER.invite).first<InviteRow>();
    return { admin: true, payer: ADMIN_PAYER, ...(owner ? { invite: owner, owner: true } : {}) };
  }
  const secret = request.headers.get("x-invite");
  if (secret) {
    const row = await inviteByToken(env.DB, secret);
    if (row?.status === "revoked" || row?.deleted_at) return json({ error: "This invite link has been turned off.", code: "revoked" }, 403);
    // A claimed account's link signs in once (claim-link); it plays nothing by itself.
    if (row?.claimed_at) return { admin: false, payer: null, invite: row };
    // 4.4.6: the owner's account is never made from a link, only with the token.
    if (row?.admin) return { admin: false, payer: null };
    if (row) return { admin: false, payer: payerOf(row), invite: row };
  }
  // Mock mode is open for local development, never on the staging Worker
  // (4.5): a preview holds a copy of the live library, so only the admin
  // token (or an invite made there) gets in, with or without an API key.
  if (!env.ANTHROPIC_API_KEY && !sessionToken && !secret && env.STAGING !== "1")
    return { admin: false, payer: { ...ADMIN_PAYER, invite: "local", name: "local" } };
  return { admin: false, payer: null };
}

// The admin token, compared in constant time (4.0 review L1): both sides are
// hashed first, so neither the length nor the first differing byte shows.
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// Last visit, written at most every five minutes.
async function seen(db: D1Database, invite: string): Promise<void> {
  const now = Date.now();
  await db
    .prepare("UPDATE invites SET last_seen = ? WHERE id = ? AND COALESCE(last_seen, 0) < ?")
    .bind(now, invite, now - 300_000)
    .run();
}

async function health(env: Env, who: Who): Promise<HealthResponse> {
  const { admin, payer, session, invite } = who;
  const out: HealthResponse = { ok: true, mock: !env.ANTHROPIC_API_KEY, admin, invited: !!payer };
  if (payer && payer.invite !== "admin" && payer.invite !== "local") {
    const spent = await spentBy(env.DB, payer.invite);
    out.invite = { name: payer.name, status: payer.status, spent: round(spent, 3), cap: payer.cap ?? 0 };
  }
  if (invite)
    out.account = {
      id: invite.id,
      name: invite.name,
      signedIn: !!session,
      claimed: !!invite.claimed_at,
      emailOffered: emailReady(env),
      admin: !!invite.admin,
    };
  out.email = emailReady(env);
  if (env.STAGING === "1") out.staging = true;
  return out;
}

// 4.0: the signed in person's own account.
async function handleAccount(request: Request, url: URL, env: Env, session: SessionRow, invite: InviteRow): Promise<Response | null> {
  const path = url.pathname.slice("/api/account".length);
  if (path === "" && request.method === "GET") return json(await accountInfo(env, invite, session));
  if (path === "" && request.method === "DELETE") return json(await deleteAccount(env, invite));
  if (path === "/export" && request.method === "GET") return json(await exportAccount(env, invite));
  if (path === "/logout" && request.method === "POST") {
    await logout(env, session);
    return json({ ok: true });
  }
  if (path === "/session" && request.method === "DELETE") {
    await revokeSession(env, invite.id, await readBody(request));
    return json({ ok: true });
  }
  if (path === "/email" && request.method === "POST") return json(await setEmail(env, invite.id, await readBody(request)));
  return null;
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
// One row per invite every 20 seconds at most (4.0 review L2): the page sends
// one every 30, so a client in a loop writes no more than an honest one.
// A sample inside the window is dropped quietly, never an error.
const PERF_EVERY_MS = 20_000;
async function recordPerf(db: D1Database, invite: string, body: PerfSample, ua: string): Promise<boolean> {
  const sample = JSON.stringify(body ?? {});
  if (sample.length > 4000) throw new HttpError(413, "The sample is too big");
  const now = Date.now();
  const [insert] = await db.batch([
    db
      .prepare("INSERT INTO perf (at, ua, sample, invite) SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM perf WHERE invite = ?4 AND at > ?5)")
      .bind(now, ua.slice(0, 300), sample, invite, now - PERF_EVERY_MS),
    db.prepare("DELETE FROM perf WHERE at < ?").bind(now - 30 * 86400_000),
  ]);
  return (insert.meta.changes ?? 0) > 0;
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
  const ledger = ledgerOf(oracle);
  const invite = ledger.payer.invite;
  ledger.recorded += oracle.spent.reduce((sum, s) => sum + s.usd, 0);
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
  // 4.5: an open daily challenge is not anyone's yet, so it is no ingredient.
  if (!oracle.mock) {
    for (const input of [a, b]) {
      if (await openByResult(env.DB, elementKey(input.name))) throw new HttpError(400, `Nobody has discovered ${input.name} yet`);
    }
  }

  // The pair as written first: a recipe made with a name that is now an alias (3.7) still answers.
  const asWritten = pairKey(String(body.a), String(body.b));
  const known =
    (asWritten !== pair ? await env.DB.prepare("SELECT result FROM recipes WHERE pair = ?").bind(asWritten).first<{ result: string }>() : null) ??
    (await env.DB.prepare("SELECT result FROM recipes WHERE pair = ?").bind(pair).first<{ result: string }>());
  if (known) {
    const element = await getElement(env.DB, known.result);
    // A known item without a program, got by this merge: written now (4.2).
    if (element) return { element, firstDiscovery: false, mock: oracle.mock, writing: await writeAhead(env, oracle, element, "first") };
  }

  // 4.5: the secret pair of a daily challenge, merged ahead: free, and the
  // first to get here is its finder.
  if (!oracle.mock) {
    const daily = await openByPair(env.DB, pair, asWritten);
    if (daily) return foundDaily(env, oracle, daily, pair);
  }

  await ensureBudget(env, oracle, "merge", ESTIMATE.merge);
  let answer = await oracle.merge(a.name, b.name);
  // An answer that only joins the two names is asked once more (3.7).
  if (!oracle.mock && joinsBoth(answer.name, a.name, b.name)) {
    await ensureBudget(env, oracle, "merge", ESTIMATE.merge);
    const again = await oracle.merge(a.name, b.name, answer.name);
    if (!joinsBoth(again.name, a.name, b.name)) answer = again;
  }
  const candidate: GameElement = {
    name: cleanName(answer.name),
    emoji: cleanEmoji(answer.emoji),
    kind: answer.kind,
    form: answer.form,
    depth: Math.max(a.depth, b.depth) + 1,
    // At most two tiers above its strongest input, and one above what its depth implies (3.7).
    tier: capByDepth(capTier(answer.tier, [tierOf(a), tierOf(b)]), Math.max(a.depth, b.depth) + 1),
  };

  // Mock answers are never stored, so a real key later starts from a clean cache.
  if (oracle.mock) return { element: candidate, firstDiscovery: false, mock: true };

  const key = elementKey(candidate.name);
  const existing = await getElement(env.DB, key);
  let element: GameElement;
  let firstDiscovery = false;
  // 4.5: another pair that gives an open daily challenge finds it too.
  const daily = existing ? await openByResult(env.DB, key) : null;
  if (existing && daily) {
    const [ka, kb] = pair.split("+");
    await env.DB.prepare("INSERT OR IGNORE INTO recipes (pair, a, b, result, created_at) VALUES (?, ?, ?, ?, ?)").bind(pair, ka, kb, key, Date.now()).run();
    return foundDaily(env, oracle, daily, pair);
  }
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
      "INSERT OR IGNORE INTO elements (key, name, emoji, kind, depth, tier, created_at, invite, form) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        key,
        candidate.name,
        candidate.emoji,
        candidate.kind,
        candidate.depth,
        candidate.tier,
        Date.now(),
        ledgerOf(oracle).payer.invite,
        candidate.form ?? null,
      )
      .run();
    firstDiscovery = inserted.meta.changes > 0;
    element = (await getElement(env.DB, key)) ?? candidate;
  }

  const [ka, kb] = pair.split("+");
  await env.DB.prepare("INSERT OR IGNORE INTO recipes (pair, a, b, result, created_at) VALUES (?, ?, ?, ?, ?)").bind(pair, ka, kb, key, Date.now()).run();

  return { element, firstDiscovery, mock: false, writing: await writeAhead(env, oracle, element, firstDiscovery ? "new" : "first") };
}

// 4.5: a merge reached an open daily challenge. The first to claim it is its
// finder and its First Discovery; its recipe joins the book. Someone who
// claims it a moment too late gets the item, like any known recipe.
async function foundDaily(env: Env, oracle: Oracle, row: DailyRow, pair: string): Promise<MergeResponse> {
  const won = await claimDaily(env.DB, row, ledgerOf(oracle).payer.invite, pair);
  const [ka, kb] = row.pair.split("+");
  await env.DB.prepare("INSERT OR IGNORE INTO recipes (pair, a, b, result, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(row.pair, ka, kb, row.result, Date.now())
    .run();
  const element = await getElement(env.DB, row.result);
  if (!element) throw new HttpError(500, "The daily challenge lost its item");
  return { element, firstDiscovery: won, mock: false, ...(won ? { daily: { day: row.day } } : {}), writing: await writeAhead(env, oracle, element, "first") };
}

// 4.5: the night's challenge. Two pool items nobody has merged, their merge
// made now (about $0.003 with its description, paid by the admin), the
// result kept only if it is truly new; its program is written ahead like
// any new item. The pair stays out of the recipe book until it is found. A
// merge that lands on an item that exists is kept as an ordinary recipe, and
// the next pair is tried, three at most a night.
async function setDailyChallenge(env: Env, force: boolean): Promise<{ day: string | null; set: string | null; tried: string[] }> {
  const db = env.DB;
  const out = { day: null as string | null, set: null as string | null, tried: [] as string[] };
  if (!env.ANTHROPIC_API_KEY) return out;
  const now = Date.now();
  const day = force ? `${dayInZone(now)}${await forcedSuffix(db, dayInZone(now))}` : await dailyChallengeDue(db, now);
  if (!day) return out;
  out.day = day;
  // Counted before any call, so a run that finds nothing new (or throws) uses
  // one of the day's runs. The count is the increment's own answer, so two
  // runs that overlap cannot both pass the last slot.
  if (!force && !(await takeRun(db, "daily", day, RUNS_A_DAY, now))) return { ...out, day: null };
  const ledger = new Ledger(ADMIN_PAYER);
  ledger.burstFree = true;
  const oracle = oracleFor(env, {}, ledger);
  try {
    for (const [pa, pb] of await freePairs(db)) {
      const a = await getElement(db, pa.key);
      const b = await getElement(db, pb.key);
      if (!a || !b) continue;
      const pair = pairKey(a.name, b.name);
      out.tried.push(`${a.name} + ${b.name}`);
      await ensureBudget(env, oracle, "merge", ESTIMATE.merge);
      let answer = await oracle.merge(a.name, b.name);
      if (joinsBoth(answer.name, a.name, b.name)) {
        await ensureBudget(env, oracle, "merge", ESTIMATE.merge);
        const again = await oracle.merge(a.name, b.name, answer.name);
        if (!joinsBoth(again.name, a.name, b.name)) answer = again;
      }
      const depth = Math.max(a.depth, b.depth) + 1;
      const name = cleanName(answer.name);
      const key = elementKey(name);
      const [ka, kb] = pair.split("+");
      // Not new (an item, an alias of one, or one of its parents): an ordinary recipe now.
      if ((await getElement(db, key)) || key === ka || key === kb) {
        await db.prepare("INSERT OR IGNORE INTO recipes (pair, a, b, result, created_at) VALUES (?, ?, ?, ?, ?)").bind(pair, ka, kb, key, now).run();
        continue;
      }
      const element: GameElement = {
        name,
        emoji: cleanEmoji(answer.emoji),
        kind: answer.kind,
        form: answer.form,
        depth,
        tier: capByDepth(capTier(answer.tier, [tierOf(a), tierOf(b)]), depth),
      };
      await ensureBudget(env, oracle, "describe", ESTIMATE.describe);
      const description = await oracle.describe(element.name, element.kind, "secret", element.form);
      // A refusal is no description of a challenge (4.5.1): the next pair is tried.
      if (looksLikeRefusal(description, element.name)) continue;
      const usd = oracle.spent.reduce((sum, s) => sum + s.usd, 0);
      const results = await db.batch([
        db
          .prepare(
            "INSERT OR IGNORE INTO elements (key, name, emoji, kind, depth, tier, description, created_at, invite, form) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
          )
          .bind(key, element.name, element.emoji, element.kind, element.depth, element.tier, description, now, element.form ?? null),
        db
          .prepare(
            "INSERT OR IGNORE INTO daily_challenges (day, pair, result, created_at, usd) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM recipes WHERE pair = ?)",
          )
          .bind(day, pair, key, now, usd, pair),
      ]);
      if (results[1].meta.changes === 0) {
        // Someone merged the pair meanwhile, or the day was set by another run.
        if (results[0].meta.changes > 0) await db.prepare("DELETE FROM elements WHERE key = ? AND invite IS NULL").bind(key).run();
        continue;
      }
      out.set = `${element.emoji} ${element.name} (${element.tier})`;
      await writeAhead(env, oracle, element, "new");
      console.log(JSON.stringify({ daily: day, item: element.name, tier: element.tier, usd }));
      break;
    }
  } finally {
    await closeLedger(db, oracle);
  }
  return out;
}

// The admin's "set one now" on a day that has one: a second row for the day.
async function forcedSuffix(db: D1Database, day: string): Promise<string> {
  const n = await db.prepare("SELECT COUNT(*) AS n FROM daily_challenges WHERE day = ? OR day LIKE ?").bind(day, `${day} #%`).first<{ n: number }>();
  return n?.n ? ` #${n.n + 1}` : "";
}

// 4.2: the program of what a merge gave is written now, in the background,
// unless it has one or is being written; paid by the player who merged.
// A failure here never fails the merge: the item is written on first use.
async function writeAhead(env: Env, oracle: Oracle, element: GameElement, cause: "new" | "first"): Promise<boolean> {
  if (oracle.mock || PRIMITIVES.some((p) => p.name === element.name)) return false;
  try {
    return await startWrite(env.DB, env.WRITES, elementKey(element.name), ledgerOf(oracle).payer.invite, cause);
  } catch (err) {
    console.error("write ahead", element.name, err);
    return false;
  }
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
  // A session's rewrite runs without the owner's prompt: its turn is taken before any call,
  // so a spell that fails to write still counts (review of #58);
  // the name is checked first, which costs nothing, so a typo takes no turn. The owner's card is not counted.
  if (regenerate && body.session === true && !(await takeRun(env.DB, "session-rewrite", dayInZone(Date.now()), SESSION_REWRITES_PER_DAY)))
    throw new HttpError(429, `${SESSION_REWRITES_PER_DAY} spell rewrites were asked by sessions today; a session may not ask another`, { capped: true });
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

  // Big spells: drafted now by the small model, written later by the big one
  // through the Batch API at half price. The admin's button still asks the
  // big model at once, and says so.
  const batch = !oracle.mock && !regenerate && !(admin && body.model) && isBig(tier, smallUpTo(env)) && batchEnabled(env);
  const model = body.model && admin ? body.model : batch ? smallModel(env) : spellModelFor(env, tier);
  const origin: ProgramOrigin = regenerate ? "admin" : batch ? "draft" : "new";
  const written = await writeProgram(env, oracle, element, { model, effort: body.effort, origin, liveId: live?.row.id ?? null });
  if (oracle.mock || !written.id) return { name: element.name, tier, program: { ...written.program, model }, mock: oracle.mock };
  // The Opus version through the Batch API is held once the draft exists: a
  // player near their allowance keeps the draft and skips the upgrade.
  const batchHold = batch ? await holdBatch(env, oracle).catch(() => null) : null;
  if (batchHold !== null)
    ctx.waitUntil(
      queueBatch(env, key, written.request, written.id, "upgrade", ledgerOf(oracle).payer.invite, batchHold).catch((err) => console.error("batch", err)),
    );
  return { name: element.name, tier, program: { ...written.program, model, id: written.id, trial: true }, mock: false };
}

// Writes a new program for an element and stores it as a trial: the grimoire
// entry first (the spell is written from it), then, side by side, what it
// promises, the API's library, its first recipe and the library examples
// (4.2: these waited on each other before), then the program. Shared by a
// player's first use (handleSpell) and the job started at the merge (ahead.ts).
export async function writeProgram(
  env: Env,
  oracle: Oracle,
  element: GameElement,
  o: { model: string; effort?: string; origin: ProgramOrigin; liveId: number | null },
): Promise<{ program: SpellProgram; id: number | null; request: OracleSpellRequest }> {
  const key = elementKey(element.name);
  await ensureBudget(env, oracle, "spell", spellEstimate(env, o.model));
  const library = oracle.mock ? NO_LIBRARY : await liveLibrary(env.DB);
  const request = await buildRequest(env, oracle, element, o.model, library);
  const intents = request.intents ?? [];
  const answer = await writeWith(env, oracle, o.model, o.effort, (w) => w.spell(request));
  const program = programFrom(answer, intents, library, request);
  if (oracle.mock) return { program, id: null, request };
  const id = await insertProgram(env.DB, key, JSON.stringify(program), o.model, PROGRAM_VERSION, o.origin, "trial", o.liveId);
  await recordGap(env.DB, key, id, answer.missing);
  return { program, id, request };
}

// What a program is written from: the grimoire entry first, then side by
// side (4.2: these waited on each other before) what it promises, the API's
// library, its first recipe and the library examples the small model sees.
async function buildRequest(env: Env, oracle: Oracle, element: GameElement, model: string, library?: Library): Promise<OracleSpellRequest> {
  const key = elementKey(element.name);
  const tier = tierOf(element);
  const description = await ensureDescription(env, oracle, element, false);
  const small = !oracle.mock && model === smallModel(env);
  const [intents, lib, recipe, entries] = await Promise.all([
    ensureIntents(env, oracle, element, description),
    library ?? (oracle.mock ? NO_LIBRARY : liveLibrary(env.DB)),
    firstRecipe(env.DB, key),
    small ? libraryEntries(env.DB) : Promise.resolve([]),
  ]);
  const request: OracleSpellRequest = {
    name: element.name,
    kind: element.kind,
    ...shapeOf(element, description),
    description,
    recipe,
    tier,
    intents,
    library: lib.docs,
  };
  if (small) request.examples = pickExamples(entries, { key, name: request.name, description, kind: request.kind, tier });
  return request;
}

// 4.2: one job of the WRITES queue (worker/ahead.ts): the program of an item
// a merge just made, or reached without a program, written by the model its
// tier calls for and paid by the player whose merge started it, within the
// day's cap for these writes. Big items are written by the big model at
// once, with no draft: nobody is waiting on this request, and players never
// see a weaker version first.
async function runAhead(env: Env, key: string): Promise<void> {
  const db = env.DB;
  const row = await getWrite(db, key);
  if (!row || row.status !== "queued" || !env.ANTHROPIC_API_KEY) return;
  if (await hasProgram(db, key)) {
    await finishWrite(db, key, "done");
    return;
  }
  const element = await getElement(db, key);
  if (!element) {
    await finishWrite(db, key, "failed", { error: "no such element" });
    return;
  }
  const tier = tierOf(element);
  const model = spellModelFor(env, tier);
  const est = isBig(tier, smallUpTo(env)) ? AHEAD_ESTIMATE.big : AHEAD_ESTIMATE.small;
  if ((await claimWrite(db, key, est, aheadCap(env.AHEAD_DAILY_USD), { start: monthStart(Date.now()), budget: budget(env) })) !== "go") return;
  const invite = row.invite === ADMIN_PAYER.invite ? null : await db.prepare("SELECT * FROM invites WHERE id = ?").bind(row.invite).first<InviteRow>();
  if (row.invite !== ADMIN_PAYER.invite && (!invite || invite.status === "revoked")) {
    await finishWrite(db, key, "unpaid", { error: "no active invite" });
    return;
  }
  const ledger = new Ledger(invite ? payerOf(invite) : ADMIN_PAYER);
  ledger.burstFree = true;
  const oracle = oracleFor(env, {}, ledger);
  const t0 = Date.now();
  // Big items: the big model through the Batch API, at half price, as their
  // upgrade always was; no draft first. The queue polls the batch every 30 s
  // (the cron every ten minutes is the fallback), and the row stays "writing"
  // until the program comes back as a trial.
  if (isBig(tier, smallUpTo(env)) && batchEnabled(env)) {
    try {
      const request = await buildRequest(env, oracle, element, model);
      const reservation = await holdBatch(env, oracle);
      if (reservation === null) throw new Error("no hold");
      await queueBatch(env, key, request, null, "ahead", ledger.payer.invite, reservation);
      await db.prepare("UPDATE writes SET model = ? WHERE key = ?").bind(model, key).run();
      await env.WRITES?.send({ poll: 1 }, { delaySeconds: BATCH_POLL_S });
      console.log(JSON.stringify({ ahead: key, model, batch: true, ms: Date.now() - t0 }));
    } catch (err) {
      const usd = ledger.recorded + oracle.spent.reduce((sum, s) => sum + s.usd, 0);
      await finishWrite(db, key, err instanceof LedgerError ? "unpaid" : "failed", { usd, model, error: err instanceof Error ? err.message : String(err) });
    } finally {
      await closeLedger(db, oracle);
    }
    return;
  }
  try {
    // The same in-flight key as a player's own request: whoever comes second
    // finds the program the first one stored.
    const written = await once(db, `spell:${key}`, async () =>
      (await hasProgram(db, key)) ? null : writeProgram(env, oracle, element, { model, origin: "new", liveId: null }),
    );
    const usd = ledger.recorded + oracle.spent.reduce((sum, s) => sum + s.usd, 0);
    await finishWrite(db, key, "done", { usd, pid: written?.id ?? null, model });
    console.log(JSON.stringify({ ahead: key, model, usd, ms: Date.now() - t0, written: !!written }));
  } catch (err) {
    const usd = ledger.recorded + oracle.spent.reduce((sum, s) => sum + s.usd, 0);
    await finishWrite(db, key, err instanceof LedgerError ? "unpaid" : "failed", { usd, model, error: err instanceof Error ? err.message : String(err) });
  } finally {
    await closeLedger(db, oracle);
  }
}

// The batches of big items written ahead, collected as soon as they end:
// every 30 s while any is waiting, for an hour at most (the ten minute cron
// goes on after that). Collecting twice bills once (pollBatches).
const BATCH_POLL_S = 30;
async function pollAhead(env: Env, round: number): Promise<void> {
  const { waiting } = await pollBatches(env);
  if (waiting > 0 && round < 120) await env.WRITES?.send({ poll: round + 1 }, { delaySeconds: BATCH_POLL_S });
}

// A player asks for a program a job is writing (4.2): the answer waits for
// it, up to 20 s, and then says "still being written" to a page that knows
// what that means; an older page (no `ahead`) waits longer, then gets an
// error to try again. Null when no job is writing it, or once it is stored:
// the usual path then serves it, free.
async function waitForWrite(env: Env, name: unknown, ahead: boolean): Promise<SpellResponse | null> {
  const db = env.DB;
  const element = await resolveInput(db, name, false).catch(() => null);
  if (!element) return null;
  const key = elementKey(element.name);
  // No writes table (a deploy whose migration has not run): nothing is
  // written ahead, so there is nothing to wait for.
  const first = await activeWrite(db, key).catch(() => null);
  if (!first) return null;
  // A big item's batch takes minutes: the page is told at once and asks
  // again in 15 s; a small one is written in seconds, so the answer waits.
  const big = first.est >= AHEAD_ESTIMATE.big;
  const until = Date.now() + (!ahead ? 55_000 : big ? 0 : 20_000);
  for (let pause = 300; ; pause = Math.min(1000, pause * 1.4)) {
    if (!(await activeWrite(db, key)) || (await hasProgram(db, key))) return null;
    if (Date.now() >= until) break;
    await new Promise((r) => setTimeout(r, pause));
  }
  if (!ahead) throw new HttpError(503, `${element.name} is still being written; try again in a moment`);
  const program = { version: PROGRAM_VERSION, summary: "", code: "" };
  return { name: element.name, tier: tierOf(element), program, mock: false, writing: true, retry: big ? 15_000 : 3000 };
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
  const tier = tierOf(element);
  // A fix or a rewrite is already waiting for its test run (two browsers saw
  // the same crash): that one is served, not mended again, and before the
  // limit below, since it costs nothing (4.1: the third repair's trial was
  // refused to a second browser, which then stopped asking for the session).
  const waiting = live ? await newerTrial(env.DB, key, live.row.id) : null;
  const pending = waiting ? programOf(waiting) : null;
  if (pending) return { name: element.name, tier, program: pending, mock: false };
  if (live && live.repairs >= MAX_REPAIRS && !admin)
    throw new HttpError(429, `${element.name} has been mended too often; ask the admin for a new spell`, { mended: true });
  const stored = live ? programOf(live.row) : null;
  await ensureBudget(env, oracle, "repair", ESTIMATE.small);
  // Repairs always go to the small model: fixing one error in a program that
  // exists is not where Opus earns its price.
  const model = env.REPAIR_MODEL || "claude-haiku-5-5";
  const answer = await writeWith(env, oracle, model, undefined, (w) => w.repair(element.name, tier, stored?.code ?? "", error));
  const library = oracle.mock ? NO_LIBRARY : await liveLibrary(env.DB);
  const program = programFrom({ ...answer, summary: answer.summary || stored?.summary || "" }, parseIntents(stored?.intents), library, {
    form: isForm(stored?.form) ? stored.form : undefined,
    giant: stored?.giant === true,
  });
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

// Who writes a program again after its test run or its promise failed
// (4.2, the owner's call): the model its tier calls for, so a legendary or
// cosmic item's Opus program is never replaced by a Haiku one. Opus directly,
// not in a batch: the player's browser is waiting for the program to test.
function rewriterFor(env: Env, tier: Tier): string {
  return isBig(tier, smallUpTo(env)) ? spellModelFor(env, tier) : smallModel(env);
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

// Did a stored test run face the promise probe? It records how much harm was prevented.
function promiseTested(checked: string | null): boolean {
  if (!checked) return false;
  try {
    const v = JSON.parse(checked) as { stats?: { saved?: unknown }; recheck?: boolean };
    return typeof v.stats?.saved === "number" || v.recheck === true;
  } catch {
    return false;
  }
}

// Did it face the five minute test of an artifact (3.7)? It records what it changed.
function actsTested(checked: string | null): boolean {
  if (!checked) return false;
  try {
    return typeof (JSON.parse(checked) as { stats?: { acted?: unknown } }).stats?.acted === "number";
  } catch {
    return false;
  }
}

// Everything the test run asks of this element today, faced by this run?
function faced(checked: string | null, kind: string | null | undefined, intents: Intent[]): boolean {
  const promise = !intents.some((i) => PROBED.includes(i)) || promiseTested(checked);
  return promise && (kind !== "artifact" || actsTested(checked));
}

// A verdict as stored, whole JSON within 2000 characters. Its `stats` come
// from the browser unbounded, and the cut string it was stored as before was
// not JSON, which a query reading it with json_extract throws on (the review
// of #45). The other fields are bounded (detail at 400). Real verdicts are
// far shorter (671 characters at most on production): only a hand made body
// is trimmed, its stats down to `saved` and `acted` (what promiseTested and
// actsTested read).
function storedVerdict(verdict: { stats?: unknown } & Record<string, unknown>): string {
  const text = JSON.stringify(verdict);
  if (text.length <= 2000) return text;
  const all = verdict.stats && typeof verdict.stats === "object" ? (verdict.stats as Record<string, unknown>) : {};
  const kept: Record<string, number> = {};
  for (const k of ["saved", "acted"]) if (typeof all[k] === "number") kept[k] = all[k];
  return JSON.stringify({ ...verdict, stats: { ...kept, cut: 1 } });
}

const PROBLEMS = ["crash", "nothing", "wiped", "promise", "idle", "size", "kind", "look", "fit"] as const;
const problemOf = (v: unknown): (typeof PROBLEMS)[number] | null => ((PROBLEMS as readonly unknown[]).includes(v) ? (v as (typeof PROBLEMS)[number]) : null);

// A live program tested again by a browser against the promise its element
// now has (3.6). Pass: the result is recorded and nothing else happens. Fail:
// it is written once more (rewriterFor: Opus for a big item since 4.2, Haiku
// otherwise) with what the probe found, as a
// trial whose parent is the live program, which stays until the new one
// passes its own test run. Never twice for the same program.
async function handleRecheck(body: CheckRequest, env: Env, oracle: Oracle, element: GameElement, row: ProgramRow): Promise<SpellResponse> {
  const key = elementKey(element.name);
  const tier = tierOf(element);
  const live = await liveProgram(env.DB, key);
  const servedLive = (): SpellResponse => ({ name: element.name, tier, program: programOf(live!.row)!, mock: false });
  const intentsNow = parseIntents((await env.DB.prepare("SELECT intents FROM elements WHERE key = ?").bind(key).first<{ intents: string | null }>())?.intents);
  if (!live || live.row.id !== row.id || faced(row.checked, element.kind, intentsNow)) return servedLive();
  const detail = String(body.detail ?? "").slice(0, 400);
  const problem = problemOf(body.problem);
  const verdict = { ok: body.ok === true, problem, detail, stats: body.stats ?? {}, at: Date.now(), recheck: true };
  // Past the day's rewrite budget (4.5.1), a broken promise is not recorded
  // yet: recorded, it would count as faced and never be written again.
  if (!verdict.ok && problem === "promise" && (await overRewriteBudget(env, tier))) return servedLive();
  await env.DB.prepare("UPDATE programs SET checked = ? WHERE id = ?").bind(storedVerdict(verdict), row.id).run();
  // Only a broken promise asks for a rewrite here; anything else is the old
  // test's business. An old artifact that does nothing in its five minute
  // test (3.7) is recorded and not written again: the refresh of the legacy
  // library (3.7 part E) writes every stored program again, so a rewrite here
  // would pay twice for the same artifact.
  if (verdict.ok || problem !== "promise") return servedLive();
  const pending = await newerTrial(env.DB, key, row.id);
  if (pending) return { name: element.name, tier, program: programOf(pending)!, mock: false };
  let description: string;
  try {
    await ensureBudget(env, oracle, "rewrite", spellEstimate(env, rewriterFor(env, tier)));
    description = await ensureDescription(env, oracle, element, false);
  } catch {
    return servedLive();
  }
  const tested = programOf(row);
  const intents = parseIntents((await env.DB.prepare("SELECT intents FROM elements WHERE key = ?").bind(key).first<{ intents: string | null }>())?.intents);
  const library = await liveLibrary(env.DB);
  const request: OracleSpellRequest = {
    name: element.name,
    kind: element.kind,
    ...shapeOf(element, description),
    description,
    recipe: await firstRecipe(env.DB, key),
    tier,
    intents,
    library: library.docs,
    rewrite: { reasons: [`it was written before its promise was tested, and its test found: ${detail}`], summary: tested?.summary, code: tested?.code },
  };
  let answer;
  try {
    answer = await writeWith(env, oracle, rewriterFor(env, tier), undefined, (w) => w.spell(request));
  } catch (err) {
    console.error("recheck rewrite", err);
    return servedLive();
  }
  const program = programFrom(answer, intents, library, request);
  // A trial like any rewrite: if it fails its own test run it is written once more, and the live program stays.
  const id = await insertProgram(env.DB, key, JSON.stringify(program), rewriterFor(env, tier), PROGRAM_VERSION, "promise", "trial", row.id);
  await recordGap(env.DB, key, id, answer.missing);
  await env.DB.prepare("INSERT INTO rewrites (key, from_pid, to_pid, cause, at, status, model) VALUES (?, ?, ?, 'promise', ?, 'done', ?)")
    .bind(key, row.id, id, Date.now(), rewriterFor(env, tier))
    .run();
  return { name: element.name, tier, program: { ...program, model: rewriterFor(env, tier), id, trial: true }, mock: false };
}

// The test run of a trial, done in the browser (src/sim/check.ts): pass, and
// it becomes the live program; fail, and it is written once more with what the
// test found, with the failing code in front of it, by Haiku, or by Opus for
// a legendary or cosmic item (4.2, rewriterFor). A
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
  if (body.recheck === true && row.status === "live") return handleRecheck(body, env, oracle, element, row);
  // Someone else's browser got there first.
  if (row.status !== "trial") return served();
  const detail = String(body.detail ?? "").slice(0, 400);
  // 4.5.1 (audit, C.R42-5): a failure that names no problem is a crash, as
  // the page reads it (src/checkresult.ts), never a pass. A failure is
  // promoted only by the 3.3 rule below (a rewrite that failed again, or a
  // budget spent for the month, with no live program to fall back on).
  const ok = body.ok === true;
  const problem = ok ? null : (problemOf(body.problem) ?? "crash");
  const verdict = { ok, problem, detail, stats: body.stats ?? {}, at: Date.now() };
  await env.DB.prepare("UPDATE programs SET checked = ? WHERE id = ?").bind(storedVerdict(verdict), row.id).run();
  if (verdict.ok) {
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
  // Past the day's rewrite budget (4.5.1): a failed trial is not promoted.
  // It stays a trial, the live program (if any) stays, and the next browser's
  // failing verdict asks for the rewrite once the budget allows.
  if (await overRewriteBudget(env, tier)) {
    if (others) await setStatus(env.DB, row.id, "rejected");
    return served();
  }
  let description: string;
  try {
    await ensureBudget(env, oracle, "rewrite", spellEstimate(env, rewriterFor(env, tier)));
    description = await ensureDescription(env, oracle, element, false);
  } catch (err) {
    // The month's budget spent for everyone: the program is kept as it is
    // rather than refused (3.3). Anything else (this player's allowance, a
    // pause, the burst guard, a failed description) says nothing about the
    // program (4.5.1, N5): it waits as a trial for the next browser.
    if (err instanceof LedgerError && err.code === "budget") return keep();
    if (others) await setStatus(env.DB, row.id, "rejected");
    return served();
  }
  const tested = programOf(row);
  const intents = parseIntents(tested?.intents);
  const library = await liveLibrary(env.DB);
  const request: OracleSpellRequest = {
    name: element.name,
    kind: element.kind,
    ...shapeOf(element, description),
    description,
    recipe: await firstRecipe(env.DB, key),
    tier,
    intents,
    library: library.docs,
    rewrite: { reasons: [`its test run found: ${detail}`], summary: tested?.summary, code: tested?.code },
  };
  let answer;
  try {
    answer = await writeWith(env, oracle, rewriterFor(env, tier), undefined, (w) => w.spell(request));
  } catch (err) {
    console.error("check rewrite", err);
    return keep();
  }
  await setStatus(env.DB, row.id, "rejected");
  const program = programFrom(answer, intents, library, request);
  const id = await insertProgram(env.DB, key, JSON.stringify(program), rewriterFor(env, tier), PROGRAM_VERSION, "check", "trial", row.parent);
  await recordGap(env.DB, key, id, answer.missing);
  await env.DB.prepare("INSERT INTO rewrites (key, from_pid, to_pid, cause, at, status, model) VALUES (?, ?, ?, 'check', ?, 'done', ?)")
    .bind(key, row.id, id, Date.now(), rewriterFor(env, tier))
    .run();
  return { name: element.name, tier, program: { ...program, model: rewriterFor(env, tier), id, trial: true }, mock: false };
}

// The chronicle (3.7): Haiku tells the island's story from what its World
// recorded (src/sim/chronicle.ts). The page asks once a session; here, at
// most one every 20 minutes per person, held and paid like any call.
async function handleChronicle(body: { digest?: unknown }, env: Env, oracle: Oracle): Promise<{ text: string; mock: boolean }> {
  const digest = readDigest(body.digest);
  if (!digest) throw new HttpError(400, "There is nothing to tell yet");
  if (!oracle.mock) {
    const payer = ledgerOf(oracle).payer;
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM spend WHERE call = 'chronicle' AND invite = ? AND at > ?")
      .bind(payer.invite, Date.now() - 20 * 60_000)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) > 0) throw new HttpError(429, "The chronicle was written a moment ago: come back later for the next chapter");
    await ensureBudget(env, oracle, "chronicle", ESTIMATE.chronicle);
  }
  return { text: await oracle.chronicle(digest), mock: oracle.mock };
}

// Spells from the shared library by name (3.7), for creatures and artifacts
// that cast them: the stored live program of each, never written on demand,
// so it costs nothing. Spells only: a creature does not cast a Golem.
async function handleLibrary(
  body: { names?: unknown },
  env: Env,
): Promise<{ spells: { key: string; name: string; tier: Tier; code: string; intents: Intent[] }[] }> {
  const names = Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string" && n.length <= MAX_NAME_LENGTH).slice(0, 20) : [];
  const keys = [...new Set(names.map(elementKey))];
  if (!keys.length) return { spells: [] };
  const rows = await env.DB.prepare(
    `SELECT s.key, s.spec, e.name, e.tier, e.depth, e.intents FROM spells s JOIN elements e ON e.key = s.key
     WHERE s.key IN (${keys.map(() => "?").join(", ")}) AND s.version >= ? AND e.kind = 'spell'`,
  )
    .bind(...keys, FIRST_PROGRAM_VERSION)
    .all<{ key: string; spec: string; name: string; tier: string | null; depth: number; intents: string | null }>();
  const spells: { key: string; name: string; tier: Tier; code: string; intents: Intent[] }[] = [];
  for (const r of rows.results) {
    let code: unknown;
    try {
      code = (JSON.parse(r.spec) as { code?: unknown }).code;
    } catch {
      continue;
    }
    if (typeof code === "string")
      spells.push({ key: r.key, name: r.name, tier: isTier(r.tier) ? r.tier : tierFromDepth(r.depth), code, intents: parseIntents(r.intents) });
  }
  return { spells };
}

// --- 3.7 part E: refresh the legacy library. ---
//
// The one planned exception to "never rewrite in bulk". Every stored program
// is written again with today's prompt and engine, from the element's own
// name, entry, recipe, tier and intents, through the Batch API at half price:
// legendary and cosmic by SPELL_MODEL, the rest by the small model. A new
// program comes back as a candidate nobody is served; scripts/refresh-runner.ts
// tests it (the test run, its promise probe and the five minute test of an
// artifact), has the judge score it against the old one on the same frames,
// and replaces the old one only if it passed and scored no lower (and its
// creatures look no less alive). Players' votes then roll a replaced one back
// if they like it less, as with any rewrite. Old versions are kept.
// Capped at REFRESH_BUDGET_USD ($8) a month, estimates held before submitting.

function refreshBudget(env: Env): number {
  const v = Number(env.REFRESH_BUDGET_USD);
  return Number.isFinite(v) && v >= 0 ? v : 8;
}

async function refreshSpentThisMonth(db: D1Database): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const r = await db
    .prepare("SELECT COALESCE(SUM(estimate), 0) AS usd FROM rewrites WHERE cause = 'refresh' AND at >= ? AND status != 'failed'")
    .bind(start.getTime())
    .first<{ usd: number }>();
  return r?.usd ?? 0;
}

const REFRESH_ESTIMATE = { big: 0.06, small: 0.006 };

async function startRefresh(
  env: Env,
  oracle: Oracle,
  body: { keys?: unknown; limit?: unknown; dry?: unknown; forms?: unknown; why?: unknown; entries?: unknown },
) {
  if (oracle.mock) throw new HttpError(400, "The refresh needs the Claude API");
  const db = env.DB;
  const asked = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string").map(elementKey) : null;
  // 4.6, rewrites by form: a capped batch, at most 20 at a time (ROADMAP 4.6 item 5: never all at once).
  const byForm = body.forms === true;
  const limit = Math.max(1, Math.min(byForm ? 20 : 200, Number(body.limit) || (byForm ? 5 : 20)));
  // Every element with a live program, never refreshed, the ones players hold most first.
  // By form: every element whose sorted kind the owner approved, not refreshed
  // since; the keys asked first, in their order.
  const rows = byForm
    ? await db
        .prepare(
          `SELECT s.key, s.pid FROM spells s JOIN elements e ON e.key = s.key JOIN forms f ON f.key = s.key
           WHERE s.pid IS NOT NULL AND f.status = 'applied' AND e.form IS NOT NULL AND e.form != 'spell'
             AND NOT EXISTS (SELECT 1 FROM rewrites r WHERE r.key = s.key AND r.cause = 'refresh' AND r.at >= f.applied_at AND r.status NOT IN ('failed', 'superseded'))
           ORDER BY (SELECT COUNT(*) FROM casts c JOIN programs p ON p.id = c.pid WHERE p.key = s.key) DESC, s.key`,
        )
        .all<{ key: string; pid: number }>()
    : await db
        .prepare(
          `SELECT s.key, s.pid FROM spells s JOIN elements e ON e.key = s.key
       WHERE s.pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rewrites r WHERE r.key = s.key AND r.cause = 'refresh' AND r.status NOT IN ('failed', 'superseded'))
       ORDER BY (SELECT COUNT(*) FROM casts c JOIN programs p ON p.id = c.pid WHERE p.key = s.key) DESC, s.key`,
        )
        .all<{ key: string; pid: number }>();
  // By form, a key asked by name may be written for its kind once more
  // (AGAIN_BY_FORM_SQL): when its first rewrite was kept out, the writer is
  // told why (7 November: 9 of 14 people written as beasts before the API
  // named w.person); `why` adds the asker's own reason, a line per key (the
  // owner: a Serpent raised a shield). Only by name, never in the daily run.
  const again = new Map<string, string[]>();
  const why = (k: string): string | null => {
    const w = body.why && typeof body.why === "object" ? (body.why as Record<string, unknown>)[k] : undefined;
    return typeof w === "string" && w.trim() ? w.trim().slice(0, 300) : null;
  };
  if (byForm && asked?.length) {
    const more = await db
      .prepare(AGAIN_BY_FORM_SQL)
      .bind(JSON.stringify(asked))
      .all<{ key: string; pid: number; reason: string; replaced: number; n: number }>();
    for (const r of more.results) {
      const asker = why(r.key);
      // A program its rewrite put live, or a third try, only for a reason
      // given; a fourth only with a new entry given (`entries`).
      if (rows.results.some((o) => o.key === r.key) || !mayAskAgain(r, asker, givenEntry(body.entries, r.key) !== null)) continue;
      rows.results.push({ key: r.key, pid: r.pid });
      const reasons = r.replaced ? [] : [`its last rewrite for its kind was not used: ${r.reason}`];
      if (asker) reasons.push(asker);
      again.set(r.key, reasons);
    }
  }
  const inOrder = asked ? asked.map((k) => rows.results.find((r) => r.key === k)).filter((r): r is { key: string; pid: number } => !!r) : rows.results;
  const picked = inOrder.slice(0, limit);
  const room = refreshBudget(env) - (await refreshSpentThisMonth(db));
  const byModel = new Map<string, { id: string; request: OracleSpellRequest }[]>();
  const queued: string[] = [];
  let estimate = 0;
  const library = await liveLibrary(db);
  for (const r of picked) {
    const element = await getElement(db, r.key);
    const row = await getProgram(db, r.pid);
    if (!element || !row) continue;
    const tier = tierOf(element);
    const big = isBig(tier, smallUpTo(env));
    const cost = big ? REFRESH_ESTIMATE.big : REFRESH_ESTIMATE.small;
    if (estimate + cost > room) break;
    // 4.6: by form, the entry is written again for its kind the first time,
    // for the program to be written from. Players keep reading the old one
    // until the candidate replaces the live program (refreshVerdict); a dry
    // run writes no entry at all.
    let fresh = false;
    if (byForm && body.dry !== true) {
      const kept = await db.prepare("SELECT entry FROM forms WHERE key = ?").bind(r.key).first<{ entry: string | null }>();
      fresh = !!kept && kept.entry === null;
    }
    // An entry given by name is the item's new entry: written from, and live
    // with the program (the owner's hunting Serpent).
    const given = byForm && body.dry !== true ? givenEntry(body.entries, r.key) : null;
    if (given) fresh = true;
    const description = given ?? (fresh ? await ensureDescription(env, oracle, element, true, false) : await ensureDescription(env, oracle, element, false));
    // By form, its promise is read again from the entry it is written from:
    // the stored one may come from an entry written before its kind (a
    // Serpent promised to protect, so its program raised a shield). Stored
    // only when the program goes live (refreshVerdict).
    // A failed read keeps the stored promise (the review of #65: an empty one
    // would hold the candidate to nothing, and clear the live item's).
    const read = byForm && body.dry !== true ? await readIntents(env, oracle, element, description) : null;
    const newIntents = read !== null;
    const intents = read ?? (await ensureIntents(env, oracle, element, description));
    const request: OracleSpellRequest = {
      name: element.name,
      kind: element.kind,
      ...shapeOf(element, description),
      description,
      recipe: await firstRecipe(db, r.key),
      tier,
      intents,
      library: library.docs,
      ...(fresh ? { newEntry: true } : {}),
      ...(newIntents ? { newIntents: true } : {}),
      // Its first rewrite for its kind was kept out: the writer is told why,
      // not shown that program (it is the design that failed).
      ...(again.get(r.key)?.length ? { rewrite: { reasons: again.get(r.key)! } } : {}),
    };
    const model = big ? env.SPELL_MODEL : smallModel(env);
    const hold = await holdBatch(env, oracle);
    const ins = await db
      .prepare(
        "INSERT INTO rewrites (key, from_pid, cause, at, status, model, request, invite, reservation, estimate, dry) VALUES (?, ?, 'refresh', ?, 'pending', ?, ?, 'admin', ?, ?, ?)",
      )
      .bind(r.key, r.pid, Date.now(), model, JSON.stringify(request), hold, cost, body.dry === true ? 1 : 0)
      .run();
    const id = Number(ins.meta.last_row_id);
    byModel.set(model, [...(byModel.get(model) ?? []), { id: batchItemId("refresh", id), request }]);
    estimate += cost;
    queued.push(element.name);
  }
  const batches: string[] = [];
  for (const [model, items] of byModel) {
    try {
      const batch = await oracleFor(env, { spellModel: model }, ledgerOf(oracle)).submitBatch(items);
      batches.push(batch);
      for (const it of items)
        await db
          .prepare("UPDATE rewrites SET batch = ? WHERE id = ?")
          .bind(batch, Number(it.id.slice(2)))
          .run();
    } catch (err) {
      for (const it of items) {
        const id = Number(it.id.slice(2));
        const row = await db.prepare("SELECT reservation FROM rewrites WHERE id = ?").bind(id).first<{ reservation: number | null }>();
        await db.prepare("UPDATE rewrites SET status = 'failed' WHERE id = ?").bind(id).run();
        await releaseHold(db, row?.reservation ?? null);
      }
      throw err;
    }
  }
  return { queued, batches, estimate: Math.round(estimate * 1000) / 1000, room: Math.round((room - estimate) * 100) / 100 };
}

// For the runner: candidates with the program they would replace.
async function refreshCandidates(env: Env, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.key, p.spec, p.model, p.parent, e.name, e.kind, e.tier, e.depth, e.intents,
       (SELECT spec FROM programs o WHERE o.id = (SELECT pid FROM spells WHERE key = p.key)) AS old_spec,
       (SELECT pid FROM spells WHERE key = p.key) AS old_id,
       (SELECT dry FROM rewrites r WHERE r.to_pid = p.id) AS dry,
       (SELECT request FROM rewrites r WHERE r.to_pid = p.id) AS request
     FROM programs p JOIN elements e ON e.key = p.key WHERE p.status = 'candidate' AND p.origin = 'refresh' ORDER BY p.id LIMIT ?`,
  )
    .bind(Math.min(100, Math.max(1, limit)))
    .all<{
      id: number;
      key: string;
      spec: string;
      model: string;
      parent: number | null;
      name: string;
      kind: string;
      tier: string | null;
      depth: number;
      intents: string | null;
      old_spec: string | null;
      old_id: number | null;
      dry: number | null;
      request: string | null;
    }>();
  const code = (spec: string | null) => {
    try {
      return String((JSON.parse(spec ?? "{}") as { code?: unknown }).code ?? "");
    } catch {
      return "";
    }
  };
  // 4.6: the kind a candidate was written as, so its test run holds it to that kind's size.
  const shape = (spec: string | null) => {
    try {
      const v = JSON.parse(spec ?? "{}") as { form?: unknown; giant?: unknown };
      return isForm(v.form) ? { form: v.form, giant: v.giant === true } : {};
    } catch {
      return {};
    }
  };
  return rows.results.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    kind: r.kind,
    ...shape(r.spec),
    tier: isTier(r.tier) ? r.tier : tierFromDepth(r.depth),
    intents: requestIntents(r.request) ?? parseIntents(r.intents),
    model: r.model,
    code: code(r.spec),
    oldId: r.old_id,
    oldCode: code(r.old_spec),
    dry: r.dry === 1,
  }));
}

// What the runner decided. Replaced: the candidate goes live and the old
// program is retired (kept, so a vote can bring it back). Kept: the
// candidate is rejected and the old one stays live.
async function refreshVerdict(
  env: Env,
  body: { id?: unknown; replace?: unknown; reason?: unknown; oldScore?: unknown; newScore?: unknown; checked?: unknown; supersede?: unknown },
) {
  const db = env.DB;
  const row = await getProgram(db, Number(body.id));
  if (!row || row.status !== "candidate" || row.origin !== "refresh") throw new HttpError(404, "There is no such candidate");
  // Superseded: written with a prompt changed since (the dry run, before
  // protection kept each item's own look). Rejected, and its element may be
  // refreshed again; what it cost still counts against the cap.
  if (body.supersede === true) {
    await setStatus(db, row.id, "rejected");
    await db.prepare("UPDATE rewrites SET status = 'superseded' WHERE cause = 'refresh' AND to_pid = ?").bind(row.id).run();
    return { ok: true, replaced: false, superseded: true };
  }
  const live = await liveProgram(db, row.key);
  const replace = body.replace === true;
  const score = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  if (typeof body.checked === "object" && body.checked)
    await db.prepare("UPDATE programs SET checked = ? WHERE id = ?").bind(JSON.stringify(body.checked).slice(0, 2000), row.id).run();
  if (replace) {
    await promote(db, { ...row, parent: live?.row.id ?? row.parent });
    // 4.6: a rewrite by form that wrote the entry again for its kind: the
    // new entry goes live with the program, the old one kept in forms.entry.
    const asked = await db.prepare("SELECT request FROM rewrites WHERE cause = 'refresh' AND to_pid = ?").bind(row.id).first<{ request: string | null }>();
    let entry: string | null = null;
    try {
      const req = JSON.parse(asked?.request ?? "{}") as OracleSpellRequest;
      if (req.newEntry === true && typeof req.description === "string" && req.description.trim()) entry = req.description;
    } catch {
      entry = null;
    }
    // Its promise, read from that entry, goes live with it too.
    const intents = requestIntents(asked?.request ?? null)?.join(",") ?? null;
    if (intents !== null) await db.prepare("UPDATE elements SET intents = ? WHERE key = ?").bind(intents, row.key).run();
    if (entry) {
      const old = await db.prepare("SELECT description FROM elements WHERE key = ?").bind(row.key).first<{ description: string | null }>();
      await db.batch([
        db.prepare("UPDATE forms SET entry = ? WHERE key = ? AND entry IS NULL").bind(old?.description ?? "", row.key),
        db.prepare("UPDATE elements SET description = ? WHERE key = ?").bind(entry, row.key),
      ]);
    }
  } else await setStatus(db, row.id, "rejected");
  await db
    .prepare("INSERT OR REPLACE INTO refresh_verdicts (to_pid, key, from_pid, replaced, reason, old_score, new_score, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(
      row.id,
      row.key,
      live?.row.id ?? row.parent,
      replace ? 1 : 0,
      String(body.reason ?? "").slice(0, 300),
      score(body.oldScore),
      score(body.newScore),
      Date.now(),
    )
    .run();
  return { ok: true, replaced: replace };
}

async function refreshReport(env: Env) {
  const db = env.DB;
  const statuses = await db
    // A row that failed before any batch held it was never sent (4.0 review
    // M12: 94 rows of a first submitBatch that threw read as 94 failures).
    .prepare(
      `SELECT CASE WHEN status = 'failed' AND batch IS NULL THEN 'not sent' ELSE status END AS status, dry, COUNT(*) AS n
       FROM rewrites WHERE cause = 'refresh' GROUP BY 1, dry`,
    )
    .all<{ status: string; dry: number; n: number }>();
  const verdicts = await db.prepare("SELECT v.*, e.name FROM refresh_verdicts v JOIN elements e ON e.key = v.key ORDER BY v.at").all<{
    to_pid: number;
    key: string;
    from_pid: number;
    replaced: number;
    reason: string;
    old_score: number | null;
    new_score: number | null;
    name: string;
  }>();
  // Rolled back by votes since: the replaced program is no longer live.
  const rolled = await db
    .prepare("SELECT COUNT(*) AS n FROM refresh_verdicts v JOIN programs p ON p.id = v.to_pid WHERE v.replaced = 1 AND p.status != 'live'")
    .first<{ n: number }>();
  const cost = await db.prepare("SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS n FROM spend WHERE call = 'refresh'").first<{ usd: number; n: number }>();
  return {
    budget: refreshBudget(env),
    held: Math.round((await refreshSpentThisMonth(db)) * 1000) / 1000,
    statuses: statuses.results,
    replaced: verdicts.results.filter((v) => v.replaced).length,
    kept: verdicts.results.filter((v) => !v.replaced).length,
    rolledBack: rolled?.n ?? 0,
    cost: { usd: Math.round((cost?.usd ?? 0) * 10000) / 10000, programs: cost?.n ?? 0 },
    verdicts: verdicts.results,
  };
}

// --- 3.7 part E: trim duplicates without breaking anyone. ---

// One cheap pass over every name and recipe: near duplicates (World Tree and
// Yggdrasil, Ley Line and Ley Lines) and merges that make no sense. Nothing
// changes until the owner approves each one (trimDecide).
async function trimScan(env: Env, oracle: Oracle) {
  const db = env.DB;
  const names = (await db.prepare("SELECT name, kind FROM elements ORDER BY name").all<{ name: string; kind: string }>()).results;
  const recipes = (
    await db
      .prepare(
        "SELECT ea.name AS a, eb.name AS b, er.name AS r FROM recipes x JOIN elements er ON er.key = x.result LEFT JOIN elements ea ON ea.key = x.a LEFT JOIN elements eb ON eb.key = x.b",
      )
      .all<{ a: string | null; b: string | null; r: string }>()
  ).results;
  await ensureBudget(env, oracle, "trim", ESTIMATE.trim);
  const answer = await oracle.trim(
    names.map((n) => `${n.name} (${n.kind})`),
    recipes.map((r) => `${r.a ?? "?"} + ${r.b ?? "?"} = ${r.r}`),
  );
  const now = Date.now();
  const known = new Set(names.map((n) => elementKey(n.name)));
  let added = 0;
  for (const d of answer.duplicates.slice(0, 60)) {
    if (!known.has(elementKey(d.keep)) || !known.has(elementKey(d.alias)) || elementKey(d.keep) === elementKey(d.alias)) continue;
    await db.prepare("INSERT INTO trims (kind, a, b, why, at) VALUES ('duplicate', ?, ?, ?, ?)").bind(d.keep, d.alias, d.why.slice(0, 300), now).run();
    added++;
  }
  for (const m of answer.senseless.slice(0, 40)) {
    const pair = pairKey(m.a, m.b);
    const found = await db.prepare("SELECT result FROM recipes WHERE pair = ?").bind(pair).first<{ result: string }>();
    if (!found) continue;
    await db
      .prepare("INSERT INTO trims (kind, a, b, result, why, at) VALUES ('senseless', ?, ?, ?, ?, ?)")
      .bind(m.a, m.b, found.result, m.why.slice(0, 300), now)
      .run();
    added++;
  }
  return { added };
}

async function trimNext(env: Env) {
  const next = await env.DB.prepare("SELECT * FROM trims WHERE status = 'pending' ORDER BY kind, id LIMIT 1").first();
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM trims WHERE status = 'pending'").first<{ n: number }>();
  const all = await env.DB.prepare("SELECT id, kind, a, b, result, why, status FROM trims ORDER BY kind, id").all();
  return { next, left: left?.n ?? 0, all: all.results };
}

// Approved: a duplicate becomes an alias of the kept element (nothing is
// deleted: the alias name keeps working in inventories, recipes and First
// Discoveries, and means the kept one); a senseless merge is asked again on
// its next merge, the old answer kept in recipe_history and in inventories.
async function trimDecide(env: Env, body: { id?: unknown; approve?: unknown }) {
  const db = env.DB;
  const t = await db
    .prepare("SELECT * FROM trims WHERE id = ? AND status = 'pending'")
    .bind(Number(body.id))
    .first<{ id: number; kind: string; a: string; b: string; result: string | null }>();
  if (!t) throw new HttpError(404, "Nothing pending with that id");
  const now = Date.now();
  if (body.approve === true) {
    if (t.kind === "duplicate") {
      const keep = elementKey(t.a);
      const alias = elementKey(t.b);
      // An alias of an alias points at the end of the chain; never at itself.
      const end = (await db.prepare("SELECT key FROM aliases WHERE alias = ?").bind(keep).first<{ key: string }>())?.key ?? keep;
      if (end === alias) throw new HttpError(400, "That would make an alias of itself");
      await db.batch([
        db.prepare("INSERT OR REPLACE INTO aliases (alias, key, at) VALUES (?, ?, ?)").bind(alias, end, now),
        db.prepare("UPDATE aliases SET key = ? WHERE key = ?").bind(end, alias),
      ]);
    } else {
      const pair = pairKey(t.a, t.b);
      const r = await db
        .prepare("SELECT * FROM recipes WHERE pair = ?")
        .bind(pair)
        .first<{ pair: string; a: string; b: string; result: string; created_at: number }>();
      if (r)
        await db.batch([
          db
            .prepare("INSERT INTO recipe_history (pair, a, b, result, created_at, retired_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(r.pair, r.a, r.b, r.result, r.created_at, now),
          db.prepare("DELETE FROM recipes WHERE pair = ?").bind(pair),
        ]);
    }
  }
  await db
    .prepare("UPDATE trims SET status = ?, decided_at = ? WHERE id = ?")
    .bind(body.approve === true ? "approved" : "declined", now, t.id)
    .run();
  return trimNext(env);
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
      `SELECT s.key, s.pid, (SELECT MAX(p.id) FROM programs p WHERE p.key = s.key AND p.status = 'trial' AND p.id > COALESCE(s.pid, 0)) AS trial,
         e.intents, e.kind, (SELECT p.checked FROM programs p WHERE p.id = s.pid) AS checked
       FROM spells s LEFT JOIN elements e ON e.key = s.key WHERE s.key IN (${marks}) AND s.version >= ?`,
    )
      .bind(...chunk, FIRST_PROGRAM_VERSION)
      .all<{ key: string; pid: number | null; trial: number | null; intents: string | null; kind: string | null; checked: string | null }>();
    const found = new Set<string>();
    for (const r of rows.results) {
      const id = r.trial ?? r.pid;
      if (!id) continue;
      found.add(r.key);
      const entry: LiveResponse["programs"][string] = { id, trial: !!r.trial };
      // A live program whose promise is probed but that never faced the
      // probe, or an artifact that never faced its five minute test (3.7).
      const intents = parseIntents(r.intents);
      if (!r.trial && !faced(r.checked, r.kind, intents)) entry.recheck = r.kind === "artifact" ? [...intents, "act"] : intents;
      programs[byKey.get(r.key) ?? r.key] = entry;
    }
    // An element whose only program is a trial has no row in `spells` yet:
    // the browser that holds that trial is told so, and tests it again if
    // its verdict never arrived (a lost request kept it a trial for good).
    const missing = chunk.filter((k) => !found.has(k));
    if (missing.length) {
      const trials = await env.DB.prepare(
        `SELECT key, MAX(id) AS id FROM programs WHERE status = 'trial' AND key IN (${missing.map(() => "?").join(", ")}) GROUP BY key`,
      )
        .bind(...missing)
        .all<{ key: string; id: number }>();
      for (const t of trials.results) programs[byKey.get(t.key) ?? t.key] = { id: t.id, trial: true };
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
  // One to three reasons, stored joined ("still,size"): no new column.
  const reasons = up ? null : voteReasons(body);
  if (!up && !reasons) throw new HttpError(400, "A down vote needs one to three of the reasons offered");
  const cast = await env.DB.prepare("SELECT at FROM casts WHERE player = ? AND pid = ?").bind(player, row.id).first<{ at: number }>();
  if (!cast || Date.now() - cast.at > VOTE_WINDOW_MS) throw new HttpError(403, "Only players who cast this version of the spell lately can vote on it");
  await env.DB.prepare(
    `INSERT INTO votes (player, pid, key, up, reason, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (player, pid) DO UPDATE SET up = excluded.up, reason = excluded.reason, at = excluded.at`,
  )
    .bind(player, row.id, key, up ? 1 : 0, reasons ? reasons.join(",") : null, Date.now())
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

// 4.5.1 (audit, D.M14): the daily rewrite budget covered votes and the judge
// only; a failed test run and a broken promise found by a recheck wrote again
// without it. Those two ask this first now. Not under it, on purpose: a
// repair (a program that crashed in play, capped by its own "mended" limit)
// and the admin's own rewrite from the card.
async function overRewriteBudget(env: Env, tier: Tier): Promise<boolean> {
  const estimate = isBig(tier, smallUpTo(env)) ? REWRITE_ESTIMATE.big : REWRITE_ESTIMATE.small;
  return (await rewriteSpendToday(env.DB, REWRITE_ESTIMATE.batch)) + estimate > rewriteBudget(env);
}

// Writes a live program again because of votes or the judge: at most once per
// spell every three days, within the daily rewrite budget. Small spells are
// written at once; big ones go to the Batch API, and the live version stays
// until the new one is back and through its test run.
async function requestRewrite(env: Env, row: ProgramRow, cause: RewriteCause, reasons: string[], payer: Payer): Promise<string> {
  const db = env.DB;
  const oracle = oracleFor(env, {}, new Ledger(payer));
  try {
    return await rewriteWith(env, oracle, row, cause, reasons);
  } finally {
    await closeLedger(db, oracle);
  }
}

type RewriteCause = "votes" | "judge" | "evidence";

async function rewriteWith(env: Env, oracle: Oracle, row: ProgramRow, cause: RewriteCause, reasons: string[]): Promise<string> {
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
  // Evidence names what part broke (daily 2026-11-05): the program is shown, to fix,
  // as after a failed test run. Votes and the judge ask for a new design.
  const rewrite: Rewrite = { reasons, summary: programOf(row)?.summary, ...(cause === "evidence" ? { code: programOf(row)?.code } : {}) };
  const intents = await ensureIntents(env, oracle, element, description);
  const library = await liveLibrary(db);
  const request: OracleSpellRequest = {
    name: element.name,
    kind: element.kind,
    ...shapeOf(element, description),
    description,
    recipe: await firstRecipe(db, row.key),
    tier,
    rewrite,
    intents,
    library: library.docs,
  };
  if (batchHold !== null) {
    await queueBatch(env, row.key, request, row.id, cause, ledgerOf(oracle).payer.invite, batchHold);
    return "queued in a batch";
  }
  const model = big ? env.SPELL_MODEL : smallModel(env);
  if (!big) request.examples = await examplesFor(env, row.key, request);
  const at = Date.now();
  try {
    const answer = await writeWith(env, oracle, model, undefined, (w) => w.spell(request));
    const program = programFrom(answer, intents, library, request);
    const id = await insertProgram(db, row.key, JSON.stringify(program), model, PROGRAM_VERSION, cause, "trial", row.id);
    await recordGap(db, row.key, id, answer.missing);
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
  fromPid: number | null,
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
  return `${cause === "upgrade" ? "up" : cause === "refresh" ? "rf" : cause === "ahead" ? "ah" : "rw"}${id}`;
}

// What a program back from a batch is called, by why it was asked; a rewrite asked by votes otherwise.
const BATCH_ORIGIN: Record<string, ProgramOrigin> = { upgrade: "batch", ahead: "new", judge: "judge", evidence: "evidence", refresh: "refresh" };

// Collects finished batches: each program comes back as a trial, tested by
// the next browser that asks for the spell.
async function pollBatches(env: Env): Promise<{ done: number; failed: number; waiting: number }> {
  const db = env.DB;
  const pending = await db
    .prepare("SELECT id, key, from_pid, cause, batch, model, invite, reservation, request FROM rewrites WHERE status = 'pending' AND batch IS NOT NULL")
    .all<{
      id: number;
      key: string;
      from_pid: number;
      cause: string;
      batch: string;
      model: string;
      invite: string | null;
      reservation: number | null;
      request: string | null;
    }>();
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
        // A big item written ahead (4.2) is then written on first use.
        if (taken && row.cause === "ahead") await finishWrite(db, row.key, "failed", { usd: o?.usd ?? 0, error: o?.error ?? "missing" });
        continue;
      }
      if (taken) {
        let intents: Intent[] = [];
        let shape: { form?: Form; giant?: boolean } = {};
        try {
          const asked = JSON.parse(row.request ?? "{}") as OracleSpellRequest;
          intents = parseIntents(asked.intents);
          shape = { form: isForm(asked.form) ? asked.form : undefined, giant: asked.giant === true };
        } catch {
          // An old row without a request: no promise to keep.
        }
        const program = programFrom(o.answer, intents, await liveLibrary(db), shape);
        const origin: ProgramOrigin = BATCH_ORIGIN[row.cause] ?? "votes";
        // Its parent is what is live now: the draft may have been fixed, or the
        // spell rolled back, while the batch ran. A refresh (3.7) waits as a
        // candidate, served to nobody, for the refresh runner to decide.
        const live = await liveProgram(db, row.key);
        const id = await insertProgram(
          db,
          row.key,
          JSON.stringify(program),
          o.model,
          PROGRAM_VERSION,
          origin,
          row.cause === "refresh" ? "candidate" : "trial",
          live?.row.id ?? row.from_pid,
        );
        await db.prepare("UPDATE rewrites SET status = 'done', to_pid = ?, model = ? WHERE id = ?").bind(id, o.model, row.id).run();
        await recordGap(db, row.key, id, o.answer.missing);
        if (row.cause === "ahead") await finishWrite(db, row.key, "done", { usd: o.usd, pid: id, model: o.model });
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

async function ensureDescription(env: Env, oracle: Oracle, element: GameElement, regenerate: boolean, store = true): Promise<string> {
  const db = env.DB;
  const key = elementKey(element.name);
  if (!oracle.mock && !regenerate) {
    const cached = await db.prepare("SELECT description FROM elements WHERE key = ?").bind(key).first<{ description: string | null }>();
    // A refusal stored before 4.5.1 counts as no description: it is written again.
    if (cached?.description && !looksLikeRefusal(cached.description, element.name)) return cached.description;
  }

  await ensureBudget(env, oracle, "describe", ESTIMATE.describe);
  const recipe = await firstRecipe(db, key);
  let description = await oracle.describe(element.name, element.kind, recipe, element.form);
  if (!oracle.mock && looksLikeRefusal(description, element.name)) {
    await ensureBudget(env, oracle, "describe", ESTIMATE.describe);
    description = await oracle.describe(element.name, element.kind, recipe, element.form);
    // Twice refused: the plain stand in is stored, so no request pays twice
    // again (the admin's "New description" asks anew); the page never caches
    // it (src/store.ts), so a later description reaches every device.
    if (looksLikeRefusal(description, element.name)) description = noDescription(element.name);
  }
  if (!oracle.mock && store) {
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
  // An approved duplicate (3.7) means the element it is an alias of.
  const alias = await db.prepare("SELECT key FROM aliases WHERE alias = ?").bind(key).first<{ key: string }>();
  if (alias && alias.key !== key) return getElement(db, alias.key);
  const row = await db
    .prepare("SELECT name, emoji, kind, depth, tier, form FROM elements WHERE key = ?")
    .bind(key)
    .first<{ name: string; emoji: string; kind: ElementKind; depth: number; tier: string | null; form: string | null }>();
  if (!row) return null;
  return {
    name: row.name,
    emoji: row.emoji,
    kind: row.kind,
    depth: row.depth,
    ...(isTier(row.tier) ? { tier: row.tier } : {}),
    ...(isForm(row.form) && kindOfForm(row.form) === row.kind ? { form: row.form } : {}),
  };
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

// A player's request is small (names, a digest, a test verdict); only the
// judge's frames, from the admin's runner, are large. Anything bigger is
// refused before it is parsed, so a flood of big bodies cannot tie the Worker up.
const MAX_BODY = 128 * 1024;
const MAX_ADMIN_BODY = 8 * 1024 * 1024;
// 4.0: an account's progress upload (a large island gzipped is under 200 KB).
const MAX_PROGRESS_BODY = 2 * 1024 * 1024;

async function readBody<T>(request: Request, limit = MAX_BODY): Promise<T> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "The request is too big");
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, "The request is too big");
  try {
    return JSON.parse(text) as T;
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
  if (!post && path === "programs")
    return json(await programsToJudge(env, Number(url.searchParams.get("limit")) || 20, url.searchParams.get("creatures") === "1"));
  if (post && path === "judge") return json(await handleJudge(await readBody<JudgeBody>(request, MAX_ADMIN_BODY), env, oracle, ctx, true));
  if (post && path === "judge-trial") return json(await handleJudge(await readBody<JudgeBody>(request, MAX_ADMIN_BODY), env, oracle, ctx, false));
  if (!post && path === "judge-stats") return json(await calibration(env.DB));
  // 4.2: what the writes started at the merge did, by day, against their cap.
  if (!post && path === "ahead") return json(await aheadReport(env.DB, aheadCap(env.AHEAD_DAILY_USD)));
  if (post && path === "poll-batches") return json(await pollBatches(env));
  if (post && path === "spell-trial") return json(await spellTrial(await readBody<SpellTrialBody>(request), env, oracle));
  if (post && path === "batch-trial") return json(await batchTrial(await readBody<SpellTrialBody & { names?: string[] }>(request), env, oracle));
  if (!post && path === "batch-trial") return json(await batchTrialResults(url.searchParams.get("batch") ?? "", env));
  // 3.4: invites, people and reports.
  if (!post && path === "people") return json(await people(env));
  if (post && path === "invites") return json(await newInvite(await readBody<{ name?: unknown; cap?: unknown }>(request), env, url));
  if (post && path === "invite") return json(await changeInvite(await readBody<InviteChange>(request), env, url));
  if (post && path === "report") return json(await closeReport(await readBody<{ id?: unknown }>(request), env));
  // 3.4.1: send an idea to Claude, decline, reopen or delete it; read GitHub now.
  if (post && path === "feedback") return json(await changeFeedback(env, await readBody<FeedbackAction>(request)));
  if (post && path === "feedback-sync") return json(await syncFeedback(env, 20));
  // 4.5: a pull request that says "Idea #n" (.github/workflows/ideas.yml).
  if (post && path === "idea-pr") return json(await ideaPull(env, await readBody(request)));
  // 3.4.2: the API that grows.
  if (post && path === "refresh") return json(await startRefresh(env, oracle, await readBody(request)));
  if (!post && path === "refresh-candidates") return json(await refreshCandidates(env, Number(url.searchParams.get("limit")) || 20));
  if (post && path === "refresh-verdict") return json(await refreshVerdict(env, await readBody(request)));
  if (!post && path === "refresh-report") return json(await refreshReport(env));
  // 4.6: the library sorted into the seven kinds: proposals first, the owner's list, then applied.
  if (post && path === "forms") {
    const body = await readBody<{ limit?: unknown; again?: unknown }>(request);
    // again: proposals nobody applied or declined are asked anew (a better prompt).
    if (body.again === true) await env.DB.prepare("DELETE FROM forms WHERE status = 'proposed'").run();
    return json(await proposeForms(env.DB, oracle, () => ensureBudget(env, oracle, "forms", ESTIMATE.trim), Number(body.limit) || 180));
  }
  if (!post && path === "forms") return json(await formList(env.DB));
  if (post && path === "forms-apply") {
    try {
      return json(await applyForms(env.DB, await readBody(request)));
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
  }
  if (post && path === "trim-scan") return json(await trimScan(env, oracle));
  if (!post && path === "trims") return json(await trimNext(env));
  if (post && path === "trim") return json(await trimDecide(env, await readBody(request)));
  if (!post && path === "challenge-candidates") return json(await candidates(env.DB, Math.min(60, Number(url.searchParams.get("limit")) || 20)));
  if (post && path === "challenge-verify") return json(await recordVerification(env.DB, await readBody(request)));
  if (!post && path === "evolution") return json(await evolution(env.DB));
  if (post && path === "evolve") return json(await evolve(env, true));
  if (!post && path === "helpers") return json(await trialHelpers(env.DB));
  // Intents for elements from before 3.4.2, now rather than 25 per cron run.
  if (post && path === "intents") return json(await backfillIntents(env, 80));
  if (post && path === "helper-check") {
    const body = await readBody<{ id?: unknown; ok?: unknown; detail?: unknown }>(request);
    return json({ status: await settleHelper(env.DB, Number(body.id), body.ok === true, String(body.detail ?? "")) });
  }
  if (!post && path === "proposals") {
    const rows = await env.DB.prepare("SELECT * FROM extensions WHERE kind = 'engine' AND status = 'open' ORDER BY id").all();
    return json(rows.results);
  }
  if (post && path === "extension") return json(await changeExtension(await readBody<{ id?: unknown; status?: unknown; issue?: unknown }>(request), env));
  // 4.4.5 part C: wonders written as programs.
  if (!post && path === "wonders") return json(await wonderList(env.DB));
  if (!post && path === "wonders-trial") return json((await trialWonders(env.DB)).map((r) => ({ ...poolOf(r), status: r.status })));
  if (!post && path === "wonders-unjudged") {
    const rows = await env.DB.prepare("SELECT * FROM wonders WHERE status = 'live' AND judged IS NULL ORDER BY id LIMIT 10").all<WonderRow>();
    return json(rows.results.map(poolOf));
  }
  if (post && path === "wonder-check") {
    const body = await readBody<{ id?: unknown; ok?: unknown; detail?: unknown; problem?: unknown }>(request);
    return json({
      status: await settleWonder(env.DB, Number(body.id), body.ok === true, String(body.detail ?? ""), typeof body.problem === "string" ? body.problem : null),
    });
  }
  if (post && path === "wonder") {
    const body = await readBody<{ id?: unknown; status?: unknown }>(request);
    try {
      return json({ status: await changeWonder(env.DB, Number(body.id), String(body.status)) });
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
  }
  if (post && path === "wonder-judge") return json(await judgeWonder(await readBody<JudgeBody>(request, MAX_ADMIN_BODY), env, oracle));
  if (post && path === "wonder-daily") {
    const body = await readBody<{ force?: unknown }>(request);
    return json(await wonderDaily(env, body.force === true ? "force" : "due"));
  }
  return null;
}

// --- 4.4.5 part C: a new wonder a day ------------------------------------

// Collects the day's wonder when its batch has ended; when one is due (or
// forced by the admin) and the month's wonder budget has room, asks for the
// next one; and sorts the day's new artifacts for players' discoveries.
async function wonderDaily(env: Env, mode: "collect" | "due" | "force") {
  const db = env.DB;
  const now = Date.now();
  const out: { collected: number; failed: string[]; asked: string | null; sorted: number; trials: string[]; skipped: string | null } = {
    collected: 0,
    failed: [],
    asked: null,
    sorted: 0,
    trials: [],
    skipped: null,
  };
  // The admin pays; the day's batch hold outlives this run (taken out of the
  // ledger, settled when the batch is collected), the sort's is settled at once.
  const ledger = new Ledger(ADMIN_PAYER);
  ledger.burstFree = true;
  const oracle = oracleFor(env, {}, ledger);
  // 1. What a batch wrote.
  const pending = await db.prepare("SELECT * FROM wonders WHERE status = 'pending' AND batch IS NOT NULL").all<WonderRow>();
  for (const batch of new Set(pending.results.map((r) => r.batch!))) {
    const outcomes = await oracle.wonderResults(batch);
    if (!outcomes) continue;
    for (const row of pending.results.filter((r) => r.batch === batch)) {
      const o = outcomes.find((x) => x.id === `wd${row.id}`);
      const draw = { rarity: row.rarity, land: row.lands, change: row.change ?? "" };
      const problem = o?.answer ? wonderProblem(o.answer, draw, await takenKinds(db)) : (o?.error ?? "the batch lost it");
      const a = o?.answer;
      const ok = !problem && a;
      const update = ok
        ? db
            .prepare(
              "UPDATE wonders SET status = 'trial', kind = ?, lands = ?, spot = ?, reach = ?, does = ?, summary = ?, code = ?, missing = ?, model = ?, usd = ? WHERE id = ? AND status = 'pending'",
            )
            .bind(
              a.kind.trim().toLowerCase(),
              a.lands.join(","),
              a.spot,
              a.reach,
              a.does.trim(),
              a.summary.trim(),
              a.code,
              a.missing.trim(),
              o!.model,
              o!.usd,
              row.id,
            )
        : db
            .prepare("UPDATE wonders SET status = 'failed', checked = ?, usd = ? WHERE id = ? AND status = 'pending'")
            .bind(JSON.stringify({ ok: false, problem: "answer", detail: problem, at: now }), o?.usd ?? 0, row.id);
      // Billed once, with the hold settled, only while the row is still pending.
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO spend (at, call, model, usd, invite)
             SELECT ?, 'wonder', ?, ?, 'admin' WHERE ? > 0 AND EXISTS (SELECT 1 FROM wonders WHERE id = ? AND status = 'pending')`,
          )
          .bind(now, o?.model || row.model, o?.usd ?? 0, o?.usd ?? 0, row.id),
        db.prepare("UPDATE reservations SET settled = 1 WHERE id = ?").bind(row.reservation ?? 0),
        update,
      ]);
      if (results[2].meta.changes === 0) continue;
      if (ok) out.collected++;
      else out.failed.push(`#${row.id}: ${problem}`);
    }
  }
  if (mode === "collect") return out;
  if (mode === "due" && !(await dailyDue(db, now))) return out;
  // 4.5.1 (audit, B13): a wonder whose answer failed its checks left no live
  // row, so `dailyDue` asked again at the next run; one attempt a day now.
  // Only the wonder waits: the day's sort of players' artifacts (step 3) runs.
  const ask = mode !== "due" || (await takeRun(db, "wonder", dayInZone(now), 1, now));
  const cap = wonderBudget(env.WONDER_BUDGET_USD);
  // 2. Today's wonder, within its cap.
  if (ask) {
    const draw = await drawWonder(db);
    const rarity = draw.rarity as WonderRow["rarity"];
    const model = modelFor(rarity, { big: env.SPELL_MODEL, small: smallModel(env) });
    const estimate = model === smallModel(env) ? WONDER_ESTIMATE.small : WONDER_ESTIMATE.big;
    const spent = await wonderSpent(db, monthStart(now));
    if (!oracle.mock && spent + estimate > cap) {
      out.skipped = `the month's wonders have $${(cap - spent).toFixed(3)} left of $${cap}, and one costs up to $${estimate}`;
    } else {
      let reservation: number | null = null;
      if (!oracle.mock) {
        reservation = await hold(db, ledger, "wonder", estimate, budget(env));
        ledger.held.splice(ledger.held.indexOf(reservation), 1);
      }
      const ins = await db
        .prepare(
          "INSERT INTO wonders (source, kind, rarity, lands, change, status, model, reservation, estimate, created_at) VALUES ('daily', '', ?, ?, ?, 'pending', ?, ?, ?, ?)",
        )
        .bind(draw.rarity, draw.land, draw.change, model, reservation, estimate, now)
        .run();
      const id = Number(ins.meta.last_row_id);
      try {
        const batch = await oracle.submitWonders([{ id: `wd${id}`, model, user: await dailyMessage(db, draw) }]);
        await db.prepare("UPDATE wonders SET batch = ? WHERE id = ?").bind(batch, id).run();
        out.asked = `${draw.rarity} ${draw.land} ${draw.change} (${model})`;
      } catch (err) {
        await db.batch([
          db.prepare("UPDATE wonders SET status = 'failed', estimate = 0 WHERE id = ?").bind(id),
          db.prepare("UPDATE reservations SET settled = 1 WHERE id = ?").bind(reservation ?? 0),
        ]);
        throw err;
      }
    }
  }
  // 3. Players' discoveries: a day's new artifacts sorted in one small call,
  // once a Toronto day (4.5.1, N1: on a day the wonder failed, every due run
  // would sort again what the last one left unanswered).
  const list = await unsorted(db);
  if (list.length && (mode !== "due" || (await takeRun(db, "wonder-sort", dayInZone(now), 1, now)))) {
    const room = cap - (await wonderSpent(db, monthStart(now)));
    if (oracle.mock || room >= WONDER_ESTIMATE.sort) {
      if (!oracle.mock) await hold(db, ledger, "wonder-sort", WONDER_ESTIMATE.sort, budget(env));
      try {
        const grown = await growDiscoveries(db, oracle, list, now);
        out.sorted = grown.sorted;
        out.trials = grown.trials;
      } finally {
        await closeLedger(db, oracle);
      }
    }
  }
  return out;
}

// The judge looks at a live wonder's frames, for advice only (4.4.5 part C).
async function judgeWonder(body: JudgeBody, env: Env, oracle: Oracle) {
  const frames = Array.isArray(body.frames) ? body.frames.filter((f) => typeof f === "string" && f.length < 2_000_000).slice(0, 3) : [];
  if (frames.length < 1) throw new HttpError(400, "The judge needs frames");
  const row = await env.DB.prepare("SELECT * FROM wonders WHERE id = ?").bind(Number(body.id)).first<WonderRow>();
  if (!row) throw new HttpError(404, "There is no such wonder");
  await ensureBudget(env, oracle, "judge", ESTIMATE.judge);
  const shots = Array.isArray(body.shots) ? body.shots.map(Number).slice(0, 3) : [1, 3, 6];
  const answer = await oracle.judge({
    name: row.kind,
    kind: "artifact",
    tier: row.rarity === "legendary" ? "legendary" : "grand",
    description: `A wonder of nature (${row.rarity}) on new islands: ${row.does}. ${row.summary}`,
    facts: String(body.facts ?? "not measured").slice(0, 600),
    frames,
    shots,
    notes: [],
  });
  const judged = { ...answer, model: env.JUDGE_MODEL || "claude-haiku-5-5", at: Date.now() };
  if (!oracle.mock) await env.DB.prepare("UPDATE wonders SET judged = ? WHERE id = ?").bind(JSON.stringify(judged), row.id).run();
  return judged;
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
  // 4.4.6: the owner's account only gets a new link (a sign in on a device
  // without the passkey); pausing, revoking or deleting it would lock the
  // owner out of their own game or wipe the admin's rows.
  if (row.admin && body.action !== "relink") throw new HttpError(400, "The owner's account only takes a new link");
  // Before its passkey exists, a link to it would make the owner's account
  // (and the admin powers) for whoever opens it: it is made with the token.
  if (row.admin && !row.claimed_at) throw new HttpError(400, "Make the owner's account with a passkey first, from a device with the admin token");
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
    // 4.0: everything the account holds, as the person's own Delete does
    // (passkeys, sessions, progress, votes, ideas, wins); for a test or a
    // revoked invite. The row stays as deleted with its spend.
    case "delete":
      if (row.deleted_at) throw new HttpError(400, "This account is deleted already");
      return deleteAccount(env, row);
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
      throw new HttpError(400, "pause, resume, revoke, topup, relink or delete");
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
      claimedAt: r.claimed_at ?? null,
      deletedAt: r.deleted_at ?? null,
      owner: !!r.admin,
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
  // 4.6, measurements: write it as this kind, from this entry, storing nothing.
  form?: string;
  description?: string;
}

// Live programs the judge has not looked at, newest first, for scripts/judge-runner.mjs.
// With creatures (3.7), the live programs that bring creatures and whose
// judgment has no answer to "does it look alive?" yet, judged or not.
async function programsToJudge(env: Env, limit: number, creatures = false) {
  const where = creatures
    ? `p.status = 'live' AND p.spec LIKE '%creatures%' AND (p.judged IS NULL OR p.judged NOT LIKE '%"alive"%')`
    : `p.status = 'live' AND p.judged IS NULL`;
  const rows = await env.DB.prepare(
    `SELECT p.id, p.key, p.spec, e.name, e.tier, e.kind, e.depth FROM programs p JOIN elements e ON e.key = p.key
     WHERE ${where} ORDER BY p.id DESC LIMIT ?`,
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
  const found = await resolveInput(env.DB, body.name, oracle.mock);
  const element: GameElement = isForm(body.form) ? { ...found, form: body.form } : found;
  const key = elementKey(element.name);
  const tier = tierOf(element);
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, 600)
      : await ensureDescription(env, oracle, element, false);
  await ensureBudget(env, oracle, "spell", ESTIMATE.big);
  const model = body.model && SPELL_MODELS.has(body.model) ? body.model : spellModelFor(env, tier);
  // 4.2: the request a player's write sends (intents, the API's library),
  // so a measurement of quality measures what players get.
  const intents = await ensureIntents(env, oracle, element, description);
  const library = oracle.mock ? NO_LIBRARY : await liveLibrary(env.DB);
  const request: OracleSpellRequest = {
    name: element.name,
    kind: element.kind,
    ...shapeOf(element, description),
    description,
    recipe: await firstRecipe(env.DB, key),
    tier,
    intents,
    library: library.docs,
  };
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
      program: { ...answer, code: withLibrary(answer.code, library.helpers), ...shapeOf(element, description) },
      intents,
      examples: (request.examples ?? []).map((e) => e.name),
      calls: trial.spent.map((x) => ({ call: x.call, usd: x.usd, tokens: x.tokens })),
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
      request: {
        name: element.name,
        kind: element.kind,
        ...shapeOf(element, description),
        description,
        recipe: await firstRecipe(env.DB, key),
        tier: tierOf(element),
      },
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

// 3.4.2: promises and the growing API.

const NO_LIBRARY: Library = { docs: [], helpers: [] };

// The program as stored: the helpers it calls appended, and its promise with it.
function programFrom(answer: ProgramAnswer, intents: Intent[], library: Library, shape: { form?: Form; giant?: boolean } = {}): SpellProgram {
  const program: SpellProgram = { version: PROGRAM_VERSION, summary: answer.summary, code: withLibrary(answer.code, library.helpers) };
  if (intents.length) program.intents = intents;
  // 4.6: written for its kind, its test run holds it to that kind's size.
  if (shape.form) program.form = shape.form;
  if (shape.giant) program.giant = true;
  return program;
}

// 4.6: the kind an element's program is written for, and whether it says it
// is giant. Only a stored form: an element merged before 4.6 is written as it
// always was until the owner approves the library's sort.
function shapeOf(element: GameElement, description: string): { form?: Form; giant?: boolean } {
  if (!element.form || element.form === "spell") return {};
  return { form: element.form, ...(saysGiant(element.name, description) ? { giant: true } : {}) };
}

// What an element promises, decided once by its own small call (3.4.2). A
// failure here never stops a spell from being written: it is then written
// without a promise, as before.
async function ensureIntents(env: Env, oracle: Oracle, element: GameElement, description: string): Promise<Intent[]> {
  const key = elementKey(element.name);
  const row = await env.DB.prepare("SELECT intents FROM elements WHERE key = ?").bind(key).first<{ intents: string | null }>();
  if (row?.intents) return parseIntents(row.intents);
  const intents = (await readIntents(env, oracle, element, description)) ?? [];
  if (intents.length && !oracle.mock) await env.DB.prepare("UPDATE elements SET intents = ? WHERE key = ?").bind(intents.join(","), key).run();
  return intents;
}

// What an entry promises, asked of the small model (about $0.0001), stored
// nowhere. Null when it could not be read (the budget, the API) or says nothing.
async function readIntents(env: Env, oracle: Oracle, element: GameElement, description: string): Promise<Intent[] | null> {
  try {
    await ensureBudget(env, oracle, "intent", ESTIMATE.intent);
    const intents = await oracle.intents(element.name, element.kind, description);
    return intents.length ? intents : null;
  } catch (err) {
    console.error("intents", err);
    return null;
  }
}

// Asks the designer how the API should grow, when enough spells lacked
// something (worker/evolve.ts). Daily from the cron; at once for the admin.
// Elements made before 3.4.2 have no intents, so their programs never faced
// the probe of their promise: a Protection Spell kept a shell of blocks that
// prevented none of the harm (3.6, all nine stored protection programs failed
// the probe). A few at a time on the cron, from the stored entry, never
// writing a description: about $0.0001 each on the small model.
const INTENTS_PER_RUN = 25;
async function backfillIntents(env: Env, limit = INTENTS_PER_RUN): Promise<{ done: number; left: number }> {
  if (!env.ANTHROPIC_API_KEY) return { done: 0, left: 0 };
  const rows = await env.DB.prepare("SELECT key, name, kind, description FROM elements WHERE intents IS NULL ORDER BY created_at LIMIT ?")
    .bind(limit)
    .all<{ key: string; name: string; kind: ElementKind; description: string | null }>();
  if (!rows.results.length) return { done: 0, left: 0 };
  const oracle = oracleFor(env, {}, new Ledger(ADMIN_PAYER));
  let done = 0;
  try {
    for (const r of rows.results) {
      try {
        await ensureBudget(env, oracle, "intent", ESTIMATE.intent);
        const intents = await oracle.intents(r.name, r.kind, r.description ?? "");
        await env.DB.prepare("UPDATE elements SET intents = ? WHERE key = ? AND intents IS NULL")
          .bind(intents.join(",") || "other", r.key)
          .run();
        done++;
      } catch (err) {
        console.error("intents", r.key, err);
        break;
      }
    }
  } finally {
    await closeLedger(env.DB, oracle);
  }
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM elements WHERE intents IS NULL").first<{ n: number }>();
  return { done, left: left?.n ?? 0 };
}

// Daily 2026-11-05: one live program shown to break its promise is written again a day
// (worker/evidence.ts says which), paid by the game as the designer is, and
// through the path of a rewrite asked by votes: the daily rewrite budget, the
// cooldown, a trial tested before anyone else gets it, the old one kept.
async function rewriteByEvidence(env: Env, now = Date.now()): Promise<Record<string, unknown>> {
  if (!env.ANTHROPIC_API_KEY) return { skipped: "no API key" };
  // Nothing paid runs on its own on staging (wrangler.jsonc, env.staging): its
  // database is copied from production every night, so it would pay each day
  // for the same rewrite.
  if (env.STAGING === "1") return { skipped: "staging" };
  // A day already tried costs one row read, not the picker's scan, on the 143 runs after it.
  if ((await runsOn(env.DB, "evidence", dayInZone(now))) >= 1) return { skipped: "already tried today" };
  const found = await nextEvidence(env.DB, undefined, now);
  if (!found) return { skipped: "no evidence" };
  const element = await getElement(env.DB, found.row.key);
  if (!element) return { skipped: "unknown element" };
  // Before the day's attempt is taken: a day whose rewrites votes already
  // spent tries again at the next run, which costs nothing until it asks.
  if (await overRewriteBudget(env, tierOf(element))) return { skipped: "over the daily rewrite budget" };
  if (!(await takeRun(env.DB, "evidence", dayInZone(now), 1, now))) return { skipped: "already tried today" };
  const result = await requestRewrite(env, found.row, "evidence", found.reasons, ADMIN_PAYER);
  console.log(JSON.stringify({ evidence: found.row.key, pid: found.row.id, source: found.source, result }));
  return { key: found.row.key, pid: found.row.id, source: found.source, result };
}

async function evolve(env: Env, force: boolean): Promise<Record<string, unknown>> {
  if (!env.ANTHROPIC_API_KEY) return { skipped: "no API key" };
  if (!force && !(await designDue(env.DB))) return { skipped: "not due" };
  const gaps = await openGaps(env.DB);
  if (new Set(gaps.map((g) => g.key)).size < 3) return { skipped: "fewer than three spells lacked anything" };
  // Before the call: whatever it answers, or if it throws, the next is a day
  // away. One a Toronto day, by the increment's own answer (two overlapping runs cannot both go).
  if (!force && !(await takeRun(env.DB, "design", dayInZone(Date.now()), 1))) return { skipped: "already tried today" };
  const oracle = oracleFor(env, {}, new Ledger(ADMIN_PAYER));
  try {
    await ensureBudget(env, oracle, "design", ESTIMATE.design);
    const library = await liveLibrary(env.DB);
    const answer = await oracle.design({ gaps: gaps.map((g) => ({ id: g.id, spell: g.spell, tier: g.tier, missing: g.missing })), library: library.docs });
    const stored = await storeDesign(env.DB, answer, gaps, env.DESIGN_MODEL || env.SPELL_MODEL);
    console.log(JSON.stringify({ evolve: answer.decision, name: answer.name, ...stored }));
    return { decision: answer.decision, name: answer.name, ...stored };
  } finally {
    await closeLedger(env.DB, oracle);
  }
}

// The admin retires a helper or hint, or closes an engine proposal; the runner records its issue.
async function changeExtension(body: { id?: unknown; status?: unknown; issue?: unknown }, env: Env) {
  const id = Number(body.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Which extension?");
  if (typeof body.issue === "string" && /^https:\/\/github\.com\//.test(body.issue)) {
    await env.DB.prepare("UPDATE extensions SET issue = ? WHERE id = ?").bind(body.issue.slice(0, 300), id).run();
  }
  const allowed = ["live", "retired", "rejected", "done"];
  if (typeof body.status === "string" && allowed.includes(body.status)) {
    await env.DB.prepare("UPDATE extensions SET status = ? WHERE id = ?").bind(body.status, id).run();
  }
  return env.DB.prepare("SELECT id, kind, name, status, issue FROM extensions WHERE id = ?").bind(id).first();
}
