// The 4.0 review's browser findings, checked in a phone sized headless
// browser against the real Worker (wrangler dev, a fresh local D1, a stub
// Claude), the same way on main and on the 4.1 branch:
//   A. two tabs of one browser, signed in (M6): a discovery made in one tab
//      survives the other's writes, one tab at a time writes the island, and
//      the account upload works from both without a conflict;
//   B. a full storage (M13): the player is told once;
//   C. a World frame stuck in spell code (M3): replaced after 20 s, and an
//      idle frame is not;
//   D. a live challenge with the vote bar up (M10, a screenshot) and its
//      Restart and Retry (L6: the head start is kept);
//   E. a spell the Worker will not mend again (L5): asked once a session.
//
//   npm run build && node scripts/verify-4.1.mjs [only=A,B] [shots=dir]
import { createRequire } from "node:module";

// require, not import: it also finds a Playwright installed globally (NODE_PATH), as lab-browser.mjs does.
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")));
const only = args.only ? args.only.split(",") : ["A", "B", "C", "D", "E"];
const SHOTS = args.shots ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ADMIN = "admin-verify-41";
const STATE = mkdtempSync(join(tmpdir(), "mm-verify41-"));
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", WRANGLER_SEND_METRICS: "false", CI: "1" };

// The stub Claude: merges answer "Answer n" (Shadow + Arcane answers "Brittle
// Charm"), programs paint a little sand, and Brittle Charm's throws when cast.
let calls = 0;
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const n = ++calls;
    const body = JSON.parse(raw || "{}");
    const system = (body.system ?? []).map((b) => b.text).join("");
    const last = body.messages?.at(-1)?.content;
    const user = typeof last === "string" ? last : Array.isArray(last) ? last.map((b) => b.text ?? "").join("") : "";
    let text;
    if (system.startsWith("You write the grimoire")) text = "A small bright spell.";
    else if (system.includes("Say what this item promises")) text = JSON.stringify({ intents: ["other"] });
    else if (system.startsWith("You write the spells") || system.startsWith("You mend"))
      text = JSON.stringify({
        summary: "A flash.",
        code: user.includes("Brittle")
          ? "const spell = { *cast(w) { if (w.x > -1) throw new Error('brittle'); yield 0.1; } };"
          : "const spell = { *cast(w) { w.flash('#fff', 0.2); w.paint(w.x, w.y, 2, 'sand', 1); } };",
        missing: "",
      });
    else if (/^(Shadow \+ Arcane|Arcane \+ Shadow)/.test(user)) text = JSON.stringify({ name: "Brittle Charm", emoji: "🪨", kind: "spell", tier: "minor" });
    else text = JSON.stringify({ name: `Answer ${n}`, emoji: "✨", kind: "spell", tier: "minor" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `m${n}`,
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 100 },
      }),
    );
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const stubUrl = `http://127.0.0.1:${stub.address().port}`;
const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "magic-merger", "--local", "--persist-to", STATE], { env, encoding: "utf8" });
if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
const port = 9200 + Math.floor(Math.random() * 90);
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
const dir = join(STATE, "v3", "d1", "miniflare-D1DatabaseObject");
const sqlite = new DatabaseSync(
  join(
    dir,
    readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite"),
  ),
);
sqlite.exec("PRAGMA busy_timeout = 5000");
const sql = (q, ...a) => sqlite.prepare(q).run(...a);

async function api(path, body, headers = { "x-access-token": ADMIN }) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-player": "verify-player", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
// A live program for an element, written and passed through the API.
async function liveSpell(a, b) {
  const element = (await api("/api/merge", { a, b })).data.element;
  const spell = (await api("/api/spell", { name: element.name })).data;
  const checked = (await api("/api/spell/check", { name: element.name, id: spell.program.id, ok: true, problem: null, detail: "" })).data;
  return { element, program: checked.program };
}

