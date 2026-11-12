// The eye view, second pass (2026-11-12): what the eye view costs, measured with the game's own perf
// sample (engine.stats, the numbers a phone sends to /api/perf) in a headless browser, at a phone's
// sizes with deviceScaleFactor 2: from the sky, then in a villager's eyes walking in woods, standing in
// a village, and on a hill looking across the island; on the medium island a phone gets and a large
// one. Software WebGL (SwiftShader): the CPU side only, the GPU is not measured. Each place twice in
// the same scene: as drawn before the second pass (the eye view's cuts off) and as played now.
//   npm run build && node scripts/eyes-perf.mjs <out.jsonl> [344x882,700x830] [medium,large]
import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const SIZES = (process.argv[3] ?? "344x882,700x830").split(",").map((s) => s.split("x").map(Number));
const ISLANDS = (process.argv[4] ?? "medium,large").split(",");
const SECONDS = Number(process.env.SECONDS ?? 6);
const game = await startLocalGame();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [W, H] of SIZES)
    for (const island of ISLANDS) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true });
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
      await page.goto(game.BASE + "/");
      await page.waitForSelector(".chip-inventory", { timeout: 30000 });
      await page.waitForTimeout(1500);
      for (let i = 0; i < 4 && (await page.locator("dialog[open]").count()); i++) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
      await page.click('.tab[data-view="world-view"]');
      await page.waitForTimeout(3000);
      const world = () => page.frames().find((f) => /\/world(\.html)?$/.test(new URL(f.url(), "http://x").pathname));
      await page.click("#world-reset");
      await page.waitForSelector("dialog.reset-island[open]");
      await page.selectOption("dialog.reset-island select >> nth=0", island).catch(() => undefined);
      await page.fill("dialog.reset-island input[type=text]", "21");
      await page.click("dialog.reset-island .primary");
      await page.waitForTimeout(5000);
      await page
        .locator("text=Got it")
        .click({ timeout: 1000 })
        .catch(() => undefined);
      const eyes = (look) => world().evaluate((l) => window.__mmEyes?.(l), look);
      await eyes({ clock: 70 });
      await world()
        .locator("text=Skip")
        .click({ timeout: 2000 })
        .catch(() => undefined);
      await page.waitForTimeout(3000);
      const measure = async (place, tag, extra = {}) => {
        await eyes({ stats: true, prof: true, ...extra });
        await page.waitForTimeout(SECONDS * 1000);
        const r = await eyes({ prof: false, tris: true });
        const p = r.perf;
        const row = {
          tag,
          size: `${W}x${H}`,
          island,
          w: r.size?.w,
          place,
          view: p.view,
          frames: p.frames,
          frameP50: p.frameP50,
          frameP95: p.frameP95,
          simP50: p.simP50,
          simP95: p.simP95,
          renderP50: p.renderP50,
          renderP95: p.renderP95,
          calls: r.draw?.calls,
          triangles: r.draw?.triangles,
          draw: r.prof?.draw,
          total: r.prof?.total,
          tris: r.tris,
        };
        appendFileSync(OUT, JSON.stringify(row) + "\n");
        console.log(JSON.stringify(row));
      };
      await measure("sky", "now");
      await eyes({ become: "villager" });
      await page.waitForTimeout(1500);
      for (const [place, look, stick] of [
        ["woods", { place: "forest", pitch: -0.05 }, { x: 0, y: -0.5 }],
        ["village", { place: "village", pitch: -0.05 }, { x: 0, y: 0 }],
        ["hill", { place: "hill", pitch: -0.08 }, { x: 0, y: 0 }],
      ]) {
        for (const cuts of [false, true]) {
          const at = await eyes({ ...look, cuts });
          if (!at) {
            console.log(JSON.stringify({ size: `${W}x${H}`, island, place, missing: true }));
            break;
          }
          await page.waitForTimeout(1500);
          await measure(place, cuts ? "after" : "before", { stick });
          await eyes({ stick: { x: 0, y: 0 } });
        }
      }
      if (errors.length) console.log("errors", JSON.stringify(errors.slice(0, 3)));
      await ctx.close();
    }
} finally {
  await browser.close();
  game.stop();
}
