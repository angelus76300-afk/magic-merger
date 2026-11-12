// The Watch camera starts on its button and never by itself (the owner, 12 November). Played in a
// browser: 22 seconds without a touch leave the camera where it was and the button off; a press on
// Watch starts it; a tap on the island ends it.
//   npm run build && node scripts/watch-idle-proof.mjs [344x882] [seed]
import { createRequire } from "node:module";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [W, H] = (process.argv[2] ?? "344x882").split("x").map(Number);
const SEED = process.argv[3] ?? "21";
const game = await startLocalGame();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let failed = 0;
const check = (ok, name, got = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${got ? `: ${got}` : ""}`);
};
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
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
  // One tap ends the tour of the new island; then hands off.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.waitForTimeout(2500);
  const state = () =>
    world().evaluate(() => {
      const b = document.querySelector("#watch");
      return { pressed: b?.getAttribute("aria-pressed"), label: b?.textContent?.trim() ?? "", stats: window.__mmWatch?.() ?? null };
    });
  const before = await state();
  await page.waitForTimeout(22000);
  const idle = await state();
  check(
    idle.pressed !== "true" && !/watching/i.test(idle.label),
    "22 s without a touch: the Watch button is still off",
    JSON.stringify({ pressed: idle.pressed, label: idle.label }),
  );
  check(
    JSON.stringify(idle.stats?.shots ?? idle.stats?.starts ?? null) === JSON.stringify(before.stats?.shots ?? before.stats?.starts ?? null),
    "and no shot was taken meanwhile",
    JSON.stringify(idle.stats),
  );
  await world().locator("#watch").tap();
  await page.waitForTimeout(2500);
  const on = await state();
  check(on.pressed === "true" || /watching/i.test(on.label), "a press on Watch starts it", JSON.stringify({ pressed: on.pressed, label: on.label }));
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.45);
  await page.waitForTimeout(1500);
  const off = await state();
  check(off.pressed !== "true" && !/watching/i.test(off.label), "a tap on the island ends it", JSON.stringify({ pressed: off.pressed, label: off.label }));
} finally {
  await browser.close();
  game.stop();
}
if (failed) process.exit(1);
