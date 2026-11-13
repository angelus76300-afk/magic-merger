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
};

export type GraphicsFlag = keyof typeof GRAPHICS;

// The looks a quality level turns on (5.2.5). Low is the island as it was
// before them; the device picks one from its own frame times (QualityChooser),
// and the owner can pick one, or one switch at a time, in the frame HUD.
export const LOOKS_FLAGS = ["shadows", "grade", "bloom", "tilt"] as const;
export type LooksFlag = (typeof LOOKS_FLAGS)[number];
export const QUALITIES = ["low", "medium", "high"] as const;
export type Quality = (typeof QUALITIES)[number];
export const PRESETS: Record<Quality, Record<LooksFlag, boolean>> = {
  low: { shadows: false, grade: false, bloom: false, tilt: false },
  medium: { shadows: true, grade: true, bloom: false, tilt: false },
  high: { shadows: true, grade: true, bloom: true, tilt: true },
};

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
  return level;
}

// Picks the level from the device's own frames in the sky view. Starts at
// medium; after FRAMES frames goes up to high when frames keep their cadence
// with room to spare at full pixel density, or down to low when frames are
// missed or the pixel density had to drop. At most one step up, and never up
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
  feed(frameMs: number, drawMs: number, paceMs: number, pixelRatio: number, maxRatio: number): Quality | null {
    this.frames.push(frameMs);
    this.draws.push(drawMs);
    if (this.frames.length < QualityChooser.FRAMES) return null;
    const mid = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const frame = mid(this.frames);
    const draw = mid(this.draws);
    this.frames = [];
    this.draws = [];
    return this.decide(frame, draw, paceMs, pixelRatio, maxRatio);
  }

  decide(frame: number, draw: number, paceMs: number, pixelRatio: number, maxRatio: number): Quality | null {
    const slow = frame > paceMs * 1.45 || draw > 22 || pixelRatio < maxRatio - 0.3;
    const roomy = frame < paceMs * 1.15 && draw < 9 && pixelRatio >= maxRatio;
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
