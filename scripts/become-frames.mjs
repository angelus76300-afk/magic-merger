// Become anything (2026-11-12): played in a browser at one size. A villager's card with Become, the
// villager possessed, the stick held, Let go, then a creature with an ability of its own (or a wolf,
// a deer, a bird) possessed, its buttons pressed.
//   npm run build && node scripts/become-frames.mjs <out dir> [344x882] [seed]
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "344x882").split("x").map(Number);
const SEED = process.argv[4] ?? "21";
// A desktop is played with a mouse: its page has no rail, its tools are a row at the top.
const TOUCH = W < 1000;
const game = await startLocalGame();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
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
  const world = () => page.frames().find((f) => /\/world(\.html)?$/.test(new URL(f.url(), "http://x").pathname));
  let box = null;
  // A new island from the seed, its tour ended with a tap: play starts over a village.
  const fresh = async () => {
    await page.click("#world-reset");
    await page.waitForSelector("dialog.reset-island[open]");
    await page.fill("dialog.reset-island input[type=text]", SEED);
    await page.click("dialog.reset-island .primary");
    await page.waitForTimeout(4000);
    await page
      .locator("text=Got it")
      .click({ timeout: 1000 })
      .catch(() => undefined);
    box = await (await world().frameElement()).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
    await page.waitForTimeout(2500);
  };
  await fresh();
  const shot = (name) => page.screenshot({ path: join(OUT, `${W}-${name}.jpg`), type: "jpeg", quality: 85 });
  const state = () => world().evaluate(() => window.__mmBecome?.());

  // Taps a creature of one of these kinds on screen, and presses Become on its card.
  const become = async (kinds, name) => {
    for (const kind of kinds) {
      for (let tries = 0; tries < 6; tries++) {
        const r = await world().evaluate((k) => window.__mmBecome?.(k), kind);
        console.log("find", kind, JSON.stringify(r?.tap));
        if (!r?.tap) break;
        if (TOUCH) await page.touchscreen.tap(box.x + r.tap.x, box.y + r.tap.y);
        else await page.mouse.click(box.x + r.tap.x, box.y + r.tap.y);
        await page.waitForTimeout(700);
        const card = world().locator("#inspect .become");
        if (await card.count()) {
          await shot(`${name}-card`);
          // The card is redrawn twice a second, and closes if its creature walks off the island's edge of view.
          const ok = await card[TOUCH ? "tap" : "click"]({ timeout: 3000 })
            .then(() => true)
            .catch(() => false);
          if (!ok && !(await state())?.riding) continue;
          await page.waitForTimeout(2500);
          return kind;
        }
      }
    }
    return null;
  };
  // Holds the stick pushed toward (dx, dy) for `ms`, with a frame halfway.
  const hold = async (dx, dy, ms, name) => {
    const s = await world().locator("#stick").boundingBox();
    const cx = s.x + s.width / 2;
    const cy = s.y + s.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx * 40, cy + dy * 40, { steps: 4 });
    await page.waitForTimeout(ms / 2);
    if (name) await shot(name);
    await page.waitForTimeout(ms / 2);
    await page.mouse.up();
    await page.waitForTimeout(500);
  };

  const first = await become(["villager"], "villager");
  console.log("became", first, JSON.stringify(await state()));
  await shot("villager-possessed");
  const before = (await state())?.riding;
  await hold(0, -1, 3000, "villager-walking");
  await hold(1, 0, 2400, "villager-turned");
  const after = (await state())?.riding;
  console.log("moved", before && after ? Math.hypot(after.x - before.x, after.y - before.y).toFixed(1) : "?", "cells", JSON.stringify(after));
  // A drag on the island turns the view a little and keeps it on the villager.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.45, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await shot("villager-dragged");
  console.log("after a drag", JSON.stringify(await state()));
  await world().locator("#letgo")[TOUCH ? "tap" : "click"]();
  await page.waitForTimeout(1200);
  await shot("villager-letgo");
  console.log("let go", JSON.stringify(await state()));

  // The island again from its start (the camera stayed where the villager was let go), then a
  // creature with an ability of its own, or an animal, further out if none is near.
  await fresh();
  const kinds = ["power", "wolf", "bear", "boar", "deer", "rabbit"];
  let second = await become(kinds, "second");
  if (!second) {
    for (let k = 0; k < 2; k++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(1500);
    second = await become(kinds, "second");
  }
  console.log("became", second, JSON.stringify(await state()));
  await shot("second-possessed");
  await hold(0, -1, 3000, "second-walking");
  const buttons = await world().locator("#powers button").count();
  if (buttons) {
    await world().locator("#powers button").first()[TOUCH ? "tap" : "click"]();
    await page.waitForTimeout(600);
    await shot("second-power");
    console.log("pressed", JSON.stringify(await state()));
  }
  await world().locator("#letgo")[TOUCH ? "tap" : "click"]();
  await page.waitForTimeout(800);
  await shot("second-letgo");
  console.log("end", JSON.stringify(await state()), `${buttons} buttons`, errors);
} finally {
  await browser.close();
  game.stop();
}
