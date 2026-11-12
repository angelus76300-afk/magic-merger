// The eye view, second pass (2026-11-12): hold and release to cast, proved with real touches (CDP
// touch events, as a phone sends them; scripts/eyes-tap-proof.mjs is the model). One finger walks on
// the stick while the other holds Cast, drags the ring and lifts: one cast, while walking. A quick tap
// on Cast: one cast. A finger held still on the island, dragged and lifted: one cast. Lifted over
// Cancel: none. Exits 1 when any of these fails.
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
  // Open ground ahead for the run: a street of the village.
  await eyes({ place: "street", pitch: -0.1 });

  // 0. How fast the eye answers a real thumb on the stick: from the stick's pointerdown (its own
  // event time) to the first frame the eye has moved, and to the frame it reaches 90 percent of the
  // pace it keeps; then the pace, in cells per second. The page only watches; the touch is real.
  {
    await world().evaluate(() => {
      const w = window;
      w.__trace = [];
      w.__down = 0;
      document.getElementById("stick").addEventListener("pointerdown", (e) => (w.__down = e.timeStamp), { once: true });
      const t0 = performance.now();
      const step = (t) => {
        const r = w.__mmEyes?.();
        if (r?.eye) w.__trace.push([t, r.eye.x, r.eye.y]);
        if (t - t0 < 3500) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await page.waitForTimeout(300);
    const stick = await center("#stick");
    // Straight up, past the rim: a run ahead.
    await touch("touchStart", [{ ...stick, id: 5 }]);
    await touch("touchMove", [{ ...stick, y: stick.y - 70, id: 5 }]);
    await page.waitForTimeout(1500);
    await touch("touchEnd", [{ ...stick, y: stick.y - 70, id: 5 }]);
    await page.waitForTimeout(1800);
    const { trace, down } = await world().evaluate(() => ({ trace: window.__trace, down: window.__down }));
    const at = trace.findIndex((p) => p[0] >= down);
    const [, x0, y0] = trace[Math.max(0, at - 1)];
    const moved = trace.find((p) => p[0] >= down && Math.hypot(p[1] - x0, p[2] - y0) > 0.02);
    // The pace kept: over the last 0.5 s of the push.
    const late = trace.filter((p) => p[0] > down + 900 && p[0] < down + 1400);
    const pace = late.length > 1 ? Math.hypot(late.at(-1)[1] - late[0][1], late.at(-1)[2] - late[0][2]) / ((late.at(-1)[0] - late[0][0]) / 1000) : 0;
    let full = null;
    for (let i = 1; i < trace.length; i++) {
      const [t, x, y] = trace[i];
      if (t < down) continue;
      const [tp, xp, yp] = trace[Math.max(0, i - 3)];
      if (t > tp && Math.hypot(x - xp, y - yp) / ((t - tp) / 1000) >= pace * 0.9) {
        full = t;
        break;
      }
    }
    const first = moved ? moved[0] - down : Infinity;
    const toFull = full ? full - down : Infinity;
    const frames = trace.filter((p) => p[0] > down && p[0] < down + 1400);
    const frameMs = frames.length > 1 ? (frames.at(-1)[0] - frames[0][0]) / (frames.length - 1) : 0;
    // In frames drawn after the touch: software WebGL draws a frame in 100 to 250 ms here, so the
    // answer is counted in frames (a phone draws one in 16 to 33 ms).
    const firstFrames = moved ? trace.filter((p) => p[0] > down && p[0] <= moved[0]).length : Infinity;
    const fullFrames = full ? trace.filter((p) => p[0] > down && p[0] <= full).length : Infinity;
    const answer = {
      firstMoveMs: Math.round(first),
      to90Ms: Math.round(toFull),
      firstFrames,
      fullFrames,
      pace: +pace.toFixed(1),
      frameMs: +frameMs.toFixed(1),
    };
    expect(
      "a real thumb on the stick: the eye moves on the first or second frame drawn after it, and runs at about 4 times a villager's walk (2.9)",
      firstFrames <= 2 && pace > 9,
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
  expect("no page errors", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} finally {
  await browser.close();
  game.stop();
}
process.exit(failed ? 1 : 0);
