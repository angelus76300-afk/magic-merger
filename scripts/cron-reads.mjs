// D1 rows read by each job of the ten minute cron (docs/ROADMAP.md, "D1 reads").
//
// Cloudflare's free plan allows 5,000,000 rows read a day, for the whole
// account; past it every D1 request fails until 00:00 UTC. The cron runs 144
// times a day on the live Worker and again on staging, so a job that scans a
// table each run reads that table 144 times a day.
//
// Applies every migration to a local D1 (the same engine and the same
// meta.rows_read as production), seeds a library the size you give it, runs
// each job alone and prints the rows it read per run and per day (the first
// run plus 143 like the last of six; a scan the job repeats every few hours
// adds a few more first runs). No network,
// no key, nothing is written anywhere but a temporary local database.
//
//   node scripts/cron-reads.mjs [--elements 3000] [--env staging] [--quiet] [--trace] [--json]
//   --quiet: no program failed its test run, so the evidence job finds nothing to rewrite.
//   (imported by scripts/worker-test.mjs: measure(), seed())
import { build } from "esbuild";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RUNS_A_DAY = 144;

// A library of `n` items, with the tables that grow with play in proportion.
export const sizes = (n) => ({
  elements: n,
  programs: Math.round(n * 1.5),
  rewrites: Math.round(n * 0.7),
  casts: n * 10,
  recipes: n * 6,
  votes: Math.round(n * 0.5),
  wonder_sorts: Math.round(n * 0.6),
  spend: n * 2,
  reservations: n,
  perf: n * 3,
});

export async function seed(db, n, { quiet = false } = {}) {
  const z = sizes(n);
  const run = (sql) => db.prepare(sql).run();
  const now = Date.now();
  const seq = (count) => `WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ${count}) `;
  await run(
    seq(z.elements) +
      `INSERT INTO elements (key, name, emoji, kind, depth, description, created_at, tier, invite, intents, form)
       SELECT 'e' || i, 'Item ' || i, 'x', CASE WHEN i % 3 = 0 THEN 'artifact' ELSE 'spell' END, 1 + i % 8, 'It does thing ' || i, ${now} - i * 60000,
              CASE i % 5 WHEN 0 THEN 'minor' WHEN 1 THEN 'major' WHEN 2 THEN 'grand' WHEN 3 THEN 'minor' ELSE 'legendary' END,
              'inv' || (i % 20), 'protect', NULL FROM s`,
  );
  await run(seq(z.elements) + `INSERT INTO spells (key, spec, model, created_at) SELECT 'e' || i, '{}', 'm', ${now} FROM s`);
  // Live program per item, plus older versions. A tenth of the live ones failed their test run.
  await run(
    seq(z.programs) +
      `INSERT INTO programs (key, spec, model, version, origin, status, parent, created_at, checked)
       SELECT 'e' || (1 + (i - 1) % ${z.elements}), '{"x":' || i || '}', 'm', 1, 'merge', CASE WHEN i <= ${z.elements} THEN 'live' ELSE 'old' END, NULL, ${now},
              CASE WHEN i <= ${z.elements} AND i % 10 = 0 AND ${quiet ? 0 : 1} THEN '{"ok":false,"detail":"x"}' WHEN i <= ${z.elements} THEN '{"ok":true}' END FROM s`,
  );
  await run(
    seq(z.elements) +
      `UPDATE spells SET pid = (SELECT id FROM programs p WHERE p.key = spells.key AND p.status = 'live') WHERE key IN (SELECT 'e' || i FROM s)`,
  ).catch(() => {});
  await run(
    seq(z.rewrites) +
      `INSERT INTO rewrites (key, from_pid, to_pid, cause, at, status, batch, model, invite)
       SELECT 'e' || (1 + i % ${z.elements}), 1 + i % ${z.programs}, NULL, CASE i % 3 WHEN 0 THEN 'votes' WHEN 1 THEN 'evidence' ELSE 'refresh' END,
              ${now} - i * 3600000, CASE WHEN i % 50 = 0 THEN 'failed' ELSE 'done' END, NULL, 'm', NULL FROM s`,
  );
  await run(seq(z.casts) + `INSERT INTO casts (player, pid, at) SELECT 'p' || (i / ${z.programs}), 1 + i % ${z.programs}, ${now} FROM s`);
  await run(
    seq(z.recipes) +
      `INSERT INTO recipes (pair, a, b, result, created_at) SELECT 'a' || i || '+b' || i, 'a' || i, 'b' || i, 'e' || (1 + i % ${z.elements}), ${now} FROM s`,
  );
  await run(seq(z.votes) + `INSERT INTO votes (player, pid, key, up, at) SELECT 'p' || (i % 40), i, 'e' || (1 + i % ${z.elements}), i % 2, ${now} FROM s`);
  await run(seq(z.wonder_sorts) + `INSERT INTO wonder_sorts (key, sort, at) SELECT 'e' || (i * 3), 'ordinary', ${now} FROM s WHERE i * 3 <= ${z.elements}`);
  await run(seq(z.spend) + `INSERT INTO spend (at, call, model, usd, invite) SELECT ${now} - i * 30000, 'merge', 'm', 0.002, 'inv' || (i % 20) FROM s`);
  await run(
    seq(z.reservations) + `INSERT INTO reservations (at, call, usd, invite, settled) SELECT ${now} - i * 30000, 'merge', 0.004, 'inv' || (i % 20), 1 FROM s`,
  ).catch(() => {});
  await run(
    seq(40) +
      `INSERT INTO wonders (source, kind, rarity, lands, status, created_at) SELECT 'daily', 'wonder ' || i, 'common', 'temperate', 'live', ${now} - i * 86400000 FROM s`,
  );
  await run(seq(30) + `INSERT INTO gaps (key, pid, missing, at, extension) SELECT 'e' || i, i, 'a thing', ${now}, CASE WHEN i % 2 = 0 THEN 1 END FROM s`);
  await run(
    seq(30) + `INSERT INTO daily_challenges (day, pair, result, created_at, found_at) SELECT '2026-10-' || i, 'dp' || i, 'dr' || i, ${now}, ${now} FROM s`,
  );
}

