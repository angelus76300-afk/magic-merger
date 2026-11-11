// The island needs you: a wildfire played in a browser at one size, with a frame every ten seconds, the Craft tab while it runs and the new island dialog.
//   npm run build && node scripts/trouble-frames.mjs <out dir> [344x882] [seed]
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "344x882").split("x").map(Number);
const SEED = process.argv[4] ?? "21";
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
    } catch {}
  }, game.ADMIN);
  await page.goto(game.BASE + "/");
  await page.waitForSelector(".chip-inventory", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const esc = async () => {
    for (let i = 0; i < 4 && (await page.locator("dialog[open]:not(.reset-island)").count()); i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  };
  await esc();
  await page.click('.tab[data-view="world-view"]');
  await page.waitForTimeout(3000);
  await esc();
  await page.click("#world-reset");
  await page.waitForSelector("dialog.reset-island[open]");
  await page.screenshot({ path: join(OUT, `${W}-dialog.jpg`), type: "jpeg", quality: 85 });
  await page.fill("dialog.reset-island input[type=text]", SEED);
  await page.click("dialog.reset-island .primary");
  await page.waitForTimeout(4000);
  await page
    .locator("text=Got it")
    .click({ timeout: 1000 })
    .catch(() => undefined);
  const world = () => page.frames().find((f) => /\/world(\.html)?$/.test(new URL(f.url(), "http://x").pathname));
  const stage = await page.locator("#world-stage").boundingBox();
  // End the tour with a tap, then force a trouble through the frame's test hook.
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height * 0.6);
  await page.waitForTimeout(1500);
  const started = await world().evaluate(() => window.__mmTrouble?.());
  console.log("started", started);
  for (let s = 0; s <= 120; s += 10) {
    if (s === 20)
      await world()
        .locator("#story")
        .click()
        .catch(() => console.log("no story line to tap"));
    await page.screenshot({ path: join(OUT, `${W}-t${String(s).padStart(3, "0")}.jpg`), type: "jpeg", quality: 85 });
    if (s === 60) {
      await page.click('.tab[data-view="craft-view"]');
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT, `${W}-craft.jpg`), type: "jpeg", quality: 85 });
      await page.click('.tab[data-view="world-view"]');
    }
    await page.waitForTimeout(10000);
  }
  console.log("state", await world().evaluate(() => window.__mmTrouble?.(true)), errors);
} finally {
  await browser.close();
  game.stop();
}
