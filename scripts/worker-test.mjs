// Worker tests for 3.4: invites, the budget caps and the bug guard. Runs the
// real Worker with `wrangler dev` on a fresh local D1 (every migration
// applied) and answers its Claude calls with a stub server that counts them
// and takes a moment, so requests are really in flight together. The test
// reads and seeds the local D1 file directly. No network, no API key.
//
//   npm run test:worker
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ADMIN = "admin-secret-for-tests";
const STATE = mkdtempSync(join(tmpdir(), "mm-worker-test-"));
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", WRANGLER_SEND_METRICS: "false", CI: "1" };

// The stub Claude: every message is a merge answer named after a counter. Its
// usage is priced (oracle.ts) at 100 input and 100 output tokens of Opus 5.5:
// $0.0024, under the merge hold of $0.004.
let calls = 0;
const STUB_USD = (100 * 4 + 100 * 20) / 1e6;
const stub = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (!req.url.endsWith("/v1/messages")) {
      res.writeHead(404).end("not stubbed");
      return;
    }
    const n = ++calls;
    const answer = { name: `Answer ${n}`, emoji: "✨", kind: "spell", tier: "minor" };
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: `msg_${n}`,
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(answer) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 100 },
        }),
      );
    }, 150);
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const stubUrl = `http://127.0.0.1:${stub.address().port}`;

// wrangler serves ./dist as assets; the tests only call /api.
mkdirSync("dist", { recursive: true });
const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "magic-merger", "--local", "--persist-to", STATE], { env, encoding: "utf8" });
if (migrate.status !== 0) throw new Error(`migrations failed: ${migrate.stderr || migrate.stdout}`);

const port = 8900 + Math.floor(Math.random() * 90);
const vars = { ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: stubUrl, ADMIN_TOKEN: ADMIN, BUDGET_USD: "50", INVITE_CAP_USD: "5" };
const dev = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--port",
    String(port),
    "--ip",
    "127.0.0.1",
    "--persist-to",
    STATE,
    "--show-interactive-dev-session=false",
    "--log-level",
    "error",
    ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
  ],
  { env, stdio: ["ignore", "inherit", "inherit"], detached: true },
);
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {
    // not up yet
  }
  if (i > 120) throw new Error("wrangler dev did not start");
  await new Promise((r) => setTimeout(r, 500));
}

function stop() {
  try {
    process.kill(-dev.pid);
  } catch {
    // already gone
  }
  stub.close();
  rmSync(STATE, { recursive: true, force: true });
}

// The local D1 file, with the few calls the checks use.
const dir = join(STATE, "v3", "d1", "miniflare-D1DatabaseObject");
const file = readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
const sqlite = new DatabaseSync(join(dir, file));
sqlite.exec("PRAGMA busy_timeout = 5000");
const db = {
  prepare(sql) {
    let args = [];
    const q = {
      bind: (...a) => ((args = a), q),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => sqlite.prepare(sql).run(...args),
    };
    return q;
  },
  batch: async (list) => Promise.all(list.map((q) => q.run())),
};

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}

