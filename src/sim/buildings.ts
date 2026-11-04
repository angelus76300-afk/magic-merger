import { C, F, G, isBuilding } from "./materials";
import { Rng } from "./noise";
import type { Biome } from "./land-options";
import type { World } from "./world";
import type { Creature } from "./creatures";
import { WOODLAND, cellHash, type Settlement } from "./ecology";
import { daylight, dayOf } from "./daylight";
import { tell, villageOf, type Village } from "./kin";
import { wordOf } from "./names";

// Buildings that differ inside a village (4.4.5 part B). A village is laid
// out round a plaza with a main street; its houses face the paths and some
// keep a garden; it grows from a hamlet to a village to a town, and as it
// grows it raises buildings with a job, each of which does something:
//
//   smithy       villagers arm themselves: they hit harder in a fight
//   granary      food kept for hard times, given back when stores run out
//   bakery       a harvest brought home feeds half as many again
//   barn         the oxen sow the bare fields
//   tavern       villagers gather there at dusk before going home
//   market       trade days, one day in two: gold, and food shared
//   chapel       heals the village and keeps the risen dead away
//   watchtower   spots monsters from far: the village takes cover, guards go
//   lumber yard  woodcutters keep more wood and replant the forest edge
//   fisher hut   fishers catch more, and bring home more of it
//
// Each is a two by two block of its own cover, like a house (materials.ts,
// after every older id). A burnt one is rubble, which builders rebuild as a
// house, and the village turns that back into what it was. The view draws
// every house and building from its own seed (voxel/buildings.ts): no two
// alike, in a single draw call.

export interface Job {
  id: number;
  name: string;
  // Where it stands: by the plaza, at the edge, on a shore, on a rise.
  site: "plaza" | "edge" | "shore" | "rise";
  // Whether this village has a use for it.
  wants: (world: World, s: Settlement) => boolean;
}

const fieldsNear = (world: World, s: Settlement) => countNear(world, s, 18, (i) => world.ground[i] === G.FIELD) > 10;
const treesNear = (world: World, s: Settlement) => countNear(world, s, 22, (i) => world.cover[i] === C.TREE) > 25;
const shoreNear = (world: World, s: Settlement) => shoreSite(world, s) >= 0;

// In the order a village wants them.
export const JOBS: Job[] = [
  { id: C.SMITHY, name: "smithy", site: "edge", wants: () => true },
  { id: C.GRANARY, name: "granary", site: "edge", wants: fieldsNear },
  { id: C.FISHERHUT, name: "fisher hut", site: "shore", wants: shoreNear },
  { id: C.LUMBERYARD, name: "lumber yard", site: "edge", wants: treesNear },
  { id: C.TAVERN, name: "tavern", site: "plaza", wants: () => true },
  { id: C.CHAPEL, name: "chapel", site: "plaza", wants: () => true },
  { id: C.BAKERY, name: "bakery", site: "plaza", wants: fieldsNear },
  { id: C.MARKET, name: "market", site: "plaza", wants: (world) => world.settlements.length >= 2 },
  { id: C.BARN, name: "barn", site: "edge", wants: fieldsNear },
  { id: C.WATCHTOWER, name: "watchtower", site: "rise", wants: () => true },
];
export const JOB_BY_ID = new Map(JOBS.map((j) => [j.id, j]));

// Hamlet, village, town: by houses (two by two blocks of house cells).
export type Tier = "hamlet" | "village" | "town";
export function tierOf(houses: number): Tier {
  return houses >= 15 ? "town" : houses >= 7 ? "village" : "hamlet";
}
const MOST_JOBS: Record<Tier, number> = { hamlet: 2, village: 5, town: 10 };

function countNear(world: World, s: Settlement, r: number, test: (i: number) => boolean): number {
  let n = 0;
  const cx = Math.round(s.x);
  const cy = Math.round(s.y);
  for (let y = Math.max(0, cy - r); y < Math.min(world.h, cy + r); y += 2)
    for (let x = Math.max(0, cx - r); x < Math.min(world.w, cx + r); x += 2) if (test(y * world.w + x)) n++;
  return n;
}

