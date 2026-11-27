// Which statements of the admin routes and the cron read a whole table
// (26 November 2026: the account passed D1's 5,000,000 rows read a day, and
// every request failed until midnight UTC; one call of
// /api/admin/refresh-candidates read on the order of a million rows).
//
// Applies every migration to a local D1, seeds a small library
// (scripts/cron-reads.mjs), then calls each admin route the runners use and
// runs each cron job, through the Worker itself, with every statement it
// prepares written down. Each statement is then asked EXPLAIN QUERY PLAN, with
// the values it was bound to. A plan step `SCAN <table>` on a table that grows
// with play reads every row of it, at every call: those are printed, and the
// check fails on any that is not in ACCEPTED below with its reason.
//
// The statements are taken from the code as it runs, not copied by hand, so a
// new query on these routes is checked without editing this file. A route
// that is not in ROUTES is not checked: add it there.
//
//   node scripts/read-plan.mjs [--all] [--rows] [--json] [--elements 300] [--candidates 2]
//   --all: print every statement's plan, not only the scans.
//   --rows: the rows each route read, as the Worker counts them (x-rows-read).
//   --elements, --candidates: the library's size, and the refresh candidates waiting.
import { pathToFileURL } from "node:url";
import { openDb, seed, bundle } from "./cron-reads.mjs";

// Tables that grow with play: a scan of one costs more every day.
export const GROWING = ["programs", "spells", "rewrites", "elements", "spend", "looks", "votes", "perf", "casts", "recipes", "reservations"];

// The admin routes the runners call (scripts/refresh-runner.ts, looks-runner.ts,
// promise-runner.ts, judge-runner.mjs) and /api/spend. `body` may be a
// function of the seeded ids.
const ROUTES = [
  ["GET", "/api/admin/refresh-candidates?limit=300"],
  ["GET", "/api/admin/refresh-report"],
  ["POST", "/api/admin/refresh-verdict", (s) => ({ id: s.candidate, replace: false, reason: "read plan" })],
  ["POST", "/api/admin/refresh-verdict", (s) => ({ id: s.candidate2, replace: true, reason: "read plan", oldScore: 1, newScore: 2 })],
  ["POST", "/api/admin/refresh", () => ({ limit: 3 })],
  ["POST", "/api/admin/refresh", () => ({ keys: ["e1", "e2"], why: { e1: "it should burn" } })],
  ["GET", "/api/admin/looks-candidates?limit=60"],
  ["GET", "/api/admin/looks-report"],
  ["GET", "/api/admin/looks-pool?limit=500"],
  ["POST", "/api/admin/looks", () => ({ limit: 5 })],
  ["POST", "/api/admin/looks", () => ({ keys: ["e3", "e4"] })],
  ["POST", "/api/admin/looks-verdict", (s) => ({ id: s.look, tested: { ok: true }, reason: "read plan" })],
  ["POST", "/api/admin/looks-poll"],
  ["POST", "/api/admin/poll-batches"],
  ["POST", "/api/admin/judge-trial", () => ({ name: "Item 5", frames: ["x"] })],
  ["POST", "/api/admin/promise-check", () => ({ limit: 5, dry: true })],
  ["POST", "/api/admin/promise-check", () => ({ limit: 5 })],
  ["POST", "/api/admin/promise-check-poll", () => ({ batch: "msgbatch_x" })],
  ["GET", "/api/admin/promise-check-report"],
  ["GET", "/api/spend"],
];

