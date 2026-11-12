// High water: a flood played in a browser at one size, with frames as it starts, spreads and reaches
// the houses, the Craft tab's line, and the end after an answer (raised earth, or cold at its source).
//   npx vite build && node scripts/highwater-frames.mjs <out dir> [344x882] [seeds, the first that floods] [answer: none|earth|cold|heat|dome]
//   STALE=1 also checks the Craft line after a reload mid flood and after a new island.
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "344x882").split("x").map(Number);
const SEED = process.argv[4] ?? "21";
const ANSWER = process.argv[5] ?? "none";
// The answers, as the player's own casts through the frame's check hook. `at`: where; `when`: the stage it is cast at.
const EARTH = "const spell = { *cast(w) { w.sound('rumble', 0.6); w.terraform(w.x, w.y, w.r * 0.35, 4); w.paint(w.x, w.y, w.r * 0.3, 'rock', 0.8); } };";
const CODES = {
  // Five plain Earth casts across the water's way, six cells apart, while it still swells in its bed.
  earth: Array.from({ length: 5 }, (_, k) => ({ at: "line", k, of: 5, name: "Earth", tier: "minor", code: EARTH, when: "1" })),
  // Hard cold where the water swells (lab/solutions/frost.js).
  cold: [
    {
      at: "source",
      name: "Frost",
      code: "const spell = { *cast(w) { for (let k = 0; k < 40; k++) { w.temperature(w.x, w.y, w.r, -120); yield 0.5; } } };",
      when: "2",
    },
  ],
  // Heat on the water's edge.
  heat: [
    {
      at: "front",
      name: "Heat",
      code: "const spell = { *cast(w) { for (let k = 0; k < 30; k++) { w.temperature(w.x, w.y, w.r * 0.8, 300); yield 0.5; } } };",
      when: "2",
    },
  ],
  // A dome on the house it makes for (the playtest's case).
  dome: [{ at: "house", name: "Dome", tier: "minor", code: "const spell = { *cast(w) { w.ward(w.x, w.y, w.r, { seconds: 600 }); } };", when: "1" }],
};
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
  // The first of the seeds whose island has a village rising water can reach.
  let started = "";
  for (const seed of SEED.split(",")) {
    await esc();
    await page.click("#world-reset");
    await page.waitForSelector("dialog.reset-island[open]");
    await page.fill("dialog.reset-island input[type=text]", seed);
    await page.click("dialog.reset-island .primary");
    await page.waitForTimeout(4000);
    await page
      .locator("text=Got it")
      .click({ timeout: 1000 })
      .catch(() => undefined);
    const stage = await page.locator("#world-stage").boundingBox();
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height * 0.6);
    await page.waitForTimeout(1500);
    started = await world().evaluate(() => window.__mmTrouble?.(false, "flood"));
    console.log("seed", seed, started);
    if (started.startsWith("flood")) break;
  }
  const shot = (name) => page.screenshot({ path: join(OUT, `${W}-${name}.jpg`), type: "jpeg", quality: 85 });
  let answered = false;
  let lastStage = "";
  const t0 = Date.now();
  for (let n = 0; n < 200; n++) {
    const s = Math.round((Date.now() - t0) / 1000);
    const now = await world().evaluate(() => window.__mmTrouble?.(true));
    const st = (/stage (\d)/.exec(now) ?? [])[1] ?? "end";
    if (n === 0 || st !== lastStage || n % 4 === 0) await shot(`t${String(s).padStart(3, "0")}-s${st}`);
    lastStage = st;
    if (n === 2) {
      // The line's Go: where the camera goes.
      await world()
        .locator("#story")
        .click()
        .catch(() => console.log("no story line to tap"));
      await page.waitForTimeout(2500);
      await shot("go");
    }
    if (n === 6) {
      await page.click('.tab[data-view="craft-view"]');
      await page.waitForTimeout(800);
      await shot("craft");
      await page.click('.tab[data-view="world-view"]');
    }
    if (ANSWER !== "none" && !answered && st === CODES[ANSWER][0].when && (st !== "1" || n >= 4)) {
      answered = true;
      for (const c of CODES[ANSWER]) await world().evaluate((a) => window.__mmTrouble?.(true, undefined, a), c);
      await page.waitForTimeout(1500);
      await shot(`cast-${ANSWER}`);
      console.log("answered at", s, "s with", ANSWER);
    }
    if (st === "end") {
      await page.waitForTimeout(1000);
      await shot(`end-${ANSWER}`);
      break;
    }
    await page.waitForTimeout(2500);
  }
  if (process.env.STALE) {
    // A new island while a high water runs: the board's line must go. Then a reload mid flood: the board says it before the World opens.
    await world().evaluate(() => window.__mmTrouble?.(false, "flood"));
    await page.waitForTimeout(3000);
    await page.click('.tab[data-view="craft-view"]');
    await page.waitForTimeout(800);
    await shot("stale-0-craft-running");
    await page.click('.tab[data-view="world-view"]');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector(".chip-inventory", { timeout: 30000 });
    await page.waitForTimeout(1500);
    await esc();
    await page.click('.tab[data-view="craft-view"]').catch(() => undefined);
    await page.waitForTimeout(800);
    await shot("stale-1-reload-craft");
    await page.click('.tab[data-view="world-view"]');
    await page.waitForTimeout(4000);
    await esc();
    await page.click("#world-reset");
    await page.waitForSelector("dialog.reset-island[open]");
    await page.fill("dialog.reset-island input[type=text]", "77");
    await page.click("dialog.reset-island .primary");
    await page.waitForTimeout(4000);
    await page.click('.tab[data-view="craft-view"]');
    await page.waitForTimeout(800);
    await shot("stale-2-new-island-craft");
  }
  console.log("state", await world().evaluate(() => window.__mmTrouble?.(true)), errors);
} finally {
  await browser.close();
  game.stop();
}
