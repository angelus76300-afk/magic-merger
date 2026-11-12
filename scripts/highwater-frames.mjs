// High water: a flood played in a browser at one size, with frames as it starts, spreads and reaches
// the houses, the Craft tab's line, and the end after an answer (raised earth, or cold at its source).
//   npx vite build && node scripts/highwater-frames.mjs <out dir> [344x882] [seed] [answer: none|earth|cold]
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "344x882").split("x").map(Number);
const SEED = process.argv[4] ?? "21";
const ANSWER = process.argv[5] ?? "none";
const CODES = {
  // A ring of raised earth round the village (lab/solutions/dike.js).
  earth: {
    at: "village",
    code: "const spell = { *cast(w) { for (let h = 0; h < 5; h++) { w.ring(w.x, w.y, w.r * 0.9, w.r * 0.9 + 2.5, (x, y) => w.build(x, y, 1, 'basalt')); yield 0.2; } } };",
  },
  // Hard cold where the water swells (lab/solutions/frost.js).
  cold: { at: "source", code: "const spell = { *cast(w) { for (let k = 0; k < 40; k++) { w.temperature(w.x, w.y, w.r, -120); yield 0.5; } } };" },
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
  for (let s = 0; s <= 150; s += 2.5) {
    const now = await world().evaluate(() => window.__mmTrouble?.(true));
    const st = (/stage (\d)/.exec(now) ?? [])[1] ?? "end";
    if (s === 0 || st !== lastStage || s % 10 === 0) await shot(`t${String(Math.round(s)).padStart(3, "0")}-s${st}`);
    lastStage = st;
    if (s === 20) {
      await page.click('.tab[data-view="craft-view"]');
      await page.waitForTimeout(800);
      await shot("craft");
      await page.click('.tab[data-view="world-view"]');
    }
    if (ANSWER !== "none" && !answered && st === "2") {
      answered = true;
      const c = CODES[ANSWER];
      await world().evaluate((a) => window.__mmTrouble?.(true, undefined, a), c);
      console.log("answered at", s, "s with", ANSWER);
    }
    if (st === "end") {
      await page.waitForTimeout(1500);
      await shot(`end-${ANSWER}`);
      break;
    }
    await page.waitForTimeout(2500);
  }
  console.log("state", await world().evaluate(() => window.__mmTrouble?.(true)), errors);
} finally {
  await browser.close();
  game.stop();
}