// Scans kept on purpose: in a statement whose text contains `has`, a scan of
// `table` is allowed, for the reason given. Any other scan in it still fails,
// and a scan made once per row of an outer query never passes. Keep this list
// short; an index is the usual answer.
export const ACCEPTED = [
  {
    has: "FROM spells s JOIN elements e ON e.key = s.key WHERE s.pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rewrites r WHERE r.key = s.key AND r.cause = 'refresh'",
    table: "spells",
    why: "refresh start ranks every live item by casts: one row per item, a few thousand, once per start",
  },
  {
    has: "FROM spells s JOIN elements e ON e.key = s.key JOIN forms f ON f.key = s.key",
    table: "spells",
    why: "the rebuild by kind ranks every live item of an applied kind, once per start",
  },
  { has: "(SELECT COUNT(*) FROM casts c WHERE c.pid = s.pid) AS casts FROM spells s", table: "spells", why: "looks-pool lists the library, up to its limit" },
  {
    has: "LEFT JOIN (SELECT pid, COUNT(*) AS n FROM casts GROUP BY pid) c ON c.pid = s.pid",
    table: "spells",
    why: "the looks' bulk order ranks every live item by casts, once per start",
  },
  {
    has: "LEFT JOIN (SELECT pid, COUNT(*) AS n FROM casts GROUP BY pid) c ON c.pid = s.pid",
    table: "casts",
    why: "the same ranking counts every cast once (with casts_by_pid, one index entry per cast)",
  },
  {
    has: "LEFT JOIN (SELECT q.key, COUNT(*) AS n FROM casts c JOIN programs q ON q.id = c.pid GROUP BY q.key) cc",
    table: "spells",
    why: "the promise check picks among every live item, once per start",
  },
  {
    has: "LEFT JOIN (SELECT q.key, COUNT(*) AS n FROM casts c JOIN programs q ON q.id = c.pid GROUP BY q.key) cc",
    table: "casts",
    why: "the promise check counts every cast once per start",
  },
  {
    has: "LEFT JOIN (SELECT q.key, COUNT(*) AS n FROM casts c JOIN programs q ON q.id = c.pid GROUP BY q.key) cc",
    table: "programs",
    why: "the same count groups casts by item, through every program's key once",
  },
  {
    has: "LEFT JOIN (SELECT pid, COUNT(*) AS n FROM casts GROUP BY pid) c ON c.pid = p.id",
    table: "programs",
    why: "the evidence job's look for failed programs, once in EVIDENCE_SCAN_EVERY_MS (scanDue, worker/cron.ts)",
  },
  {
    has: "LEFT JOIN (SELECT pid, COUNT(*) AS n FROM casts GROUP BY pid) c ON c.pid = p.id",
    table: "casts",
    why: "the same look counts every cast once",
  },
  {
    has: "FROM elements e WHERE e.tier IN (?, ?, ?) AND e.depth BETWEEN ? AND ?",
    table: "elements",
    why: "the daily challenge draws one item at random, once a day",
  },
  { has: "SELECT status, pilot, COUNT(*) AS n FROM looks GROUP BY status, pilot", table: "looks", why: "the looks report counts every look by status" },
];

const ADMIN = "read-plan-admin";

// A few rows the routes act on: refresh candidates with their rewrites, a look
// waiting for its verdict, a pending batch.
async function seedRoutes(db, candidates) {
  const now = Date.now();
  const q = (sql, ...args) => db.prepare(sql).bind(...args);
  const ids = {};
  for (let i = 1; i <= Math.max(2, candidates); i++) {
    const name = i === 1 ? "candidate" : i === 2 ? "candidate2" : `c${i}`;
    const key = `e${i}`;
    const ins = await q(
      "INSERT INTO programs (key, spec, model, version, origin, status, parent, created_at) VALUES (?, '{\"code\":\"x\"}', 'm', 2, 'refresh', 'candidate', NULL, ?)",
      key,
      now,
    ).run();
    ids[name] = Number(ins.meta.last_row_id);
    await q(
      "INSERT INTO rewrites (key, from_pid, to_pid, cause, at, status, batch, model, request, dry) VALUES (?, 1, ?, 'refresh', ?, 'done', 'b1', 'm', '{}', 0)",
      key,
      ids[name],
      now,
    ).run();
  }
  await q(
    "INSERT INTO rewrites (key, from_pid, cause, at, status, batch, model, request) VALUES ('e7', 7, 'refresh', ?, 'pending', 'msgbatch_p', 'm', '{}')",
    now,
  ).run();
  const look = await q(
    "INSERT INTO looks (target, key, from_pid, status, model, old_code, new_code, at) VALUES ('program', 'e3', 3, 'candidate', 'm', 'a', 'b', ?)",
    now,
  ).run();
  ids.look = Number(look.meta.last_row_id);
  await q("INSERT INTO looks (target, key, from_pid, status, model, batch, at) VALUES ('program', 'e5', 5, 'pending', 'm', 'msgbatch_l', ?)", now).run();
  return ids;
}

