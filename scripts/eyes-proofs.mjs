// Become anything and Through its eyes, played in a browser for what Node cannot see: a cast from the
// eyes counted by a wildfire, a full 15 s cooldown, the hint while possessed, a creature set alight and
// the player thrown out at 0 health with the page whole again, and the stick held right from behind.
//   npm run build && node scripts/eyes-proofs.mjs <out dir> [344x882] [seed]
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
  const header = () => page.evaluate(() => getComputedStyle(document.querySelector(".topbar")).display !== "none");
  const status = () => page.evaluate(() => document.querySelector("#world-status")?.textContent ?? "");

  // 1. A spell in hand from the drawer, then Become from behind: the hint says how a cast works now.
  await page.locator(".spell-list .chip-castable").first().click();
  for (let i = 0; i < 40 && !(await eyes())?.held; i++) await page.waitForTimeout(500);
  log("hint before", JSON.stringify(await status()));
  await eyes({ become: "villager" });
  await page.waitForTimeout(1500);
  await tap(world().locator("#eye"));
  await page.waitForTimeout(1200);
  log("hint from behind", JSON.stringify(await status()));
  // A tap on the island from behind casts.
  const castsBefore = (await eyes())?.allCasts ?? 0;
  const r0 = await world().evaluate(() => window.__mmBecome?.());
  if (TOUCH) await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.62);
  else await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.62);
  await page.waitForTimeout(800);
  const page1 = await page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent));
  log("tap from behind", JSON.stringify({ before: castsBefore, after: (await eyes())?.allCasts, riding: !!r0?.riding, toasts: page1 }));
  await shot("01-behind-cast");

  // 2. The stick held right for 3 s from behind: where it goes on screen.
  {
    const s = await world().locator("#stick").boundingBox();
    const cx = s.x + s.width / 2;
    const cy = s.y + s.height / 2;
    const a = await eyes();
    const theta0 = await world().evaluate(() => window.__mmBecome?.()?.riding);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy, { steps: 4 });
    await page.waitForTimeout(1000);
    const mid = (await eyes())?.rider;
    await page.waitForTimeout(2000);
    const end = (await eyes())?.rider;
    await shot("02-held-right");
    await page.mouse.up();
    log("held right", JSON.stringify({ start: a?.rider, mid, end, theta0: !!theta0 }));
  }

  // 3. A wildfire, the villager eight cells from it in its eyes, a cast from the mark.
  const fire = await world().evaluate(() => window.__mmTrouble?.());
  log("trouble", fire);
  await tap(world().locator("#eye"));
  await page.waitForTimeout(800);
  const at = await eyes({ place: "fire", pitch: -0.2 });
  await page.waitForTimeout(1500);
  const before = (await eyes())?.trouble;
  log("near the fire", JSON.stringify({ eye: at?.eye, aim: at?.aim, trouble: before }));
  await shot("03-fire-aim");
  if (await world().locator("#castbtn").isVisible()) await tap(world().locator("#castbtn"));
  await page.waitForTimeout(1500);
  const after = (await eyes())?.trouble;
  log("cast at the fire", JSON.stringify({ before, after, casts: (await eyes())?.casts }));
  await shot("04-fire-cast");

  // 4. Set alight: the creature burns, and at 0 health the player is thrown out, the page whole.
  await eyes({ burn: true });
  let fell = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const e = await eyes();
    if (i === 2) await shot("05-burning");
    if (!e?.rider) {
      fell = { after: (i + 1) * 0.5, caption: e?.caption, eyes: e?.eyes, header: await header() };
      break;
    }
  }
  await page.waitForTimeout(400);
  await shot("06-fell");
  log("burning", JSON.stringify(fell));

  // 5. A creature with a power: one press, another at once, and one after the full cooldown.
  const p = await eyes({ become: "power" });
  await page.waitForTimeout(1500);
  const pw = (await eyes())?.powers;
  log("power", JSON.stringify(pw), JSON.stringify((await eyes())?.rider));
  if (pw?.length) {
    const b = world().locator("#powers button").first();
    await tap(b);
    await page.waitForTimeout(300);
    const first = await eyes();
    await shot("07-power");
    await tap(b);
    await page.waitForTimeout(300);
    const second = await eyes();
    const t0 = Date.now();
    let left = second?.powers?.[0]?.left ?? 0;
    while (left > 0 && Date.now() - t0 < 40000) {
      await page.waitForTimeout(500);
      left = (await eyes())?.powers?.[0]?.left ?? 0;
    }
    const waited = (Date.now() - t0) / 1000;
    await tap(b);
    await page.waitForTimeout(300);
    const third = await eyes();
    await shot("08-power-again");
    log(
      "cooldown",
      JSON.stringify({
        does: pw[0].do,
        first: [first?.powers?.[0], first?.caption],
        second: [second?.powers?.[0], second?.caption],
        waited,
        third: [third?.powers?.[0], third?.caption],
      }),
    );
  }
  log("end", p ? "ok" : "no power creature", errors);
} finally {
  await browser.close();
  game.stop();
}
