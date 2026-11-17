import { LAND_LOOKS } from "./land-looks";

// The view's improvements of 4.4, each behind its own switch so the Perf Lab
// can measure it alone (scripts/perf-phone.mjs, "off=ao,water"), and so one
// can be turned off on a device that cannot afford it.
export const GRAPHICS = {
  // Ambient occlusion baked into the terrain's vertex colors.
  ao: true,
  // Water: color by depth, foam along the shore, gentle waves.
  water: true,
  // Rain, snow and fog that come and go.
  weather: true,
  // Sun, moon and stars.
  sky: true,
  // Up to 60 frames a second where the device keeps up, creatures drawn part
  // way between two ticks (2026-11-07, pacing.ts). Off: 30 a second on touch
  // screens, a frame only when something changed.
  smooth: true,
  ...LAND_LOOKS,
  // The looks of 5.2.5 (looks.ts), each measured alone ("off=shadows" or
  // "on=bloom" in the Perf Lab). Set by the quality preset below.
  // A sun that casts soft shadows over the land, following the hour, in the
  // sky view; warm where it lights, cool in the shade. One extra pass that
  // draws what casts (the land, trees, houses, props, wonders, creatures)
  // into a 1024 square map.
  shadows: false,
  // A filmic tone curve and a colour grade (deeper middle tones, greens
  // muted, warm light and cool shade) in every material, and a haze over the far side of the
  // island. No extra pass.
  grade: false,
  // Glow that blooms at night: bright parts spill light around them. At night
  // only; three passes at a quarter of the pixels, and the frame is drawn
  // into a texture first.
  bloom: false,
  // The miniature's depth of field, only when the camera comes close: none
  // at a mid zoom or over the whole island, growing to full at the closest
  // sky zoom; in focus at the point under the middle of the screen, blurred
  // in front of it and behind it. Off in the eye view. Two blur passes at half the pixels; the frame and its depth are
  // drawn into textures by the scene's own pass (no pass for the depth).
  tilt: false,
  // Edges smoothed (5.2.5, the owner: "the render is finer ... refined and
  // detailed, not messy"): FXAA at full resolution, nine taps a pixel, in the
  // last pass; the frame is drawn into a texture first.
  aa: false,
  // Village houses and trees in small cubes near the camera (cubes.ts): timber frames, windows
  // set back in their frames, tiled roofs; fluffy crowns in three shades. Farther away, and with
  // it off, the old models.
  cubes: false,
};

export type GraphicsFlag = keyof typeof GRAPHICS;

// The looks a quality level turns on (5.2.5). Low is the island as it was
// before them; the device picks one from its own frame times (QualityChooser),
// and the owner can pick one, or one switch at a time, in the frame HUD.
export const LOOKS_FLAGS = ["shadows", "grade", "bloom", "tilt", "aa", "cubes", "fine"] as const;
export type LooksFlag = (typeof LOOKS_FLAGS)[number];
export const QUALITIES = ["low", "medium", "high"] as const;
export type Quality = (typeof QUALITIES)[number];
export const PRESETS: Record<Quality, Record<LooksFlag, boolean>> = {
  low: { shadows: false, grade: false, bloom: false, tilt: false, aa: false, cubes: false, fine: false },
  medium: { shadows: true, grade: true, bloom: false, tilt: false, aa: false, cubes: true, fine: true },
  high: { shadows: true, grade: true, bloom: true, tilt: true, aa: true, cubes: true, fine: true },
};

// The most device pixels per CSS pixel each level draws (the Fold folded has
// about 2.6): 2 at every level, as the game had before the looks (the owner
// wants it finer, so the level a device starts at must not get coarser). High
// alone lowers them only when frames are actually late (LATE_ONLY), never
// because the drawing took long while the frames kept their cadence.
export const PIXEL_CAPS: Record<Quality, number> = { low: 2, medium: 2, high: 2 };
export const LATE_ONLY: Record<Quality, boolean> = { low: false, medium: false, high: true };

// The fewest device pixels per CSS pixel a level may come down to when frames are slow (16
// November, the owner on the unfolded Fold: "Why is the quality decreasing with time giving this
// blurry look unzoomed???"; it went down to 0.6). Never lower than the device's own.
export const PIXEL_FLOORS: Record<Quality, number> = { low: 1, medium: 1.5, high: 1.5 };

