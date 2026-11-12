// One real tap on a slot of the eye view's bar: the spell is held, Cast shows, a cast goes, and a second
// tap puts it away (the review of 12 November found the tap picking and dropping at once).
//   npm run build && node scripts/eyes-tap-proof.mjs <out dir> [344x882] [seed]
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "344x882").split("x").map(Number);
const SEED = process.argv[4] ?? "7";
const TOUCH = W < 1000;
const game = await startLocalGame();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const log = (...a) => console.log(`[${W}]`, ...a);
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: TOUCH });
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
  await page.fill("dialog.reset-island input[type=text]", SEED);
  await page.click("dialog.reset-island .primary");
  await page.waitForTimeout(4000);
  await page
    .locator("text=Got it")
    .click({ timeout: 1000 })
    .catch(() => undefined);
  const box = await (await world().frameElement()).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.waitForTimeout(2500);
  const shot = (name) => page.screenshot({ path: join(OUT, `${W}-proof-${name}.jpg`), type: "jpeg", quality: 85 });
  const eyes = (look) => world().evaluate((l) => window.__mmEyes?.(l), look);
  const tap = async (loc) => (TOUCH ? loc.tap({ timeout: 4000 }) : loc.click({ timeout: 4000 }));

  // One real tap on a slot of the bar: the spell is held, Cast shows, and a cast goes.
  await eyes({ become: "villager" });
  await page.waitForTimeout(2500);
  const fw = world();
  const slot = fw.locator("#hotbar button").first();
  await tap(slot);
  await page.waitForTimeout(1200);
  const after = await fw.evaluate(() => ({
    pressed: [...document.querySelectorAll("#hotbar button")].map((b) => b.getAttribute("aria-pressed")).filter((x) => x === "true").length,
    cast: (() => {
      const c = document.querySelector("#castbtn");
      return !!c && !c.hidden && getComputedStyle(c).display !== "none";
    })(),
  }));
  const e1 = await eyes();
  log("one tap on a slot", JSON.stringify({ ...after, held: e1?.held, casts: e1?.allCasts }));
  await shot("tap-held");
  await tap(fw.locator("#castbtn"));
  await page.waitForTimeout(1500);
  const e2 = await eyes();
  log("then Cast", JSON.stringify({ held: e2?.held, casts: e2?.allCasts }));
  // A second tap on the same slot puts it away.
  await tap(fw.locator("#hotbar button").first());
  await page.waitForTimeout(800);
  log("second tap", JSON.stringify({ held: (await eyes())?.held }));
  log("errors", JSON.stringify(errors));
} finally {
  await browser.close();
  game.stop();
}