let failed = 0;
const log = (s) => console.log(s);
function check(name, ok, detail = "") {
  if (!ok) failed++;
  log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function context(init) {
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(init.script, init.arg);
  return ctx;
}
const adminInit = {
  script: (t) => {
    if (window !== window.top) return;
    localStorage.setItem("magic-merger.token", t);
    localStorage.setItem("magic-merger.welcomed", "1");
  },
  arg: ADMIN,
};
const toasts = (page) =>
  page
    .locator("#toasts")
    .innerText()
    .catch(() => "");
// Every toast shown, kept: they leave the screen after a few seconds.
const keepToasts = () => {
  if (window !== window.top) return;
  window.__toasts = [];
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains("toast")) window.__toasts.push(n.textContent);
  }).observe(document, { childList: true, subtree: true });
};
const toldOf = (page) => page.evaluate(() => window.__toasts ?? []);
async function closeDialogs(page) {
  for (let i = 0; i < 3 && (await page.locator("dialog[open]").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}
async function mergeOnBoard(page, a, b) {
  await page.waitForSelector(".chip-inventory", { timeout: 20000 });
  await closeDialogs(page);
  await page.locator(".chip-inventory", { hasText: a }).first().click();
  await page.locator(".chip-inventory", { hasText: b }).first().click();
  const chips = page.locator(".chip-board");
  const n = await chips.count();
  const x = await chips.nth(n - 1).boundingBox();
  const y = await chips.nth(n - 2).boundingBox();
  await page.mouse.move(x.x + x.width / 2, x.y + x.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x.x + x.width / 2 + ((y.x - x.x) * i) / 6, x.y + x.height / 2 + ((y.y - x.y) * i) / 6);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll(".chip-board.merging").length === 0, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await closeDialogs(page);
}
const saved = (page) =>
  page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("magic-merger.save") ?? "{}").discoveries ?? {}).map((d) => d.element.name));
const worldFrame = (page) => page.frames().find((f) => /\/world(\.html)?$/.test(f.url().split("?")[0]));
async function openWorld(page) {
  await closeDialogs(page);
  await page.click('.tab[data-view="world-view"]');
  for (let i = 0; i < 60 && !worldFrame(page); i++) await page.waitForTimeout(250);
  await page.waitForTimeout(2500);
}
async function tapIsland(page) {
  const box = await page.locator(".world-frame").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
}
async function waitStatus(page, re, ms = 60000) {
  const t0 = Date.now();
  let s = "";
  while (Date.now() - t0 < ms) {
    s = await page.locator("#world-status").innerText();
    if (re.test(s)) return s;
    await page.waitForTimeout(500);
  }
  return s;
}

