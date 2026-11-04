// Verifies the fix for picking a spell still being made (4.4.5 part B,
// owner's report) against the real Worker (wrangler dev, a fresh local D1, a
// stub Claude that writes the second spell slowly): the creation bar shows,
// a tap on the island says to wait, and the previous spell is never cast.
// Run after `npm run build`.
import { createRequire } from "node:module";

// require, not import: it also finds a Playwright installed globally (NODE_PATH), as lab-browser.mjs does.
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN = "admin-local-verify";
const STATE = mkdtempSync(join(tmpdir(), "mm-verify-"));
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", WRANGLER_SEND_METRICS: "false", CI: "1" };
let calls = 0;
let spellsAsked = 0;
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
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
    // The second spell is written slowly: the player picks it meanwhile.
    if (system.startsWith("You write the spells") && ++spellsAsked >= 2) await new Promise((r) => setTimeout(r, 25000));
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
  } catch {
    // not up yet
  }
  if (i > 120) throw new Error("wrangler dev did not start");
  await new Promise((r) => setTimeout(r, 500));
}
const log = (s) => console.log(s);
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
async function merge(page, a, b) {
  await page.click('.tab[data-view="craft-view"]');
  await page.waitForTimeout(500);
  await page.locator(".chip-inventory", { hasText: a }).first().click();
  await page.locator(".chip-inventory", { hasText: b }).first().click();
  const chips = page.locator(".chip-board");
  const n = await chips.count();
  const p = await chips.nth(n - 1).boundingBox();
  const q = await chips.nth(n - 2).boundingBox();
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(p.x + p.width / 2 + ((q.x - p.x) * i) / 6, p.y + p.height / 2 + ((q.y - p.y) * i) / 6);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll(".chip-board.merging").length === 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3 && (await page.locator("dialog[open]").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}
async function tapIsland(page) {
  const box = await page.locator("iframe").first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
let failed = 0;
const expect = (name, ok, detail) => {
  log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed++;
};
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem("magic-merger.token", t);
    window.__casts = [];
    window.addEventListener("message", (e) => {
      if (e.data && e.data.type === "cast") window.__casts.push(e.data.key);
    });
  }, ADMIN);
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".chip-inventory", { timeout: 20000 });
  // A first spell, ready and cast once.
  await merge(page, "Fire", "Water");
  await page.click('.tab[data-view="world-view"]');
  await page.waitForTimeout(1500);
  await page.locator(".chip-castable", { hasText: "Answer" }).first().click();
  for (let i = 0; i < 80 && !/Tap the island to cast/.test(await page.locator("#world-status").innerText()); i++) await page.waitForTimeout(500);
  await page.waitForTimeout(3000);
  await tapIsland(page);
  await page.waitForTimeout(1500);
  const first = await page.evaluate(() => window.__casts.slice());
  expect("the ready spell casts", first.length === 1, `casts ${JSON.stringify(first)}`);
  // A second one, still being written when it is picked.
  await merge(page, "Earth", "Air");
  await page.click('.tab[data-view="world-view"]');
  await page.waitForTimeout(1000);
  // A chip that is not the first spell.
  const chips = page.locator(".chip-castable");
  let pick = -1;
  for (let k = 0; k < (await chips.count()); k++) if ((await chips.nth(k).getAttribute("data-key")) !== first[0]) pick = k;
  await chips.nth(pick).click();
  await page.waitForTimeout(1500);
  const bar = await page
    .locator(".creation-bar")
    .isVisible()
    .catch(() => false);
  const width1 = await page
    .locator(".creation-bar > i")
    .evaluate((e) => e.style.width)
    .catch(() => "");
  await page.waitForTimeout(3000);
  const width2 = await page
    .locator(".creation-bar > i")
    .evaluate((e) => e.style.width)
    .catch(() => "");
  expect("a spell being made shows the creation bar, filling", bar && parseFloat(width2) > parseFloat(width1), `visible ${bar}, ${width1} then ${width2}`);
  await tapIsland(page);
  await page.waitForTimeout(1200);
  const toasts = (await page.locator("#toasts").innerText()).replace(/\s+/g, " ");
  const after = await page.evaluate(() => window.__casts.slice());
  expect(
    "a tap meanwhile says to wait and casts nothing",
    /Wait for the incantation/.test(toasts) && after.length === 1,
    `casts ${after.length}; toasts: ${toasts.slice(-160)}`,
  );
  // Once written, it is in hand by itself: a tap casts it.
  for (let i = 0; i < 120 && !/Tap the island to cast/.test(await page.locator("#world-status").innerText()); i++) await page.waitForTimeout(500);
  await page.waitForTimeout(3000);
  await tapIsland(page);
  await page.waitForTimeout(1500);
  const last = await page.evaluate(() => window.__casts.slice());
  const hidden = !(await page
    .locator(".creation-bar")
    .isVisible()
    .catch(() => false));
  expect(
    "once ready it is in hand without picking it again, and the bar is gone",
    last.length === 2 && last[1] !== first[0] && hidden,
    `casts ${JSON.stringify(last)}, bar hidden ${hidden}`,
  );
  await ctx.close();
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
process.exit(failed ? 1 : 0);
