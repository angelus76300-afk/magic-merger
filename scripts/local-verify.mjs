// Verifies two browser-side fixes against the real Worker (wrangler dev, a
// fresh local D1, a stub Claude): a check frame that never loads no longer
// blocks a spell for good, and a trial whose verdict never reached the
// Worker is tested again on the next visit.
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN = "admin-local-verify";
const STATE = mkdtempSync(join(tmpdir(), "mm-verify-"));
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", WRANGLER_SEND_METRICS: "false", CI: "1" };
let calls = 0;
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const n = ++calls;
    const body = JSON.parse(raw || "{}");
    const system = (body.system ?? []).map((b) => b.text).join("");
    let text;
    if (system.startsWith("You write the grimoire")) text = "A small bright spell.";
    else if (system.includes("Say what this item promises")) text = JSON.stringify({ intents: ["other"] });
    else if (system.startsWith("You write the spells"))
      text = JSON.stringify({
        summary: "A flash.",
        code: "const spell = { *cast(w) { w.flash('#fff', 0.2); w.paint(w.x, w.y, 2, 'sand', 1); } };",
        missing: "",
      });
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
const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "magic-merger", "--local", "--persist-to", STATE], {
  env,
  encoding: "utf8",
  cwd: "/home/user/magic-merger",
});
if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
const port = 8990 + Math.floor(Math.random() * 9);
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
  { env, stdio: ["ignore", "inherit", "inherit"], detached: true, cwd: "/home/user/magic-merger" },
);
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {}
  if (i > 120) throw new Error("wrangler dev did not start");
  await new Promise((r) => setTimeout(r, 500));
}
const log = (s) => console.log(s);
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
async function session(name, setup) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const checks = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/spell/check") && r.method() === "POST") checks.push(r.postData());
  });
  await page.addInitScript((t) => localStorage.setItem("magic-merger.token", t), ADMIN);
  await setup(page);
  return { ctx, page, checks };
}
async function discoverAndSelect(page) {
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".chip-inventory", { timeout: 20000 });
  await page.locator(".chip-inventory", { hasText: "Fire" }).first().click();
  await page.locator(".chip-inventory", { hasText: "Water" }).first().click();
  const chips = page.locator(".chip-board");
  const a = await chips.nth(1).boundingBox();
  const b = await chips.nth(0).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 6, a.y + a.height / 2 + ((b.y - a.y) * i) / 6);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll(".chip-board.merging").length === 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3 && (await page.locator("dialog[open]").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await page.click('.tab[data-view="world-view"]');
  await page.waitForTimeout(1500);
  await page.locator(".chip-castable", { hasText: "Answer" }).first().click();
}
try {
  // A. The check frame never loads: the spell must still become castable.
  {
    const { ctx, page, checks } = await session("A", async (p) => p.route("**/check", (r) => r.abort()));
    const t0 = Date.now();
    await discoverAndSelect(page);
    let status = "";
    for (let i = 0; i < 80; i++) {
      status = await page.locator("#world-status").innerText();
      if (/Tap the island to cast/.test(status)) break;
      await page.waitForTimeout(500);
    }
    log(
      `A: check frame blocked: status after ${Date.now() - t0} ms: "${status}"; /api/spell/check posted ${checks.length} time(s): ${checks[0]?.slice(0, 120)}`,
    );
    await ctx.close();
  }
  // B. The verdict never reaches the Worker: the next visit tests the trial again.
  {
    const { ctx, page, checks } = await session("B", async (p) => p.route("**/api/spell/check", (r) => r.abort()));
    await discoverAndSelect(page);
    await page.waitForTimeout(12000);
    log(`B: first visit with /api/spell/check blocked: ${checks.length} post(s) reached the page's network layer (all aborted)`);
    const held = await page.evaluate(() => JSON.parse(localStorage.getItem("magic-merger.save")).spells);
    log(
      `B: programs held after the first visit: ${JSON.stringify(Object.fromEntries(Object.entries(held).map(([k, v]) => [k, { id: v.id, trial: v.trial }])))}`,
    );
    await page.unroute("**/api/spell/check");
    checks.length = 0;
    await page.reload();
    await page.waitForSelector(".chip-inventory", { timeout: 20000 });
    await page.click('.tab[data-view="world-view"]');
    await page.waitForTimeout(15000);
    log(`B: after a reload with the route open: /api/spell/check posted ${checks.length} time(s): ${checks[0]?.slice(0, 160)}`);
    const live = await fetch(`${BASE}/api/spells/live`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-token": ADMIN },
      body: JSON.stringify({ names: ["Answer 1"] }),
    }).then((r) => r.json());
    log(`B: the Worker's view of the program now: ${JSON.stringify(live)}`);
    await ctx.close();
  }
  // C. A win kept from a visit when the Worker could not be reached is sent on the next visit.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const wins = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/challenge/win")) wins.push(r.postData());
    });
    await page.addInitScript((t) => {
      localStorage.setItem("magic-merger.token", t);
      localStorage.setItem("mm-challenge-win", JSON.stringify({ id: "first-fire", merges: 3, spell: "Answer 1" }));
    }, ADMIN);
    await page.goto(`${BASE}/`);
    await page.waitForSelector(".chip-inventory", { timeout: 20000 });
    await page.click('.tab[data-view="challenges-view"]');
    await page.waitForTimeout(4000);
    const left = await page.evaluate(() => localStorage.getItem("mm-challenge-win"));
    log(
      `C: pending win posted ${wins.length} time(s): ${wins[0]}; still pending after: ${left}; toasts: ${(await page.locator("#toasts").innerText()).replace(/\s+/g, " ")}`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
  try {
    process.kill(-dev.pid);
  } catch {}
  stub.close();
  rmSync(STATE, { recursive: true, force: true });
}
