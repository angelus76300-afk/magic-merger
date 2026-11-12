import { housesOf, tierOf, type Tier } from "./buildings";
import type { Creature } from "./creatures";
import { VILLAGE_REACH, type Village } from "./kin";
import { C, G } from "./materials";
import type { World } from "./world";

// The island as a map (roadmap 4.9 part 3, 2026-11-12). Seen whole, the
// island reads as a place with towns and roads: each village's name over it,
// the roads drawn wide and pale, a glow at night as large as its people, dust
// over what is being built and smoke over what burnt, and carts on the roads
// while a market trip is under way. All of it read from what the simulation
// holds, nothing invented; nothing here changes the world (view only).
//
// Plain logic, no drawing: the view (voxel/view.ts) draws what this returns,
// npm test checks it (scripts/map-test.ts).

// How much of the island the camera holds: 1 for the whole island (the
// tour's opening shot, firstlook.ts), about 0.1 at the default zoom on a
// folded phone. Each layer fades in between its two numbers.
export const FAR = {
  names: [0.3, 0.55],
  roads: [0.18, 0.45],
  glows: [0.2, 0.45],
  plumes: [0.15, 0.4],
  carts: [0.12, 0.6],
} as const;

/** 0 below `from`, 1 above `to`, smooth between. */
export function fade(cover: number, [from, to]: readonly [number, number]): number {
  const t = Math.max(0, Math.min(1, (cover - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** The share of the island the camera holds: its visible radius against the island's. */
export function coverOf(visibleRadius: number, world: { w: number; h: number }): number {
  return visibleRadius / (Math.max(world.w, world.h) * 0.55);
}

export interface MapVillage {
  name: string;
  x: number;
  y: number;
  tier: Tier;
  // From the village search (kin.ts findVillages): its people and house blocks.
  people: number;
  houses: number;
  // The share of its windows lit at night: two people to a house.
  lit: number;
  // Hidden while a trouble's line names it (troubles.ts): the line says it already.
  hidden: boolean;
}

export interface Plume {
  x: number;
  y: number;
  // Dust over a house going up, smoke over a burnt block.
  kind: "dust" | "smoke";
}

export interface IslandMap {
  villages: MapVillage[];
  // Road cells, laid or worn (G.ROAD), and bridge decks: what the far roads are drawn from.
  roads: number[];
  plumes: Plume[];
  // World time it was made at, and a count that changes with it.
  at: number;
  version: number;
}

// The village search runs every 3 s (goals.ts stepGoals): the map no faster.
export const MAP_EVERY = 3;

export function emptyMap(): IslandMap {
  return { villages: [], roads: [], plumes: [], at: -Infinity, version: 0 };
}

/** Made again when MAP_EVERY seconds have passed since the last; true when it was. */
export function refreshMap(world: World, map: IslandMap): boolean {
  if (world.time - map.at < MAP_EVERY && world.time >= map.at) return false;
  map.at = world.time;
  map.version++;
  map.villages = villagesOf(world);
  map.roads = roadCells(world);
  map.plumes = plumesOf(world);
  return true;
}

function villageAt(world: World, x: number, y: number): Village | null {
  let best: Village | null = null;
  let bestD = VILLAGE_REACH;
  for (const v of world.villages) {
    const d = Math.hypot(v.x - x, v.y - y);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

export function villagesOf(world: World): MapVillage[] {
  const t = world.trouble;
  const out: MapVillage[] = [];
  for (const s of world.settlements) {
    if (!s.name) continue;
    const v = villageAt(world, s.x, s.y);
    // Nobody lives there any more: no name on the map.
    if (!v || v.people <= 0) continue;
    const houses = Math.max(1, v.houses);
    out.push({
      name: s.name,
      x: s.x,
      y: s.y,
      tier: tierOf(housesOf(world, s)),
      people: v.people,
      houses: v.houses,
      lit: Math.max(0, Math.min(1, v.people / (2 * houses))),
      hidden: !!t && (t.name === s.name || Math.hypot(t.vx - s.x, t.vy - s.y) < 6),
    });
  }
  return out;
}

export function roadCells(world: World): number[] {
  const out: number[] = [];
  for (let i = 0; i < world.n; i++) if (world.ground[i] === G.ROAD || (world.cover[i] === C.BRIDGE && world.decks.has(i))) out.push(i);
  return out;
}

// One plume a site, one a burnt block (its 2 by 2 rubble counted once), within a village's reach.
export function plumesOf(world: World): Plume[] {
  const out: Plume[] = [];
  for (const s of world.sites) out.push({ x: (s.i % world.w) + 1, y: Math.floor(s.i / world.w) + 1, kind: "dust" });
  const smoke: Plume[] = [];
  for (const s of world.settlements) {
    const r = 18;
    for (let y = Math.max(0, Math.round(s.y - r)); y <= Math.min(world.h - 1, Math.round(s.y + r)); y++)
      for (let x = Math.max(0, Math.round(s.x - r)); x <= Math.min(world.w - 1, Math.round(s.x + r)); x++) {
        if (world.cover[y * world.w + x] !== C.RUBBLE) continue;
        // A block is two by two: one plume for it, from its first cell found.
        if (smoke.some((p) => Math.abs(p.x - x - 0.5) <= 1.5 && Math.abs(p.y - y - 0.5) <= 1.5)) continue;
        smoke.push({ x: x + 0.5, y: y + 0.5, kind: "smoke" });
      }
  }
  out.push(...smoke);
  return out;
}

/** A villager on its way to market in another village (goals.ts goToMarket, trade): drawn with a cart. */
export function onTrip(c: Creature): boolean {
  if (c.dead || c.kind !== "villager" || c.mind?.task !== "trade") return false;
  const trip = c.data.trip as { to?: object } | undefined;
  // To a village, not to see a wonder.
  return !!trip?.to && !("seed" in trip.to);
}

export interface Label {
  // Its place on the screen (the middle of its baseline) and its size, in CSS pixels.
  x: number;
  y: number;
  w: number;
  h: number;
}

// A part of the screen kept clear: its top left corner and its size, in CSS pixels.
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Which names are shown: the larger village first, a name that would overlap
 * one already placed, leave the screen or reach into a blocked rectangle (the
 * line at the top) is left out. `order` lists the labels most important first.
 */
export function placeNames(labels: Label[], order: number[], screen: { w: number; h: number }, blocked: Rect[]): boolean[] {
  const shown = labels.map(() => false);
  const placed: Label[] = [];
  const box = (l: Label) => ({ x0: l.x - l.w / 2 - 3, x1: l.x + l.w / 2 + 3, y0: l.y - l.h - 2, y1: l.y + 3 });
  const hits = (a: Label, b: Label) => {
    const p = box(a);
    const q = box(b);
    return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
  };
  for (const k of order) {
    const l = labels[k];
    const b = box(l);
    if (b.x0 < 2 || b.x1 > screen.w - 2 || b.y0 < 2 || b.y1 > screen.h - 2) continue;
    if (placed.some((o) => hits(l, o))) continue;
    if (blocked.some((o) => b.x0 < o.x + o.w && o.x < b.x1 && b.y0 < o.y + o.h && o.y < b.y1)) continue;
    placed.push(l);
    shown[k] = true;
  }
  return shown;
}

/**
 * Each village's name as a label, just under the village's middle as `project` puts it on the
 * screen (CSS pixels; `behind` when the camera cannot see it): the village's own glow and smoke rise
 * above it, clear of the letters. `widthOf` is its lettered width. A hidden village's or one behind
 * the camera is placed off the screen, so it is never shown.
 */
export function nameLabels(
  villages: MapVillage[],
  project: (v: MapVillage) => { x: number; y: number; behind: boolean },
  widthOf: (v: MapVillage) => number,
  big = 1,
): Label[] {
  return villages.map((v) => {
    const p = project(v);
    const h = LETTERING[v.tier].px * big;
    return { x: p.x, y: p.behind || v.hidden ? -1e4 : p.y + 6 + h, w: widthOf(v), h };
  });
}

/** Where a villager's cart stands: behind it, along its heading (radians along +x), `s` times a cart's size. */
export function cartCenter(x: number, y: number, heading: number, s: number): { x: number; y: number } {
  const back = 0.75 + 0.35 * s;
  return { x: x - Math.cos(heading) * back, y: y - Math.sin(heading) * back };
}

const TIER_RANK: Record<Tier, number> = { town: 3, village: 2, hamlet: 1 };

/** Most important first: towns, then villages, then hamlets; more people first within each. */
export function nameOrder(villages: MapVillage[]): number[] {
  return villages.map((_, k) => k).sort((a, b) => TIER_RANK[villages[b].tier] - TIER_RANK[villages[a].tier] || villages[b].people - villages[a].people);
}

// How a name is lettered, by the size of its village: a town in spaced capitals,
// a village in its own name, a hamlet small and slanted, as on an old map.
export const LETTERING: Record<Tier, { px: number; weight: number; italic: boolean; caps: boolean; spacing: number }> = {
  town: { px: 15, weight: 700, italic: false, caps: true, spacing: 1.6 },
  village: { px: 13.5, weight: 700, italic: false, caps: false, spacing: 0.4 },
  hamlet: { px: 12, weight: 600, italic: true, caps: false, spacing: 0.2 },
};

/** The glow over a village at night, in lit windows: its people decide how many, never the time of day. */
export function litWindows(v: MapVillage, windows: number): number {
  return Math.round(windows * v.lit);
}