try {
  // A. Two tabs of one browser, signed in (M6).
  if (only.includes("A")) {
    const inv = (await api("/api/admin/invites", { name: "Tabs", cap: 5 })).data;
    sql("UPDATE invites SET claimed_at = ?, token_hash = 'gone' WHERE id = ?", Date.now(), inv.id);
    const relink = new URL((await api("/api/admin/invite", { id: inv.id, action: "relink" })).data.link).hash.replace("#invite=", "");
    const token = (await api("/api/account/claim-link", {}, { "x-invite": relink })).data.token;
    const ctx = await context({
      script: (t) => {
        if (window !== window.top) return;
        if (!localStorage.getItem("magic-merger.session")) localStorage.setItem("magic-merger.session", t);
        localStorage.setItem("magic-merger.welcomed", "1");
        localStorage.setItem("magic-merger.offered", "1");
      },
      arg: token,
    });
    // Every write of the island, by tab, and every upload of progress.
    const writes = [];
    await ctx.exposeBinding("__wrote", ({ page }, key) => writes.push({ tab: page.__name, key, at: Date.now() }));
    await ctx.addInitScript(() => {
      if (window !== window.top) return;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        set.call(this, k, v);
        if (k === "magic-merger.world2") window.__wrote(k);
      };
    });
    await ctx.addInitScript(keepToasts);
    const uploads = [];
    const dialogs = [];
    const tab = async (name) => {
      const p = await ctx.newPage();
      p.__name = name;
      p.on("response", async (r) => {
        if (r.url().endsWith("/api/progress") && r.request().method() === "PUT")
          uploads.push({ tab: name, kind: JSON.parse(r.request().postData() ?? "{}").kind, status: r.status() });
      });
      p.on("dialog", (d) => {
        dialogs.push({ tab: name, text: d.message().slice(0, 90) });
        void d.accept();
      });
      await p.goto(`${BASE}/`);
      await p.waitForSelector(".chip-inventory", { timeout: 20000 });
      return p;
    };
    const one = await tab("tab 1");
    const two = await tab("tab 2");
    await mergeOnBoard(one, "Fire", "Water");
    const first = (await saved(one)).filter((n) => n.startsWith("Answer"));
    await mergeOnBoard(two, "Earth", "Air");
    await two.waitForTimeout(1000);
    const after = await saved(two);
    check(
      "M6: a discovery made in tab 1 survives tab 2's next write",
      first.length === 1 && after.includes(first[0]) && after.filter((n) => n.startsWith("Answer")).length === 2,
      `tab 1 found ${first.join(", ")}; stored after tab 2's merge: ${after.filter((n) => n.startsWith("Answer")).join(", ")}`,
    );
    const shown = await two.locator(".chip-inventory", { hasText: first[0] ?? "nothing" }).count();
    check("M6: and tab 2 shows it without a reload", shown > 0, `${shown} chip(s)`);

    // The island: tab 1 shows the World, then tab 2 does. Both stay visible.
    await openWorld(one);
    await one.waitForTimeout(11000);
    await openWorld(two);
    const claimed = Date.now();
    await two.waitForTimeout(25000);
    const late = writes.filter((w) => w.at > claimed + 1500);
    const byOne = late.filter((w) => w.tab === "tab 1").length;
    const byTwo = late.filter((w) => w.tab === "tab 2").length;
    const told = (await toldOf(one)).filter((t) => /another tab/.test(t));
    check(
      "M6: once tab 2 shows the World, only tab 2 writes the island, and tab 1 is told",
      byOne === 0 && byTwo > 0 && told.length === 1,
      `in 25 s: tab 1 wrote ${byOne} time(s), tab 2 ${byTwo}; tab 1 was told: ${JSON.stringify(told)}`,
    );
    // Both tabs leave the page (the upload's flush), tab 1 first.
    for (const p of [one, two]) {
      await p.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await p.waitForTimeout(3000);
    }
    const islandUploads = uploads.filter((u) => u.kind === "island");
    check(
      "M6: the account upload works from both tabs, with no conflict and no warning",
      islandUploads.length > 0 && islandUploads.every((u) => u.status === 200) && dialogs.length === 0,
      `uploads ${JSON.stringify(islandUploads)}; dialogs ${JSON.stringify(dialogs)}`,
    );
    await ctx.close();
  }

  // B. A full storage (M13).
  if (only.includes("B")) {
    const ctx = await context(adminInit);
    await ctx.addInitScript(() => {
      if (window !== window.top || localStorage.getItem("mm-filled")) return;
      localStorage.setItem("mm-filled", "1");
      // Fill the site's storage to its quota, then leave room for small flags only.
      let n = 0;
      for (const size of [1 << 20, 1 << 16, 1 << 12, 1 << 8]) {
        const chunk = "x".repeat(size);
        try {
          for (;;) localStorage.setItem(`mm-fill-${n++}`, chunk);
        } catch {
          // full at this size: smaller ones next
        }
      }
      for (let k = 0; k < 4; k++) localStorage.removeItem(`mm-fill-${--n}`);
    });
    await ctx.addInitScript(keepToasts);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await mergeOnBoard(page, "Fire", "Water");
    await openWorld(page);
    await page.waitForTimeout(12000);
    const full = (await page.evaluate(() => window.__toasts)).filter((t) => /full/i.test(t));
    const kept = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("magic-merger.save") ?? "{}").discoveries ?? {}).length);
    check("M13: a full storage is said, once", full.length === 1, `toasts about it: ${JSON.stringify(full)}; discoveries stored: ${kept}`);
    await ctx.close();
  }

  // C. A World frame stuck in spell code (M3).
  if (only.includes("C")) {
    const ctx = await context(adminInit);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await page.waitForSelector(".chip-inventory", { timeout: 20000 });
    await openWorld(page);
    await page.evaluate(() => (document.querySelector(".world-frame").dataset.mark = "first"));
    await page.waitForTimeout(30000);
    const idle = await page.evaluate(() => document.querySelector(".world-frame")?.dataset.mark === "first");
    check("M3: an idle World frame is kept (30 s on screen)", idle);
    const t0 = Date.now();
    void worldFrame(page)
      .evaluate(() => {
        const end = Date.now() + 25000;
        while (Date.now() < end) {
          // stuck, as spell code with a catastrophic regex would be
        }
      })
      .catch(() => {});
    let replaced = false;
    while (Date.now() - t0 < 45000 && !replaced) {
      await page.waitForTimeout(1000);
      replaced = await page.evaluate(() => {
        const f = document.querySelector(".world-frame");
        return !!f && f.dataset.mark !== "first";
      });
    }
    check(
      "M3: a frame stuck for 25 s is replaced, and the player told",
      replaced && /froze/.test(await toasts(page)),
      `replaced after ${replaced ? Math.round((Date.now() - t0) / 1000) : "never (45 s)"} s`,
    );
    await ctx.close();
  }

  // D. A live challenge with the vote bar up (M10), Restart and Retry (L6).
  if (only.includes("D")) {
    const solver = await liveSpell("Life", "Light");
    sql(
      "INSERT INTO challenge_solvers (challenge, key, pid, ok, wins, runs, origin, at) VALUES ('racing-lava', ?, ?, 1, 1, 1, 'test', ?)",
      solver.element.name.toLowerCase(),
      solver.program.id,
      Date.now(),
    );
    const ctx = await context(adminInit);
    // What the frame is told to play: the head start of each challenge start.
    await ctx.addInitScript(() => {
      if (window === window.top) return;
      window.addEventListener("message", (e) => {
        if (e.data?.type === "scenario" || e.data?.type === "reset") (window.__plays ??= []).push({ type: e.data.type, ahead: e.data.ahead ?? null });
      });
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await page.waitForSelector(".chip-inventory", { timeout: 20000 });
    await closeDialogs(page);
    await page.click('.tab[data-view="challenges-view"]');
    await page.locator(".challenge-go").first().click();
    await page.waitForTimeout(6000);
    const items = page.locator(".attempt-items .chip");
    await items.nth(0).click();
    await items.nth(1).click();
    await page.waitForSelector(".attempt-cast:has-text('Answer')", { timeout: 30000 });
    await page.click(".attempt-cast");
    for (let i = 0; i < 60 && !worldFrame(page); i++) await page.waitForTimeout(250);
    const ready = await waitStatus(page, /Tap the island to cast/, 90000);
    await tapIsland(page);
    const voted = await page.waitForSelector(".vote", { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "m10-vote-and-banner.jpg"), quality: 80 });
    const geo = await page.evaluate(() => {
      const box = (el) => el?.getBoundingClientRect();
      const v = box(document.querySelector(".vote"));
      const b = box(document.querySelector("#world-banner"));
      const leave = document.querySelector(".world-banner-leave");
      const l = box(leave);
      const hit = l ? document.elementFromPoint(l.x + l.width / 2, l.y + l.height / 2) : null;
      return {
        overlap: !!v && !!b && v.left < b.right && b.left < v.right && v.top < b.bottom && b.top < v.bottom,
        leaveTappable: !!hit && (hit === leave || leave.contains(hit)),
        vote: v && [Math.round(v.top), Math.round(v.bottom)],
        banner: b && [Math.round(b.top), Math.round(b.bottom)],
      };
    });
    check(
      "M10: the vote bar and the challenge banner do not overlap on a phone",
      !!voted && !geo.overlap && geo.leaveTappable,
      `status before the cast: "${ready.slice(0, 50)}"; ${JSON.stringify(geo)}`,
    );
    // L6: Restart, then a loss and Retry, play the same head start.
    const frame = worldFrame(page);
    await page.click("#world-reset");
    await page.waitForTimeout(1500);
    await frame.evaluate(() => window.parent.postMessage({ type: "objective", id: "lava", text: "The lava reached the village.", status: "lost" }, "*"));
    await page.waitForTimeout(800);
    await page.click(".world-banner-retry");
    await page.waitForTimeout(1500);
    const plays = await frame.evaluate(() => window.__plays ?? []);
    const startAhead = plays[0]?.ahead ?? 0;
    check(
      "L6: Restart and Retry of a live challenge keep the head start",
      plays.length === 3 && startAhead > 0 && plays.slice(1).every((p) => p.type === "scenario" && p.ahead === startAhead),
      JSON.stringify(plays),
    );
    await ctx.close();
  }

  // E. A spell the Worker will not mend again (L5).
  if (only.includes("E")) {
    const brittle = await liveSpell("Shadow", "Arcane");
    const key = brittle.element.name.toLowerCase();
    sql("UPDATE spells SET repairs = 3 WHERE key = ?", key);
    // A friend's invite: the admin is never refused a repair.
    const friend = new URL((await api("/api/admin/invites", { name: "Mender", cap: 5 })).data.link).hash.replace("#invite=", "");
    const ctx = await context({
      script: (t) => {
        if (window !== window.top) return;
        localStorage.setItem("magic-merger.invite", t);
        localStorage.setItem("magic-merger.welcomed", "1");
        localStorage.setItem("magic-merger.offered", "1");
      },
      arg: friend,
    });
    await ctx.addInitScript(
      ({ key, element, program }) => {
        if (window !== window.top || localStorage.getItem("magic-merger.save")) return;
        const prim = (name, emoji) => [name.toLowerCase(), { element: { name, emoji, kind: "spell", depth: 0 }, discoveredAt: 0, recipe: null }];
        localStorage.setItem(
          "magic-merger.save",
          JSON.stringify({
            version: 1,
            discoveries: Object.fromEntries([prim("Fire", "🔥"), [key, { element, discoveredAt: Date.now(), recipe: ["Shadow", "Arcane"] }]]),
            descriptions: {},
            spells: { [key]: { version: program.version, summary: "", code: program.code, id: program.id } },
            board: [],
            nextChipId: 1,
          }),
        );
      },
      { key, element: brittle.element, program: brittle.program },
    );
    const page = await ctx.newPage();
    const repairs = [];
    page.on("response", (r) => {
      if (r.url().endsWith("/api/spell/repair")) repairs.push(r.status());
    });
    await page.goto(`${BASE}/`);
    await page.waitForSelector(".chip-inventory", { timeout: 20000 });
    await openWorld(page);
    await page.locator(".chip-castable", { hasText: "Brittle" }).first().click();
    await waitStatus(page, /Tap the island to cast/, 30000);
    for (let k = 0; k < 3; k++) {
      await tapIsland(page);
      await page.waitForTimeout(3500);
    }
    check(
      "L5: a spell mended too often is asked for once a session, not on every crash",
      repairs.length === 1 && repairs[0] === 429,
      `three casts that crash: ${repairs.length} repair request(s) ${JSON.stringify(repairs)}`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
  try {
    process.kill(-dev.pid);
  } catch {
    // already gone
  }
  stub.close();
  rmSync(STATE, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} browser check(s) failed` : "\nall browser checks passed");
process.exit(failed ? 1 : 0);
