// Through its eyes, round two (2026-11-12), played in a browser at one size: the first eye frame, a
// villager's trade on what is in front, the whole spell book from the bar, two fingers at once (the
// stick held while Cast and an act are pressed), taps on the upper half, no ring no cast, the trouble
// line, health and burning, dying by its own Fire, Let go putting the spell away; and with `trees`,
// only the frames looking up at crowns and eaves (for the before and after of the undersides).
//   npx vite build && node scripts/eyes-frames2.mjs <out dir> [344x882] [seed] [trees]
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "344x882").split("x").map(Number);
const SEED = process.argv[4] ?? "21";
const TREES = process.argv[5] === "trees";
const TAG = process.argv[6] ?? "";
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
  let box = await (await world().frameElement()).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.waitForTimeout(2500);
  const shot = (name) => page.screenshot({ path: join(OUT, `${W}-${name}${TAG}.jpg`), type: "jpeg", quality: 85 });
  const eyes = (look) => world().evaluate((l) => window.__mmEyes?.(l), look);
  const tap = async (loc) => {
    try {
      await (TOUCH ? loc.tap({ timeout: 4000, force: true }) : loc.click({ timeout: 4000, force: true }));
    } catch (e) {
      log("tap failed", String(loc), String(e).split("\n")[0]);
    }
  };
  const frameBox = async () => (box = await (await world().frameElement()).boundingBox());

  if (TREES) {
    // The same spots before and after: under the crowns of the nearest woods, and under a house's eaves, looking up.
    await eyes({ become: "villager" });
    await page.waitForTimeout(1500);
    for (const [place, yaw, name] of [
      ["woods", 0, "trees-woods"],
      ["woods", Math.PI / 2, "trees-woods-2"],
      ["house", null, "trees-house"],
      ["village", null, "trees-village"],
    ]) {
      const r = await eyes({ place });
      if (!r) {
        log(place, "none");
        continue;
      }
      if (yaw !== null) await eyes({ yaw });
      await eyes({ pitch: 0.45 });
      await page.waitForTimeout(1500);
      log(name, JSON.stringify((await eyes())?.eye));
      await shot(name);
    }
  }
  if (!TREES) {
    // 1. The first frame in the eyes, for a few villagers: not one flat colour.
    for (const job of ["job:woodcutter", "job:farmer", "job:fisher", "job:builder", "job:priest"]) {
      const r = await eyes({ become: job });
      if (!r) {
        log("no villager of that trade", job);
        continue;
      }
      await page.waitForTimeout(2000);
      const e = await eyes();
      log("first frame", job, r ? "" : "none", JSON.stringify(e?.eye), JSON.stringify(e?.deeds));
      await shot(`01-first-${job.slice(4)}`);
      // Its trade: in the woods for the woodcutter, the shore for the fisher, as it stands for the farmer.
      if (job === "job:woodcutter") await eyes({ place: "woods", pitch: -0.1 });
      if (job === "job:fisher") await eyes({ place: "shore", pitch: -0.2 });
      await page.waitForTimeout(1200);
      const before = (await eyes())?.deeds;
      const trade = world().locator("#deeds .deed").last();
      if (await trade.count()) await tap(trade);
      await page.waitForTimeout(500);
      const after = await eyes();
      log("trade", job, JSON.stringify(before), JSON.stringify(after?.caption));
      await shot(`02-trade-${job.slice(4)}`);
      await tap(world().locator("#letgo"));
      await page.waitForTimeout(800);
    }

    // 2. The whole spell book: the bar scrolls, All opens the list with a search.
    await eyes({ become: "villager" });
    await page.waitForTimeout(1500);
    const slots = await world().locator("#hotbar button").count();
    await tap(world().locator("#hotbar button.all"));
    await page.waitForTimeout(500);
    await shot("03-all");
    await world().locator("#allspells input").fill("fi");
    await page.waitForTimeout(300);
    await shot("03-all-search");
    const found = await world().locator("#allspells .list button").count();
    if (found) await tap(world().locator("#allspells .list button").first());
    for (let i = 0; i < 40 && !(await eyes())?.held; i++) await page.waitForTimeout(500);
    const order0 = (await eyes())?.hot;
    log("book", JSON.stringify({ slots, found, held: (await eyes())?.held }));

    // 3. Two fingers: the stick held by one, Cast and the act pressed by the other (CDP touches).
    if (TOUCH) {
      const cdp = await ctx.newCDPSession(page);
      await frameBox();
      const s = await world().locator("#stick").boundingBox();
      const cb = await world().locator("#castbtn").boundingBox();
      const stickAt = { x: s.x + s.width / 2, y: s.y + s.height / 2 - 40, id: 1 };
      const castAt = cb ? { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2, id: 2 } : null;
      const from = (await eyes())?.rider;
      const casts0 = (await eyes())?.allCasts ?? 0;
      await eyes({ pitch: -0.4 });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: s.x + s.width / 2, y: s.y + s.height / 2, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [stickAt] });
      await page.waitForTimeout(600);
      if (castAt) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [stickAt, castAt] });
        await page.waitForTimeout(100);
        await shot("04-two-fingers");
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [stickAt] });
      }
      await page.waitForTimeout(600);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(300);
      const to = (await eyes())?.rider;
      const casts1 = (await eyes())?.allCasts ?? 0;
      log(
        "two fingers",
        JSON.stringify({
          walked: from && to ? Math.hypot(to.x - from.x, to.y - from.y).toFixed(2) : "?",
          casts: `${casts0} to ${casts1}`,
          order: JSON.stringify((await eyes())?.hot) === JSON.stringify(order0),
        }),
      );
    }

    // 4. Taps on the upper and lower halves: each casts at the mark, or says why not.
    await frameBox();
    const results = [];
    for (const fy of [0.15, 0.3, 0.45, 0.6]) {
      await eyes({ pitch: -0.35 });
      await page.waitForTimeout(400);
      const a = (await eyes())?.allCasts ?? 0;
      if (TOUCH) await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * fy);
      else await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * fy);
      await page.waitForTimeout(500);
      results.push(`${fy}: ${((await eyes())?.allCasts ?? 0) - a}`);
    }
    log("taps cast", results.join(", "));
    // At the sky: no ring, no cast, the line says why.
    await eyes({ pitch: 0.45 });
    await page.waitForTimeout(500);
    const a = (await eyes())?.allCasts ?? 0;
    await tap(world().locator("#castbtn"));
    await page.waitForTimeout(300);
    log("at the sky", JSON.stringify({ casts: ((await eyes())?.allCasts ?? 0) - a, caption: (await eyes())?.caption }));
    await shot("05-sky");

    // 5. The trouble line above the thought, health, a warm edge while it burns.
    log("trouble", await world().evaluate(() => window.__mmTrouble?.()));
    await eyes({ pitch: -0.1 });
    await page.waitForTimeout(1200);
    await shot("06-trouble");
    // Out of the village, whose ward puts out fire on its people.
    await eyes({ place: "woods" });
    await page.waitForTimeout(800);
    await eyes({ burn: true });
    await page.waitForTimeout(1500);
    await shot("07-burning");
    log("burning", JSON.stringify((await eyes())?.rider), JSON.stringify((await eyes())?.caption));
    for (let i = 0; i < 30 && (await eyes())?.rider; i++) await page.waitForTimeout(500);
    log("after burning", JSON.stringify((await eyes())?.held), JSON.stringify((await eyes())?.caption));
    if ((await eyes())?.rider) await tap(world().locator("#letgo"));
    await page.waitForTimeout(800);

    // 6. Dying by its own Fire: Fire in hand, cast at its own feet, the stick at rest.
    await eyes({ become: "villager" });
    await page.waitForTimeout(1500);
    await tap(world().locator("#hotbar button.all"));
    await world().locator("#allspells input").fill("Fire");
    await page.waitForTimeout(300);
    if (await world().locator("#allspells .list button").count()) await tap(world().locator("#allspells .list button").first());
    for (let i = 0; i < 40 && (await eyes())?.held !== "fire"; i++) await page.waitForTimeout(500);
    await eyes({ place: "woods" });
    await page.waitForTimeout(800);
    await eyes({ pitch: -1.1 });
    await page.waitForTimeout(400);
    log("fire at its feet", JSON.stringify((await eyes())?.aim), JSON.stringify((await eyes())?.held));
    await tap(world().locator("#castbtn"));
    let fell = null;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(500);
      const e = await eyes();
      if (i === 3) await shot("08-own-fire");
      // Once more on its own feet after four seconds, as a player who does not run would.
      if (i === 8 && e?.rider) await tap(world().locator("#castbtn"));
      if (!e?.rider) {
        fell = { after: (i + 1) / 2, caption: e?.caption, held: e?.held };
        break;
      }
    }
    await shot("09-fell");
    log("own fire", JSON.stringify(fell));

    // 7. Let go puts the spell away; the page whole.
    await eyes({ become: "villager" });
    await page.waitForTimeout(1500);
    if (await world().locator("#hotbar button").count()) await tap(world().locator("#hotbar button").first());
    for (let i = 0; i < 20 && !(await eyes())?.held; i++) await page.waitForTimeout(500);
    const heldBefore = (await eyes())?.held;
    await tap(world().locator("#letgo"));
    await page.waitForTimeout(1200);
    log("let go", JSON.stringify({ heldBefore, heldAfter: (await eyes())?.held }));
    await shot("10-letgo");
  }
  log("end", errors);
} finally {
  await browser.close();
  game.stop();
}
