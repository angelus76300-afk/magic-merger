import { C, F, G, isBuilding } from "./materials";
import { VILLAGE_REACH, tell, type Village } from "./kin";
import { solidCovers } from "./paths";
import type { Wonder } from "./wonders";
import type { World } from "./world";

// Roads (4.9). Two ways a road comes to be:
//
// 1. Worn in. Villagers wear paths into the grass where they walk (ecology.ts,
//    wearPaths). A path walked hard for a few minutes running, near a
//    village, is trodden into a dirt road; one nobody walks for ten minutes
//    goes back to a path. A village's own lanes, never more than a share of
//    the land round it.
// 2. Laid. Villages that keep sending people to each other (a merchant, a
//    market day), or to a wonder, survey a way between them once: the
//    cheapest walk, round woods and houses, wide of the fields, over a river
//    where it is narrow. Builders then lay it cell by cell from both ends,
//    and a bridge of planks where it crosses water, paid in wood.
//
// On a road everyone walks faster (creatures.ts), and the flow fields that
// take creatures on long trips count a step on a road as cheaper (paths.ts),
// so walkers keep to it. A bridge carries walkers over water at its deck's
// height (world.walkLevel). Roads are saved with the island; old islands
// load with none and grow their own.

export const ROAD = {
  // People sent from one end to the other (a market day, a merchant, a
  // visit to a wonder), arrived or turned back, before they lay a road.
  linkTrips: 4,
  wonderTrips: 5,
  // The widest water a bridge crosses, in cells, and its wood a cell.
  bridgeSpan: 8,
  bridgeWood: 2,
  // Laid roads a village may be an end of, and on an island.
  perVillage: 3,
  perIsland: 12,
  // No new road where the roads already join two places by a way at most
  // this many times the walk across the grid (through a third village).
  detour: 2,
  // Cells a survey looks at each tick, how far round its two ends it may
  // wander, and the longest road it lays.
  surveyBudget: 600,
  margin: 24,
  maxLen: 260,
  // Worn roads: wear (ecology.ts counts a villager's cell once a second and
  // halves every minute, so a cell walked r times a minute settles near 2r)
  // to tread a path into a dirt road, held this many minutes running; the
  // share of the land round a village that may be worn into road; minutes
  // unused before a worn road is a path again.
  dirtWear: 32,
  dirtMinutes: 3,
  dirtShare: 0.12,
  dirtFade: 10,
  // Walking speed, by what is underfoot.
  trailSpeed: 1.1,
  roadSpeed: 1.3,
  bridgeSpeed: 1.3,
};

// The steepest step a road takes, a little less than a walker climbs.
const CLIMB = 1.5;
// Water deeper than this is crossed by a bridge: any water drawn as water
// (the view's WET_ON), so a road never wades through a shallow river.
const DEEP = 0.06;
const LAND = -999;
// Ends closer than this are one place; fewer people than this are not a village.
const MIN_LEN = 30;
export const MIN_PEOPLE = 4;

export interface Road {
  // Its ends, in cells, and their names (for the card and the chronicle).
  ax: number;
  ay: number;
  bx: number;
  by: number;
  a: string;
  b: string;
  // The way from a to b, as cell indices, and the deck height of each cell
  // over water (LAND for the others).
  cells: number[];
  decks: number[];
  made: number;
}

// An end of a road: a village or a wonder.
type End = Village | Wonder;

interface Link {
  a: End;
  b: End;
  n: number;
  // No way found, or no road allowed yet: not tried again before then.
  retry: number;
}

interface Survey {
  link: Link;
  x0: number;
  y0: number;
  bw: number;
  bh: number;
  cost: Uint16Array;
  from: Int32Array;
  carried: Float32Array;
  run: Uint8Array;
  goal: Uint8Array;
  buckets: number[][];
  d: number;
  left: number;
  found: number;
}

interface State {
  links: Link[];
  survey: Survey | null;
  // Cells on a laid road, which never fade, and cells worn into road this
  // session (only those fade back).
  planned: Uint8Array;
  worn: Uint8Array;
  held: Uint8Array;
  idle: Uint8Array;
  version: number;
  // Who is laying which cell, until when.
  claims: Map<number, number>;
}

