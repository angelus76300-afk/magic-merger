// What the island sounds like from where the camera looks (4.8, item 3):
// a level from 0 to 1 per bed, read from the simulation's own grids a few
// times a second. Pure: sound.ts turns the levels into noise beds, and
// scripts/sound-test.ts checks them on built islands.

import { daylight } from "./daylight";
import { C, F, isBuilding } from "./materials";
import { hostile } from "./creatures";
import type { World } from "./world";

// No village murmur: filtered noise at 500 Hz reads as traffic, not people
// (game designer, 2026-11-07); villagers' own work says "village".
export const BEDS = ["surf", "leaves", "fire", "lava", "edge", "rain", "birds", "crickets"] as const;
export type Bed = (typeof BEDS)[number];
export type BedLevels = Record<Bed, number>;

// What the music follows (4.8, item 6), sampled with the beds: night from 0
// to 1, tension from fire or a monster in view, and the island's seed for its key.
export interface Sampled extends BedLevels {
  night: number;
  tension: number;
  seed: number;
}

// Cells read per sample: a sunflower spiral over the disc, the same every time.
export const SAMPLES = 80;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function silentBeds(): BedLevels {
  return { surf: 0, leaves: 0, fire: 0, lava: 0, edge: 0, rain: 0, birds: 0, crickets: 0 };
}

// The beds heard at (x, y) with a view of radius `ref` cells, at `time`.
// `rainAt` gives the rain (0 to 1) over a cell: the weather lives in the
// view (voxel/sky.ts), which the simulation must not import.
export function sampleBeds(world: World, x: number, y: number, ref: number, time: number, rainAt: (cell: number) => number = () => 0): Sampled {
  let water = 0;
  let land = 0;
  let deep = 0;
  let outside = 0;
  let trees = 0;
  let green = 0;
  let fire = 0;
  let lava = 0;
  let centre = -1;
  const fires: number[] = [];
  const houses: number[] = [];
  for (let k = 0; k < SAMPLES; k++) {
    // Denser near the middle: what is close counts more.
    const r = ref * Math.sqrt((k + 0.5) / SAMPLES);
    const a = k * GOLDEN;
    const cx = Math.round(x + Math.cos(a) * r);
    const cy = Math.round(y + Math.sin(a) * r);
    if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) {
      outside++;
      continue;
    }
    const i = cy * world.w + cx;
    if (k === 0) centre = i;
    const fl = world.fluid[i];
    if (fl === F.WATER || fl === F.ICE) {
      water++;
      if (world.depth[i] > 4) deep++;
    } else if (fl === F.LAVA) lava++;
    else land++;
    const c = world.cover[i];
    if (c === C.TREE || c === C.BUSH) trees++;
    if (c === C.TREE || c === C.BUSH || c === C.FERN || c === C.FLOWER || c === C.CROP || c === C.REEDS || c === C.BERRIES) green++;
    if (world.fire[i] > 0.05) {
      fire++;
      fires.push(cx, cy);
    }
    if (isBuilding(c)) houses.push(cx, cy);
  }
  const n = SAMPLES;
  const night = daylight(time).night;
  const share = (v: number, full: number) => Math.min(1, v / (n * full));
  // Surf is loudest where water meets land, quieter over open sea.
  const surf = share(water, 0.5) * (land > 0 ? 1 : 0.5);
  const leaves = share(trees, 0.4);
  // A threat makes the music tense: fire within 15 cells of a house, or a
  // monster within 25 cells of a villager. Fire the player lights in the
  // wild is play, not danger (game designer, 2026-11-07).
  let threat = 0;
  for (let a = 0; a < fires.length && !threat; a += 2)
    for (let b = 0; b < houses.length; b += 2)
      if (Math.hypot(fires[a] - houses[b], fires[a + 1] - houses[b + 1]) <= 15) {
        threat = 1;
        break;
      }
  for (const c of world.creatures) {
    if (threat) break;
    if (c.dead || Math.abs(c.x - x) > ref || Math.abs(c.y - y) > ref || !hostile(c)) continue;
    if (
      world.creatures.some(
        (o) => !o.dead && o.kind === "villager" && Math.abs(o.x - c.x) <= 25 && Math.abs(o.y - c.y) <= 25 && Math.hypot(o.x - c.x, o.y - c.y) <= 25,
      )
    )
      threat = 1;
  }
  return {
    night,
    tension: threat,
    seed: world.seed,
    surf,
    leaves,
    // A few burning cells already crackle.
    fire: share(fire, 0.08),
    lava: share(lava, 0.15),
    // Open sea far out, or the void past the island's rim.
    edge: share(outside + deep * 0.5, 0.5),
    rain: rainAt(centre),
    birds: leaves * (1 - night),
    crickets: share(green, 0.4) * night,
  };
}

