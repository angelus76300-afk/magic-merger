// The budget hold's D1 reads (4.7, docs/DESIGN.md "The hold reads running
// totals"). The hold summed every `spend` row of the month on each paid call:
// 4,205 rows per call on 10 November, 47% of all rows read, growing with the
// month. It now reads `spend_totals`, kept by triggers on `spend`.
//
// On a local D1 (every migration applied, the same engine and meta.rows_read
// as production): one hold reads the same few rows with 10 ledger rows and
// with 5,000; it refuses at the same amounts as the old sum over the ledger,
// for the month's budget and for an invite's allowance; and a total that
// drifted from the ledger is found by the cron's check and rebuilt.
//
//   node scripts/budget-reads-test.mjs [--ledger path/to/ledger.ts]
//   --ledger: measure another ledger.ts (the one on main, for the before).
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb } from "./cron-reads.mjs";

let failed = 0;
const expect = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

const arg = process.argv.includes("--ledger") ? process.argv[process.argv.indexOf("--ledger") + 1] : "worker/ledger.ts";
const out = join(mkdtempSync(join(tmpdir(), "mm-budget-")), "ledger.mjs");
await build({ entryPoints: [resolve(arg)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const L = await import(pathToFileURL(out).href);

const proxy = await openDb();
const raw = proxy.env.DB;
let reads = 0;
const counted = (stmt) =>
  new Proxy(stmt, {
    get(t, k) {
      if (k === "__real") return t;
      const v = t[k];
      if (typeof v !== "function") return v;
      if (k === "bind") return (...a) => counted(v.apply(t, a));
      if (k === "first")
        return async (col) => {
          const x = await t.all();
          reads += x.meta?.rows_read ?? 0;
          const row = x.results[0] ?? null;
          return col && row ? row[col] : row;
        };
      if (k === "run" || k === "all")
        return async (...a) => {
          const x = await v.apply(t, a);
          reads += x.meta?.rows_read ?? 0;
          return x;
        };
      return v.bind(t);
    },
  });
const db = new Proxy(raw, {
  get(t, k) {
    if (k === "prepare") return (sql) => counted(t.prepare(sql));
    if (k === "batch")
      return async (list) => {
        const r = await t.batch(list.map((s) => s.__real ?? s));
        for (const x of r) reads += x?.meta?.rows_read ?? 0;
        return r;
      };
    const v = t[k];
    return typeof v === "function" ? v.bind(t) : v;
  },
});

const now = Date.now();
const BUDGET = 50;
const seq = (n) => `WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ${n}) `;
// `n` ledger rows of this month, spread over 20 invites and the admin.
const addSpend = (n, from = 0) =>
  raw
    .prepare(
      seq(n) +
        `INSERT INTO spend (at, call, model, usd, invite)
         SELECT ?1 + (i + ?2) % 1000, 'merge', 'm', 0.0001, CASE WHEN i % 21 = 0 THEN 'admin' ELSE 'inv' || (i % 20) END FROM s`,
    )
    .bind(L.monthStart(now), from)
    .run();
const payer = (invite, cap) => ({ invite, name: invite, status: "active", cap });
const clear = () => raw.batch([raw.prepare("DELETE FROM spend"), raw.prepare("DELETE FROM reservations"), raw.prepare("DELETE FROM spend_totals")]);
const ledger = (p) => {
  const l = new L.Ledger(p);
  l.burstFree = true;
  return l;
};
// One hold and its release, as a request without a Claude answer would: what it read.
async function holdReads(p) {
  const l = ledger(p);
  reads = 0;
  await L.hold(db, l, "merge", 0.004, BUDGET, now);
  const r = reads;
  await L.settle(raw, l, []);
  return r;
}

try {
  await clear();
  // (b) What one paid call's budget check reads, by the size of the ledger.
  await addSpend(10);
  // The table's first AUTOINCREMENT row reads one row fewer (no sqlite_sequence entry yet): not counted.
  await holdReads(payer("admin", null));
  const small = { game: await holdReads(payer("admin", null)), invite: await holdReads(payer("inv3", 5)) };
  reads = 0;
  await L.spentBy(db, "inv3", now);
  const healthSmall = reads;
  await addSpend(4990, 10);
  const big = { game: await holdReads(payer("admin", null)), invite: await holdReads(payer("inv3", 5)) };
  reads = 0;
  await L.spentBy(db, "inv3", now);
  const healthBig = reads;
  console.log(`# rows read by one hold: 10 ledger rows ${JSON.stringify(small)}, 5,000 ledger rows ${JSON.stringify(big)}`);
  console.log(`# rows read by an invite's spend (health): ${healthSmall} and ${healthBig}`);
  expect("a hold reads as many rows with 5,000 ledger rows as with 10", small.game === big.game && small.invite === big.invite, JSON.stringify({ small, big }));
  expect("a hold reads under 20 rows", big.game < 20 && big.invite < 20, JSON.stringify(big));
  expect("an invite's month spend reads under 20 rows, whatever the ledger", healthBig < 20 && healthBig === healthSmall, `${healthSmall}, ${healthBig}`);

  // (a) The same refusals as the sum over the ledger, at the same amounts.
  // The old rule, evaluated against `spend` itself: would this hold pass?
  const oldRule = async (invite, cap, usd) => {
    const row = await raw
      .prepare(
        `SELECT (SELECT COALESCE(SUM(usd), 0) FROM spend WHERE at >= ?1)
              + (SELECT COALESCE(SUM(usd), 0) FROM reservations WHERE settled = 0) + ?2 <= ?3
            AND (?4 IS NULL OR (SELECT COALESCE(SUM(usd), 0) FROM spend WHERE invite = ?5 AND at >= ?1)
              + (SELECT COALESCE(SUM(usd), 0) FROM reservations WHERE settled = 0 AND invite = ?5) + ?2 <= ?4) AS ok`,
      )
      .bind(L.monthStart(now), usd, BUDGET, cap, invite)
      .first();
    return !!row.ok;
  };
  const verdict = async (p, usd) => {
    try {
      const l = ledger(p);
      await L.hold(db, l, "merge", usd, BUDGET, now);
      await L.settle(raw, l, []);
      return "ok";
    } catch (e) {
      return e.code ?? String(e);
    }
  };
  let same = 0;
  const differ = [];
  // The month at $49.995 (the concurrency test's seed), last month's spend
  // that must not count, an open hold of someone else, and Kit near its cap.
  await clear();
  await raw
    .prepare("INSERT INTO spend (at, call, model, usd, invite) VALUES (?, 'seed', 'none', ?, 'admin')")
    .bind(now, BUDGET - 0.005 - 0.6)
    .run();
  await raw
    .prepare("INSERT INTO spend (at, call, model, usd, invite) VALUES (?, 'old', 'none', 30, 'kit')")
    .bind(L.monthStart(now) - 1)
    .run();
  await raw.prepare("INSERT INTO spend (at, call, model, usd, invite) VALUES (?, 'merge', 'm', 0.5, 'kit')").bind(now).run();
  await raw.prepare("INSERT INTO reservations (req, invite, call, at, usd) VALUES ('other', 'zed', 'merge', ?, 0.1)").bind(now).run();
  for (const cap of [0.5005, 0.504, 0.51, 1, 5, null])
    for (const usd of [0.0001, 0.003, 0.004, 0.0049, 0.005, 0.0051, 0.01, 0.15]) {
      const p = payer(cap === null ? "admin" : "kit", cap);
      const before = await oldRule(p.invite, cap, usd);
      const now2 = await verdict(p, usd);
      const want = before ? "ok" : cap !== null && 0.5 + usd > cap ? "spent" : "budget";
      if (now2 === want) same++;
      else differ.push({ cap, usd, before: want, now: now2 });
    }
  expect(
    "the hold passes and refuses (budget, spent) where the sum over the ledger did, at 48 amounts",
    differ.length === 0 && same === 48,
    JSON.stringify(differ),
  );
  {
    // The edge itself: $0.005 left in the month, a hold of $0.004 then another.
    const a = await verdict(payer("admin", null), 0.004);
    await raw.prepare("INSERT INTO reservations (req, invite, call, at, usd) VALUES ('mine', 'admin', 'merge', ?, 0.004)").bind(now).run();
    const b = await verdict(payer("admin", null), 0.004);
    expect("the month's last $0.005: one $0.004 hold passes, the next is refused", a === "ok" && b === "budget", `${a}, ${b}`);
    await raw.prepare("DELETE FROM reservations WHERE req = 'mine'").run();
    // Room in the month again for the checks below (the trigger takes it off the total).
    await raw.prepare("DELETE FROM spend WHERE call = 'seed'").run();
  }
  {
    // An invite with $0.006 of allowance: one hold of $0.004 after $0.0024 spent is refused.
    await raw.prepare("INSERT INTO spend (at, call, model, usd, invite) VALUES (?, 'merge', 'm', 0.0024, 'cat')").bind(now).run();
    const v = await verdict(payer("cat", 0.006), 0.004);
    const w = await verdict(payer("cat", 0.0065), 0.004);
    expect("an invite's allowance: refused at $0.0024 + $0.004 over $0.006, passed under $0.0065", v === "spent" && w === "ok", `${v}, ${w}`);
  }
  {
    // Settling writes the total in the same batch as the ledger row.
    const l = ledger(payer("dee", 5));
    await L.hold(db, l, "merge", 0.004, BUDGET, now);
    await L.settle(raw, l, [{ call: "merge", model: "m", usd: 0.0024 }]);
    const t = await raw.prepare("SELECT usd FROM spend_totals WHERE month = ? AND scope = 'dee'").bind(L.monthKey(now)).first();
    expect("a settled call is in its invite's total at once", Math.abs((t?.usd ?? 0) - 0.0024) < 1e-9, JSON.stringify(t));
  }

  // (c) A total that drifted from the ledger is found, logged and rebuilt.
  {
    expect("checkTotals: no drift right after the triggers wrote", (await L.checkTotals(raw, now)).length === 0);
    const month = L.monthKey(now);
    await raw.prepare("UPDATE spend_totals SET usd = usd - 0.25 WHERE month = ? AND scope IN ('*', 'kit')").bind(month).run();
    await raw.prepare("UPDATE spend_totals SET usd = usd + 0.001 WHERE month = ? AND scope = 'cat'").bind(month).run();
    const log = console.error;
    let logged = "";
    console.error = (s) => (logged += s);
    const drift = await L.checkTotals(raw, now);
    console.error = log;
    expect(
      "checkTotals: a total $0.25 under the ledger is found for the game and the invite, a $0.001 gap is not",
      drift.length === 2 && drift.some((d) => d.scope === "*") && drift.some((d) => d.scope === "kit") && /spend-totals/.test(logged),
      JSON.stringify(drift),
    );
    const kit = await raw.prepare("SELECT usd FROM spend_totals WHERE month = ? AND scope = 'kit'").bind(month).first();
    expect(
      "checkTotals: the month's totals are rebuilt from the ledger",
      Math.abs(kit.usd - 0.5) < 1e-9 && (await L.checkTotals(raw, now)).length === 0,
      JSON.stringify(kit),
    );
    // A drifted total is a refusal at the old amount again once rebuilt.
    expect("checkTotals: after the rebuild, Kit at $0.5 of $0.504 is refused a $0.0049 hold", (await verdict(payer("kit", 0.504), 0.0049)) === "spent");
  }
} finally {
  await proxy.dispose();
}
console.log(failed ? `${failed} checks failed` : "all checks passed");
process.exitCode = failed ? 1 : 0;