const states = new WeakMap<World, State>();
function stateOf(world: World): State {
  let s = states.get(world);
  if (!s || s.planned.length !== world.n) {
    s = {
      links: [],
      survey: null,
      planned: new Uint8Array(world.n),
      worn: new Uint8Array(world.n),
      held: new Uint8Array(world.n),
      idle: new Uint8Array(world.n),
      version: -1,
      claims: new Map(),
    };
    states.set(world, s);
  }
  if (s.version !== world.roadsVersion) {
    s.planned.fill(0);
    for (const r of world.roads) for (const i of r.cells) if (i >= 0 && i < world.n) s.planned[i] = 1;
    s.version = world.roadsVersion;
  }
  return s;
}

export function isRoad(g: number): boolean {
  return g === G.ROAD;
}

// A trodden way, worn or laid: houses, gardens and fields keep off it.
export function isWay(g: number): boolean {
  return g === G.PATH || g === G.ROAD;
}

// On a laid road's line (laid already or not): houses keep off it.
export function planned(world: World, i: number): boolean {
  return stateOf(world).planned[i] === 1;
}

// How much faster a walker goes on this cell.
export function roadSpeed(world: World, i: number): number {
  if (world.cover[i] === C.BRIDGE && world.onDeck(i)) return ROAD.bridgeSpeed;
  const g = world.ground[i];
  if (g === G.ROAD) return ROAD.roadSpeed;
  if (g === G.PATH) return ROAD.trailSpeed;
  return 1;
}

function nameOf(world: World, e: End): string {
  return settlementName(world, e) ?? "the village";
}

// A wonder's name, or the name of the village's settlement (none on islands
// from before 4.4.5).
function settlementName(world: World, e: End): string | null {
  if ("name" in e && typeof e.name === "string") return e.name;
  let best: string | null = null;
  let bestD = 30;
  for (const t of world.settlements) {
    const d = Math.abs(t.x - e.x) + Math.abs(t.y - e.y);
    if (d < bestD && t.name) {
      bestD = d;
      best = t.name;
    }
  }
  return best;
}

function isWonder(e: End): e is Wonder {
  return "kind" in e && "seed" in e;
}

// A villager from `from` set out for `to` (a market, a merchant's trip, a
// visit to a wonder): ends that keep sending people lay a road.
export function noteTrip(world: World, from: Village, to: End): void {
  // Two halves of one village are one village: no road between them.
  if (from === to || Math.hypot(from.x - to.x, from.y - to.y) < MIN_LEN) return;
  // A villager who settled alone far from home is not a village to lay a road to.
  if (from.people < MIN_PEOPLE || (!isWonder(to) && to.people < MIN_PEOPLE)) return;
  const named = settlementName(world, from);
  if (named && named === settlementName(world, to)) return;
  const s = stateOf(world);
  let l = s.links.find((k) => (k.a === from && k.b === to) || (k.a === to && k.b === from));
  if (!l) {
    if (s.links.length > 64) s.links.splice(0, s.links.length - 64);
    s.links.push((l = { a: from, b: to, n: 0, retry: 0 }));
  }
  l.n++;
}

// Is there a road with an end near (x, y) to near (x2, y2)?
function roadBetween(world: World, a: End, b: End): boolean {
  const near = (x: number, y: number, e: End) => Math.hypot(x - e.x, y - e.y) < VILLAGE_REACH;
  return world.roads.some((r) => (near(r.ax, r.ay, a) && near(r.bx, r.by, b)) || (near(r.ax, r.ay, b) && near(r.bx, r.by, a)));
}

