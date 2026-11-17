// The looks of 5.2.5, render side (src/sim/voxel/graphics.ts, looks.ts): the
// four switches, the quality presets, the device's own choice, and that the
// colour grade matches in GLSL and in JavaScript. The frames that prove the
// looks on screen are in docs/measurements/looks-render/; this guards the
// logic that turns each one on and off.
import { Color } from "three";
import {
  AUTO_CHOICE,
  usefulTrims,
  GRAPHICS,
  LOOKS_FLAGS,
  PRESETS,
  QUALITIES,
  QualityChooser,
  LATE_ONLY,
  PIXEL_CAPS,
  PIXEL_FLOORS,
  Relief,
  RELIEF_TUNING,
  TRIMS,
  applyLooks,
  readLooksChoice,
  setLooksChoice,
  type Quality,
} from "../src/sim/voxel/graphics";
import { BLOOM_STRENGTH, FOCUS_FULL, FOCUS_MAX, SHARP_BAND, bloomAt, focusBlur, gradeColor } from "../src/sim/voxel/looks";

type Check = (name: string, ok: boolean, detail?: string) => void;

export function looksChecks(check: Check): void {
  const was = Object.fromEntries(LOOKS_FLAGS.map((f) => [f, GRAPHICS[f]]));

  // Low is the island as it was before 5.2.5: every look off.
  check(
    "the low preset turns every look off",
    LOOKS_FLAGS.every((f) => PRESETS.low[f] === false),
  );
  // High turns them all on; the levels only add.
  check(
    "the high preset turns every look on",
    LOOKS_FLAGS.every((f) => PRESETS.high[f] === true),
  );
  check(
    "each level only adds looks to the one below",
    QUALITIES.every((q, i) => i === 0 || LOOKS_FLAGS.every((f) => !PRESETS[QUALITIES[i - 1]][f] || PRESETS[q][f])),
    "a look on at a lower level must stay on higher up",
  );

  // applyLooks sets the four switches from a level.
  for (const level of QUALITIES) {
    applyLooks({ level, flip: [] }, "low");
    check(
      `the ${level} preset sets the switches`,
      LOOKS_FLAGS.every((f) => GRAPHICS[f] === PRESETS[level][f]),
      LOOKS_FLAGS.map((f) => `${f}=${GRAPHICS[f]}`).join(" "),
    );
  }

  // "auto" follows the device's level; a flipped switch turns the other way.
  const level = applyLooks({ level: "auto", flip: ["bloom"] }, "medium");
  check("auto follows the device's level", level === "medium");
  check(
    "a flipped switch turns the other way from its level",
    GRAPHICS.bloom === !PRESETS.medium.bloom && GRAPHICS.shadows === PRESETS.medium.shadows,
    `bloom=${GRAPHICS.bloom} shadows=${GRAPHICS.shadows}`,
  );

  // A bad choice reads as the automatic one; a good one round-trips.
  check("an unknown choice reads as auto", readLooksChoice({ level: "ultra", flip: 3 }).level === "auto");
  const round = readLooksChoice({ level: "high", flip: ["tilt", "nope", "tilt"] });
  check("a choice keeps only real looks", round.level === "high" && round.flip.length === 1 && round.flip[0] === "tilt", JSON.stringify(round));

  // setLooksChoice applies the choice; the automatic one leaves the chooser to decide.
  setLooksChoice(AUTO_CHOICE);
  check("the automatic choice is kept", readLooksChoice(AUTO_CHOICE).level === "auto");

  // The device's chooser: medium to start, down to low when frames are missed,
  // up to high when they are kept with room, and never see-sawing.
  const slow = new QualityChooser();
  const atPace = 1000 / 30;
  check("a slow device drops to low", slow.decide(atPace * 2, 30, atPace, { spent: true, full: false }) === "low", `level ${slow.level}`);
  check("it does not drop past low", slow.decide(atPace * 2, 30, atPace, { spent: true, full: false }) === null && slow.level === "low");
  const fast = new QualityChooser();
  check("a fast device rises to high", fast.decide(atPace, 5, atPace, { spent: false, full: true }) === "high", `level ${fast.level}`);
  const seesaw = new QualityChooser();
  seesaw.decide(atPace * 2, 30, atPace, { spent: true, full: false }); // down to low
  check("it does not rise again after dropping", seesaw.decide(atPace, 5, atPace, { spent: false, full: true }) === null && seesaw.level === "low");

  // The Fold at 48 ms went straight to low before the relief had acted (16 November): the level
  // comes down only once the relief has nothing left to give up.
  const waiting = new QualityChooser();
  check(
    "the level stays while the relief still has something to give up",
    waiting.decide(atPace * 2, 30, atPace, { spent: false, full: false }) === null && waiting.level === "medium",
  );
  // feed() picks the median over a window, then decides.
  const fed = new QualityChooser();
  let got: Quality | null = null;
  for (let i = 0; i < QualityChooser.FRAMES; i++) got = fed.feed(atPace, 5, atPace, { spent: false, full: true }) ?? got;
  check("the chooser decides over a window of frames", got === "high", `got ${got}`);

  // The colour grade matches between the GLSL and the JavaScript (the fog is
  // graded in JavaScript, the materials in GLSL): the JavaScript is well
  // formed and leaves black and white near where they were, warms a midtone.
  const black = gradeColor(new Color(0, 0, 0));
  const white = gradeColor(new Color(1, 1, 1));
  check("the grade keeps black near black", black.r < 0.05 && black.g < 0.05 && black.b < 0.05, black.getHexString());
  check("the grade keeps white near white", white.r > 0.9 && white.g > 0.9 && white.b > 0.9, white.getHexString());
  const grey = gradeColor(new Color(0.5, 0.5, 0.5));
  check("the grade warms the midtones", grey.r >= grey.b, `${grey.r.toFixed(3)} vs ${grey.b.toFixed(3)}`);
  // The lead's review of the first frames: grass went neon. A grass green
  // comes out darker and less saturated than it went in, never more.
  const grassIn = new Color(0.42, 0.72, 0.25);
  const grass = gradeColor(grassIn);
  const sat = (c: Color) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  check(
    "the grade keeps grass deep and muted, not neon",
    grass.g < grassIn.g && sat(grass) < sat(grassIn),
    `green ${grassIn.g.toFixed(3)} to ${grass.g.toFixed(3)}, spread ${sat(grassIn).toFixed(3)} to ${sat(grass).toFixed(3)}`,
  );
  check(
    "the grade stays in range",
    [grey, black, white].every((c) => [c.r, c.g, c.b].every((v) => v >= 0 && v <= 1)),
  );

  // The depth of field only when the camera comes close (the owner, 13 November): none over the
  // whole island (a medium island is seen from about 83 cells) or at a mid zoom (55), whole at
  // the closest sky zoom, never in the eye view.
  check("no depth of field over the whole island", focusBlur(83, false) === 0);
  check("no depth of field at a mid zoom", focusBlur(55, false) === 0 && focusBlur(28, false) === 0);
  check("the depth of field is whole at the closest sky zoom", focusBlur(FOCUS_FULL, false) === 1 && focusBlur(8, false) === 1);
  check("the depth of field grows as the camera comes closer", focusBlur(20, false) > 0 && focusBlur(20, false) < focusBlur(14, false));
  check("no depth of field in the eye view", focusBlur(8, true) === 0);
  // The owner's close frames on the Fold, 15 November: most of the frame blurred. The middle third
  // of the screen stays sharp.
  check("the middle third of the screen stays sharp", Math.abs(SHARP_BAND - 1 / 6) < 1e-9, `${SHARP_BAND}`);
  // The owner, after the closest frame: "a bit strong". At most two thirds of the blurred frame.
  check("the depth of field shows at most two thirds of the blur", FOCUS_MAX > 0.6 && FOCUS_MAX < 0.7, `${FOCUS_MAX}`);

  // Finer pixels (the owner: "the render is finer"): high draws up to 2 device pixels a CSS pixel
  // at every level, and high smooths edges and lowers its pixels only when frames are late.
  check("every level draws up to 2 pixels, none coarser than before", PIXEL_CAPS.high === 2 && PIXEL_CAPS.medium === 2 && PIXEL_CAPS.low === 2);
  check("high smooths edges, low and medium do not", PRESETS.high.aa && !PRESETS.medium.aa && !PRESETS.low.aa);
  reliefChecks(check);

  // Bloom (the owner on the Fold: "Bloom looks weird when unzoomed ... lower the bloom quite a
  // bit"): none over the whole island at night (a medium island, 152 cells, is seen from about 83),
  // whole at a mid zoom (55) and closer, none by day, and half as strong as first built (1.8).
  check("no bloom over the whole island at night", bloomAt(1, 0, 83, 152) === 0);
  check("bloom at a mid zoom at night", bloomAt(1, 0, 55, 152) === 1);
  check("no bloom by day", bloomAt(0, 0, 30, 152) === 0);
  check("bloom fades in between", bloomAt(1, 0, 66, 152) > 0 && bloomAt(1, 0, 66, 152) < 1, `${bloomAt(1, 0, 66, 152)}`);
  check("bloom about half as strong as before", BLOOM_STRENGTH <= 1, `${BLOOM_STRENGTH}`);

  for (const f of LOOKS_FLAGS) GRAPHICS[f] = was[f];
}

