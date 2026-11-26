// The promise check (25 November 2026, the owner in the lead session: "an Opus check of the
// most-cast spells, which flags those that don't do what their name says ... we can probably
// review even more things this way"). Opus reads an item's name, entry, tier, kind, the
// writer's summary, its last test run and its program, and says whether the program does what
// the name promises: yes, partly or no, what is missing, and a one-line fix.
//
// It only reads and reports: nothing is rewritten, stored or served. The runner
// (scripts/promise-runner.ts) writes the verdicts to docs/measurements/; the lead session decides
// what to rewrite, through the refresh, as for any rewrite.
//
// Money: the Batch API at half price, the shared system part (the checker's rules and the World
// API the programs are written against) cached for an hour. Billed in the ledger as
// 'promise-check' (invite 'admin'), inside BUDGET_USD, and under its own CHECK_BUDGET_USD a month
// ("0" or unset: off). Each batch holds its estimate in `reservations` until its answers are
// billed; the hold carries the batch id in its `req`, so the poll needs nothing else.
import Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "./http";
import { ADMIN_PAYER, Ledger, hold, monthKey, monthStart } from "./ledger";
import { logUsage, type Effort } from "./oracle";
import { SPELL_SYSTEM } from "./prompts";
import { FORMS } from "../shared/forms";
import { isTier, tierFromDepth } from "../shared/tiers";

export interface PromiseEnv {
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  BUDGET_USD?: string;
  // Dollars a month the promise check may spend, inside BUDGET_USD. Unset or "0": off.
  CHECK_BUDGET_USD?: string;
  CHECK_MODEL?: string;
  CHECK_EFFORT?: string;
}

export const CHECK_CALL = "promise-check";
// Held per item before a batch is sent: about 10,000 tokens in (the cached system part counted
// in full, as a miss) and 3,000 out with thinking, at Opus 5.5 batch prices ($2 and $10 a
// million). A cache hit and a short answer cost about a third of it.
export const CHECK_ESTIMATE = 0.05;
const MAX_CODE = 24_000;