// The shortest way from a to b along laid or marked roads, through the
// places at their ends; Infinity when the roads do not join them.
function networkWay(world: World, a: End, b: End): number {
  const near = (x: number, y: number, px: number, py: number) => Math.hypot(x - px, y - py) < VILLAGE_REACH;
  const best = new Map<number, number>();
  const todo: { x: number; y: number; d: number }[] = [{ x: a.x, y: a.y, d: 0 }];
  let found = Infinity;
  while (todo.length) {
    todo.sort((p, q) => q.d - p.d);
    const p = todo.pop()!;
    if (p.d >= found) break;
    if (near(p.x, p.y, b.x, b.y)) {
      found = p.d;
      continue;
    }
    world.roads.forEach((r, k) => {
      for (const [fx, fy, tx, ty] of [
        [r.ax, r.ay, r.bx, r.by],
        [r.bx, r.by, r.ax, r.ay],
      ]) {
        if (!near(fx, fy, p.x, p.y)) continue;
        const d = p.d + r.cells.length;
        const key = k * 2 + (tx === r.ax && ty === r.ay ? 0 : 1);
        if (d >= (best.get(key) ?? Infinity)) continue;
        best.set(key, d);
        todo.push({ x: tx, y: ty, d });
      }
    });
  }
  return found;
}

function roadsAt(world: World, e: End): number {
  return world.roads.filter((r) => Math.hypot(r.ax - e.x, r.ay - e.y) < VILLAGE_REACH || Math.hypot(r.bx - e.x, r.by - e.y) < VILLAGE_REACH).length;
}

// Once a tick (creatures.ts lifeCycle): a survey goes on, or a new one starts.
export function stepRoads(world: World): void {
  const s = stateOf(world);
  if (s.survey) {
    advance(world, s, s.survey);
    return;
  }
  if (world.tick % 60 !== 23 || world.roads.length >= ROAD.perIsland) return;
  // Links whose ends are gone are forgotten.
  s.links = s.links.filter((l) => alive(world, l.a) && alive(world, l.b));
  for (const l of s.links) {
    const need = isWonder(l.a) || isWonder(l.b) ? ROAD.wonderTrips : ROAD.linkTrips;
    if (l.n < need || world.time < l.retry) continue;
    if (
      roadBetween(world, l.a, l.b) ||
      roadsAt(world, l.a) >= ROAD.perVillage ||
      roadsAt(world, l.b) >= ROAD.perVillage ||
      networkWay(world, l.a, l.b) <= (Math.abs(l.a.x - l.b.x) + Math.abs(l.a.y - l.b.y)) * ROAD.detour
    ) {
      l.retry = world.time + 60;
      continue;
    }
    s.survey = startSurvey(world, l);
    if (!s.survey) l.retry = world.time + 120;
    return;
  }
}

function alive(world: World, e: End): boolean {
  return isWonder(e) ? world.wonders.includes(e) : world.villages.includes(e);
}

// Open land cells within r of an end, where a road may start or finish.
function endCells(world: World, e: End, x0: number, y0: number, bw: number, bh: number, out: (k: number) => void): number {
  const solid = solidCovers(world);
  const reach = isWonder(e) ? Math.min(6, Math.max(2, e.r)) + 2 : 3;
  let n = 0;
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dy * dy > reach * reach) continue;
      const x = Math.round(e.x) + dx;
      const y = Math.round(e.y) + dy;
      if (x < x0 || y < y0 || x >= x0 + bw || y >= y0 + bh) continue;
      const i = y * world.w + x;
      if (solid[world.cover[i]] || world.depth[i] > DEEP) continue;
      out((y - y0) * bw + (x - x0));
      n++;
    }
  return n;
}

function startSurvey(world: World, link: Link): Survey | null {
  const { a, b } = link;
  if (Math.hypot(a.x - b.x, a.y - b.y) > ROAD.maxLen * 0.8) return null;
  const m = ROAD.margin;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x)) - m);
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y)) - m);
  const bw = Math.min(world.w, Math.ceil(Math.max(a.x, b.x)) + m + 1) - x0;
  const bh = Math.min(world.h, Math.ceil(Math.max(a.y, b.y)) + m + 1) - y0;
  const n = bw * bh;
  const sv: Survey = {
    link,
    x0,
    y0,
    bw,
    bh,
    cost: new Uint16Array(n).fill(0xffff),
    from: new Int32Array(n).fill(-1),
    carried: new Float32Array(n),
    run: new Uint8Array(n),
    goal: new Uint8Array(n),
    buckets: Array.from({ length: 16 }, () => []),
    d: 0,
    left: n * 3,
    found: -1,
  };
  const starts = endCells(world, a, x0, y0, bw, bh, (k) => {
    sv.cost[k] = 0;
    sv.buckets[0].push(k);
  });
  const goals = endCells(world, b, x0, y0, bw, bh, (k) => (sv.goal[k] = 1));
  if (!starts || !goals) return null;
  return sv;
}

