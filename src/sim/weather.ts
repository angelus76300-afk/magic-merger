import { LOOKS, biomeAt, type Weather } from "./land";
import { seeded } from "./noise";
import type { World } from "./world";

// Weather that crosses the island (2026-11-11, the owner's report: "it seems
// to be raining for too long in the entire biome, and when we move over
// another one it can change... we should instead see some sort of cloud
// shape or just moving zone that moves across the map and that is not based
// on what the camera is looking at"; and "rain should also put out fires").
//
// Rain and snow come as fronts: a round mass of cloud that enters the island
// upwind, crosses it with the wind and leaves on the other side. Where a
// front is, it rains, whatever the camera looks at; beside it the sky is
// clear. A front is a function of the island's seed and the time, as the
// weather of 4.4 was, so it needs no saving and two devices see the same sky.
//
// Fog stays what it was, a region's own (voxel/sky.ts): it does not travel.
//
// Rain is real on the player's island: it puts out what burns under it
// (wetFires), the wildfire of troubles.ts included. A challenge and a spell's
// test run have no weather at all (`world.weather` is off there), so they
// play the same under any sky, as before.

// A new front may be born every SLOT seconds, and takes CROSS seconds to cross.
const SLOT = 100;
const CROSS = 170;

export interface Front {
  kind: "rain" | "snow";
  x: number;
  y: number;
  r: number;
  // 0 to 1: how hard it falls, easing in as it arrives and out as it leaves.
  amount: number;
}

/** The fronts over the island at a time: none, one or two. */
export function fronts(world: World, time: number): Front[] {
  if (!world.land) return [];
  const out: Front[] = [];
  const side = Math.max(world.w, world.h);
  const wl = Math.hypot(world.wind.x, world.wind.y) || 1;
  const dx = world.wind.x / wl;
  const dy = world.wind.y / wl;
  const slot = Math.floor(time / SLOT);
  for (let s = slot - Math.ceil(CROSS / SLOT); s <= slot; s++) {
    if (s < 0) continue;
    const age = time - s * SLOT;
    if (age < 0 || age > CROSS) continue;
    const rng = seeded((world.seed * 7919 + s * 104729) >>> 0);
    const roll = rng();
    // How far off the island's middle line it passes, and how big it is.
    const off = (rng() - 0.5) * side * 0.7;
    const r = side * (0.2 + rng() * 0.12);
    const f = age / CROSS;
    // From one edge to the other, a radius beyond each.
    const along = (f - 0.5) * (side + 2 * r);
    const x = world.w / 2 + dx * along - dy * off;
    const y = world.h / 2 + dy * along + dx * off;
    // What falls is the weather of the land at the middle of its way: rain over a forest, snow over tundra, nothing over a desert most days.
    const mx = Math.round(Math.max(0, Math.min(world.w - 1, world.w / 2 - dy * off)));
    const my = Math.round(Math.max(0, Math.min(world.h - 1, world.h / 2 + dx * off)));
    const odds = LOOKS[biomeAt(world, my * world.w + mx)].weather;
    // A front wets a fifth of the island for under a minute a spot, where the old weather rained on a
    // whole land for two: a little likelier to come, so that rain is still met.
    const rain = Math.min(0.9, (odds.rain ?? 0) * 1.3);
    const snow = Math.min(0.9, (odds.snow ?? 0) * 1.3);
    const kind = roll < rain ? "rain" : roll < rain + snow ? "snow" : null;
    if (!kind) continue;
    const ease = (t: number) => t * t * (3 - 2 * t);
    const amount = f < 0.12 ? ease(f / 0.12) : f > 0.88 ? ease((1 - f) / 0.12) : 1;
    out.push({ kind, x, y, r, amount });
  }
  return out;
}

/** What falls on a cell right now, and how hard: full under the middle of a front, fading over its outer third. */
export function fallingAt(world: World, x: number, y: number, time: number, list: Front[] = fronts(world, time)): { kind: Weather; amount: number } {
  let kind: Weather = "clear";
  let amount = 0;
  for (const f of list) {
    const d = Math.hypot(x - f.x, y - f.y) / f.r;
    if (d >= 1) continue;
    const a = f.amount * (d < 0.65 ? 1 : 1 - (d - 0.65) / 0.35);
    if (a > amount) {
      amount = a;
      kind = f.kind;
    }
  }
  return { kind, amount };
}

/**
 * Rain puts out what burns under it, and snow more slowly. Called a few times a second on the
 * player's island only (`world.weather`). Returns how many cells it put out.
 */
export function wetFires(world: World, dt: number): number {
  if (!world.weather) return 0;
  let out = 0;
  for (const f of fronts(world, world.time)) {
    if (f.amount < 0.3) continue;
    const x0 = Math.max(0, Math.floor(f.x - f.r));
    const x1 = Math.min(world.w - 1, Math.ceil(f.x + f.r));
    const y0 = Math.max(0, Math.floor(f.y - f.r));
    const y1 = Math.min(world.h - 1, Math.ceil(f.y + f.r));
    // A burning cell grows by 1.2 a second by itself (physics.ts): rain has to beat that to put it out.
    const rate = (f.kind === "rain" ? 3.2 : 1.8) * f.amount * dt;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * world.w + cx;
        if (world.fire[i] <= 0) continue;
        const d = Math.hypot(cx - f.x, cy - f.y) / f.r;
        if (d >= 0.9) continue;
        world.fire[i] -= rate;
        // Wet ground does not catch again at once: what was hot is cooled.
        world.temp[i] = Math.min(world.temp[i], 60);
        if (world.fire[i] <= 0.02) {
          world.fire[i] = 0;
          out++;
        }
      }
  }
  return out;
}