export async function bundle(entry = "worker/index.ts") {
  const dir = mkdtempSync(join(tmpdir(), "mm-reads-"));
  const out = join(dir, "bundle.mjs");
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    external: ["cloudflare:*", "node:*"],
    logLevel: "error",
  });
  return out;
}

async function migrate(db, split) {
  for (const f of readdirSync(join(root, "migrations")).sort()) {
    for (const stmt of split(readFileSync(join(root, "migrations", f), "utf8"))) {
      const sql = stmt.replace(/--.*$/gm, "").trim();
      if (sql) await db.prepare(sql).run();
    }
  }
}

// Rows read by one run of each job, in a database of `elements` items.
// A local D1 with every migration applied: { env, dispose }, env as the Worker's.
export async function openDb({ environment } = {}) {
  const { getPlatformProxy, unstable_splitSqlQuery } = await import("wrangler");
  const proxy = await getPlatformProxy({
    configPath: join(root, "wrangler.jsonc"),
    environment,
    persist: { path: mkdtempSync(join(tmpdir(), "mm-reads-db-")) },
  });
  await migrate(proxy.env.DB, unstable_splitSqlQuery);
  return proxy;
}

export async function measure({ elements = 3000, environment, extra = {}, quiet = false } = {}) {
  const proxy = await openDb({ environment });
  try {
    await seed(proxy.env.DB, elements, { quiet });
    // Counts what each statement reads, whichever job asked.
    let reads = 0;
    const byQuery = new Map();
    const note = (sql, n) => {
      reads += n;
      const key = sql.replace(/\s+/g, " ").slice(0, 110);
      byQuery.set(key, (byQuery.get(key) ?? 0) + n);
    };
    const counting = (stmt, sql) =>
      new Proxy(stmt, {
        get(t, k) {
          if (k === "__real") return t;
          if (k === "__sql") return sql;
          const v = t[k];
          if (typeof v !== "function") return v;
          // first() drops the metadata: read it through all(), which keeps it.
          if (k === "first")
            return async (col) => {
              const x = await t.all();
              note(sql, x.meta?.rows_read ?? 0);
              const row = x.results[0] ?? null;
              return col && row ? row[col] : row;
            };
          return (...a) => {
            const r = v.apply(t, a);
            if (k === "bind") return counting(r, sql);
            if (r && typeof r.then === "function")
              return r.then((x) => {
                note(sql, x?.meta?.rows_read ?? 0);
                return x;
              });
            return r;
          };
        },
      });
    const DB = new Proxy(proxy.env.DB, {
      get(t, k) {
        const v = t[k];
        if (typeof v !== "function") return v;
        if (k === "prepare") return (sql) => counting(t.prepare(sql), sql);
        if (k === "batch")
          return async (stmts) => {
            const r = await t.batch(stmts.map((s) => s.__real ?? s));
            r.forEach((x, i) => note(stmts[i].__sql ?? "batch", x?.meta?.rows_read ?? 0));
            return r;
          };
        return v.bind(t);
      },
    });
    // A key and a gateway that answers nothing: the reads before any call are what is counted.
    const env = { ...proxy.env, DB, ANTHROPIC_API_KEY: "test", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ...extra };
    const { cronTasks } = await import(pathToFileURL(await bundle()).href);
    const out = {};
    const log = console.error;
    console.error = () => {};
    for (const [name, run] of Object.entries(cronTasks(env))) {
      if (!run) {
        out[name] = null;
        continue;
      }
      // Six runs: the first may do the day's work, the last is what the 143 others cost.
      for (let i = 0; i < 6; i++) {
        reads = 0;
        byQuery.clear();
        const v = await run().catch((e) => {
          if (process.argv.includes("--trace")) process.stderr.write(`${name}: ${String(e).slice(0, 200)}\n`);
        });
        if (i === 0) {
          out[name] = { first: reads };
          if (process.argv.includes("--trace")) process.stderr.write(`${name} -> ${JSON.stringify(v)?.slice(0, 160)}\n`);
        }
        if (i === 5) out[name] = { ...out[name], later: reads, top: [...byQuery].sort((a, b) => b[1] - a[1]).slice(0, 3) };
      }
    }
    console.error = log;
    return out;
  } finally {
    await proxy.dispose();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
  const elements = Number(arg("--elements", 3000));
  const environment = arg("--env", undefined);
  const res = await measure({ elements, environment, quiet: process.argv.includes("--quiet") });
  if (process.argv.includes("--json"))
    console.log(JSON.stringify({ elements, sizes: sizes(elements), environment: environment ?? "production", jobs: res }, null, 2));
  else {
    console.log(`${environment ?? "production"}, ${elements} items (${JSON.stringify(sizes(elements))})`);
    let total = 0;
    for (const [name, r] of Object.entries(res)) {
      if (!r) {
        console.log(`${name.padEnd(22)} off`);
        continue;
      }
      const day = r.first + r.later * (RUNS_A_DAY - 1);
      total += day;
      console.log(`${name.padEnd(22)} first ${String(r.first).padStart(8)}   later ${String(r.later).padStart(8)}   a day ${String(day).padStart(10)}`);
      if (process.argv.includes("--trace")) for (const [q, n] of r.top) if (n) console.log(`    ${String(n).padStart(7)}  ${q}`);
    }
    console.log(`${"all jobs".padEnd(22)} a day ${String(total).padStart(10)} (of 5,000,000)`);
  }
}
