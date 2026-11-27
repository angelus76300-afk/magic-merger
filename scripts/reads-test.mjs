// D1's rows read (26 November 2026: the account passed the free 5,000,000 a
// day and every request failed until midnight UTC).
//
// 1. No statement of the admin routes or the cron scans a table that grows,
//    unless scripts/read-plan.mjs keeps it with its reason; a new query
//    without an index fails here.
// 2. The meter (worker/meter.ts) changes no result: first(), first(column),
//    all(), run() and batch() answer as on the bare database, and the rows
//    each read are counted.
// 3. scripts/admin-api.ts adds up x-rows-read, prints the run's total at the
//    end, and stops with exit code 3, without retrying, on a 429 code "reads"
//    or past MM_READS_MAX.
//
//   npm run test:worker
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { plans, judged } from "./read-plan.mjs";
import { openDb, seed } from "./cron-reads.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const expect = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const tmp = mkdtempSync(join(tmpdir(), "mm-reads-test-"));
const bundled = async (entry) => {
  const out = join(tmp, entry.replace(/\W/g, "_") + ".mjs");
  await build({ entryPoints: [join(root, entry)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
  return out;
};

// 1. The plans.
{
  const { statements, routes } = await plans();
  const bad = statements.flatMap((q) =>
    judged(q)
      .filter((v) => !v.kept)
      .map((v) => `[${q.source}] ${v.table}: ${v.detail} in ${q.sql.slice(0, 120)}`),
  );
  expect(`read plan: ${statements.length} statements, none scans a growing table unless kept`, bad.length === 0, bad.join("; "));
  expect("read plan: the routes and the cron were reached", statements.length > 40 && routes.length > 15, `${statements.length} statements`);
  const cands = routes.find((r) => r.route.startsWith("GET /api/admin/refresh-candidates"));
  expect("read plan: the Worker counts what refresh-candidates read", cands?.status === 200 && cands.rowsRead > 0, JSON.stringify(cands));
}

// 2. The meter.
{
  const { Meter, metered } = await import(pathToFileURL(await bundled("worker/meter.ts")).href);
  const proxy = await openDb();
  try {
    const raw = proxy.env.DB;
    await seed(raw, 200);
    const meter = new Meter();
    const db = metered(raw, meter);
    const same = async (name, f) => {
      const [a, b] = [await f(raw), await f(db)];
      expect(
        `meter: ${name} answers as the bare database`,
        JSON.stringify(a) === JSON.stringify(b),
        `${JSON.stringify(a)?.slice(0, 80)} / ${JSON.stringify(b)?.slice(0, 80)}`,
      );
    };
    await same("first()", (d) => d.prepare("SELECT key, name FROM elements ORDER BY key").first());
    await same("first(column)", (d) => d.prepare("SELECT name FROM elements WHERE key = ?").bind("e7").first("name"));
    await same("first() of nothing", (d) => d.prepare("SELECT name FROM elements WHERE key = ?").bind("none").first());
    await same("first(column) of nothing", (d) => d.prepare("SELECT name FROM elements WHERE key = ?").bind("none").first("name"));
    await same("all()", async (d) => (await d.prepare("SELECT key FROM elements WHERE depth = ? ORDER BY key").bind(3).all()).results);
    const missing = async (d) =>
      d
        .prepare("SELECT name FROM elements WHERE key = 'e1'")
        .first("nope")
        .then(
          () => "answered",
          () => "threw",
        );
    await same("first() of a column it does not have", missing);
    meter.read = 0;
    await db.prepare("SELECT COUNT(*) AS n FROM elements WHERE description LIKE '%9%'").first();
    expect("meter: a scan through first() is counted", meter.read >= 200, `${meter.read}`);
    meter.read = 0;
    meter.written = 0;
    const ran = await db.prepare("UPDATE elements SET emoji = 'y' WHERE key = 'e1'").run();
    expect("meter: run() keeps its meta and counts the row written", ran.meta.changes === 1 && meter.written >= 1, `${meter.written}`);
    meter.read = 0;
    const res = await db.batch([db.prepare("SELECT COUNT(*) AS n FROM elements"), db.prepare("SELECT name FROM elements WHERE key = ?").bind("e2")]);
    expect(
      "meter: batch() takes metered statements and counts each",
      res[0].results[0].n === 200 && res[1].results[0].name === "Item 2" && meter.read >= 200,
      `${meter.read}`,
    );
  } finally {
    await proxy.dispose();
  }
}

// 3. The runners' helper.
{
  const server = createServer((req, res) => {
    if (req.url === "/a") return res.writeHead(200, { "content-type": "application/json", "x-rows-read": "7" }).end("{}");
    if (req.url === "/busy")
      return res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: "x", code: "reads", rowsRead: 9, limit: 10 }));
    return res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "down" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const helper = await bundled("scripts/admin-api.ts");
  const script = join(tmp, "run.mjs");
  writeFileSync(
    script,
    `import { adminApi } from ${JSON.stringify(pathToFileURL(helper).href)};
     const api = adminApi(${JSON.stringify(base)}, "t", { retries: 3 });
     for (const p of process.argv.slice(2)) { await api(p); console.log("done " + p); }`,
  );
  const run = (env, ...paths) =>
    new Promise((resolve) => {
      // Not spawnSync: it would block the server above.
      const child = spawn(process.execPath, [script, ...paths], { env: { ...process.env, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1", ...env } });
      let out = "";
      let err = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (err += c));
      child.on("close", (code) => resolve({ code, out, err }));
    });
  const busy = await run({}, "/a", "/a", "/busy", "/a");
  expect(
    "admin-api: a 429 code reads stops the run with code 3, at once, and the total is printed",
    busy.code === 3 && busy.out.trim().split("\n").length === 2 && /D1 rows read by this run: 14 in 3 admin requests/.test(busy.err),
    JSON.stringify(busy),
  );
  const capped = await run({ MM_READS_MAX: "10" }, "/a", "/a", "/a");
  expect(
    "admin-api: past MM_READS_MAX the run stops before its next request",
    capped.code === 3 && capped.out.trim().split("\n").length === 2 && /14 in 2 admin requests/.test(capped.err),
    JSON.stringify(capped),
  );
  const fine = await run({}, "/a");
  expect("admin-api: a run that ends prints its total", fine.code === 0 && /7 in 1 admin requests/.test(fine.err), JSON.stringify(fine));
  server.close();
}

if (failed) {
  console.log(`\n${failed} reads checks failed`);
  process.exit(1);
}
console.log("\nall reads checks passed");