// Every statement the Worker prepares, with the values it was bound to.
function recording(raw, seen) {
  const note = (sql, args) => {
    if (!seen.has(sql)) seen.set(sql, args);
  };
  const wrap = (stmt, sql, args) =>
    new Proxy(stmt, {
      get(t, k) {
        if (k === "__real") return t;
        const v = t[k];
        if (typeof v !== "function") return v;
        if (k === "bind") return (...a) => wrap(v.apply(t, a), sql, a);
        return (...a) => {
          note(sql, args);
          return v.apply(t, a);
        };
      },
    });
  return new Proxy(raw, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== "function") return v;
      if (k === "prepare") return (sql) => wrap(t.prepare(sql), sql, []);
      if (k === "batch") return (stmts) => t.batch(stmts.map((s) => s.__real ?? s));
      return v.bind(t);
    },
  });
}

const oneLine = (sql) => sql.replace(/\s+/g, " ").trim();

// Table names by the name a plan step uses: the table's own, or its alias.
const KEYWORDS = new Set([
  "where",
  "on",
  "join",
  "left",
  "inner",
  "cross",
  "group",
  "order",
  "limit",
  "using",
  "set",
  "values",
  "natural",
  "outer",
  "union",
  "select",
]);
export function aliases(sql) {
  const out = new Map();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    out.set(m[1], m[1]);
    if (m[2] && !KEYWORDS.has(m[2].toLowerCase())) out.set(m[2], m[1]);
  }
  // A subquery in FROM, `(SELECT ...) c`: its rows are counted where it reads its own table.
  for (const m of sql.matchAll(/\)\s+(?:AS\s+)?(\w+)\s+ON\b/gi)) out.set(m[1], "(subquery)");
  return out;
}

// The plan's steps that read a whole growing table: `SCAN t` (every row, or
// every entry of an index with USING INDEX), and an AUTOMATIC index, which
// SQLite builds by reading the whole table at every call. A scan under a
// CORRELATED subquery is made once per row of the outer query.
// A partial index (CREATE INDEX ... WHERE) holds only the rows its WHERE
// keeps: a scan of it reads those, not the table.
export function scansOf(sql, plan, partial = new Set()) {
  const names = aliases(sql);
  const parents = new Map(plan.map((p) => [p.id, p]));
  const correlated = (p) => {
    for (let q = parents.get(p.parent); q; q = parents.get(q.parent)) if (q.detail.startsWith("CORRELATED")) return true;
    return false;
  };
  const out = [];
  for (const step of plan) {
    const scan = /^SCAN (\w+)(?: USING (?:COVERING )?INDEX (\w+))?$/.exec(step.detail);
    if (scan?.[2] && partial.has(scan[2])) continue;
    const auto = /^SEARCH (\w+) USING AUTOMATIC (?:COVERING |PARTIAL )*INDEX/.exec(step.detail);
    const m = scan ?? auto;
    const table = m && names.get(m[1]);
    if (table && GROWING.includes(table)) out.push({ table, detail: step.detail, perRow: correlated(step) });
  }
  return out;
}