// What slow frames give up, one notch at a time, before any pixel (Relief): the shadow map at half
// its texels, then the sun's shadows (no shadow pass), then the bloom and the depth of field. The
// looks read TRIM.level (looks.ts); 0 gives up nothing.
export const TRIMS = ["none", "shadow map", "shadows", "bloom and blur"] as const;
export const TRIM = { level: 0 };

// Which notches change anything with the looks now on: none for a look that is off (low has no
// shadows, medium no bloom or blur), so a slow second never spends itself on one.
export function usefulTrims(g: { shadows: boolean; bloom: boolean; tilt: boolean }): boolean[] {
  return [true, g.shadows, g.shadows, g.bloom || g.tilt];
}

// Frames are late past LATE ms at 30 a second (they come every 33); the view's own work is too long
// past BUSY ms where the level lowers on the draw time alone (not LATE_ONLY).
const LATE = 52;
const BUSY = 30;
// The last WINDOWS windows are looked at: a notch is given up when SLOW_OF of the last 3 since the
// last notch given up were slow, taken back when ON_TIME_OF of the last 5 were on time. A slow second now and then (one in three)
// neither lowers the looks nor keeps them down.
const WINDOWS = 5;
const SLOW_OF = 2;
const ON_TIME_OF = 4;
// The same, as a knob the tests turn to show it matters.
export const RELIEF_TUNING = { onTimeOf: ON_TIME_OF };
// The wait before a notch is taken back, after the last change. When one taken back is given up
// again within BOUNCE ms, the wait is at least FAILED and doubles each time after, up to WAIT_MAX:
// at most one try a minute, then fewer. It goes back to QUIET only once a notch taken back has held
// for HELD ms with nothing given up since.
const QUIET = 10_000;
const FAILED = 60_000;
const WAIT_MAX = 240_000;
// A spike every 15 to 30 s must not flip a notch for good (review of #167: 123 changes in 30 min at
// a 30 s period), so a notch given up within a minute of being taken back did not hold.
const BOUNCE = 60_000;
const HELD = 120_000;

// How the view spends a slow second (view.ts adapt): extras first, then pixels down to the
// level's floor; and when frames are on time again, the same way back, pixels first. Fed the mean
// of each window of frames (about a second or two).
export class Relief {
  trim = 0;
  wait = QUIET;
  private slow: boolean[] = [];
  private droppedAt = -Infinity;
  private climbedAt = -Infinity;

  constructor(public ratio: number) {}

  // Whether nothing is left to give up: the last useful notch and the floor.
  spent(useful: boolean[], floor: number): boolean {
    return this.ratio <= floor && !useful.some((u, k) => u && k > this.trim);
  }

  // avg: the mean time between frames; draw: the mean of the view's own work; fast: the engine
  // aims at 60 a second; max and floor: the level's pixels (the device's included); useful: which
  // notches change anything (usefulTrims); now: ms. Returns whether anything changed.
  step(o: { max: number; floor: number; avg: number; draw: number; fast: boolean; lateOnly: boolean; useful: boolean[]; now: number }): boolean {
    const was = this.ratio * 16 + this.trim;
    const floor = Math.min(o.floor, o.max);
    this.ratio = Math.min(o.max, Math.max(floor, this.ratio));
    // A notch that does nothing at this level is not held.
    while (this.trim > 0 && !o.useful[this.trim]) this.trim--;
    this.slow.push((!o.fast && o.avg > LATE) || (!o.lateOnly && o.draw > BUSY));
    if (this.slow.length > WINDOWS) this.slow.shift();
    const slowOf3 = this.slow.slice(-3).filter(Boolean).length;
    const onTime = this.slow.filter((x) => !x).length;
    if (slowOf3 >= SLOW_OF) {
      if (this.climbedAt > this.droppedAt && o.now - this.climbedAt < BOUNCE) this.wait = Math.min(WAIT_MAX, Math.max(FAILED, this.wait * 2));
      const next = o.useful.findIndex((u, k) => u && k > this.trim);
      if (next > 0) this.trim = next;
      else this.ratio = Math.max(floor, this.ratio - 0.25);
      if (this.ratio * 16 + this.trim !== was) this.droppedAt = o.now;
      // The next notch needs slow windows of its own.
      this.slow.length = 0;
    } else if (onTime >= RELIEF_TUNING.onTimeOf && o.now - Math.max(this.droppedAt, this.climbedAt) > this.wait) {
      if (this.ratio < o.max) this.ratio = Math.min(o.max, this.ratio + 0.25);
      else if (this.trim > 0) {
        this.trim--;
        while (this.trim > 0 && !o.useful[this.trim]) this.trim--;
      }
      if (this.ratio * 16 + this.trim !== was) this.climbedAt = o.now;
    }
    if (this.climbedAt > this.droppedAt && o.now - this.climbedAt > HELD) this.wait = QUIET;
    return this.ratio * 16 + this.trim !== was;
  }
}

