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
};

export type GraphicsFlag = keyof typeof GRAPHICS;