async function api(path, { body, invite, admin, method } = {}) {
  const headers = { "content-type": "application/json", "x-player": "test-player" };
  if (invite) headers["x-invite"] = invite;
  if (admin) headers["x-access-token"] = ADMIN;
  const res = await fetch(`${BASE}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function invite(name, cap) {
  const r = await api("/api/admin/invites", { admin: true, body: { name, cap } });
  const secret = new URL(r.data.link).hash.replace("#invite=", "");
  return { id: r.data.id, secret };
}

const merge = (inv, a, b) => api("/api/merge", { invite: inv?.secret, body: { a, b } });
const month = async () => (await db.prepare("SELECT COALESCE(SUM(usd), 0) AS t FROM spend").first()).t;
const reset = () => db.batch([db.prepare("DELETE FROM spend"), db.prepare("DELETE FROM reservations")]);

// Pairs nobody merged yet: each costs one Claude call.
let pairs = 0;
const PRIMS = ["Fire", "Water", "Earth", "Air", "Light", "Shadow", "Life", "Arcane"];
const ALL = PRIMS.flatMap((a, i) => PRIMS.slice(i).map((b) => [a, b]));
const fresh = () => ALL[pairs++];

// 1. Who gets in.
{
  const none = await api("/api/merge", { body: { a: "Fire", b: "Water" } });
  check("no invite: refused", none.status === 401 && none.data.code === "invite");
  const health = await api("/api/health");
  check("no invite: health says so", health.status === 200 && health.data.invited === false);
  const wrong = await merge({ secret: "x".repeat(32) }, "Fire", "Water");
  check("a made up link: refused", wrong.status === 401);
  const ann = await invite("Ann", 5);
  const h = await api("/api/health", { invite: ann.secret });
  check("an invite: health has its name and allowance", h.data.invited && h.data.invite.name === "Ann" && h.data.invite.cap === 5);
  const people = await api("/api/admin/people", { invite: ann.secret });
  check("an invite is not the admin", people.status === 404);
}

// 2. Every call is paid by the invite that triggered it.
{
  const bob = await invite("Bob", 5);
  const [a, b] = fresh();
  const r = await merge(bob, a, b);
  const rows = (await db.prepare("SELECT invite, usd FROM spend").all()).results;
  check("a merge is paid by its invite", r.status === 200 && rows.length === 1 && rows[0].invite === bob.id, JSON.stringify(rows));
  const open = await db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE settled = 0").first();
  check("its hold is released", open.n === 0);
  const found = await db.prepare("SELECT invite FROM elements WHERE name = ?").bind(r.data.element.name).first();
  check("the discovery is credited to the invite", found?.invite === bob.id);
  await reset();
}

// 3. A capped invite: new merges refused, the library still free.
{
  // Room for one merge hold ($0.004) but not two ($0.0024 spent + $0.004).
  const cat = await invite("Cat", 0.006);
  const [a, b] = fresh();
  const first = await merge(cat, a, b);
  const [c, d] = fresh();
  const second = await merge(cat, c, d);
  check("past its allowance, a new merge is refused", first.status === 200 && second.status === 402 && second.data.code === "spent", second.data?.error);
  check("with a friendly message", /magic is spent for now/i.test(second.data?.error ?? ""));
  const before = calls;
  const known = await merge(cat, a, b);
  check("a known recipe still works, for free", known.status === 200 && known.data.element.name === first.data.element.name && calls === before);
  const other = await invite("Dan", 5);
  const forOthers = await merge(other, c, d);
  check("other invites are not affected", forOthers.status === 200);
  const top = await api("/api/admin/invite", { admin: true, body: { id: cat.id, action: "topup", usd: 1 } });
  const [e, f] = fresh();
  const after = await merge(cat, e, f);
  check("a top-up gives this month's magic back", top.data.ok && after.status === 200);
  await api("/api/admin/invite", { admin: true, body: { id: cat.id, action: "pause" } });
  const [g, h] = fresh();
  const paused = await merge(cat, g, h);
  const pausedKnown = await merge(cat, a, b);
  check("a paused invite plays the library only", paused.status === 402 && paused.data.code === "paused" && pausedKnown.status === 200);
  await reset();
}

// 4. A revoked invite: the link is dead.
{
  const eve = await invite("Eve", 5);
  await merge(eve, "Fire", "Fire");
  await api("/api/admin/invite", { admin: true, body: { id: eve.id, action: "revoke" } });
  const r = await merge(eve, "Fire", "Fire");
  const h = await api("/api/health", { invite: eve.secret });
  check("a revoked invite is refused everywhere", r.status === 403 && r.data.code === "revoked" && h.status === 403);
  const resume = await api("/api/admin/invite", { admin: true, body: { id: eve.id, action: "resume" } });
  check("and stays revoked", resume.status === 400);
  const fay = await invite("Fay", 5);
  const old = fay.secret;
  const re = await api("/api/admin/invite", { admin: true, body: { id: fay.id, action: "relink" } });
  const fresh2 = new URL(re.data.link).hash.replace("#invite=", "");
  const oldUse = await api("/api/health", { invite: old });
  const newUse = await api("/api/health", { invite: fresh2 });
  check("a new link replaces the old one", oldUse.data.invited === false && newUse.data.invited === true);
  await reset();
}

// 5. Two concurrent calls at the limit: only one passes.
{
  for (let round = 0; round < 5; round++) {
    // $0.005 left of $50: room for one merge hold ($0.004), not two.
    await db
      .prepare("INSERT INTO spend (at, call, model, usd, invite) VALUES (?, 'seed', 'none', ?, 'admin')")
      .bind(Date.now(), 50 - 0.005)
      .run();
    const one = await invite(`G${round}`, 5);
    const two = await invite(`H${round}`, 5);
    const [a, b] = fresh();
    const [c, d] = fresh();
    const results = await Promise.all([merge(one, a, b), merge(two, c, d)]);
    const passed = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status === 402 && r.data.code === "budget").length;
    const total = await month();
    check(
      `two calls at the last dollar, round ${round + 1}: one passes`,
      passed === 1 && refused === 1 && total <= 50,
      `${passed} passed, month $${total.toFixed(4)}`,
    );
    await reset();
  }
  // Four at once, three invites with room for two.
  await db
    .prepare("INSERT INTO spend (at, call, model, usd, invite) VALUES (?, 'seed', 'none', ?, 'admin')")
    .bind(Date.now(), 50 - 0.009)
    .run();
  const many = await Promise.all([0, 1, 2, 3].map(async (k) => merge(await invite(`M${k}`, 5), ...fresh())));
  const passed = many.filter((r) => r.status === 200).length;
  check("four calls with room for two holds: two pass", passed === 2 && (await month()) <= 50, `${passed} passed`);
  await reset();
}

// 6. The bug guard: identical requests in flight ask Claude once.
{
  const ivy = await invite("Ivy", 5);
  const jon = await invite("Jon", 5);
  const [a, b] = fresh();
  const before = calls;
  const [x, y, z] = await Promise.all([merge(ivy, a, b), merge(ivy, a, b), merge(jon, b, a)]);
  check(
    "the same merge three times in flight: one Claude call",
    x.status === 200 && y.status === 200 && z.status === 200 && calls === before + 1 && x.data.element.name === z.data.element.name,
    `${calls - before} calls`,
  );
  await reset();
}

// 7. The bug guard: more than 10 paid requests from one person in a few
// seconds are refused and logged; nobody else is slowed down.
{
  const kim = await invite("Kim", 5);
  const burst = await Promise.all(Array.from({ length: 12 }, () => merge(kim, ...fresh())));
  const ok = burst.filter((r) => r.status === 200).length;
  const refused = burst.filter((r) => r.status === 429 && r.data.code === "burst").length;
  const logged = await db.prepare("SELECT COUNT(*) AS n FROM refusals WHERE invite = ? AND reason = 'burst'").bind(kim.id).first();
  check(
    "12 new merges at once: 10 pass, 2 refused and logged",
    ok === 10 && refused === 2 && logged.n === 2,
    `${ok} passed, ${refused} refused, ${logged.n} logged`,
  );
  const lea = await invite("Lea", 5);
  const other = await merge(lea, ...fresh());
  check("another person is not refused", other.status === 200);
  const known = await merge(kim, burst.find((r) => r.status === 200) ? "Fire" : "Fire", "Water");
  check("free requests are not counted", known.status === 200);
  await reset();
}

// 8. The admin view.
{
  const r = await api("/api/admin/people", { admin: true });
  const kim = r.data?.people?.find((p) => p.name === "Kim");
  check("the admin sees each person", r.status === 200 && r.data.budget === 50 && kim && kim.refusals === 2 && kim.discoveries >= 10);
}

console.log(`${calls} stub Claude calls, $${(calls * STUB_USD).toFixed(4)} at stub prices`);
stop();
if (failed) {
  console.log(`\n${failed} worker checks failed`);
  process.exit(1);
}
console.log("\nall worker checks passed");