// Windows of frames, as view.ts adapt feeds Relief (a second each by default), over a session; the
// pixel ratio and the notches given up after each window.
export function foldSession(
  windows: number,
  avgAt: (w: number) => number,
  o: { level?: Quality; dpr?: number; draw?: number; windowMs?: number } = {},
): { ratio: number; trim: number }[] {
  const level = o.level ?? "high";
  const dpr = o.dpr ?? 2.6;
  const r = new Relief(Math.min(PIXEL_CAPS[level], dpr));
  const out: { ratio: number; trim: number }[] = [];
  for (let w = 0; w < windows; w++) {
    r.step({
      max: Math.min(PIXEL_CAPS[level], dpr),
      floor: Math.min(PIXEL_FLOORS[level], dpr),
      avg: avgAt(w),
      draw: o.draw ?? 20,
      fast: false,
      lateOnly: LATE_ONLY[level],
      useful: usefulTrims(PRESETS[level]),
      now: w * (o.windowMs ?? 1000),
    });
    out.push({ ratio: r.ratio, trim: r.trim });
  }
  return out;
}

// The unfolded Fold (16 November): frames between 40 and 50 ms, with a busy spell of 6 s (a spell,
// a storm) every minute and a half.
export function foldFrames(s: number): number {
  const jitter = 40 + ((s * 7919) % 11);
  return s % 90 >= 20 && s % 90 < 26 ? 58 : jitter;
}

