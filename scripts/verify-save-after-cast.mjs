// Verifies that a cast is saved within seconds (2026-11-07, found by the
// planner's playtest): cast a spell right after the 10 s timer saved the
// island, then check that a save lands within 3 s. Before the fix the next
// save came at the next tick, and a reload in between lost the cast.
// Mock mode, a fresh local D1, 390 by 844. Run after `npm run build`.
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const { chromium } = createRequire(join(REPO, "package.json"))("playwright");
const ADMIN = "admin-local-verify";
const STATE = mkdtempSync(join(tmpdir(), "mm-verify-"));
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", WRANGLER_SEND_METRICS: "false", CI: "1" };
const m = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "magic-merger", "--local", "--persist-to", STATE], { env, encoding: "utf8", cwd: REPO });
if (m.status !== 0) throw new Error(m.stderr || m.stdout);
const port = 9100 + Math.floor(Math.random() * 50);
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
    "--var",
    `ADMIN_TOKEN:${ADMIN}`,
  ],
  { env, stdio: ["ignore", "inherit", "inherit"], detached: true, cwd: REPO },
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
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((t) => localStorage.setItem("magic-merger.token", t), ADMIN);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".chip-inventory", { timeout: 20000 });
  const esc = async () => {
    for (let i = 0; i < 4 && (await page.locator("dialog[open]").count()); i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  };
  await esc();
  // One spell: merge Fire and Water.
  await page.locator(".chip-inventory", { hasText: "Fire" }).first().click();
  await page.locator(".chip-inventory", { hasText: "Water" }).first().click();
  const chips = page.locator(".chip-board");
  const a = await chips.nth(1).boundingBox();
  const b = await chips.nth(0).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * k) / 8, a.y + a.height / 2 + ((b.y - a.y) * k) / 8);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll(".chip-board.merging").length === 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await esc();
  await page.click('.tab[data-view="world-view"]');
  await page.waitForTimeout(4000);
  await esc();
  const at = () => page.evaluate(() => Number(localStorage.getItem("magic-merger.world2.at") ?? 0));
  // Cast right after a timer save, so the timer cannot save it by chance.
  const first = await at();
  for (let i = 0; i < 150 && (await at()) === first; i++) await page.waitForTimeout(100);
  await page.locator(".chip-castable").first().click();
  await page.waitForTimeout(300);
  const box = await page.locator("#world-view").boundingBox();
  const castAt = Date.now();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await page.waitForTimeout(3000);
  const saved = await at();
  const r = { castAt, savedAt: saved, savedAfterCast: saved > castAt, waitedMs: Date.now() - castAt };
  console.log(JSON.stringify(r));
  if (!r.savedAfterCast) {
    console.log("FAIL a cast is saved within 3 s");
    process.exitCode = 1;
  } else console.log("ok   a cast is saved within 3 s");
} finally {
  await browser.close();
  try {
    process.kill(-dev.pid);
  } catch {
    // already gone
  }
  rmSync(STATE, { recursive: true, force: true });
}
