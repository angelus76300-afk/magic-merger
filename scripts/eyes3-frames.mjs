// The eye view, second pass (2026-11-12): frames of a villager walking and running, the mist and the
// far models before and after at the same spots, a far cast with its ring across a valley, an aim
// held on the Cast button with a real touch, a bird climbing and diving, a fish, a beast running.
// Seed 21, the light held mid morning, deviceScaleFactor 2, touch below 1000 px wide. The spots come
// through the __mmEyes hook (frame.ts); the held aim is a real finger (CDP touch events).
//   npm run build && node scripts/eyes3-frames.mjs <out dir> [344x882] [seed]
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "344x882").split("x").map(Number);
const SEED = process.argv[4] ?? "21";
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
  const eyes = (look) => world().evaluate((l) => window.__mmEyes?.(l), look);
  await eyes({ clock: 70 });
  await world()
    .locator("text=Skip")
    .click({ timeout: 2000 })
    .catch(() => undefined);
  await page.waitForTimeout(2500);
  const shot = (name) => page.screenshot({ path: join(OUT, `${W}-${name}.jpg`), type: "jpeg", quality: 85 });
  const tap = async (loc) => {
    try {
      await (TOUCH ? loc.tap({ timeout: 4000, force: true }) : loc.click({ timeout: 4000, force: true }));
    } catch (e) {
      log("tap failed", String(loc), String(e).split("\n")[0]);
    }
  };
  const letGo = async () => {
    if ((await eyes())?.rider) await tap(world().locator("#letgo"));
    await page.waitForTimeout(800);
  };
  // The speed of the creature over one second, cells per second.
  const speed = async () => {
    const a = (await eyes())?.rider;
    await page.waitForTimeout(1000);
    const b = (await eyes())?.rider;
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y).toFixed(1) : "?";
  };

  // 1. A villager walking and running in the woods.
  await eyes({ become: "villager" });
  await page.waitForTimeout(1500);
  await eyes({ place: "forest", pitch: -0.08 });
  await page.waitForTimeout(800);
  await eyes({ stick: { x: 0, y: -0.7 } });
  await page.waitForTimeout(500);
  log("walk", await speed(), "cells/s");
  await shot("01-walk");
  await eyes({ place: "forest", pitch: -0.08 });
  await eyes({ stick: { x: 0, y: -1 } });
  await page.waitForTimeout(500);
  log("run", await speed(), "cells/s");
  await shot("02-run");
  await eyes({ stick: { x: 0, y: 0 } });

  // 2. The mist and the far models, before and after, at the same spots.
  for (const place of ["hill", "village", "forest"]) {
    for (const cuts of [false, true]) {
      const r = await eyes({ place, pitch: -0.06, cuts });
      if (!r) break;
      await page.waitForTimeout(1800);
      const e = await eyes();
      log("spot", place, cuts ? "after" : "before", JSON.stringify(e?.draw));
      await shot(`03-${place}-${cuts ? "after" : "before"}`);
    }
  }

  // 3. A far cast: a spell in hand as a grand one (46 cells), looking across from the hill.
  await tap(world().locator("#hotbar button").first());
  for (let i = 0; i < 40 && !(await eyes())?.held; i++) await page.waitForTimeout(500);
  await eyes({ tier: "grand", place: "hill" });
  let aim = null;
  for (let pitch = -0.04; pitch > -0.5; pitch -= 0.02) {
    aim = (await eyes({ pitch }))?.aim;
    if (aim && aim.hit && aim.dist <= 44) break;
  }
  await page.waitForTimeout(1200);
  log("far ring", JSON.stringify(aim), JSON.stringify((await eyes())?.ring));
  await shot("04-far-ring");

  // 4. A held aim, with a real finger on Cast: down, a drag up and to the left, a frame, then up.
  if (TOUCH) {
    const cdp = await ctx.newCDPSession(page);
    const cb = await world().locator("#castbtn").boundingBox();
    if (cb) {
      await eyes({ pitch: -0.25 });
      await page.waitForTimeout(500);
      const casts0 = (await eyes())?.allCasts ?? 0;
      const at = { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2, id: 7 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      await page.waitForTimeout(150);
      const ring0 = (await eyes())?.aim;
      for (let k = 1; k <= 6; k++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...at, x: at.x - k * 8, y: at.y - k * 12 }] });
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(400);
      const held = await eyes();
      await shot("05-held-aim");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(800);
      const after = await eyes();
      log(
        "held aim",
        JSON.stringify({ from: ring0, to: held?.aim, hold: held?.aimHold, cancel: await world().evaluate(() => !document.getElementById("aimcancel").hidden) }),
        "casts",
        (after?.allCasts ?? 0) - casts0,
      );
    }
  }
  await letGo();

  // 5. A bird: in its eyes, climbing, then diving; then behind it in a banked turn.
  if (await eyes({ become: "bird" })) {
    await page.waitForTimeout(1200);
    await tap(world().locator("#eye"));
    await page.waitForTimeout(600);
    await eyes({ stick: { x: 0, y: -1 }, pitch: 0.4 });
    await page.waitForTimeout(1500);
    log("bird climbing", JSON.stringify((await eyes())?.rider));
    await shot("06-bird-climb");
    await eyes({ pitch: -0.7 });
    await page.waitForTimeout(1500);
    log("bird diving", JSON.stringify((await eyes())?.rider));
    await shot("07-bird-dive");
    await eyes({ pitch: 0 });
    await tap(world().locator("#eye"));
    await page.waitForTimeout(300);
    await eyes({ stick: { x: 0.7, y: -1 } });
    await page.waitForTimeout(1500);
    await shot("08-bird-behind-bank");
    await eyes({ stick: { x: 0, y: 0 } });
    await letGo();
  } else log("no bird");

  // 6. A fish, behind it and in its eyes.
  if (await eyes({ become: "fish" })) {
    await page.waitForTimeout(1200);
    await eyes({ stick: { x: 0.3, y: -1 } });
    await page.waitForTimeout(1500);
    log("fish", JSON.stringify((await eyes())?.rider), "speed", await speed());
    await shot("09-fish-behind");
    await tap(world().locator("#eye"));
    await page.waitForTimeout(1200);
    await shot("10-fish-eyes");
    await eyes({ stick: { x: 0, y: 0 } });
    await letGo();
  } else log("no fish");

  // 7. A beast running: a wolf if the island has one, else a deer; in its eyes, then behind.
  let beast = "wolf";
  if (!(await eyes({ become: "wolf" }))) beast = (await eyes({ become: "deer" })) ? "deer" : "";
  if (beast) {
    await page.waitForTimeout(1200);
    await eyes({ place: "hill", pitch: -0.08 });
    await eyes({ stick: { x: 0, y: -1 } });
    await page.waitForTimeout(400);
    log(beast, "run", await speed(), "cells/s");
    await shot(`11-${beast}-run-eyes`);
    await tap(world().locator("#eye"));
    await page.waitForTimeout(1200);
    await shot(`12-${beast}-run-behind`);
    await eyes({ stick: { x: 0, y: 0 } });
    await letGo();
  } else log("no beast");
  log("errors", JSON.stringify(errors.slice(0, 5)));
} finally {
  await browser.close();
  game.stop();
}