// House blocks of a village, counted on its cells.
export function housesOf(world: World, s: Settlement): number {
  return Math.round(countNear(world, s, 16, (i) => world.cover[i] === C.HOUSE));
}

// The settlement whose village this spot belongs to (30 cells at most).
export function settlementNear(world: World, x: number, y: number): Settlement | null {
  let best: Settlement | null = null;
  let bestD = 30;
  for (const s of world.settlements) {
    const d = Math.abs(s.x - x) + Math.abs(s.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function hasJob(world: World, x: number, y: number, id: number): boolean {
  const s = settlementNear(world, x, y);
  return !!s?.jobs?.some((j) => j.kind === id);
}

// A job building's anchor, when the village has it.
function jobAt(s: Settlement, id: number): number {
  return s.jobs?.find((j) => j.kind === id)?.i ?? -1;
}

const free = (world: World, i: number) => {
  const g = world.ground[i];
  return world.depth[i] === 0 && world.fluid[i] === F.NONE && world.cover[i] === C.NONE && (g === G.GRASS || g === G.DIRT || g === G.PATH || g === G.SAND);
};

// The top left cell of a free, flat two by two block at (x, y), or -1.
function block(world: World, x: number, y: number): number {
  if (x < 1 || y < 1 || x + 2 >= world.w || y + 2 >= world.h) return -1;
  const i = y * world.w + x;
  const cells = [i, i + 1, i + world.w, i + world.w + 1];
  const h0 = world.height[i];
  if (cells.some((j) => !free(world, j) || Math.abs(world.height[j] - h0) > 1.2)) return -1;
  return i;
}

function shoreSite(world: World, s: Settlement): number {
  let best = -1;
  let bestD = Infinity;
  const cx = Math.round(s.x);
  const cy = Math.round(s.y);
  for (let y = cy - 24; y <= cy + 24; y++)
    for (let x = cx - 24; x <= cx + 24; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < 5 || d > 24 || d >= bestD) continue;
      const b = block(world, x, y);
      if (b < 0) continue;
      // Water deep enough for a boat beside the block.
      let wet = false;
      for (let k = -1; k <= 2 && !wet; k++)
        for (const [dx, dy] of [
          [k, -1],
          [k, 2],
          [-1, k],
          [2, k],
        ]) {
          if (!world.inside(x + dx, y + dy)) continue;
          const j = (y + dy) * world.w + x + dx;
          if (world.fluid[j] === F.WATER && world.depth[j] > 0.4) wet = true;
        }
      if (!wet) continue;
      bestD = d;
      best = b;
    }
  return best;
}

function siteFor(world: World, s: Settlement, job: Job, rng: Rng): number {
  if (job.site === "shore") return shoreSite(world, s);
  const [r0, r1] = job.site === "plaza" ? [3.5, 9] : job.site === "rise" ? [6, 16] : [6, 14];
  const cx = Math.round(s.x);
  const cy = Math.round(s.y);
  let best = -1;
  let bestScore = -Infinity;
  for (let t = 0; t < 160; t++) {
    const a = rng.next() * Math.PI * 2;
    const d = r0 + rng.next() * (r1 - r0);
    const b = block(world, Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d));
    if (b < 0) continue;
    // By the plaza: as close as can be; on a rise: as high; at the edge: either.
    const score = job.site === "rise" ? world.height[b] : -d + (job.site === "edge" ? rng.next() * 4 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

function raise(world: World, s: Settlement, job: Job, rng: Rng): boolean {
  const at = siteFor(world, s, job, rng);
  if (at < 0) return false;
  for (const j of [at, at + 1, at + world.w, at + world.w + 1]) {
    world.ground[j] = G.DIRT;
    world.setCover(j, job.id);
  }
  (s.jobs ??= []).push({ kind: job.id, i: at });
  return true;
}

// When the island is made: a name, a main street, gardens, and one or two
// buildings with a job, chosen by the place.
export function layOutVillages(world: World, biomes: readonly Biome[]): void {
  world.settlements.forEach((s, k) => {
    const rng = new Rng((world.seed ^ 0x6b75) + k * 7919 + 13);
    const cx = Math.round(s.x);
    const cy = Math.round(s.y);
    const ci = cy * world.w + cx;
    const biome = world.biomeMap ? biomes[world.biomeMap[ci]] : (world.land?.biome ?? "temperate");
    // A name no other village of the island starts like.
    let name = wordOf(rng, biome);
    for (let t = 0; t < 8 && world.settlements.some((o) => o !== s && o.name && o.name.slice(0, 3) === name.slice(0, 3)); t++) name = wordOf(rng, biome);
    s.name = name;
    // The main street: from the plaza along the most open way.
    let bestDir = 0;
    let bestOpen = -1;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      let n = 0;
      for (let t = 3; t <= 16; t++) {
        const x = cx + dx * t;
        const y = cy + dy * t;
        if (!world.inside(x, y)) break;
        const i = y * world.w + x;
        if (world.depth[i] > 0 || world.fluid[i] !== F.NONE) break;
        if (world.cover[i] === C.NONE || world.cover[i] === C.BUSH || world.cover[i] === C.FLOWER) n++;
      }
      if (n > bestOpen) {
        bestOpen = n;
        bestDir = d;
      }
    }
    s.street = bestDir;
    for (const d of [bestDir, (bestDir + 2) & 3]) {
      const [dx, dy] = DIRS[d];
      for (let t = 3; t <= (d === bestDir ? 16 : 8); t++) {
        const x = cx + dx * t;
        const y = cy + dy * t;
        if (!world.inside(x, y)) break;
        const i = y * world.w + x;
        if (world.depth[i] > 0 || world.fluid[i] !== F.NONE) break;
        if (isBuilding(world.cover[i]) || world.ground[i] === G.FIELD) continue;
        if (world.cover[i] !== C.WELL) world.setCover(i, C.NONE);
        world.ground[i] = G.PATH;
      }
    }
    // Gardens beside some houses: flowers or berries, behind a fence.
    for (let y = cy - 12; y <= cy + 12; y++)
      for (let x = cx - 12; x <= cx + 12; x++) {
        if (!world.inside(x, y)) continue;
        const i = y * world.w + x;
        if (world.cover[i] !== C.HOUSE || cellHash(i, world.seed + 4801) > 0.18) continue;
        for (const [dx, dy] of DIRS) {
          const j = (y + dy) * world.w + x + dx;
          if (!world.inside(x + dx, y + dy) || !free(world, j) || world.ground[j] === G.PATH) continue;
          world.setCover(j, rng.next() < 0.5 ? C.BERRIES : C.FLOWER);
        }
      }
    // One or two buildings from the start, the ones the place calls for.
    const houses = housesOf(world, s);
    const wanted = JOBS.filter((j) => j.wants(world, s));
    const first = houses >= 7 ? 2 : 1;
    const placeFirst = wanted.filter((j) => j.site === "shore" || j.id === C.LUMBERYARD);
    const rest = wanted.filter((j) => !placeFirst.includes(j)).sort(() => rng.next() - 0.5);
    for (const job of [...placeFirst.sort(() => rng.next() - 0.5), ...rest]) {
      if ((s.jobs?.length ?? 0) >= first) break;
      if (jobAt(s, job.id) >= 0) continue;
      raise(world, s, job, rng);
    }
  });
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const JOB_SECONDS = 90;
// What each village was at the last look, and when its tower last spoke (not saved).
const tiers = new WeakMap<Settlement, Tier>();
const spotted = new WeakMap<Settlement, number>();

// Every twenty seconds from lifeCycle: buildings brought back after a
// rebuild, a new one when the village can afford it, the granary's stores
// and the market's trade days.
export function growBuildings(world: World): void {
  world.settlements.forEach((s, k) => {
    const v = villageNear(world, s);
    for (const job of [...(s.jobs ?? [])]) {
      const cells = [job.i, job.i + 1, job.i + world.w, job.i + world.w + 1];
      const covers = cells.map((i) => world.cover[i]);
      // Rebuilt as houses by the builders: what it was before.
      if (covers.every((c) => c === C.HOUSE || c === job.kind)) {
        if (covers.some((c) => c === C.HOUSE)) for (const i of cells) world.setCover(i, job.kind);
      } else if (!covers.some((c) => c === C.RUBBLE || c === job.kind || c === C.HOUSE)) {
        // Gone for good (a crater, a flood): it may be raised again elsewhere.
        s.jobs = s.jobs!.filter((j) => j !== job);
        tell(world, `${s.name ?? "a village"} lost its ${JOB_BY_ID.get(job.kind)?.name ?? "building"}`);
      }
    }
    if (!v) return;
    const tier = tierOf(housesOf(world, s));
    const had = tiers.get(s);
    if (had && had !== tier && tier !== "hamlet" && (had === "hamlet" || tier === "town")) tell(world, `${s.name ?? "a village"} grew into a ${tier}`);
    tiers.set(s, tier);
    // A new building: stores to spare, its turn come, room in the tier.
    const built = s.jobs?.length ?? 0;
    const rich = v.food + v.wood + v.gold * 2;
    if (built < MOST_JOBS[tier] && rich >= 40 + built * 25 && world.time >= (built + 1) * JOB_SECONDS && v.wood >= 4) {
      // One of the next three it wants, so two villages grow apart.
      const rng = new Rng((world.seed ^ 0x6a62) + k * 31 + built * 977);
      const options = JOBS.filter((j) => jobAt(s, j.id) < 0 && j.wants(world, s)).slice(0, 3);
      const next = options[Math.floor(rng.next() * options.length)];
      if (next && raise(world, s, next, rng)) {
        v.wood -= 4;
        tell(world, `${s.name ?? "a village"} built a ${next.name}`);
      }
    }
    // The granary: a surplus is put away, and given back when food runs out.
    if (jobAt(s, C.GRANARY) >= 0) {
      s.store ??= 0;
      if (v.food > 25 && s.store < 60) {
        const put = Math.min(5, v.food - 25, 60 - s.store);
        v.food -= put;
        s.store += put;
      } else if (v.food < 4 && s.store > 0) {
        const back = Math.min(6, s.store);
        s.store -= back;
        v.food += back;
        tell(world, `${s.name ?? "a village"} opened its granary`);
      }
    }
    // Market days, one day in two: a little gold, and food to the poorest.
    if (jobAt(s, C.MARKET) >= 0 && marketDay(world.time)) {
      v.gold += 0.5;
      let poor: Village | null = null;
      for (const o of world.villages) if (o !== v && o.food + 4 < v.food && (!poor || o.food < poor.food)) poor = o;
      if (poor) {
        v.food -= 1;
        poor.food += 1;
        v.gold += 0.5;
      }
    }
    // The barn's oxen sow bare fields.
    if (jobAt(s, C.BARN) >= 0) {
      let sown = 0;
      for (let t = 0; t < 40 && sown < 3; t++) {
        const x = Math.round(s.x + (Math.random() - 0.5) * 32);
        const y = Math.round(s.y + (Math.random() - 0.5) * 32);
        if (!world.inside(x, y)) continue;
        const i = y * world.w + x;
        if (world.ground[i] === G.FIELD && world.cover[i] === C.NONE && world.depth[i] < 0.1) {
          world.setCover(i, C.CROP);
          sown++;
        }
      }
    }
    // The lumber yard replants the forest edge.
    if (jobAt(s, C.LUMBERYARD) >= 0 && world.flora) {
      let planted = 0;
      for (let t = 0; t < 40 && planted < 2; t++) {
        const x = Math.round(s.x + (Math.random() - 0.5) * 44);
        const y = Math.round(s.y + (Math.random() - 0.5) * 44);
        if (!world.inside(x, y) || Math.hypot(x - s.x, y - s.y) < 10) continue;
        const i = y * world.w + x;
        if (world.ground[i] !== G.GRASS || world.cover[i] !== C.NONE || world.depth[i] > 0 || !(world.flora[i] & WOODLAND)) continue;
        world.setCover(i, C.BUSH);
        planted++;
      }
    }
  });
}

export function marketDay(time: number): boolean {
  const d = daylight(time);
  return dayOf(time) % 2 === 0 && d.night < 0.1;
}

function villageNear(world: World, s: Settlement): Village | null {
  return villageOf(world, s.x, s.y);
}

// Twice a second, from lifeCycle: the chapel's peace, the watchtower's eyes.
export function stepBuildings(
  world: World,
  life: { kindOf: (c: Creature) => { native: boolean; ai?: { mode: string } }; maxHp: (c: Creature) => number },
): void {
  if (world.tick % 15 !== 9) return;
  for (const s of world.settlements) {
    const chapel = jobAt(s, C.CHAPEL);
    if (chapel >= 0) {
      const x = (chapel % world.w) + 1;
      const y = Math.floor(chapel / world.w) + 1;
      for (const c of world.crowd.near(world, x, y, 8)) {
        if (c.dead || Math.hypot(c.x - x, c.y - y) > 8) continue;
        if (c.kind === "villager") {
          c.hp = Math.min(life.maxHp(c), c.hp + 1.5);
          c.calm = Math.max(c.calm, 1);
        } else if (c.kind === "risen" || /skeleton|zombie|ghoul|wraith|undead|vampire/.test(c.kind)) {
          c.fear = Math.max(c.fear, 3);
          c.fearX = x;
          c.fearY = y;
        }
      }
    }
    const tower = jobAt(s, C.WATCHTOWER);
    if (tower >= 0 && world.tick % 60 === 9) {
      const x = (tower % world.w) + 1;
      const y = Math.floor(tower / world.w) + 1;
      let foe: Creature | null = null;
      for (const c of world.crowd.near(world, x, y, 30)) {
        if (c.dead || c.kind === "villager" || c.mind?.tame) continue;
        const k = life.kindOf(c);
        if (c.kind === "bear" || c.kind === "polar bear" || (!k.native && (k.ai?.mode === "hunt" || k.ai?.mode === "guard"))) {
          foe = c;
          break;
        }
      }
      if (!foe) continue;
      // Those outside take cover at home; guards see it from 30 cells (goals.ts).
      for (const c of world.crowd.near(world, s.x, s.y, 22)) {
        if (c.dead || c.kind !== "villager" || Math.hypot(foe.x - c.x, foe.y - c.y) > 26) continue;
        if (c.mind?.task === "fight") continue;
        c.fear = Math.max(c.fear, 3);
        c.fearX = foe.x;
        c.fearY = foe.y;
      }
      if (world.time - (spotted.get(s) ?? -999) > 60) {
        spotted.set(s, world.time);
        tell(world, `the watchtower of ${s.name ?? "a village"} spotted a ${foe.kind.split("#")[0]}`);
      }
    }
  }
}

// Where the tavern of a villager's village is, at dusk, or null.
export function tavernFor(world: World, c: Creature): { x: number; y: number } | null {
  const s = settlementNear(world, c.homeX, c.homeY);
  const at = s ? jobAt(s, C.TAVERN) : -1;
  if (at < 0) return null;
  return { x: (at % world.w) + 1 + (cellHash(c.id, 7) - 0.5) * 3, y: Math.floor(at / world.w) + 2.6 };
}