// What a step onto local cell k costs, or 0 where no road goes.
function stepCost(world: World, sv: Survey, from: number, k: number): number {
  const x = sv.x0 + (k % sv.bw);
  const y = sv.y0 + ((k / sv.bw) | 0);
  const i = y * world.w + x;
  const solid = solidCovers(world);
  if (solid[world.cover[i]] && world.cover[i] !== C.BRIDGE) return 0;
  const f = world.fluid[i];
  const fx = sv.x0 + (from % sv.bw);
  const fy = sv.y0 + ((from / sv.bw) | 0);
  const fi = fy * world.w + fx;
  const fromWater = sv.run[from] > 0;
  const fromLevel = fromWater ? sv.carried[from] : world.level(fi);
  if (f !== F.NONE && f !== F.WATER && f !== F.ICE && world.depth[i] > 0.05) return f === F.MUD ? 10 : 0;
  if ((f === F.WATER || f === F.ICE) && world.depth[i] > DEEP) {
    // Over water, at the height of the bank it left.
    if ((fromWater ? sv.run[from] : 0) + 1 > ROAD.bridgeSpan) return 0;
    if (world.level(i) > fromLevel + 0.6) return 0;
    return 10;
  }
  if (Math.abs(world.level(i) - fromLevel) > CLIMB) return 0;
  const g = world.ground[i];
  if (g === G.FIELD) return 12;
  if (isWay(g)) return 3;
  if (world.depth[i] > 0.05) return 6;
  return 4;
}

function advance(world: World, s: State, sv: Survey): void {
  let budget = ROAD.surveyBudget;
  const B = sv.buckets.length;
  const limit = ROAD.maxLen * 12;
  while (budget > 0) {
    let bucket = sv.buckets[sv.d % B];
    let skipped = 0;
    while (!bucket.length && skipped < B) {
      sv.d++;
      skipped++;
      bucket = sv.buckets[sv.d % B];
    }
    if (!bucket.length || sv.d > limit || sv.left <= 0) return finishSurvey(world, s, sv);
    const k = bucket.pop()!;
    budget--;
    sv.left--;
    if (sv.cost[k] !== sv.d) continue;
    if (sv.goal[k]) {
      sv.found = k;
      return finishSurvey(world, s, sv);
    }
    const kx = k % sv.bw;
    const ky = (k / sv.bw) | 0;
    for (let dir = 0; dir < 4; dir++) {
      const nx = dir === 0 ? kx + 1 : dir === 1 ? kx - 1 : kx;
      const ny = dir === 2 ? ky + 1 : dir === 3 ? ky - 1 : ky;
      if (nx < 0 || ny < 0 || nx >= sv.bw || ny >= sv.bh) continue;
      const j = ny * sv.bw + nx;
      const c = stepCost(world, sv, k, j);
      if (!c) continue;
      const d = sv.d + c;
      if (d >= sv.cost[j]) continue;
      // A road leaves water only at a bank it can step onto from the deck.
      const i = (sv.y0 + ny) * world.w + sv.x0 + nx;
      const wet = (world.fluid[i] === F.WATER || world.fluid[i] === F.ICE) && world.depth[i] > DEEP;
      // A bridge runs straight: no bend over the water, where a walker
      // cutting the corner would step off the planks.
      if (wet && sv.run[k] > 0 && sv.from[k] >= 0 && j - k !== k - sv.from[k]) continue;
      sv.cost[j] = d;
      sv.from[j] = k;
      if (wet) {
        sv.run[j] = sv.run[k] + 1;
        sv.carried[j] = sv.run[k] > 0 ? sv.carried[k] : world.level((sv.y0 + ky) * world.w + sv.x0 + kx);
      } else sv.run[j] = 0;
      sv.buckets[d % B].push(j);
    }
  }
}