export async function plans({ elements = 300, candidates = 2 } = {}) {
  const proxy = await openDb();
  try {
    const raw = proxy.env.DB;
    await seed(raw, elements);
    const ids = await seedRoutes(raw, candidates);
    const seen = new Map();
    const DB = recording(raw, seen);
    // A key and a gateway that answers nothing: each route runs its reads, then fails at the call.
    const env = {
      ...proxy.env,
      DB,
      ADMIN_TOKEN: ADMIN,
      ANTHROPIC_API_KEY: "test",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      LOOKS: "bulk",
      CHECK_BUDGET_USD: "15",
      REFRESH_BUDGET_USD: "42",
    };
    // Node has no crypto.subtle.timingSafeEqual (a Workers extension); the admin token check uses it.
    if (!crypto.subtle.timingSafeEqual) {
      const bytes = (v) => new Uint8Array(ArrayBuffer.isView(v) ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);
      crypto.subtle.timingSafeEqual = (a, b) => {
        const x = bytes(a);
        const y = bytes(b);
        return x.length === y.length && x.every((v, i) => v === y[i]);
      };
    }
    const mod = await import(pathToFileURL(await bundle()).href);
    const pending = [];
    const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} };
    const log = console.error;
    console.error = () => {};
    const sources = new Map();
    const routes = [];
    const from = (name) => {
      for (const sql of seen.keys()) if (!sources.has(sql)) sources.set(sql, name);
    };
    try {
      for (const [method, path, body] of ROUTES) {
        const init = { method, headers: { "x-access-token": ADMIN, "content-type": "application/json" } };
        if (body) init.body = JSON.stringify(body(ids));
        const res = await mod.default.fetch(new Request(`http://local${path}`, init), env, ctx);
        await Promise.all(pending.splice(0));
        from(`${method} ${path.split("?")[0]}`);
        // The Worker's own count (worker/meter.ts).
        routes.push({ route: `${method} ${path}`, status: res.status, rowsRead: Number(res.headers.get("x-rows-read")) });
      }
      for (const [name, run] of Object.entries(mod.cronTasks(env))) {
        if (run) await run().catch(() => {});
        from(`cron: ${name}`);
      }
    } finally {
      console.error = log;
    }
    const partial = new Set(
      (await raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql LIKE '% WHERE %'").all()).results.map((r) => r.name),
    );
    const out = [];
    for (const [sql, args] of seen) {
      if (/^\s*(PRAGMA|EXPLAIN)/i.test(sql)) continue;
      let plan;
      try {
        plan = (
          await raw
            .prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .bind(...args)
            .all()
        ).results;
      } catch (e) {
        plan = [{ detail: `(no plan: ${String(e.message ?? e).slice(0, 80)})` }];
      }
      out.push({ source: sources.get(sql), sql: oneLine(sql), plan: plan.map((p) => p.detail), scans: scansOf(sql, plan, partial) });
    }
    return { statements: out, routes };
  } finally {
    await proxy.dispose();
  }
}

// Each scan of a statement, with the ACCEPTED entry that keeps it (or null).
export const judged = (q) =>
  q.scans.map((sc) => ({ ...sc, kept: sc.perRow ? null : (ACCEPTED.find((a) => a.table === sc.table && q.sql.includes(a.has)) ?? null) }));

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const arg = (k, d) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
  const { statements: all, routes } = await plans({ elements: arg("--elements", 300), candidates: arg("--candidates", 2) });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ statements: all, routes }, null, 2));
    process.exit(0);
  }
  if (process.argv.includes("--rows")) for (const r of routes) console.log(`${String(r.rowsRead).padStart(9)} rows  ${r.status}  ${r.route}`);
  let bad = 0;
  for (const q of all) {
    const verdicts = judged(q);
    const failing = verdicts.filter((v) => !v.kept).length;
    if (!q.scans.length && !process.argv.includes("--all")) continue;
    bad += failing;
    console.log(`${!q.scans.length ? "ok  " : failing ? "SCAN" : "kept"} [${q.source}] ${q.sql.slice(0, 240)}`);
    for (const d of q.plan) console.log(`       ${d}`);
    for (const v of verdicts)
      console.log(
        `    ${v.kept ? "kept" : "FAIL"} ${v.table}: ${v.detail}${v.perRow ? " (once per row of the outer query)" : ""}${v.kept ? `: ${v.kept.why}` : ""}`,
      );
  }
  console.log(`${all.length} statements, ${all.filter((q) => q.scans.length).length} scan a growing table, ${bad} scans not accepted`);
  process.exit(bad ? 1 : 0);
}
