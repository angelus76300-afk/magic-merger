// The eye view and the trees (the owner, 13 November: "it is better but trees blocked me too much").
// In a dense wood, as a villager: how far a real thumb on the stick walks it in 10 s, the frame time
// standing in it, a frame from the eye, and how many trees close to the eye are drawn small. The touch
// is a real one (CDP touch events), never a test hook. Run on a build of main and on this branch:
//   npm run build && node scripts/eyes-trees-proof.mjs <out dir> <tag> [344x882] [seed]
// Exits 1 when the branch's two claims fail: it walks at least 1.5 times as far in the wood as the
// numbers in EXPECT_MIN_BEFORE_FACTOR say is needed (checked against a number given by BEFORE=<cells>),
// and trees within 2.5 cells of the eye are drawn small.
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const TAG = process.argv[3] ?? "run";
const [W, H] = (process.argv[4] ?? "344x882").split("x").map(Number);
const SEED = process.argv[5] ?? "21";
const BEFORE = process.env.BEFORE ? Number(process.env.BEFORE) : null;
const game = await startLocalGame();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let failed = false;
const expect = (what, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what} ${detail ?? ""}`);
  if (!ok) failed = true;
};
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true });
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
  await page.waitForTimeout(5000);
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
  await page.waitForTimeout(2000);
  await eyes({ become: "villager" });
  await page.waitForTimeout(1500);
  const at = await eyes({ place: "forest", pitch: -0.05 });
  if (!at) throw new Error("no forest on this island");
  await page.waitForTimeout(1500);
  const shot = (name) => page.screenshot({ path: join(OUT, `${W}-trees-${TAG}-${name}.jpg`), type: "jpeg", quality: 85 });

  // Frame time standing in the wood, and a frame from the eye.
  await eyes({ stats: true, prof: true });
  await page.waitForTimeout(6000);
  const r = await eyes({ prof: false, tris: true });
  await shot("eye");
  const faded = r.tris?.["faded trees (count)"] ?? 0;
  console.log(
    JSON.stringify({
      tag: TAG,
      size: `${W}x${H}`,
      frames: r.perf.frames,
      frameP50: r.perf.frameP50,
      frameP95: r.perf.frameP95,
      renderP50: r.perf.renderP50,
      faded,
    }),
  );

  // Ten seconds with a thumb on the stick, straight ahead at a walk (a real touch).
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const b = await world().locator("#stick").boundingBox();
  const stick = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const e0 = await eyes();
  const from = e0?.rider;
  let path = 0;
  let last = from;
  await touch("touchStart", [{ ...stick, id: 5 }]);
  await touch("touchMove", [{ ...stick, y: stick.y - 40, id: 5 }]);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const p = (await eyes())?.rider;
    if (p && last) path += Math.hypot(p.x - last.x, p.y - last.y);
    last = p ?? last;
  }
  await shot("walked");
  await touch("touchEnd", [{ ...stick, y: stick.y - 40, id: 5 }]);
  const e1 = await eyes();
  const to = e1?.rider;
  const sim = e1.time - e0.time;
  const net = Math.hypot(to.x - from.x, to.y - from.y);
  console.log(
    JSON.stringify({
      tag: TAG,
      size: `${W}x${H}`,
      wood: at,
      net: +net.toFixed(1),
      path: +path.toFixed(1),
      simSeconds: +sim.toFixed(1),
      netPerSimSecond: +(net / sim).toFixed(2),
    }),
  );
  if (BEFORE !== null)
    expect("in 10 s in the wood the thumb walks it at least 1.5 times as far as before", net >= BEFORE * 1.5, `${net.toFixed(1)} cells, before ${BEFORE}`);
  expect("trees within 2.5 cells of the eye are drawn small", faded > 0, `${faded} trees`);
} finally {
  await browser.close();
  game.stop();
}
process.exit(failed ? 1 : 0);