export function checkBudget(env: PromiseEnv): number {
  const v = Number(env.CHECK_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function gameBudget(env: PromiseEnv): number {
  const v = Number(env.BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : 50;
}

function checkModel(env: PromiseEnv): string {
  return env.CHECK_MODEL || "claude-opus-5-5";
}

function checkEffort(env: PromiseEnv): Effort {
  const e = env.CHECK_EFFORT;
  return e === "low" || e === "medium" || e === "high" ? e : "medium";
}

export const CHECK_SYSTEM = `You check the items of Magic Merger, a crafting game about magic, for one thing: does each item's program do what its name and grimoire entry promise a player?

A player merges two items into a new one, reads its name and entry, and casts it (a spell) or places it (an object, a creature, a place, a settlement, a wonder) on a small simulated island of voxels with hills, lakes, a river, forests, fields and villages of tiny people. What happens on the island is the item's program: JavaScript written against the World API below, by another model. A player who casts "Healing Rain" and sees fire, or casts "Summon Wolves" and sees one flash, feels cheated. You find those.

For each item you get its name, kind, tier (cantrip, minor, major, grand, legendary, cosmic: how big its effect should be), its entry, what it promises (intents), the writer's one-line summary, the last test run in the game's own simulator when there is one (what it changed on the island: cells, creatures, fire, how long), and the program.

Read the program as the simulator would run it. Then answer:
- verdict: "yes" when a player who knows only the name and entry would say it does that; "partly" when it does the main thing but misses something the name makes central (a "storm" with no wind or rain, a "guardian" that never guards, a "curse" that harms nothing) or is far too small or too big for its tier; "no" when what a player sees is not what the name says (wrong element, nothing visible, only a flash or a sound, a creature that never appears, a protection that protects nothing).
- promise: what the name and entry promise, in one short line.
- does: what the program really does on the island, in one short line, from the code (and the test run when given).
- missing: what is missing or wrong, in one short line; empty when the verdict is "yes".
- fix: a one-line suggestion for the rewrite (what to add, change or remove, in the World API's terms); empty when the verdict is "yes".

Judge the promise, not the style. A plain program that does what it says is "yes". Do not ask for more spectacle than the tier calls for. Never invent what the code does not do. Answer in the JSON schema only.

The World API the programs are written against, exactly as the writer was told:

${SPELL_SYSTEM}`;

const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "promise", "does", "missing", "fix"],
  properties: {
    verdict: { type: "string", enum: ["yes", "partly", "no"] },
    promise: { type: "string" },
    does: { type: "string" },
    missing: { type: "string" },
    fix: { type: "string" },
  },
};

export interface CheckItem {
  // "p<program id>" for an item's program, "w<wonder id>" for a wonder: the batch's custom id.
  id: string;
  key: string | null;
  name: string;
  kind: string;
  tier: string;
  entry: string;
  intents: string;
  summary: string;
  test: string;
  code: string;
  casts: number;
}

export interface CheckVerdict {
  verdict: "yes" | "partly" | "no";
  promise: string;
  does: string;
  missing: string;
  fix: string;
}

export function checkMessage(item: CheckItem): string {
  return [
    `Name: ${item.name}`,
    `Kind: ${item.kind}`,
    `Tier: ${item.tier}`,
    `Entry: ${item.entry || "(none)"}`,
    `Promises: ${item.intents || "(not read)"}`,
    `Writer's summary: ${item.summary || "(none)"}`,
    `Last test run: ${item.test || "(none stored)"}`,
    "",
    "Program:",
    item.code.length > MAX_CODE ? `${item.code.slice(0, MAX_CODE)}\n// (cut at ${MAX_CODE} characters)` : item.code,
  ].join("\n");
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function readVerdict(text: string): CheckVerdict | null {
  try {
    const a = JSON.parse(text) as Record<string, unknown>;
    if (a.verdict !== "yes" && a.verdict !== "partly" && a.verdict !== "no") return null;
    return { verdict: a.verdict, promise: str(a.promise, 300), does: str(a.does, 300), missing: str(a.missing, 300), fix: str(a.fix, 300) };
  } catch {
    return null;
  }
}

// What the last test run said, short: its verdict, problem and numbers.
function testOf(checked: string | null): string {
  if (!checked) return "";
  try {
    const c = JSON.parse(checked) as { ok?: unknown; problem?: unknown; detail?: unknown; stats?: unknown };
    const parts = [c.ok === true ? "passed" : c.ok === false ? `failed (${String(c.problem ?? "")})` : ""];
    if (typeof c.detail === "string" && c.detail) parts.push(c.detail);
    if (c.stats && typeof c.stats === "object") parts.push(`numbers: ${JSON.stringify(c.stats)}`);
    return parts.filter(Boolean).join("; ").slice(0, 900);
  } catch {
    return "";
  }
}

function codeOf(spec: string): string {
  try {
    return String((JSON.parse(spec) as { code?: unknown }).code ?? "");
  } catch {
    return "";
  }
}

function summaryOf(spec: string): string {
  try {
    return str((JSON.parse(spec) as { summary?: unknown }).summary, 300);
  } catch {
    return "";
  }
}

// The kinds an item can be picked by: its sorted kind (shared/forms.ts), else spell or object.
export const CHECK_KINDS = [...FORMS, "wonder"] as const;

export interface PickBody {
  keys?: unknown;
  kinds?: unknown;
  offset?: unknown;
  limit?: unknown;
}

// The items to check, most cast first: live programs of the kinds asked (all when none), and
// live wonders when "wonder" is asked. Read only.
export async function pickItems(db: D1Database, body: PickBody): Promise<CheckItem[]> {
  const limit = Math.max(1, Math.min(200, Number(body.limit) || 50));
  const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k): k is string => typeof k === "string" && (CHECK_KINDS as readonly string[]).includes(k)) : [];
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string").map((k) => k.trim().toLowerCase()) : [];
  const programKinds = kinds.filter((k) => k !== "wonder");
  const items: CheckItem[] = [];
  if (!kinds.length || programKinds.length || keys.length) {
    const rows = await db
      .prepare(
        `SELECT p.id, p.spec, p.checked, e.key, e.name, e.kind, e.form, e.tier, e.depth, e.description, e.intents, COALESCE(cc.n, 0) AS casts
         FROM spells s JOIN programs p ON p.id = s.pid JOIN elements e ON e.key = s.key
           -- Counted in one pass: casts has no index on pid.
           LEFT JOIN (SELECT q.key, COUNT(*) AS n FROM casts c JOIN programs q ON q.id = c.pid GROUP BY q.key) cc ON cc.key = s.key
         WHERE (?1 = '[]' OR s.key IN (SELECT value FROM json_each(?1)))
           AND (?2 = '[]' OR COALESCE(e.form, CASE WHEN e.kind = 'artifact' THEN 'object' ELSE 'spell' END) IN (SELECT value FROM json_each(?2)))
         ORDER BY casts DESC, s.key LIMIT ?3 OFFSET ?4`,
      )
      .bind(JSON.stringify(keys), JSON.stringify(keys.length ? [] : programKinds), limit, offset)
      .all<{
        id: number;
        spec: string;
        checked: string | null;
        key: string;
        name: string;
        kind: string;
        form: string | null;
        tier: string | null;
        depth: number;
        description: string | null;
        intents: string | null;
        casts: number;
      }>();
    for (const r of rows.results) {
      const code = codeOf(r.spec);
      if (!code) continue;
      items.push({
        id: `p${r.id}`,
        key: r.key,
        name: r.name,
        kind: r.form ?? (r.kind === "artifact" ? "object" : "spell"),
        tier: isTier(r.tier) ? r.tier : tierFromDepth(r.depth),
        entry: r.description ?? "",
        intents: r.intents ?? "",
        summary: summaryOf(r.spec),
        test: testOf(r.checked),
        code,
        casts: r.casts,
      });
    }
  }
  if (!keys.length && kinds.includes("wonder")) {
    const room = limit - items.length;
    const rows =
      room > 0
        ? await db
            .prepare("SELECT id, kind, rarity, does, summary, code FROM wonders WHERE status = 'live' ORDER BY id LIMIT ? OFFSET ?")
            .bind(room, programKinds.length ? 0 : offset)
            .all<{ id: number; kind: string; rarity: string; does: string; summary: string; code: string }>()
        : { results: [] };
    for (const w of rows.results)
      items.push({
        id: `w${w.id}`,
        key: null,
        name: w.kind.replace(/\b\w/g, (c) => c.toUpperCase()),
        kind: "wonder",
        tier: `${w.rarity} wonder`,
        entry: w.summary,
        intents: w.does,
        summary: w.does,
        test: "",
        code: w.code,
        casts: 0,
      });
  }
  return items;
}