// A relief on high fed a window a second, slow or not as `slowAt` says; when it changed.
function changesOf(windows: number, slowAt: (w: number, r: Relief) => boolean): { changes: number[]; climbs: number[]; relief: Relief } {
  const r = new Relief(2);
  const changes: number[] = [];
  const climbs: number[] = [];
  for (let w = 0; w < windows; w++) {
    const now = w * 1000;
    const before = r.ratio * 16 - r.trim;
    const avg = slowAt(w, r) ? 60 : 40;
    if (r.step({ max: 2, floor: 1.5, avg, draw: 10, fast: false, lateOnly: true, useful: usefulTrims(PRESETS.high), now })) {
      changes.push(now);
      if (r.ratio * 16 - r.trim > before) climbs.push(now);
    }
  }
  return { changes, climbs, relief: r };
}

function reliefChecks(check: Check): void {
  check("high and medium keep 1.5 pixels at least, low 1", PIXEL_FLOORS.high === 1.5 && PIXEL_FLOORS.medium === 1.5 && PIXEL_FLOORS.low === 1);
  // A Fold at 40 to 50 ms a frame with busy spells, three minutes: never under the floor, extras
  // given up before any pixel, and back to full after every busy spell (main went down to 0.6 and
  // stayed there: frames between 38 and 52 ms neither lowered nor raised it).
  const run = foldSession(180, foldFrames);
  const low = Math.min(...run.map((p) => p.ratio));
  check("a Fold at 40 to 50 ms never goes under 1.5 pixels", low >= 1.5, `lowest ${low}`);
  check(
    "it gives up every extra before a pixel",
    run.every((p) => p.ratio === 2 || p.trim === TRIMS.length - 1),
    run.map((p) => `${p.ratio}/${p.trim}`).join(" "),
  );
  const back = [89, 179].map((s) => run[s]);
  check(
    "it comes back to full after each busy spell",
    back.every((p) => p.ratio === 2 && p.trim === 0),
    JSON.stringify(back),
  );
  // Steady at 45 ms after a long slow start: back to full, not stuck.
  // Over 30 minutes the Fold is degraded no longer than main left it (740 s), not for good (review of #176).
  const long = foldSession(1800, foldFrames);
  const downFor = long.filter((p) => p.ratio !== 2 || p.trim !== 0).length;
  check(
    "a Fold with a busy spell every 90 s ends at full and is not down for most of 30 minutes",
    downFor <= 800 && long[1799].ratio === 2 && long[1799].trim === 0,
    `${downFor} s down, ends ${JSON.stringify(long[1799])}`,
  );
  const stuck = foldSession(120, (s) => (s < 15 ? 70 : 45));
  check("frames at 45 ms after a slow start climb back", stuck[119].ratio === 2 && stuck[119].trim === 0, JSON.stringify(stuck[119]));
  check("a slow start goes down to the floor and no lower", Math.min(...stuck.map((p) => p.ratio)) === 1.5);
  // The review of 16 November: one slow window in three (60, 40, 40 ms, windows of 2.7 s) ended at
  // 1.5 pixels with every extra given up, for good, as each slow window began the wait again. A
  // slow one now and then neither lowers the looks nor keeps them down, from full or after a slow
  // start.
  const sometimes = (w: number) => (w % 3 === 0 ? 60 : 40);
  const fromFull = foldSession(222, sometimes, { windowMs: 2700 });
  check(
    "one slow window in three keeps everything",
    fromFull.at(-1)!.ratio === 2 && fromFull.at(-1)!.trim === 0,
    fromFull.map((p) => `${p.ratio}/${p.trim}`).join(" "),
  );
  const afterSlow = foldSession(222, (w) => (w < 10 ? 70 : sometimes(w)), { windowMs: 2700 });
  check(
    "one slow window in three after a slow start climbs back to full",
    afterSlow[9].ratio === 1.5 && afterSlow.at(-1)!.ratio === 2 && afterSlow.at(-1)!.trim === 0,
    `${JSON.stringify(afterSlow[9])} then ${JSON.stringify(afterSlow.at(-1))}`,
  );
  // On high a long draw with frames on time gives up nothing; on low it gives up pixels at once,
  // with no notch spent on shadows or blur it does not have.
  const onTime = foldSession(20, () => 33, { draw: 35 });
  check(
    "on high a long draw with frames on time keeps everything",
    onTime.every((p) => p.ratio === 2 && p.trim === 0),
  );
  const lowBusy = foldSession(2, () => 33, { level: "low", draw: 35 });
  check("on low the first slow notch is a pixel step", lowBusy[1].ratio === 1.75 && lowBusy[1].trim === 0, JSON.stringify(lowBusy));
  const mediumSlow = foldSession(6, () => 80, { level: "medium" });
  check(
    "on medium no notch is spent on the bloom and blur it does not have",
    mediumSlow[5].trim === 2 && mediumSlow[5].ratio === 1.75,
    JSON.stringify(mediumSlow),
  );
  // A device that cannot keep up at all stays at the floor with every extra given up.
  const slow = foldSession(120, () => 80);
  check("a device always late rests at the floor", slow[119].ratio === 1.5 && slow[119].trim === TRIMS.length - 1);
  // Low draws up to 2 and keeps 1 at least; a long draw still counts on low (not late only).
  const lowLevel = foldSession(60, () => 30, { level: "low", draw: 40 });
  check("low comes down to 1 pixel and no lower", Math.min(...lowLevel.map((p) => p.ratio)) === 1, JSON.stringify(lowLevel.at(-1)));
  // A device of fewer pixels than the floor keeps its own.
  const plain = foldSession(30, () => 80, { dpr: 1 });
  check(
    "a device of 1 pixel is never raised or lowered",
    plain.every((p) => p.ratio === 1),
  );
  // A device slow only with everything on (the review: 29 changes in 10 minutes): once a notch
  // taken back has to be given up again, at most one try a minute, then fewer.
  const flap = changesOf(600, (_w, r) => r.ratio === 2 && r.trim === 0);
  // The first try that failed: the first climb followed by a change within 15 s.
  const failed = flap.climbs.findIndex((t) => flap.changes.some((c) => c > t && c - t < 15_000));
  const later = flap.climbs.slice(failed + 1);
  check(
    "a notch that does not hold is tried at most once a minute after",
    failed >= 0 && flap.changes.length <= 16 && later.every((t, k) => t - (k ? later[k - 1] : flap.climbs[failed]) >= 60_000),
    `${flap.changes.length} changes at ${flap.changes.map((t) => t / 1000).join(", ")} s`,
  );
  check("the wait after notches that did not hold stays long", flap.relief.wait >= 120_000, `${flap.relief.wait} ms`);
  // The wait goes back to 10 s only once a notch taken back has held for two minutes: a device that
  // was slow at full and is now fine. Not while it is still waiting after a failed try.
  const settled = changesOf(900, (w, r) => w < 300 && r.ratio === 2 && r.trim === 0);
  check("the wait comes back to 10 s once the looks have held", settled.relief.wait === 10_000, `${settled.relief.wait} ms`);
  const notYet = changesOf(330, (w, r) => w < 300 && r.ratio === 2 && r.trim === 0);
  check("but not while it is still waiting", notYet.relief.wait > 10_000, `${notYet.relief.wait} ms`);
  // The review of #167: a spike every 30 s (3 s of slow frames) flipped the shadow map 123 times in
  // 30 minutes. Taking a notch back must wait out a minute before a give-up counts as a bounce.
  const spiky = changesOf(1800, (w) => w % 30 < 3);
  check("a spike every 30 s over 30 minutes changes the looks at most 24 times (main: 123)", spiky.changes.length <= 24, `${spiky.changes.length} changes`);
  // ON_TIME_OF: 4 of the last 5 windows on time are needed to take a notch back; with 1 a single
  // quiet window is enough, and a device slow on and off climbs back at once.
  const strict = changesOf(300, (w) => w % 4 === 0 || w % 4 === 1);
  RELIEF_TUNING.onTimeOf = 1;
  const loose = changesOf(300, (w) => w % 4 === 0 || w % 4 === 1);
  RELIEF_TUNING.onTimeOf = 4;
  check(
    "taking a notch back needs 4 of the last 5 windows on time",
    strict.climbs.length < loose.climbs.length,
    `${strict.climbs.length} climbs at 4 of 5, ${loose.climbs.length} at 1`,
  );
}
