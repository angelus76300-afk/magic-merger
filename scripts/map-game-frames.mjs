// The island as a map (4.9 part 3), in the real game at a folded phone: the tour of a new island
// (its last shot, the whole island with the names and no card) and the Watch camera's whole-island
// shot with its line. Run `npm run build` first.
//   node scripts/map-game-frames.mjs <out dir> [seed] [WxH]
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "/tmp/map-frames/game";
const SEED = process.argv[3] ?? "21";
const [W, H] = (process.argv[4] ?? "344x882").split("x").map(Number);
mkdirSync(OUT, { recursive: true });
const game = await startLocalGame();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
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
  const world = () => page.frames().find((f) => /\/world(\.html)?$/.test(new URL(f.url(), "http://x").pathname));
  // The tour: a frame a second while it plays, and whether its card is up.
  for (let s = 0; s < 34; s++) {
    await page.waitForTimeout(1000);
    const card = await world()
      ?.evaluate(() => !document.getElementById("first-look")?.hidden)
      .catch(() => null);
    await page.screenshot({ path: join(OUT, `${W}-tour-${String(s).padStart(2, "0")}${card ? "-card" : ""}.png`) });
  }
  await page
    .locator("text=Got it")
    .click({ timeout: 1000 })
    .catch(() => undefined);
  // The watch: until its line is the island's name (the whole-island shot), at most six minutes.
  await world()?.locator("#watch").click();
  const name = await world()?.evaluate(() => document.getElementById("story")?.textContent ?? "");
  let took = 0;
  for (let s = 0; s < 360 && took < 3; s++) {
    await page.waitForTimeout(1000);
    const w = await world()
      ?.evaluate(() => (window.__mmWatch ? window.__mmWatch() : null))
      .catch(() => null);
    if (s % 30 === 0 || w?.sort === "map") console.log(s, w?.sort, w?.dist, w?.caption);
    if (w?.sort === "map") {
      took++;
      await page.screenshot({ path: join(OUT, `${W}-watch-map-${took}.png`) });
      console.log("whole island shot", s, w.caption);
      await page.waitForTimeout(1500);
    }
  }
  console.log("first line", name, "errors", errors);
} finally {
  await browser.close();
  game.stop();
}