function finishSurvey(world: World, s: State, sv: Survey): void {
  s.survey = null;
  const link = sv.link;
  if (sv.found < 0) {
    link.retry = world.time + 300;
    return;
  }
  const local: number[] = [];
  for (let k = sv.found; k >= 0; k = sv.from[k]) local.push(k);
  local.reverse();
  const cells = local.map((k) => (sv.y0 + ((k / sv.bw) | 0)) * world.w + sv.x0 + (k % sv.bw));
  if (cells.length < 4) {
    link.retry = world.time + 600;
    return;
  }
  const decks = cells.map(() => LAND);
  // Over each stretch of water, a deck from one bank's height to the other's.
  for (let k = 0; k < cells.length; k++) {
    if (sv.run[local[k]] === 0) continue;
    let e = k;
    while (e + 1 < cells.length && sv.run[local[e + 1]] > 0) e++;
    const before = k > 0 ? world.level(cells[k - 1]) : world.level(cells[k]);
    const after = e + 1 < cells.length ? world.level(cells[e + 1]) : before;
    for (let t = k; t <= e; t++) {
      const f = (t - k + 1) / (e - k + 2);
      decks[t] = Math.round(Math.max(before + (after - before) * f, world.level(cells[t]) + 0.35) * 100) / 100;
    }
    k = e;
  }
  const a = link.a;
  const b = link.b;
  world.roads.push({
    ax: Math.round(a.x),
    ay: Math.round(a.y),
    bx: Math.round(b.x),
    by: Math.round(b.y),
    a: nameOf(world, a),
    b: nameOf(world, b),
    cells,
    decks,
    made: Math.round(world.time),
  });
  world.roadsVersion++;
  link.retry = world.time + 600;
  tell(
    world,
    isWonder(b) ? `${nameOf(world, a)} marked out a road to ${nameOf(world, b)}` : `${nameOf(world, a)} and ${nameOf(world, b)} marked out a road between them`,
  );
}

