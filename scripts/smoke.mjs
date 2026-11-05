// 4.5.2: the smoke test a deploy must pass (docs/DAILY.md, "Deploys").
//
//   node scripts/smoke.mjs live <url> [--out dir]      production, after each deploy
//   node scripts/smoke.mjs preview <url> [--out dir]   a pull request's preview, before a merge
//
// live writes nothing and spends nothing: a stranger's first screen at 390 by 844
// (the invite gate, which every newcomer sees first), the static files, the
// health route, and with MM_TOKEN a few read only routes that need the database.
// The browser never holds the token on production: as admin it would sync the
// owner's own island.
//
// preview plays the newcomer's path on the staging copy with MM_TOKEN in the
// browser: the first screen, two items onto the board, one merge, the World,
// every tab. Staging is a copy with $2 a month; a merge of two starting items
// is a known recipe there and costs nothing.
//
// Exit 0 when every check passes. Frames and report.json go to --out.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");

const [mode, rawUrl] = process.argv.slice(2);
if (!["live", "preview"].includes(mode) || !rawUrl) {
  console.error("usage: node scripts/smoke.mjs live|preview <url> [--out dir]");
  process.exit(2);
}
const BASE = rawUrl.replace(/\/$/, "");
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : `smoke-${mode}`;
mkdirSync(OUT, { recursive: true });
const TOKEN = process.env.MM_TOKEN ?? "";

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ": " + String(detail).slice(0, 200) : ""}`);
};
const getJson = async (path, token = "") => {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: token ? { "x-access-token": token } : {} });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body, ms: Date.now() - t0, text: text.slice(0, 200) };
};

// 1. The routes, without a browser.
const health = await getJson("/api/health");
check("health answers ok", health.status === 200 && health.body?.ok === true, `${health.status} ${health.text}`);
check("health answers within 3 s", health.ms < 3000, `${health.ms} ms`);
if (mode === "live") check("production is not in mock mode", health.body?.mock === false, JSON.stringify(health.body));
const page0 = await fetch(`${BASE}/`);
const html = await page0.text();
check("the page is served", page0.status === 200 && html.includes("Magic Merger"), String(page0.status));
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
const missing = [];
for (const a of assets) if ((await fetch(`${BASE}${a}`)).status !== 200) missing.push(a);
check("every built file the page names is served", assets.length > 0 && missing.length === 0, missing.join(", ") || `${assets.length} files`);
check("strangers get nothing from the API", (await getJson("/api/library")).status === 401);
if (TOKEN) {
  const admin = await getJson("/api/health", mode === "preview" ? TOKEN : "");
  if (mode === "preview") check("the admin token opens the preview", admin.body?.admin === true, admin.text);
  // Read only routes that reach the database (no activity is recorded on them).
  for (const path of ["/api/wonders", "/api/daily", "/api/spend"]) {
    const r = await getJson(path, TOKEN);
    check(`${path} reads the database`, r.status === 200 && r.body !== null, `${r.status} ${r.text}`);
  }
} else check("MM_TOKEN given, so the database is reached", false, "no MM_TOKEN in the environment");

// 2. The page at phone size.
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
const failedRequests = [];
let frame = 0;
const shot = async (page, name) => {
  const path = join(OUT, `${String(++frame).padStart(2, "0")}-${name}.jpg`);
  await page.screenshot({ path, type: "jpeg", quality: 70 });
  return path;
};
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, isMobile: false });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/401|invite only|Failed to load resource|Unrecognized Content-Security-Policy directive/i.test(m.text()))
      errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 500) failedRequests.push(`${r.status()} ${r.url().slice(BASE.length)}`);
  });
  if (mode === "preview" && TOKEN)
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("magic-merger.token", t);
      } catch {
        // the sandboxed frames have no storage
      }
    }, TOKEN);
  const t0 = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  if (mode === "live") {
    // A stranger's first screen is the gate: the app booted, asked the Worker, and was told "invite".
    const gate = await page.waitForSelector("#gate:not([hidden])", { timeout: 20000 }).catch(() => null);
    check("a stranger sees the gate within 20 s", !!gate, `${Date.now() - t0} ms`);
    const text = gate ? await gate.innerText() : "";
    check("the gate offers a sign in", /sign in|passkey/i.test(text), text.slice(0, 120));
    await shot(page, "gate");
  } else {
    const ready = await page.waitForSelector(".chip-inventory", { timeout: 30000 }).catch(() => null);
    check("the game opens with its starting items", !!ready, `${Date.now() - t0} ms`);
    await shot(page, "first-screen");
    for (let i = 0; i < 3 && (await page.locator("dialog[open]").count()); i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await page.click('.tab[data-view="craft-view"]').catch(() => undefined);
    await page.click("#clear").catch(() => undefined);
    const items = page.locator(".chip-inventory");
    if ((await items.count()) >= 2) {
      await items.nth(0).click();
      await page.waitForTimeout(300);
      await items.nth(1).click();
      await page.waitForTimeout(500);
    }
    const chips = page.locator("#board .chip-board");
    check("two items land on the board", (await chips.count()) >= 2, `${await chips.count()} on the board`);
    if ((await chips.count()) >= 2) {
      const a = await chips.nth(0).boundingBox();
      const b = await chips.nth(1).boundingBox();
      const merged = page.waitForResponse((r) => r.url().includes("/api/merge"), { timeout: 90000 }).catch(() => null);
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      for (let s = 1; s <= 12; s++) await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * s) / 12, a.y + a.height / 2 + ((b.y - a.y) * s) / 12);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.up();
      const res = await merged;
      check("a merge is answered", res?.status() === 200, res ? String(res.status()) : "no /api/merge in 90 s");
      await page.waitForTimeout(1500);
      await shot(page, "after-merge");
    }
    for (let i = 0; i < 4 && (await page.locator("dialog[open]").count()); i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await page.click('.tab[data-view="world-view"]');
    await page.waitForTimeout(6000);
    const stage = await page.locator("#world-stage iframe, #world-stage canvas").count();
    check("the World opens", stage > 0, `${stage} frame or canvas`);
    await shot(page, "world");
    for (const view of ["challenges-view", "daily-view", "community-view", "feedback-view"]) {
      if (await page.locator("dialog[open]").count()) await page.keyboard.press("Escape");
      await page.click(`.tab[data-view="${view}"]`);
      await page.waitForTimeout(1500);
      const visible = await page.locator(`#${view}`).isVisible();
      check(`the ${view.replace("-view", "")} tab opens`, visible);
      await shot(page, view.replace("-view", ""));
    }
  }
  await page.waitForTimeout(1000);
  check("no error on the page", errors.length === 0, errors.slice(0, 5).join(" | "));
  check("no server error", failedRequests.length === 0, failedRequests.slice(0, 5).join(", "));
  await ctx.close();
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(OUT, "report.json"),
  JSON.stringify({ mode, url: BASE, at: new Date().toISOString(), ok: failed.length === 0, checks, errors, failedRequests }, null, 2),
);
console.log(failed.length ? `${failed.length} of ${checks.length} smoke checks failed` : `all ${checks.length} smoke checks passed`);
process.exit(failed.length ? 1 : 0);