// This month's spend of the check, and what its batches still hold.
async function checkSpent(db: D1Database, now = Date.now()): Promise<{ spent: number; held: number }> {
  const s = await db
    .prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM spend WHERE call = ? AND at >= ?")
    .bind(CHECK_CALL, monthStart(now))
    .first<{ usd: number }>();
  const h = await db.prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM reservations WHERE call = ? AND settled = 0").bind(CHECK_CALL).first<{ usd: number }>();
  return { spent: s?.usd ?? 0, held: h?.usd ?? 0 };
}

function clientOf(env: PromiseEnv): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(400, "The promise check needs the Claude API");
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL, maxRetries: 2 });
}

export function checkParams(env: PromiseEnv, item: CheckItem) {
  return {
    model: checkModel(env),
    max_tokens: 8000,
    output_config: { effort: checkEffort(env), format: { type: "json_schema" as const, schema: CHECK_SCHEMA } },
    // The same for every item: cached for an hour, shared by the batch's items.
    system: [{ type: "text" as const, text: CHECK_SYSTEM, cache_control: { type: "ephemeral" as const, ttl: "1h" as const } }],
    messages: [{ role: "user" as const, content: checkMessage(item) }],
  };
}

const brief = ({ id, key, name, kind, tier, casts }: CheckItem) => ({ id, key, name, kind, tier, casts });

