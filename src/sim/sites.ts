import { C, FIRST_JOB, G, LAST_JOB } from "./materials";
import type { World } from "./world";
import type { Creature } from "./creatures";
import type { Settlement } from "./ecology";
import { tell, villageOf, type Village } from "./kin";

// Building sites (4.9, part 2). On islands of 4.4.5 and later a house or a
// building with a job no longer appears whole: the village stakes a site,
// pays its wood at once (it lies there as a pile of logs), and its builders
// raise it in four stages the player can watch:
//
//   0 staked    corner stakes, a string round them, the log pile
//   1 footing   a stone sill and the floor
//   2 frame     corner posts to wall height and the beams on top
//   3 walls     walls to half height, bare rafters
//
// then it is the house or building it was meant to be, drawn by the seeded
// builder of voxel/buildings.ts as before. Each stage takes a few seconds of
// work; up to three villagers work at once, so a house takes about 40 s
// with one builder and 15 s with three. A site burns like timber to ash,
// never to rubble (rubble is rebuilt for free as a house). One site open at
// a time in a hamlet or a village (two in a town), and one building with a job. The challenges and the
// oldest island build at once, as before.

export interface Site {
  // The top left cell of its two by two block.
  i: number;
  // C.HOUSE or a job building's cover.
  kind: number;
  // Work done, in seconds of one villager's work.
  work: number;
  // Wood paid when it was staked: the log pile.
  logs: number;
  // When it was staked, and when its village was last seen (not saved).
  since: number;
  seen?: number;
}

export const SITE = {
  // Seconds of work per stage, for a house; a job building takes `jobScale` as long.
  stages: [6, 10, 12, 10],
  jobScale: 1.5,
  // Villagers at work on one site at once.
  hands: 3,
  // Seconds a site waits with no village before it is given up.
  orphan: 120,
  // Wood of a house (as before).
  houseWood: 5,
} as const;

// What a worker is doing at each stage, and what the card says of the site.
export const STAGE_WORDS = ["staking out", "laying the footing of", "raising the frame of", "putting up the walls of"] as const;
const STAGE_NAMES = ["being staked out", "footing going in", "frame going up", "walls going up"] as const;

export function siteTotal(s: Site): number {
  const k = s.kind === C.HOUSE ? 1 : SITE.jobScale;
  return SITE.stages.reduce((a, b) => a + b, 0) * k;
}

export function stageOf(s: Site): number {
  const k = s.kind === C.HOUSE ? 1 : SITE.jobScale;
  let t = 0;
  for (let n = 0; n < SITE.stages.length; n++) {
    t += SITE.stages[n] * k;
    if (s.work < t) return n;
  }
  return SITE.stages.length - 1;
}

// Logs still lying at the site: the pile shrinks as the stages use it.
export function logsLeft(s: Site): number {
  return Math.ceil(s.logs * (1 - Math.min(1, s.work / siteTotal(s))));
}

export function cellsOf(world: World, i: number): number[] {
  return [i, i + 1, i + world.w, i + world.w + 1];
}

// The names of the buildings with a job, by cover id from FIRST_JOB (as in
// materials.ts and buildings.ts, which this file cannot import).
const NAMES = ["smithy", "granary", "bakery", "barn", "tavern", "market", "chapel", "watchtower", "lumber yard", "fisher hut"];

