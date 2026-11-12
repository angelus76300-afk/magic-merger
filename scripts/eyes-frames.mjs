// Through its eyes (2026-11-12): played in a browser at one size. A villager becomes the player's eyes
// (the page's header, drawer and tools hidden), walks, looks round a village, the woods, the shore and a
// house from close, holds a spell from the hot bar with the mark, casts it, presses its own acts, goes
// behind and back, and lets go: the page comes back whole. Then a wolf or a deer, for Strike and Eat.
//   npm run build && node scripts/eyes-frames.mjs <out dir> [344x882] [seed]
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
  const eyes = (look) => world().evaluate((l) => window.__mmEyes?.(l), look);
  const tap = async (loc) => (TOUCH ? loc.tap({ timeout: 4000 }) : loc.click({ timeout: 4000 }));
  // What of the page is shown: the header, the drawer, the tools, and the frame's size.
  const pageParts = () =>
    page.evaluate(() => {
      const shown = (sel) => {
        const e = document.querySelector(sel);
        return !!e && getComputedStyle(e).display !== "none";
      };
      const f = document.querySelector(".world-frame")?.getBoundingClientRect();
      return {
        header: shown(".topbar"),
        drawer: shown(".spellbar"),
        tools: shown(".world-tools"),
        eyes: document.body.classList.contains("eyes"),
        frame: f ? `${Math.round(f.width)}x${Math.round(f.height)}` : "",
      };
    });
  const become = async (kinds) => {
    for (const kind of kinds) {
      for (let tries = 0; tries < 6; tries++) {
        const r = await world().evaluate((k) => window.__mmBecome?.(k), kind);
        if (!r?.tap) break;
        if (TOUCH) await page.touchscreen.tap(box.x + r.tap.x, box.y + r.tap.y);
        else await page.mouse.click(box.x + r.tap.x, box.y + r.tap.y);
        await page.waitForTimeout(700);
        const card = world().locator("#inspect .become");
        if (await card.count()) {
          const ok = await tap(card)
            .then(() => true)
            .catch(() => false);
          if (!ok && !(await world().evaluate(() => window.__mmBecome?.()))?.riding) continue;
          await page.waitForTimeout(2500);
          return kind;
        }
      }
    }
    return null;
  };
  // The stick pushed toward (dx, dy) for `ms` (a mouse: the frame's own pointer events), a frame halfway.
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
    await page.waitForTimeout(400);
  };
  // A drag on the island: the look turns.
  const drag = async (dx, dy) => {
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  };

  log("page before", JSON.stringify(await pageParts()));
  const first = await become(["villager"]);
  log("became", first, JSON.stringify(await eyes()), JSON.stringify(await pageParts()));
  await shot("01-eyes");
  await hold(0, -1, 2400, "02-walking");
  const look0 = (await eyes())?.eye;
  await drag(W * 0.3, -40);
  const look1 = (await eyes())?.eye;
  log("drag turned", look0 && look1 ? `yaw ${(look1.yaw - look0.yaw).toFixed(2)}, pitch ${(look1.pitch - look0.pitch).toFixed(2)}` : "?");
  await shot("03-turned");
  log("village", JSON.stringify((await eyes({ place: "village", pitch: -0.04 }))?.eye));
  await page.waitForTimeout(800);
  await hold(0, -1, 1200);
  await page.waitForTimeout(600);
  await shot("04-village");
  for (const place of ["house", "woods", "shore"]) {
    const r = await eyes({ place, pitch: place === "house" ? 0.12 : -0.06 });
    await page.waitForTimeout(1200);
    log(place, r ? JSON.stringify(r.eye) : "none found");
    await shot(`05-${place}`);
    if (place === "woods") {
      await hold(0, -1, 1600, "05-woods-walking");
    }
  }
  // The hot bar: the first slot taken, waited for until it is in hand.
  const slots = await world().locator("#hotbar button").count();
  log("hot bar", slots, "slots");
  if (slots) {
    await tap(world().locator("#hotbar button").first());
    for (let i = 0; i < 40 && !(await eyes())?.held; i++) await page.waitForTimeout(500);
    await eyes({ pitch: -0.3 });
    await page.waitForTimeout(800);
    log("held", JSON.stringify(await eyes()));
    await shot("06-held");
    await eyes({ pitch: -0.02 });
    await page.waitForTimeout(800);
    await shot("07-held-far");
    await eyes({ pitch: -0.3 });
    await page.waitForTimeout(400);
    if (await world().locator("#castbtn").isVisible()) await tap(world().locator("#castbtn"));
    await page.waitForTimeout(350);
    await shot("08-cast");
    await page.waitForTimeout(1200);
    await shot("08-cast-after");
    log("cast", JSON.stringify(await eyes()));
  }
  const deeds = await world().locator("#deeds .deed").count();
  if (deeds) {
    await tap(world().locator("#deeds .deed").last());
    await page.waitForTimeout(400);
    await shot("09-act");
  }
  await tap(world().locator("#eye"));
  await page.waitForTimeout(1500);
  log("behind", JSON.stringify(await pageParts()));
  await shot("10-behind");
  await tap(world().locator("#eye"));
  await page.waitForTimeout(1000);
  await tap(world().locator("#letgo"));
  await page.waitForTimeout(1200);
  log("let go", JSON.stringify(await pageParts()), JSON.stringify(await eyes()));
  await shot("11-letgo");

  // A hunter or a grazer: its own acts.
  await fresh();
  let second = await become(["wolf", "bear", "fox", "boar", "deer", "rabbit", "hare"]);
  if (!second) {
    for (let k = 0; k < 4; k++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(1500);
    second = await become(["wolf", "bear", "fox", "boar", "deer", "rabbit", "hare"]);
  }
  // None on screen to tap: the nearest one, through the checks' hook.
  for (const kind of ["wolf", "fox", "bear", "deer", "boar", "rabbit"]) {
    if (second) break;
    if (await eyes({ become: kind })) {
      second = kind;
      await page.waitForTimeout(2000);
    }
  }
  log("second", second, JSON.stringify(await eyes()));
  if (second) {
    await hold(0, -1, 1500);
    await shot("12-animal");
    for (const b of await world().locator("#deeds .deed").all()) {
      await tap(b);
      await page.waitForTimeout(300);
    }
    await shot("13-animal-acts");
    log("acts", JSON.stringify(await eyes()));
    // Leaving the World tab and coming back: the page whole while away, the eyes back after.
    await page.evaluate(() => document.querySelector('.tab[data-view="craft-view"]').click());
    await page.waitForTimeout(800);
    log("craft tab", JSON.stringify(await pageParts()));
    await page.evaluate(() => document.querySelector('.tab[data-view="world-view"]').click());
    await page.waitForTimeout(1500);
    log("back on the island", JSON.stringify(await pageParts()), JSON.stringify((await eyes())?.eyes));
    await tap(world().locator("#letgo"));
    await page.waitForTimeout(800);
  }
  log("end", JSON.stringify(await pageParts()), errors);
} finally {
  await browser.close();
  game.stop();
}
