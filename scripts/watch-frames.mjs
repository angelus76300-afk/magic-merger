// The island tells its stories (2026-11-11): an untouched island watched for some minutes at the
// owner's Z Fold sizes, with a frame every 20 seconds and the number the update is held to: the
// share of ten second windows in which the subject the line is about is on screen and a villager
// there would stand at least 24 px tall. Before the update the camera never moved: 0.
//   npm run build && node scripts/watch-frames.mjs <out dir> [--minutes 5] [--seed 7] [--url <a deployed copy>] [--sizes 344x882,700x830]
// With --url and MM_TOKEN it plays a deployed copy (a preview, staging; never production).
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { startLocalGame } from "./local-game.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = resolve(process.argv[2] ?? "watch-frames");
const MINUTES = Number(arg("minutes", 5));
const SEED = arg("seed", "7");
const SIZES = arg("sizes", "344x882,700x830")
  .split(",")
  .map((s) => s.split("x").map(Number));
const url = arg("url", "");
mkdirSync(OUT, { recursive: true });
const game = url ? { BASE: url.replace(/\/$/, ""), ADMIN: process.env.MM_TOKEN ?? "", stop() {} } : await startLocalGame();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = {};
try {
  await Promise.all(
    SIZES.map(async ([width, height]) => {
      const tag = `${width}x${height}`;
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("magic-merger.token", t);
        } catch {
          // the sandboxed frames have no storage
        }
      }, game.ADMIN);
      await page.goto(`${game.BASE}/`);
      await page.waitForSelector(".chip-inventory", { timeout: 30000 });
      await page.waitForTimeout(1500);
      const closeDialogs = async () => {
        for (let i = 0; i < 4 && (await page.locator("dialog[open]:not(.reset-island)").count()); i++) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(300);
        }
      };
      await closeDialogs();
      await page.click('.tab[data-view="world-view"]');
      await page.waitForTimeout(3000);
      await closeDialogs();
      await page.click("#world-reset");
      await page.waitForSelector("dialog.reset-island[open]");
      await page.fill("dialog.reset-island input[type=text]", SEED);
      await page.click("dialog.reset-island .primary");
      await page.waitForTimeout(4000);
      await page
        .locator("text=Got it")
        .click({ timeout: 1000 })
        .catch(() => undefined);
      const world = () => page.frames().find((f) => /\/world(\.html)?$/.test(new URL(f.url(), "http://x").pathname));
      // The Watch button, when the game has one: a new island waits for its first cast before it watches by itself.
      const button = world()?.locator("#watch");
      const has = button ? await button.count() : 0;
      if (has) await button.click();
      const windows = [];
      let ok = 0;
      let n = 0;
      const captions = new Set();
      const steps = Math.round(MINUTES * 60);
      for (let s = 0; s <= steps; s++) {
        const w = await world()
          ?.evaluate(() => (window.__mmWatch ? window.__mmWatch() : null))
          .catch(() => null);
        n++;
        if (w && w.onScreen && w.px * 1.6 >= 24 && w.caption) ok++;
        if (w?.caption) captions.add(w.caption);
        if (n === 10) {
          windows.push(ok >= 6);
          ok = 0;
          n = 0;
        }
        if (s % 20 === 0) await page.screenshot({ path: join(OUT, `${tag}-t${String(s).padStart(4, "0")}.jpg`), type: "jpeg", quality: 88 });
        await page.waitForTimeout(1000);
      }
      let gap = 0;
      let longest = 0;
      for (const good of windows) {
        gap = good ? 0 : gap + 10;
        longest = Math.max(longest, gap);
      }
      report[tag] = {
        watchButton: !!has,
        windows: windows.length,
        share: windows.length ? windows.filter(Boolean).length / windows.length : 0,
        longestGapSeconds: longest,
        captions: captions.size,
        errors,
      };
      await ctx.close();
    }),
  );
} finally {
  await browser.close();
  game.stop();
}
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