// The settlement whose village this spot belongs to (30 cells at most), as
// buildings.ts finds it.
function settlementNear(world: World, x: number, y: number): Settlement | null {
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

export function kindName(kind: number): string {
  return kind === C.HOUSE ? "house" : kind >= FIRST_JOB && kind <= LAST_JOB ? (NAMES[kind - FIRST_JOB] ?? "building") : "building";
}

// Whether builders raise sites on this island (4.4.5 and later).
export function sitesOn(world: World): boolean {
  return !!world.flora;
}

// The sites of the village whose center is nearest (x, y), within its reach.
export function sitesOf(world: World, v: { x: number; y: number }): Site[] {
  return world.sites.filter((s) => {
    const x = s.i % world.w;
    const y = Math.floor(s.i / world.w);
    return villageOf(world, x, y) === v;
  });
}

// Whether a village may stake another site of this kind: one house at a
// time (two in a town) and one building with a job, so half built sites
// never pile up and a granary never waits behind a house.
export function canStake(world: World, v: Village, kind: number, town = false): boolean {
  const open = sitesOf(world, v).filter((s) => (s.kind === C.HOUSE) === (kind === C.HOUSE)).length;
  return open < (kind === C.HOUSE && town ? 2 : 1);
}

// Stakes a site on a free block: the cells become a site, the wood is paid.
export function stake(world: World, i: number, kind: number, logs: number): Site {
  for (const j of cellsOf(world, i)) {
    world.ground[j] = G.DIRT;
    world.setCover(j, C.SITE);
  }
  const s: Site = { i, kind, work: 0, logs, since: world.time };
  world.sites.push(s);
  // Whoever stood on the block steps off it.
  const x0 = i % world.w;
  const y0 = Math.floor(i / world.w);
  for (const c of world.creatures) {
    if (c.dead || c.x < x0 - 0.5 || c.x > x0 + 1.5 || c.y < y0 - 0.5 || c.y > y0 + 1.5) continue;
    const j = standBy(world, s, c.id);
    if (j < 0) continue;
    c.x = j % world.w;
    c.y = Math.floor(j / world.w);
  }
  world.sitesVersion++;
  if (kind !== C.HOUSE) {
    const t = settlementNear(world, i % world.w, Math.floor(i / world.w));
    tell(world, `${t?.name || "a village"} is raising a ${kindName(kind)}`);
  }
  return s;
}

// A free cell beside the block for a worker to stand on, a different one for
// each hand (k), so they work round it; -1 when the block is walled in.
export function standBy(world: World, s: Site, k: number): number {
  const x0 = s.i % world.w;
  const y0 = Math.floor(s.i / world.w);
  const ring: number[] = [];
  for (let d = 0; d < 2; d++) ring.push(x0 + d, y0 - 1, x0 + 2, y0 + d, x0 + 1 - d, y0 + 2, x0 - 1, y0 + 1 - d);
  const free: number[] = [];
  for (let n = 0; n < ring.length; n += 2) {
    const [x, y] = [ring[n], ring[n + 1]];
    if (!world.inside(x, y)) continue;
    const j = y * world.w + x;
    if (world.depth[j] < 0.3 && !world.materials.get("cover", world.cover[j]).solid) free.push(j);
  }
  return free.length ? free[k % free.length] : -1;
}

// Villagers working on a site right now.
export function handsOn(world: World, s: Site): number {
  const cells = cellsOf(world, s.i);
  let n = 0;
  for (const c of world.creatures) if (!c.dead && c.mind?.task === "raise" && cells.includes(c.mind.cell)) n++;
  return n;
}

// The site of its village a villager can work on: the one furthest along
// first, so a village finishes what it began.
export function siteToWork(world: World, v: Village): Site | null {
  let best: Site | null = null;
  for (const s of sitesOf(world, v)) {
    if (handsOn(world, s) >= SITE.hands) continue;
    if (!best || s.work > best.work) best = s;
  }
  return best;
}

// A spell of work done: the site moves on, and stands finished at the end.
// Returns the stage word of what was done, or null when the site is gone.
export function work(world: World, s: Site, seconds: number, c: Creature | null): string | null {
  if (!world.sites.includes(s)) return null;
  if (cellsOf(world, s.i).some((j) => world.cover[j] !== C.SITE)) return null;
  const before = stageOf(s);
  s.work += seconds;
  if (s.work >= siteTotal(s)) {
    finishSite(world, s);
    return "finished";
  }
  if (stageOf(s) !== before) world.sitesVersion++;
  // Wood chips off the work.
  if (c)
    for (let n = 0; n < 5; n++)
      world.particles.add({
        x: c.x + (Math.random() - 0.5),
        y: c.y + (Math.random() - 0.5),
        z: 1,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        vz: 2 + Math.random() * 2,
        life: 0.5,
        color: 0xc8a06a,
        size: 0.7,
        gravity: 10,
      });
  return STAGE_WORDS[before];
}

function finishSite(world: World, s: Site): void {
  world.sites = world.sites.filter((o) => o !== s);
  world.sitesVersion++;
  const x = s.i % world.w;
  const y = Math.floor(s.i / world.w);
  for (const j of cellsOf(world, s.i)) world.setCover(j, s.kind);
  if (s.kind === C.HOUSE) {
    const v = villageOf(world, x + 1, y + 1);
    if (v) v.houses++;
    return;
  }
  const t = settlementNear(world, x, y);
  if (t) {
    (t.jobs ??= []).push({ kind: s.kind, i: s.i });
    tell(world, `${t.name || "a village"} built a ${kindName(s.kind)}`);
  }
}

// Every twenty seconds from growBuildings: sites that burned or were blasted
// away are dropped, and so are sites whose village is gone.
export function checkSites(world: World): void {
  if (!world.sites.length) return;
  const keep: Site[] = [];
  for (const s of world.sites) {
    const cells = cellsOf(world, s.i);
    const x = s.i % world.w;
    const y = Math.floor(s.i / world.w);
    const t = settlementNear(world, x, y);
    if (cells.some((j) => world.cover[j] !== C.SITE)) {
      for (const j of cells) if (world.cover[j] === C.SITE) world.setCover(j, C.NONE);
      if (cells.some((j) => world.ground[j] === G.ASH)) tell(world, `the ${kindName(s.kind)} going up in ${t?.name || "the village"} burned`);
      continue;
    }
    const v = villageOf(world, x + 1, y + 1);
    if (v && v.people > 0) s.seen = world.time;
    else if (world.time - (s.seen ?? s.since) > SITE.orphan) {
      for (const j of cells) world.setCover(j, C.NONE);
      continue;
    }
    keep.push(s);
  }
  if (keep.length !== world.sites.length) world.sitesVersion++;
  world.sites = keep;
}

// "a granary, 2 of 4" for the villager's card.
export function siteLine(world: World, v: Village): string | null {
  const list = sitesOf(world, v);
  if (!list.length) return null;
  return list.map((s) => `a ${kindName(s.kind)}, ${STAGE_NAMES[stageOf(s)]} (${stageOf(s) + 1} of ${SITE.stages.length})`).join("; ");
}

// A saved site, checked; null when it does not fit the island.
export function readSite(world: World, raw: unknown): Site | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const i = Number(r.i);
  const kind = Number(r.kind);
  if (!Number.isInteger(i) || i < 0 || i + world.w + 1 >= world.n || (i % world.w) + 1 >= world.w) return null;
  if (kind !== C.HOUSE && (kind < FIRST_JOB || kind > LAST_JOB)) return null;
  const work = Math.max(0, Number(r.work) || 0);
  const logs = Math.max(0, Math.min(10, Number(r.logs) || 0));
  return { i, kind, work, logs, since: world.time };
}
