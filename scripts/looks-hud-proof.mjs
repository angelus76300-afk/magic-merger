// The looks' switches in the frame HUD (5.2.5) never cover Watch (the review of
// 13 November: the switch row sat over Watch and took its taps at 390 and 344
// wide). Opens the game with the HUD on, at 390, 344 and 700 wide, and checks
// that the point in the middle of Watch is Watch (elementFromPoint), and that a
// real tap there turns watching on. Exit code 1 if not.
//
//   npx vite --port 5191 &
//   node scripts/looks-hud-proof.mjs
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.GAME_URL ?? "http://localhost:5191/";
const SIZES = [
  [390, 844],
  [344, 882],
  [700, 830],
];
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let failed = 0;
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  // The HUD on, the welcome seen, as a returning player with a long press behind them.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("magic-merger.hud", "1");
      localStorage.setItem("magic-merger.welcomed", "1");
    } catch {
      // storage blocked
    }
  });
  await page.goto(base);
  await page.waitForSelector('.tab[data-view="world-view"]', { timeout: 60_000 });
  // Whatever dialog the page opens first is closed.
  await page.keyboard.press("Escape").catch(() => {});
  await page.click('.tab[data-view="world-view"]');
  const frame = await (await page.waitForSelector("iframe")).contentFrame();
  await frame.waitForSelector("#watch:not([hidden])", { timeout: 60_000 });
  await frame.waitForSelector(".looks button", { timeout: 30_000 });
  // The first look's card goes; the panel settles where it stands (it is placed twice a second).
  await page.waitForTimeout(1500);
  const at = await frame.evaluate(() => {
    const watch = document.querySelector("#watch");
    const r = watch.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const row = document.querySelector(".looks").getBoundingClientRect();
    // Every other control of the World shown now: the point in its middle is that control, not the HUD.
    const covered = [];
    for (const b of document.querySelectorAll("button, [role='button']")) {
      if (b.closest(".looks")) continue;
      const q = b.getBoundingClientRect();
      if (q.width === 0 || q.height === 0 || getComputedStyle(b).visibility === "hidden") continue;
      const at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      if (at && at.closest(".looks")) covered.push(b.id || b.className || b.textContent.trim().slice(0, 12));
    }
    return {
      covered,
      x,
      y,
      onWatch: !!hit && (hit === watch || watch.contains(hit)),
      hit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}${hit.className ? `.${hit.className}` : ""}` : "nothing",
      pressed: watch.getAttribute("aria-pressed"),
      rowBottom: Math.round(row.bottom),
      watchTop: Math.round(r.top),
    };
  });
  // SHOTS=<dir>: a frame of the World with the HUD, at each size.
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/hud-${w}x${h}.png` });
  // A real tap, in page coordinates (the frame fills the World's box).
  const box = await (await page.$("iframe")).boundingBox();
  await page.touchscreen.tap(box.x + at.x, box.y + at.y);
  await page.waitForTimeout(400);
  const after = await frame.evaluate(() => document.querySelector("#watch").getAttribute("aria-pressed"));
  const ok = at.onWatch && after === "true" && at.rowBottom <= at.watchTop && at.covered.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${w}x${h}: controls under the switches: ${at.covered.length ? at.covered.join(", ") : "none"}; at Watch's middle is ${at.hit}; switches end at y ${at.rowBottom}, Watch starts at ${at.watchTop}; a tap on Watch: pressed ${at.pressed} -> ${after}`,
  );
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
