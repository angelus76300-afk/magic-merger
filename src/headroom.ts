import { WORLD_SIZES, type WorldSize } from "./sim/sizes";

// Bigger islands for devices that can run them (4.4). The World frame sends
// its own frame numbers every 30 seconds (frame.ts, "headroom"); this browser
// keeps the latest. A bigger size is offered when the simulation's p95, grown
// with the number of cells, would still fit its budget, and frames are on
// time now. Never chosen by default: the player picks it.

export interface Headroom {
  // Width of the island measured, its simulation and frame p95 (ms), frames.
  w: number;
  simP95: number;
  frameP95: number;
  frames: number;
}

// A tick may take this much at p95 on the bigger island: a third of a frame
// at 30 a second, the rest left for drawing.
export const SIM_BUDGET_MS = 12;
// Frames must be on time on the island measured: 30 a second with a little
// slack.
export const FRAME_BUDGET_MS = 40;
// Below this many frames a measure says nothing.
export const MIN_FRAMES = 300;

export const BIG_SIZES: readonly WorldSize[] = ["huge", "giant"];

// The simulation p95 a size would have, from a measure on another size: the
// simulation's cost grows with the cells (temperature, fluids, growth are
// passes over every cell; creatures grow with the land).
export function projectedSim(m: Headroom, size: WorldSize): number {
  const n = WORLD_SIZES[size];
  return m.simP95 * ((n * n) / (m.w * m.w));
}

export function sizesOffered(m: Headroom | null): WorldSize[] {
  const sizes: WorldSize[] = ["small", "medium", "large"];
  if (!m || m.frames < MIN_FRAMES || m.frameP95 > FRAME_BUDGET_MS) return sizes;
  for (const size of BIG_SIZES) if (projectedSim(m, size) <= SIM_BUDGET_MS) sizes.push(size);
  return sizes;
}

const KEY = "magic-merger.headroom";

export function readHeadroom(): Headroom | null {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? "null") as Headroom | null;
    return m && [m.w, m.simP95, m.frameP95, m.frames].every((v) => typeof v === "number" && Number.isFinite(v)) ? m : null;
  } catch {
    return null;
  }
}

// The latest measure wins: a device that got slower (a hot phone, a new
// heavy spell) stops being offered more.
export function writeHeadroom(m: Headroom): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // Kept for nothing: the default sizes stay.
  }
}
