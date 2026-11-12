// The island seen from the ground (2026-11-12): the same spots and looks, for a before and an after
// of the art pass. Seed 21, the light held at one time of day, a villager put on each spot through
// the __mmEyes hook (frame.ts), deviceScaleFactor 2. Also times the view's frames over a busy
// village from the sky and in the woods at eye height, and counts draw calls and triangles.
//   npx vite build && node scripts/ground-frames.mjs <out dir> [344x882] [before|after]
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "344x882").split("x").map(Number);
const TAG = process.argv[4] ?? "after";
// Only these spots, without the timing: "tree-up,woods" (for quick looks while working).
const ONLY = process.argv[5] ? new Set(process.argv[5].split(",")) : null;
const TOUCH = W < 1000;
// Mid morning: the sun high enough for the light, low enough for shade on one side.
const CLOCK = 70;
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
  await page.fill("dialog.reset-island input[type=text]", "21");
  await page.click("dialog.reset-island .primary");
  await page.waitForTimeout(4000);
  await page
    .locator("text=Got it")
    .click({ timeout: 1000 })
    .catch(() => undefined);
  const eyes = (look) => world().evaluate((l) => window.__mmEyes?.(l), look);
  const shot = (name) => page.screenshot({ path: join(OUT, `${W}-${name}-${TAG}.jpg`), type: "jpeg", quality: 85 });
  const timed = async (name) => {
    await eyes({ prof: true });
    await page.waitForTimeout(5000);
    const r = await eyes({ prof: false });
    log("perf", name, JSON.stringify({ total: r.prof?.total, draw: r.prof?.draw, calls: r.draw?.calls, triangles: r.draw?.triangles }));
  };
  await eyes({ clock: CLOCK });
  // The new island's tour moves the camera: skipped, so the sky view is the same every run.
  await world()
    .locator("text=Skip")
    .click({ timeout: 2000 })
    .catch(() => undefined);
  await page.waitForTimeout(3500);
  // The sky view over the village, as the island opens.
  if (!ONLY || ONLY.has("sky")) await shot("sky");
  if (!ONLY || ONLY.has("sky")) await timed("sky");

  await eyes({ become: "villager" });
  await page.waitForTimeout(1500);
  const size = (await eyes())?.size ?? { w: 128, h: 128 };
  const home = { x: size.w / 2, y: size.h / 2 };
  // [name, place, pitch, cells stepped back from it, yaw (null: the place's own)]
  const spots = [
    ["tree-up", "tree", 0.45, 0, null],
    ["tree-side", "tree", 0.12, 2, null],
    ["woods", "woods", 0, 0, 0],
    ["street", "street", -0.04, 0, null],
    ["house", "wall", 0.2, 0.3, null],
    ["face", "village", -0.24, 0, null],
    ["cliff", "cliff", 0.15, 3, null],
    ["shore", "sea", 0.02, 0, null],
    ["rain", "village", 0.45, 0, null],
    ["night", "woods", 0.2, 0, 0],
  ];
  for (const [name, place, pitch, back, yaw] of spots) {
    if (ONLY && !ONLY.has(name)) continue;
    await eyes({ at: home });
    const r = await eyes({ place });
    if (!r?.rider) {
      log(name, "no such place");
      continue;
    }
    if (back) await eyes({ at: { x: r.rider.x - Math.cos(r.eye.yaw) * back, y: r.rider.y - Math.sin(r.eye.yaw) * back } });
    if (yaw !== null) await eyes({ yaw });
    await eyes({ pitch, rain: name === "rain", clock: name === "night" ? 262 : CLOCK });
    await page.waitForTimeout(1500);
    if (name === "face") {
      const f = await eyes({ face: 2 });
      log("faced", JSON.stringify(f?.faced));
      await page.waitForTimeout(1200);
    }
    if (name === "woods" && !ONLY) await timed("eye-woods");
    const e = await eyes();
    log(name, JSON.stringify(e?.eye), JSON.stringify(e?.draw));
    await shot(name);
    if (name === "rain") await eyes({ rain: false });
  }
  log("end", errors);
} finally {
  await browser.close();
  game.stop();
}
