// The eye view, second pass (2026-11-12): hold and release to cast, proved with real touches (CDP
// touch events, as a phone sends them; scripts/eyes-tap-proof.mjs is the model). One finger walks on
// the stick while the other holds Cast, drags the ring and lifts: one cast, while walking. A quick tap
// on Cast: one cast. A finger held still on the island, dragged and lifted: one cast. Lifted over
// Cancel: none. First, a thumb on the stick: the eye answers on the next frame, at a run. Exits 1
// when any of these fails.
//   npm run build && node scripts/eyes-aim-proof.mjs <out dir> [344x882] [seed]
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2];
const [W, H] = (process.argv[3] ?? "344x882").split("x").map(Number);
const SEED = process.argv[4] ?? "21";
const game = await startLocalGame();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const log = (...a) => console.log(`[${W}]`, ...a);
let failed = 0;
const expect = (name, ok, detail) => {
  log(ok ? "ok  " : "FAIL", name, detail);
  if (!ok) failed++;
};
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
  await world()
    .locator("text=Skip")
    .click({ timeout: 2000 })
    .catch(() => undefined);
  await page.waitForTimeout(2000);
  const shot = (name) => page.screenshot({ path: join(OUT, `${W}-aim-${name}.jpg`), type: "jpeg", quality: 85 });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const center = async (sel) => {
    const b = await world().locator(sel).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const casts = async () => (await eyes())?.allCasts ?? 0;

  await eyes({ become: "villager" });
  await page.waitForTimeout(1500);
  await eyes({ place: "hill", pitch: -0.1 });

  // 0. How fast the eye answers a real thumb on the stick. The page only watches (the touch is
  // real): when the stick's first move reaches the page's code, and each frame where the eye is.
  // Software WebGL draws a frame in 100 to 250 ms here and the browser holds input back behind it,
  // so the answer is counted in frames drawn after the page has the move (a phone draws one every
  // 16 to 33 ms), and the pace in the island's own time (a frame moves it 0.1 s at most, engine.ts).
  {
    await world().evaluate(() => {
      const w = window;
      w.__trace = [];
      w.__moves = [];
      document.getElementById("stick").addEventListener("pointermove", () => w.__moves.push(performance.now()));
      const t0 = performance.now();
      const step = () => {
        const r = w.__mmEyes?.();
        if (r?.eye) w.__trace.push([performance.now(), r.eye.x, r.eye.y]);
        if (performance.now() - t0 < 4000) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await page.waitForTimeout(300);
    const stick = await center("#stick");
    // Straight up, past the rim: a run ahead.
    await touch("touchStart", [{ ...stick, id: 5 }]);
    await touch("touchMove", [{ ...stick, y: stick.y - 70, id: 5 }]);
    await page.waitForTimeout(2000);
    await touch("touchEnd", [{ ...stick, y: stick.y - 70, id: 5 }]);
    await page.waitForTimeout(1500);
    const { trace, moves } = await world().evaluate(() => ({ trace: window.__trace, moves: window.__moves }));
    const got = moves[0] ?? Infinity;
    const before = trace.filter((p) => p[0] <= got).at(-1) ?? trace[0];
    const after = trace.filter((p) => p[0] > got);
    const firstFrames = after.findIndex((p) => Math.hypot(p[1] - before[1], p[2] - before[2]) > 0.02) + 1 || Infinity;
    // The pace kept, from the fourth frame on, over the island's time.
    const run = after.slice(3, 9);
    let sim = 0;
    for (let i = 1; i < run.length; i++) sim += Math.min(100, run[i][0] - run[i - 1][0]) / 1000;
    const pace = run.length > 1 && sim ? Math.hypot(run.at(-1)[1] - run[0][1], run.at(-1)[2] - run[0][2]) / sim : 0;
    const frameMs = run.length > 1 ? (run.at(-1)[0] - run[0][0]) / (run.length - 1) : 0;
    const answer = { firstFrames, pace: +pace.toFixed(1), frameMs: Math.round(frameMs) };
    expect(
      "a real thumb on the stick: the eye moves on the first frame drawn after the page has the move, at about 4 times a villager's walk (2.9)",
      firstFrames === 1 && pace > 9.5,
      JSON.stringify(answer),
    );
    await page.waitForTimeout(500);
  }
  await eyes({ place: "hill", pitch: -0.2 });
  // A spell in hand (Water: Fire at its own feet would end the proof), with a real tap on its slot.
  await world().locator(`#hotbar button[data-key="water"]`).tap({ timeout: 4000, force: true });
  for (let i = 0; i < 40 && !(await eyes())?.held; i++) await page.waitForTimeout(500);
  expect("a spell is in hand", !!(await eyes())?.held, (await eyes())?.held);
  await page.waitForTimeout(800);

  // 1. Two fingers: the left walks on the stick, the right holds Cast, drags, and lifts.
  {
    const stick = await center("#stick");
    const cast = await center("#castbtn");
    const from = (await eyes())?.rider;
    const c0 = await casts();
    const s = { ...stick, id: 11 };
    const s2 = { ...stick, y: stick.y - 45, id: 11 };
    await touch("touchStart", [s]);
    await touch("touchMove", [s2]);
    await page.waitForTimeout(400);
    const c = { ...cast, id: 12 };
    await touch("touchStart", [s2, c]);
    await page.waitForTimeout(120);
    const ring0 = (await eyes())?.aim;
    for (let k = 1; k <= 8; k++) {
      await touch("touchMove", [s2, { ...c, x: c.x - k * 6, y: c.y - k * 10 }]);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(200);
    const held = await eyes();
    await shot("two-fingers-held");
    // The right finger lifts; the left stays on the stick.
    // The right finger alone lifts (CDP: touchEnd names the points that end).
    await touch("touchEnd", [{ ...c, x: c.x - 48, y: c.y - 80 }]);
    await page.waitForTimeout(500);
    const c1 = await casts();
    log("after the release", JSON.stringify({ caption: (await eyes())?.caption, hold: (await eyes())?.aimHold }));
    await touch("touchEnd", [s2]);
    await page.waitForTimeout(300);
    const to = (await eyes())?.rider;
    const walked = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
    expect(
      "walking on the stick, a held aim on Cast moves the ring and its release casts once",
      c1 - c0 === 1 && walked > 3 && held?.aimHold?.armed && Math.hypot(held.aim.x - ring0.x, held.aim.y - ring0.y) > 1,
      JSON.stringify({
        casts: c1 - c0,
        walked: walked.toFixed(1),
        ringMoved: held && ring0 ? Math.hypot(held.aim.x - ring0.x, held.aim.y - ring0.y).toFixed(1) : "?",
        hold: held?.aimHold,
      }),
    );
  }

  // 2. A quick tap on Cast: one cast at the mark.
  {
    await page.waitForTimeout(1200);
    const cast = await center("#castbtn");
    const c0 = await casts();
    await touch("touchStart", [{ ...cast, id: 21 }]);
    await page.waitForTimeout(60);
    await touch("touchEnd", [{ ...cast, id: 21 }]);
    await page.waitForTimeout(900);
    expect("a quick tap on Cast casts once", (await casts()) - c0 === 1, `${(await casts()) - c0} casts`);
  }

  // 3. Held on Cast and lifted over Cancel: nothing.
  {
    await page.waitForTimeout(1200);
    const cast = await center("#castbtn");
    const c0 = await casts();
    await touch("touchStart", [{ ...cast, id: 31 }]);
    await page.waitForTimeout(150);
    const cancel = await center("#aimcancel");
    const steps = 10;
    for (let k = 1; k <= steps; k++) {
      await touch("touchMove", [{ x: cast.x + ((cancel.x - cast.x) * k) / steps, y: cast.y + ((cancel.y - cast.y) * k) / steps, id: 31 }]);
      await page.waitForTimeout(30);
    }
    await shot("over-cancel");
    await touch("touchEnd", [{ ...cancel, id: 31 }]);
    await page.waitForTimeout(800);
    expect("lifted over Cancel, nothing is cast", (await casts()) - c0 === 0, `${(await casts()) - c0} casts, ${JSON.stringify((await eyes())?.aimHold)}`);
  }

  // 4. A finger held still on the island, then dragged and lifted: one cast; the look does not turn.
  {
    await page.waitForTimeout(1200);
    const box = await (await world().frameElement()).boundingBox();
    const p = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.45, id: 41 };
    const c0 = await casts();
    const yaw0 = (await eyes())?.eye?.yaw;
    await touch("touchStart", [p]);
    await page.waitForTimeout(400);
    for (let k = 1; k <= 6; k++) {
      await touch("touchMove", [{ ...p, x: p.x + k * 8 }]);
      await page.waitForTimeout(30);
    }
    const held = await eyes();
    await shot("island-held");
    await touch("touchEnd", [{ ...p, x: p.x + 48 }]);
    await page.waitForTimeout(900);
    const yaw1 = (await eyes())?.eye?.yaw;
    expect(
      "a finger held still on the island aims, and its release casts once without turning the look",
      (await casts()) - c0 === 1 && held?.aimHold?.armed && Math.abs(yaw1 - yaw0) < 1e-6,
      JSON.stringify({ casts: (await casts()) - c0, dyaw: held?.aimHold?.dyaw, look: (yaw1 - yaw0).toFixed(3) }),
    );
  }
  // 5. A real tap on Let go: the header comes back under the finger, and the click of that touch
  // opens nothing on the page (the playtest of 12 November: it opened the account dialog).
  {
    await page.waitForTimeout(800);
    const go = await center("#letgo");
    await touch("touchStart", [{ ...go, id: 51 }]);
    await page.waitForTimeout(80);
    await touch("touchEnd", [{ ...go, id: 51 }]);
    await page.waitForTimeout(1200);
    await shot("after-let-go");
    const open = await page.locator("dialog[open]").count();
    expect("a tap on Let go lets go and opens no dialog of the page", !(await eyes())?.rider && open === 0, `${open} dialogs open`);
  }
  expect("no page errors", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally {
  await browser.close();
  game.stop();
}
process.exit(failed ? 1 : 0);