// A traveller on a long walk to a place a road reaches (to market and
// home again) walks along its line, past the reach of a flow field: aims a
// few cells ahead of the nearest cell, or at that cell when off the road.
// The road is one with an end near the destination, and either its other
// end near the walker or a cell of it close by. False with no such road,
// near the end, or before a bridge not built yet.
export function alongRoad(world: World, x: number, y: number, tx: number, ty: number, out: { x: number; y: number }): boolean {
  if (Math.hypot(tx - x, ty - y) < 12) return false;
  const near = (px: number, py: number, qx: number, qy: number) => Math.hypot(px - qx, py - qy) < VILLAGE_REACH;
  for (const r of world.roads) {
    const forward = near(r.bx, r.by, tx, ty);
    if (!forward && !near(r.ax, r.ay, tx, ty)) continue;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < r.cells.length; k++) {
      const i = r.cells[k];
      const d = Math.abs((i % world.w) - x) + Math.abs(Math.floor(i / world.w) - y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    const start = forward ? [r.ax, r.ay] : [r.bx, r.by];
    if (bestD > 10 && !near(start[0], start[1], x, y)) continue;
    // Already nearer the end than the road would take it: no use.
    if (Math.abs(best - (forward ? r.cells.length - 1 : 0)) < 4) return false;
    const dir = forward ? 1 : -1;
    let k = best;
    if (bestD <= 2) {
      // On it: a few cells on, never past water without planks.
      for (let t = 0; t < 6; t++) {
        const next = k + dir;
        if (next < 0 || next >= r.cells.length) break;
        if (r.decks[next] !== LAND && world.cover[r.cells[next]] !== C.BRIDGE) return t > 0 ? aimAt(world, r.cells[k], out) : false;
        k = next;
      }
    }
    return aimAt(world, r.cells[k], out);
  }
  return false;
}

// A cell's center: cells are centered on whole numbers (world.idx rounds).
function aimAt(world: World, i: number, out: { x: number; y: number }): boolean {
  out.x = i % world.w;
  out.y = Math.floor(i / world.w);
  return true;
}

// Is this cell of a road laid?
export function laid(world: World, r: Road, k: number): boolean {
  const i = r.cells[k];
  if (r.decks[k] !== LAND) return world.cover[i] === C.BRIDGE;
  const c = world.cover[i];
  return isRoad(world.ground[i]) || isBuilding(c) || c === C.WONDER;
}

export interface PaveJob {
  road: Road;
  k: number;
  cell: number;
  // Where the builder stands to lay it: the cell before, already laid (or
  // the cell itself at the road's end).
  stand: number;
  bridge: boolean;
}

// The next cell a village's builders lay: the first not laid, walking out
// from its own end of each of its roads. A bridge waits for wood.
export function nextPave(world: World, v: Village): PaveJob | null {
  const s = stateOf(world);
  for (const r of world.roads) {
    for (const fromA of [true, false]) {
      const ex = fromA ? r.ax : r.bx;
      const ey = fromA ? r.ay : r.by;
      if (Math.hypot(ex - v.x, ey - v.y) >= VILLAGE_REACH) continue;
      const n = r.cells.length;
      for (let t = 0; t < n; t++) {
        const k = fromA ? t : n - 1 - t;
        if (laid(world, r, k)) continue;
        const cell = r.cells[k];
        if ((s.claims.get(cell) ?? -1) > world.time) break;
        const bridge = r.decks[k] !== LAND;
        if (bridge && v.wood < ROAD.bridgeWood) break;
        const prev = t === 0 ? k : fromA ? k - 1 : k + 1;
        return { road: r, k, cell, stand: r.cells[prev], bridge };
      }
    }
  }
  return null;
}

export function claim(world: World, cell: number): void {
  stateOf(world).claims.set(cell, world.time + 25);
}

// A builder lays one cell: a dirt road on land (what grew there is cleared;
// a tree felled is wood for the village), planks over water.
export function pave(world: World, job: PaveJob, v: Village | null): boolean {
  const { road, k, cell } = job;
  stateOf(world).claims.delete(cell);
  if (road.decks[k] !== LAND) {
    if (world.cover[cell] === C.BRIDGE) return false;
    if (!v || v.wood < ROAD.bridgeWood) return false;
    if (isBuilding(world.cover[cell]) || world.cover[cell] === C.WONDER) return false;
    v.wood -= ROAD.bridgeWood;
    world.decks.set(cell, road.decks[k]);
    world.setCover(cell, C.BRIDGE);
    if (!road.cells.some((i, t) => road.decks[t] !== LAND && world.cover[i] !== C.BRIDGE))
      tell(world, `a bridge on the road from ${road.a} to ${road.b}`, { x: cell % world.w, y: Math.floor(cell / world.w) });
    return true;
  }
  const c = world.cover[cell];
  if (isBuilding(c) || c === C.WONDER) return false;
  if (c === C.TREE && v) v.wood++;
  if (c !== C.NONE && c !== C.WELL && c !== C.FENCE) world.setCover(cell, C.NONE);
  world.ground[cell] = G.ROAD;
  if (road.cells.every((_, t) => laid(world, road, t)))
    tell(world, `the road from ${road.a} to ${road.b} is finished`, { x: cell % world.w, y: Math.floor(cell / world.w) });
  return true;
}

// Once a minute (ecology.ts wearPaths, before the wear halves): a path
// walked hard for a few minutes running near a village is trodden into a
// dirt road, and a worn road nobody walks fades back to a path.
export function wearMinute(world: World): void {
  const wear = world.wear;
  if (!wear) return;
  const s = stateOf(world);
  const { w, h } = world;
  for (const v of world.villages) {
    const r = VILLAGE_REACH;
    const x0 = Math.max(0, Math.round(v.x - r));
    const x1 = Math.min(w - 1, Math.round(v.x + r));
    const y0 = Math.max(0, Math.round(v.y - r));
    const y1 = Math.min(h - 1, Math.round(v.y + r));
    // The share round its center already worn.
    let roads = 0;
    let land = 0;
    for (let y = Math.max(0, Math.round(v.y - 14)); y <= Math.min(h - 1, Math.round(v.y + 14)); y++)
      for (let x = Math.max(0, Math.round(v.x - 14)); x <= Math.min(w - 1, Math.round(v.x + 14)); x++) {
        const i = y * w + x;
        if (world.depth[i] > 0.05) continue;
        land++;
        if (isRoad(world.ground[i]) && !s.planned[i]) roads++;
      }
    const cap = land * ROAD.dirtShare;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (world.ground[i] !== G.PATH) continue;
        if (wear[i] < ROAD.dirtWear) {
          s.held[i] = 0;
          continue;
        }
        if (++s.held[i] < ROAD.dirtMinutes || roads >= cap) continue;
        world.ground[i] = G.ROAD;
        s.worn[i] = 1;
        s.idle[i] = 0;
        roads++;
      }
  }
  for (let i = 0; i < world.n; i++) {
    if (!s.worn[i]) continue;
    if (!isRoad(world.ground[i]) || s.planned[i]) {
      s.worn[i] = 0;
      continue;
    }
    if (wear[i] >= 4) s.idle[i] = 0;
    else if (++s.idle[i] >= ROAD.dirtFade) {
      world.ground[i] = G.PATH;
      s.worn[i] = 0;
      s.held[i] = 0;
    }
  }
}