// At most two beds are heard at once, or the island is a grey hiss with no
// place in it: the loudest at its level, the second at most half of it. A
// bed must lead by HYSTERESIS to take a slot from one already heard, so beds
// do not swap back and forth. Fire and rain are urgent, and birds and
// crickets are sparse calls rather than a wash: those four play over the two
// whenever they are there.
export const HEARD = 2;
export const HYSTERESIS = 0.15;
const URGENT: readonly Bed[] = ["fire", "rain", "birds", "crickets"];

export function chooseBeds(levels: BedLevels, heard: readonly Bed[]): { levels: BedLevels; heard: Bed[] } {
  const calm = BEDS.filter((b) => !URGENT.includes(b) && levels[b] > 0.02);
  // Beds already heard get the hysteresis as a head start.
  const score = (b: Bed) => levels[b] + (heard.includes(b) ? HYSTERESIS : 0);
  calm.sort((a, b) => score(b) - score(a));
  const keep = calm.slice(0, HEARD);
  const out = silentBeds();
  if (keep[0]) out[keep[0]] = levels[keep[0]];
  if (keep[1]) out[keep[1]] = Math.min(levels[keep[1]], 0.5 * levels[keep[0]]);
  for (const b of URGENT) out[b] = levels[b];
  return { levels: out, heard: keep };
}

// Calls of creatures by body plan (item 4). Most calls answer something the
// player sees: a creature hurt, or one just come into view. An idle call is
// rare. Fish and villagers are silent: villagers' work is their sound.
export const CALLS: Record<string, { voice: string }> = {
  bird: { voice: "chirp" },
  "four legs": { voice: "grunt" },
  dragon: { voice: "roar" },
  slime: { voice: "squelch" },
  serpent: { voice: "hiss" },
  insect: { voice: "buzz" },
  spider: { voice: "click" },
  golem: { voice: "grind" },
  spirit: { voice: "whisper" },
  "tree folk": { voice: "creak" },
};

// A wolf (any four legs named so) howls at night instead of grunting.
export const HOWLERS = /wolf|hound|jackal|coyote|warg/i;

// Rates (game designer, 2026-11-07): about 0.4 calls a second on average,
// never more than 1; one per species per 4 s; one per creature per 20 s (a
// howl 45 s). An idle call is this likely per creature in earshot per second.
export const CALLS_PER_SECOND = 1;
export const SPECIES_GAP = 4;
export const CREATURE_GAP = 20;
export const HOWL_GAP = 45;
export const IDLE_PER_SECOND = 0.01;
export const CALL_CELLS = 25;

export type CallWhy = "hurt" | "arrived" | "idle";

// Keeps the gaps between calls, so the engine only says who could call.
export class CallClock {
  private bySpecies = new Map<string, number>();
  private byCreature = new Map<number, number>();
  private recent: number[] = [];

  may(id: number, species: string, voice: string, now: number): boolean {
    this.recent = this.recent.filter((t) => now - t < 1);
    if (this.recent.length >= CALLS_PER_SECOND) return false;
    if (now - (this.bySpecies.get(species) ?? -Infinity) < SPECIES_GAP) return false;
    const gap = voice === "howl" ? HOWL_GAP : CREATURE_GAP;
    if (now - (this.byCreature.get(id) ?? -Infinity) < gap) return false;
    return true;
  }

  called(id: number, species: string, now: number): void {
    this.recent.push(now);
    this.bySpecies.set(species, now);
    this.byCreature.set(id, now);
    if (this.byCreature.size > 500) for (const [k, t] of this.byCreature) if (now - t > HOWL_GAP) this.byCreature.delete(k);
  }
}
