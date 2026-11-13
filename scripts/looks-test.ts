// The looks of 5.2.5, render side (src/sim/voxel/graphics.ts, looks.ts): the
// four switches, the quality presets, the device's own choice, and that the
// colour grade matches in GLSL and in JavaScript. The frames that prove the
// looks on screen are in docs/measurements/looks-render/; this guards the
// logic that turns each one on and off.
import { Color } from "three";
import {
  AUTO_CHOICE,
  GRAPHICS,
  LOOKS_FLAGS,
  PRESETS,
  QUALITIES,
  QualityChooser,
  LATE_ONLY,
  PIXEL_CAPS,
  nextPixelRatio,
  applyLooks,
  readLooksChoice,
  setLooksChoice,
  type Quality,
} from "../src/sim/voxel/graphics";
import { FOCUS_FULL, FOCUS_MAX, focusBlur, gradeColor } from "../src/sim/voxel/looks";

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
  check("a slow device drops to low", slow.decide(atPace * 2, 30, atPace, 0.6, 2) === "low", `level ${slow.level}`);
  check("it does not drop past low", slow.decide(atPace * 2, 30, atPace, 0.6, 2) === null && slow.level === "low");
  const fast = new QualityChooser();
  check("a fast device rises to high", fast.decide(atPace, 5, atPace, 2, 2) === "high", `level ${fast.level}`);
  const seesaw = new QualityChooser();
  seesaw.decide(atPace * 2, 30, atPace, 0.6, 2); // down to low
  check("it does not rise again after dropping", seesaw.decide(atPace, 5, atPace, 2, 2) === null && seesaw.level === "low");

  // feed() picks the median over a window, then decides.
  const fed = new QualityChooser();
  let got: Quality | null = null;
  for (let i = 0; i < QualityChooser.FRAMES; i++) got = fed.feed(atPace, 5, atPace, 2, 2) ?? got;
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
  check("no depth of field at a mid zoom", focusBlur(55, false) === 0);
  check("the depth of field is whole at the closest sky zoom", focusBlur(FOCUS_FULL, false) === 1 && focusBlur(8, false) === 1);
  check("the depth of field grows as the camera comes closer", focusBlur(30, false) > 0 && focusBlur(30, false) < focusBlur(15, false));
  check("no depth of field in the eye view", focusBlur(8, true) === 0);
  // The owner, after the closest frame: "a bit strong". At most two thirds of the blurred frame.
  check("the depth of field shows at most two thirds of the blur", FOCUS_MAX > 0.6 && FOCUS_MAX < 0.7, `${FOCUS_MAX}`);

  // Finer pixels (the owner: "the render is finer"): high draws up to 2 device pixels a CSS pixel
  // at every level, and high smooths edges and lowers its pixels only when frames are late.
  check("every level draws up to 2 pixels, none coarser than before", PIXEL_CAPS.high === 2 && PIXEL_CAPS.medium === 2 && PIXEL_CAPS.low === 2);
  check("high smooths edges, low and medium do not", PRESETS.high.aa && !PRESETS.medium.aa && !PRESETS.low.aa);
  const busy = { ratio: 2, max: 2, avg: 33, draw: 35, fast: false, quiet: 20_000 };
  check(
    "on high a long draw with frames on time keeps the pixels",
    nextPixelRatio({ ...busy, lateOnly: LATE_ONLY.high }).ratio === 2,
    JSON.stringify(nextPixelRatio({ ...busy, lateOnly: LATE_ONLY.high })),
  );
  check("on low a long draw still lowers them, as before", nextPixelRatio({ ...busy, lateOnly: LATE_ONLY.low }).ratio === 1.75);
  check("on high late frames lower them", nextPixelRatio({ ...busy, avg: 60, lateOnly: true }).ratio === 1.75);
  check("a cap below the density brings it down at once", nextPixelRatio({ ...busy, draw: 5, max: 1.5, lateOnly: false }).ratio === 1.5);
  check(
    "they come back up only after quiet frames with room",
    nextPixelRatio({ ratio: 1.5, max: 2, avg: 33, draw: 5, fast: false, quiet: 20_000, lateOnly: true }).ratio === 1.75 &&
      nextPixelRatio({ ratio: 1.5, max: 2, avg: 33, draw: 5, fast: false, quiet: 5_000, lateOnly: true }).ratio === 1.5,
  );

  for (const f of LOOKS_FLAGS) GRAPHICS[f] = was[f];
}
