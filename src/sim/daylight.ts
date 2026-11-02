import { hexColor, mixColor } from "./colors";

// The island's day: a six minute cycle, mostly day, with a warm dusk, a
// blue night and a pink dawn. Returns how to tint the unlit materials and the
// sky; fire, lava, glowing things and spell effects keep their own light.

export const DAY_LENGTH = 360;

export interface Daylight {
  // Multiplier for every lit material, per channel.
  r: number;
  g: number;
  b: number;
  // 0 in full day, 1 at the darkest of night.
  night: number;
  skyTop: string;
  skyLow: string;
}

// Key moments of the cycle, as a fraction of the day, and their look.
const KEYS: { at: number; tint: [number, number, number]; night: number; top: number; low: number }[] = [
  { at: 0.0, tint: [1, 1, 1], night: 0, top: 0x5fa8e8, low: 0xcfe8f7 },
  { at: 0.62, tint: [1, 1, 1], night: 0, top: 0x5fa8e8, low: 0xcfe8f7 },
  { at: 0.7, tint: [1, 0.78, 0.62], night: 0.25, top: 0x6a5aa8, low: 0xf4a46a },
  { at: 0.76, tint: [0.42, 0.48, 0.72], night: 1, top: 0x0b1030, low: 0x27305a },
  { at: 0.9, tint: [0.42, 0.48, 0.72], night: 1, top: 0x0b1030, low: 0x27305a },
  { at: 0.95, tint: [0.95, 0.78, 0.82], night: 0.3, top: 0x7a6ab8, low: 0xf6b8b0 },
  { at: 1.0, tint: [1, 1, 1], night: 0, top: 0x5fa8e8, low: 0xcfe8f7 },
];

export function daylight(time: number): Daylight {
  // Worlds start in the morning, not at the edge of night.
  const f = ((((time + DAY_LENGTH * 0.1) % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;
  let k = 0;
  while (k < KEYS.length - 2 && KEYS[k + 1].at <= f) k++;
  const a = KEYS[k];
  const b = KEYS[k + 1];
  const t = (f - a.at) / Math.max(0.0001, b.at - a.at);
  const s = t * t * (3 - 2 * t);
  const lerp = (x: number, y: number) => x + (y - x) * s;
  return {
    r: lerp(a.tint[0], b.tint[0]),
    g: lerp(a.tint[1], b.tint[1]),
    b: lerp(a.tint[2], b.tint[2]),
    night: lerp(a.night, b.night),
    skyTop: hexColor(mixColor(a.top, b.top, s)),
    skyLow: hexColor(mixColor(a.low, b.low, s)),
  };
}