// Sends one batch of the items picked, within both caps, and holds its estimate.
export async function startCheck(env: PromiseEnv, body: PickBody & { dry?: unknown }) {
  const cap = checkBudget(env);
  if (cap <= 0) throw new HttpError(409, "The promise check is off (CHECK_BUDGET_USD)");
  const items = await pickItems(env.DB, body);
  const { spent, held } = await checkSpent(env.DB);
  const room = cap - spent - held;
  const fit = Math.max(0, Math.min(items.length, Math.floor((room + 1e-9) / CHECK_ESTIMATE)));
  const sent = items.slice(0, fit);
  const base = { picked: items.length, fit, room: Math.round(room * 100) / 100, cap };
  // A dry run lists every item picked, the ones past the room too; it sends nothing.
  if (body.dry === true) return { ...base, batch: null, items: items.map(brief) };
  if (!sent.length) return { ...base, batch: null, items: [] };
  const client = clientOf(env);
  const ledger = new Ledger(ADMIN_PAYER);
  // Inside the game's month: refused, like any call, when BUDGET_USD has no room for it.
  const holdId = await hold(env.DB, ledger, CHECK_CALL, sent.length * CHECK_ESTIMATE, gameBudget(env));
  let batch: string;
  try {
    const b = await client.beta.messages.batches.create({
      requests: sent.map((item) => ({ custom_id: item.id, params: checkParams(env, item) })),
    });
    batch = b.id;
  } catch (err) {
    await env.DB.prepare("UPDATE reservations SET settled = 1 WHERE id = ?").bind(holdId).run();
    throw err;
  }
  await env.DB.prepare("UPDATE reservations SET req = ? WHERE id = ?").bind(batch, holdId).run();
  return {
    ...base,
    batch,
    estimate: Math.round(sent.length * CHECK_ESTIMATE * 100) / 100,
    items: sent.map(brief),
  };
}

export interface CheckOutcome {
  id: string;
  verdict: CheckVerdict | null;
  error?: string;
  usd: number;
}

// A batch's answers once it has ended (null before), billed once: the first poll after the end
// settles its hold and writes what it cost to `spend`; a later poll reads the answers again and
// bills nothing.
export async function pollCheck(env: PromiseEnv, batch: string): Promise<{ ended: boolean; billed: number; outcomes: CheckOutcome[] }> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(batch)) throw new HttpError(400, "Name the batch");
  const client = clientOf(env);
  const b = await client.beta.messages.batches.retrieve(batch);
  if (b.processing_status !== "ended") return { ended: false, billed: 0, outcomes: [] };
  const outcomes: CheckOutcome[] = [];
  const spent: { model: string; usd: number }[] = [];
  for await (const item of await client.beta.messages.batches.results(batch)) {
    const r = item.result;
    if (r.type !== "succeeded") {
      outcomes.push({ id: item.custom_id, verdict: null, error: r.type === "errored" ? JSON.stringify(r.error).slice(0, 300) : r.type, usd: 0 });
      continue;
    }
    const cost = logUsage(CHECK_CALL, r.message, 0.5);
    spent.push({ model: cost.model, usd: cost.usd });
    const text = r.message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const verdict = readVerdict(text);
    outcomes.push({ id: item.custom_id, verdict, ...(verdict ? {} : { error: "the answer did not match the schema" }), usd: cost.usd });
  }
  // Billed once: only the poll that settles the batch's hold writes its spend.
  const settled = await env.DB.prepare("UPDATE reservations SET settled = 1 WHERE req = ? AND call = ? AND settled = 0").bind(batch, CHECK_CALL).run();
  let billed = 0;
  if (settled.meta.changes && spent.length) {
    const at = Date.now();
    await env.DB.batch(
      spent.map((s) => env.DB.prepare("INSERT INTO spend (at, call, model, usd, invite) VALUES (?, ?, ?, ?, 'admin')").bind(at, CHECK_CALL, s.model, s.usd)),
    );
    billed = spent.reduce((a, s) => a + s.usd, 0);
  }
  return { ended: true, billed: Math.round(billed * 10000) / 10000, outcomes };
}

// What the check spent this month, held and may still spend.
export async function checkReport(env: PromiseEnv) {
  const { spent, held } = await checkSpent(env.DB);
  const cap = checkBudget(env);
  return {
    month: monthKey(),
    cap,
    spent: Math.round(spent * 10000) / 10000,
    held: Math.round(held * 100) / 100,
    room: Math.round((cap - spent - held) * 100) / 100,
  };
}