// For the villager's card: its village's roads and what they wait for.
export function roadsOf(world: World, v: Village): string[] {
  const out: string[] = [];
  for (const r of world.roads) {
    const atA = Math.hypot(r.ax - v.x, r.ay - v.y) < VILLAGE_REACH;
    const atB = Math.hypot(r.bx - v.x, r.by - v.y) < VILLAGE_REACH;
    if (!atA && !atB) continue;
    const to = atA ? r.b : r.a;
    let done = 0;
    let water = 0;
    let planks = 0;
    for (let k = 0; k < r.cells.length; k++) {
      if (laid(world, r, k)) done++;
      if (r.decks[k] !== LAND) {
        water++;
        if (world.cover[r.cells[k]] === C.BRIDGE) planks++;
      }
    }
    // Either end's builders may plank it.
    const other = world.villages.find((o) => o !== v && Math.hypot((atA ? r.bx : r.ax) - o.x, (atA ? r.by : r.ay) - o.y) < VILLAGE_REACH);
    const wood = Math.max(v.wood, other?.wood ?? 0);
    let line = `to ${to}`;
    if (done < r.cells.length) line += `, ${Math.round((done / r.cells.length) * 100)}% laid`;
    else line += ", finished";
    if (water) line += planks < water ? (wood < ROAD.bridgeWood ? ", a bridge waits for wood" : ", a bridge going up") : ", over a bridge";
    out.push(line);
  }
  return out;
}

// Bridges keep their decks: from the saved roads, for cells that still
// have planks (save.ts, after loading).
export function restoreDecks(world: World): void {
  world.decks.clear();
  for (const r of world.roads) r.cells.forEach((i, k) => r.decks[k] !== LAND && world.cover[i] === C.BRIDGE && world.decks.set(i, r.decks[k]));
  world.roadsVersion++;
}

// A saved road, checked: anything that does not read is dropped.
export function readRoad(raw: unknown, world: World): Road | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (![r.ax, r.ay, r.bx, r.by, r.made].every(num)) return null;
  if (!Array.isArray(r.cells) || !Array.isArray(r.decks) || r.cells.length !== r.decks.length || r.cells.length > ROAD.maxLen * 2) return null;
  const cells = r.cells.filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < world.n);
  if (cells.length !== r.cells.length || !r.decks.every(num)) return null;
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 40) : "the village");
  return {
    ax: r.ax as number,
    ay: r.ay as number,
    bx: r.bx as number,
    by: r.by as number,
    a: text(r.a),
    b: text(r.b),
    cells,
    decks: (r.decks as number[]).map((d) => (d === LAND ? LAND : Math.max(-200, Math.min(400, d)))),
    made: r.made as number,
  };
}
