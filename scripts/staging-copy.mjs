// 4.5: the nightly copy of the live database for the previews
// (.github/workflows/staging.yml, docs/SETUP.md "Previews").
//
// Exports the live D1, strips everything that is a person's (accounts,
// passkeys, sessions, sign in links, invites and their emails, saved
// progress, reports, activity, devices), keeps staging's own spend of the
// month so its $5 holds across nights, and replaces the staging D1 with it.
// The owner's row stays, with no link and no email, so the admin token works
// on a preview. Reads production, never writes it.
//
//   CLOUDFLARE_API_TOKEN=... node scripts/staging-copy.mjs [--dry]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const LIVE = "magic-merger";
const STAGING = "magic-merger-staging";
const dry = process.argv.includes("--dry");
const dir = mkdtempSync(join(tmpdir(), "mm-staging-"));

function wrangler(args, { json = false } = {}) {
  const r = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: "1" } });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed:\n${r.stderr}\n${r.stdout}`);
  if (!json) return r.stdout;
  const start = r.stdout.indexOf("[");
  return JSON.parse(r.stdout.slice(start));
}

function stagingQuery(sql) {
  try {
    return wrangler(["d1", "execute", STAGING, "--remote", "--env", "staging", "--json", "--command", sql], { json: true })[0]?.results ?? [];
  } catch (err) {
    // The first night: staging has no tables yet.
    if (/no such table/i.test(String(err))) return [];
    throw err;
  }
}

// 1. What staging spent this month, and what it holds now.
const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
const ownSpend = stagingQuery(`SELECT * FROM spend WHERE at >= ${monthStart}`);
const stagingTables = stagingQuery("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").map(
  (r) => r.name,
);

// 2. The live database, into memory.
const exported = join(dir, "live.sql");
wrangler(["d1", "export", LIVE, "--remote", "--output", exported]);
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(exported, "utf8"));

// 3. Stripped. Tables from later migrations may be missing: skipped.
const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const run = (sql) => {
  const t = /(?:FROM|UPDATE|INTO)\s+(\w+)/i.exec(sql)?.[1];
  if (t && !has(t)) return 0;
  return Number(db.prepare(sql).run().changes);
};
const stripped = {
  credentials: run("DELETE FROM credentials"),
  sessions: run("DELETE FROM sessions"),
  auth_challenges: run("DELETE FROM auth_challenges"),
  account_links: run("DELETE FROM account_links"),
  progress: run("DELETE FROM progress"),
  reports: run("DELETE FROM reports"),
  activity: run("DELETE FROM activity"),
  refusals: run("DELETE FROM refusals"),
  perf: run("DELETE FROM perf"),
  inflight: run("DELETE FROM inflight"),
  invites: run("DELETE FROM invites WHERE id != 'admin'"),
};
// The owner's row: no link anyone holds, no email, not claimed (no passkey here).
run("UPDATE invites SET token_hash = lower(hex(randomblob(32))), email = NULL, claimed_at = NULL WHERE id = 'admin'");
// Who found what stays as an id with no name behind it; the ideas lose their author.
run("UPDATE suggestions SET invite = 'someone', session_url = NULL WHERE invite != 'admin'");
// 4.5.1 (audit, A.V8): and their words. A player's idea is free text that may
// say who they are; a preview only needs that an idea exists and its status.
run("UPDATE suggestions SET title = 'An idea from a player (#' || id || ')', body = '', note = NULL, brief = NULL WHERE invite != 'admin'");
// The friend named on a wonder grown from their discovery.
run("UPDATE wonders SET by_name = NULL");
// The money: staging's own month, not production's.
run("DELETE FROM spend");
run("DELETE FROM reservations");
if (has("spend") && ownSpend.length) {
  const cols = Object.keys(ownSpend[0]);
  const ins = db.prepare(`INSERT INTO spend (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
  for (const row of ownSpend) ins.run(...cols.map((c) => row[c]));
}

// 4. As SQL for D1: drop what staging has, then every table, row and index.
const quote = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const objects = db
  .prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type = 'table' DESC, name",
  )
  .all();
const out = ["PRAGMA defer_foreign_keys = true;"];
for (const t of stagingTables) out.push(`DROP TABLE IF EXISTS "${t}";`);
let rows = 0;
for (const o of objects.filter((o) => o.type === "table")) {
  out.push(`${o.sql};`);
  const cols = db
    .prepare(`PRAGMA table_info("${o.name}")`)
    .all()
    .map((c) => c.name);
  for (const r of db.prepare(`SELECT * FROM "${o.name}"`).all()) {
    out.push(`INSERT INTO "${o.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => quote(r[c])).join(", ")});`);
    rows++;
  }
}
for (const o of objects.filter((o) => o.type !== "table")) out.push(`${o.sql};`);
const file = join(dir, "staging.sql");
writeFileSync(file, out.join("\n"));
console.log(JSON.stringify({ tables: objects.filter((o) => o.type === "table").length, rows, stripped, stagingSpendKept: ownSpend.length, file }));

// 5. Into staging.
if (!dry) {
  wrangler(["d1", "execute", STAGING, "--remote", "--env", "staging", "--file", file, "--yes"]);
  const check = stagingQuery(
    "SELECT (SELECT COUNT(*) FROM elements) AS elements, (SELECT COUNT(*) FROM invites) AS invites, (SELECT COUNT(*) FROM sessions) AS sessions",
  );
  console.log(JSON.stringify({ staging: check[0] }));
}