// What the player chose: a level, or "auto" (the device's), and switches
// turned the other way from that level.
export interface LooksChoice {
  level: Quality | "auto";
  flip: LooksFlag[];
}

export const AUTO_CHOICE: LooksChoice = { level: "auto", flip: [] };

// From a message or a saved string: anything else is the automatic choice.
export function readLooksChoice(v: unknown): LooksChoice {
  if (!v || typeof v !== "object") return { ...AUTO_CHOICE };
  const o = v as { level?: unknown; flip?: unknown };
  const level = o.level === "auto" || QUALITIES.includes(o.level as Quality) ? (o.level as LooksChoice["level"]) : "auto";
  const flip = Array.isArray(o.flip) ? LOOKS_FLAGS.filter((f) => (o.flip as unknown[]).includes(f)) : [];
  return { level, flip };
}

// Sets the four switches from a choice and the level the device picked.
export function applyLooks(choice: LooksChoice, auto: Quality): Quality {
  const level = choice.level === "auto" ? auto : choice.level;
  for (const f of LOOKS_FLAGS) GRAPHICS[f] = PRESETS[level][f] !== choice.flip.includes(f);
  LOOKS_STATE.level = level;
  return level;
}

// Picks the level from the device's own frames in the sky view. Starts at
// medium; after FRAMES frames goes up to high when frames keep their cadence
// with room to spare and nothing given up, or down to low when frames are still
// missed once the relief has given up all it can. At most one step up, and never up
// again after a step down, so it does not see-saw.
export class QualityChooser {
  static readonly FRAMES = 90;
  level: Quality = "medium";
  private frames: number[] = [];
  private draws: number[] = [];
  private wentDown = false;
  private wentUp = false;

  // frameMs: time since the previous frame; drawMs: the view's own work;
  // paceMs: the time between frames the engine aims for. Returns the new
  // level when it changes.
  // relief: whether the view's relief has nothing left to give up (spent) or has given up nothing (full).
  feed(frameMs: number, drawMs: number, paceMs: number, relief: { spent: boolean; full: boolean }): Quality | null {
    this.frames.push(frameMs);
    this.draws.push(drawMs);
    if (this.frames.length < QualityChooser.FRAMES) return null;
    const mid = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const frame = mid(this.frames);
    const draw = mid(this.draws);
    this.frames = [];
    this.draws = [];
    return this.decide(frame, draw, paceMs, relief);
  }

  // The level comes down only once the relief (Relief) has given up all it can and frames are still
  // slow (16 November: it went straight to low on the Fold before the relief had acted).
  decide(frame: number, draw: number, paceMs: number, relief: { spent: boolean; full: boolean }): Quality | null {
    const slow = relief.spent && (frame > paceMs * 1.45 || draw > 22);
    const roomy = frame < paceMs * 1.15 && draw < 9 && relief.full;
    const at = QUALITIES.indexOf(this.level);
    let next = at;
    if (slow && at > 0) {
      next = at - 1;
      this.wentDown = true;
    } else if (roomy && !this.wentDown && !this.wentUp && at < QUALITIES.length - 1) {
      next = at + 1;
      this.wentUp = true;
    }
    if (next === at) return null;
    this.level = QUALITIES[next];
    return this.level;
  }
}

// The game's choice and the device's level, kept across islands (frame.ts
// sets the choice; the view feeds the chooser while the choice is "auto").
// Null: nothing chosen, the switches stay as they are (the labs).
export const LOOKS_STATE = { choice: null as LooksChoice | null, chooser: new QualityChooser(), level: "low" as Quality };

export function setLooksChoice(choice: LooksChoice): void {
  LOOKS_STATE.choice = choice;
  LOOKS_STATE.level = applyLooks(choice, LOOKS_STATE.chooser.level);
}
