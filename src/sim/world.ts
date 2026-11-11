import type { ArtHooks } from "./artifacts";
import type { StoryLine } from "./kin";
import type { Creature } from "./creatures";
import { C, F, G, MaterialTable, type Layer } from "./materials";
import { Rng, fbm, valueNoise } from "./noise";
import { Particles } from "./particles";
import { VoxelState, packVoxel, VK } from "./voxels";
import { keyX, keyY, voxelKey } from "./voxelkey";
import { DecorStore } from "./decor";
import { BIOMES, buildLand, drainage, type LandOptions, type Spring } from "./land";
import { dressSettlements, ecology, growSettlements, markRefuges, type Refuge, type Settlement } from "./ecology";
import { SPECIES } from "./wildlife";
import { placeWonders, settleWonders, type Wonder, type WonderDef } from "./wonders";
import { layOutVillages } from "./buildings";
import { CreatureGrid } from "./crowd";
import type { Landmark, Presence } from "./social";
import type { Ruin, Ward } from "./wards";
import type { Prop } from "./props";
import type { Death, Mark, Village } from "./kin";
import type { Road } from "./roads";
import type { Site } from "./sites";

export const TICK = 1 / 30;
export const AMBIENT = 15;

// Moments the view turns into sound and screen effects. The simulation only
// records them; whoever draws the world decides what to do with them.
export type WorldEvent =
  // Where it happened, in cells (4.8): heard nearer or farther, left or
  // right. Without a place a spell's sound belongs to its cast. `routine`
  // is everyday work, heard only near the camera.
  | { kind: "sound"; name: string; size: number; x?: number; y?: number; routine?: boolean }
  | { kind: "shake"; amount: number; seconds: number }
  | { kind: "flash"; color: number; strength: number }
  | { kind: "error"; spell: string; message: string }
  | { kind: "cast-done"; spell: string };

// The whole simulated land, seen from above. One cell is roughly a few meters;
// heights are in the same unit, so a slope of 1 per cell is steep.
export class World {
  readonly n: number;
  readonly height: Float32Array;
  readonly ground: Uint8Array;
  readonly fluid: Uint8Array;
  readonly depth: Float32Array;
  readonly cover: Uint8Array;
  // Fuel left for burning covers, or a house's integrity.
  readonly coverHp: Float32Array;
  // 0 to 1.
  readonly fire: Float32Array;
  readonly temp: Float32Array;
  readonly gas: Uint8Array;
  readonly gasAmt: Float32Array;
  // Fixed per cell noise for color variation.
  readonly shade: Uint8Array;
  readonly materials = new MaterialTable();
  readonly particles = new Particles();
  readonly creatures: Creature[] = [];
  readonly events: WorldEvent[] = [];
  readonly wind = { x: 0.6, y: 0.2 };
  readonly rng: Rng;
  // Free standing voxels placed by spells (a tree's crown, a floating rock),
  // keyed by cell and absolute voxel height, valued by color and kind (see voxels.ts).
  readonly decor = new DecorStore();
  // Who stands where, for creatures looking around (crowd.ts).
  readonly crowd = new CreatureGrid();
  readonly voxels = new VoxelState();
  decorVersion = 0;
  // Cells of spell materials that lure or scare, refreshed a few times a
  // second, and the rules behind them by material name.
  lures: Presence[] = [];
  readonly lureMaterials = new Map<string, { lures: string[]; scares: string[]; taken: boolean }>();
  // Places spells left behind that lure, scare or carry an aura.
  landmarks: Landmark[] = [];
  // What the runtime does for artifacts and creatures (3.7): an artifact's
  // own code, and spells from the shared library cast by name.
  magic: ArtHooks | null = null;
  // The island's story (3.7, kin.ts): lines worth telling, and everyday work counted.
  story: StoryLine[] = [];
  storyCounts: Record<string, number> = {};
  // Places spells keep safe for a while (wards.ts), and what each cell is
  // protected against, as bits.
  wards: Ward[] = [];
  // Wards broken a moment ago (wards.ts, Ruin): not saved.
  ruins: Ruin[] = [];
  // The slow motion of a shatter (wards.ts, breakWard): until this world
  // time the page runs the island at SLOW_FACTOR. Not saved; headless runs
  // and tests ignore it.
  slowUntil = -1;
  lastSlow = -10;
  readonly wardMask: Uint8Array;
  // Gifts villagers have brought home; every few build a house.
  wealth = 0;
  // Villages and their stock, the marks goals left on the land, and who died
  // where lately (3.6, kin.ts).
  villages: Village[] = [];
  marks: Mark[] = [];
  deaths: Death[] = [];
  // Which wild species live here and come back; null for all (3.5).
  wild: readonly string[] | null = null;
  time = 0;
  tick = 0;
  seaLevel = 8;
  // The island's biome, shape and sliders (4.4); null for the old island
  // and the challenges, which keep the old climate.
  land: LandOptions | null = null;
  // Degrees added to the ambient temperature, and where and how fast it
  // falls with height (land.ts, the biome's climate).
  climate = 0;
  lapseFrom = 24;
  lapse = 2.5;
  // A mixed island's regions (4.4.1): each cell's biome, by its index in
  // BIOMES, and each biome's climate, lapse start and lapse in a row.
  biomeMap: Uint8Array | null = null;
  climates = new Float32Array(0);
  // Cells that keep a river flowing (land.ts). With any, water also leaves
  // the island over its edge, so the sea does not rise.
  springs: Spring[] = [];
  // Nature that is never the same twice (4.4.5, ecology.ts): each cell's
  // tree look and niche, the rare variant of a land it belongs to, a refuge
  // kept for each wild species, each village's look and what it has built.
  // All null or empty on the old island and the challenges.
  flora: Uint8Array | null = null;
  rare: Uint8Array | null = null;
  refuges: Refuge[] = [];
  settlements: Settlement[] = [];
  // How often villagers walked over each cell lately: paths wear in (not saved).
  wear: Uint8Array | null = null;
  // Roads villages laid between them and to wonders (4.9, roads.ts), saved;
  // the deck height of each bridge cell; and a counter the view redraws on.
  roads: Road[] = [];
  readonly decks = new Map<number, number>();
  roadsVersion = 0;
  // Houses and buildings going up (4.9 part 2, sites.ts), saved; and a
  // counter the view redraws them on.
  sites: Site[] = [];
  sitesVersion = 0;
  // Wonders and the island's name (4.4.5 part B, wonders.ts); none on the
  // old island and the challenges. House cells rebuilt after a fire wear a
  // patched roof.
  wonders: Wonder[] = [];
  // 4.6: fine box models of what items look like (props.ts), and a counter the view rebuilds them on.
  props: Prop[] = [];
  propsVersion = 0;
  islandName: string | null = null;
  readonly patched = new Set<number>();

  constructor(
    readonly w: number,
    readonly h: number,
    readonly seed: number,
  ) {
    this.n = w * h;
    this.height = new Float32Array(this.n);
    this.ground = new Uint8Array(this.n);
    this.fluid = new Uint8Array(this.n);
    this.depth = new Float32Array(this.n);
    this.cover = new Uint8Array(this.n);
    this.coverHp = new Float32Array(this.n);
    this.fire = new Float32Array(this.n);
    this.temp = new Float32Array(this.n).fill(AMBIENT);
    this.gas = new Uint8Array(this.n);
    this.gasAmt = new Float32Array(this.n);
    this.shade = new Uint8Array(this.n);
    this.wardMask = new Uint8Array(this.n);
    this.rng = new Rng(seed);
    // Color variation: broad patches with a little per cell grain.
    for (let i = 0; i < this.n; i++) {
      const x = i % w;
      const y = Math.floor(i / w);
      this.shade[i] = (Math.min(0.999, valueNoise(x * 0.12, y * 0.12, seed + 7) * 0.75 + valueNoise(x * 0.9, y * 0.9, seed + 9) * 0.25) * 255) | 0;
    }
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x: number, y: number): number {
    return Math.round(y) * this.w + Math.round(x);
  }

  // Temperature a cell drifts back to: colder up high, so peaks keep their snow.
  ambient(i: number): number {
    if (this.biomeMap) {
      const k = this.biomeMap[i] * 3;
      const c = this.climates;
      return AMBIENT + c[k] - Math.max(0, this.height[i] - c[k + 1]) * c[k + 2];
    }
    return AMBIENT + this.climate - Math.max(0, this.height[i] - this.lapseFrom) * this.lapse;
  }

  // Surface height: terrain plus whatever fluid lies on it.
  level(i: number): number {
    return this.height[i] + this.depth[i];
  }

  // Where a walker stands: on a bridge's deck (4.9), else the surface.
  walkLevel(i: number): number {
    const deck = this.cover[i] === C.BRIDGE ? this.decks.get(i) : undefined;
    return deck !== undefined && deck >= this.height[i] + this.depth[i] - 0.3 ? deck : this.height[i] + this.depth[i];
  }

  // A bridge a walker can cross here, its deck above the water.
  onDeck(i: number): boolean {
    if (this.cover[i] !== C.BRIDGE) return false;
    const deck = this.decks.get(i);
    return deck !== undefined && deck >= this.height[i] + this.depth[i] - 0.3;
  }

  setCover(i: number, id: number): void {
    this.cover[i] = id;
    const m = this.materials.get("cover", id);
    this.coverHp[i] = id === C.HOUSE ? 14 : m.fuel;
  }

  setFluid(i: number, id: number, depth: number): void {
    this.fluid[i] = depth > 0 ? id : F.NONE;
    this.depth[i] = id === F.NONE ? 0 : Math.max(0, depth);
  }

  // Puts a material on whatever layer it belongs to, by name.
  place(i: number, name: string, amount = 1): boolean {
    const found = this.materials.find(name);
    if (!found) return false;
    const { layer, id } = found;
    if (layer === "ground") this.ground[i] = id;
    else if (layer === "cover") this.setCover(i, id);
    else if (layer === "fluid") {
      if (this.fluid[i] === id || this.fluid[i] === F.NONE) this.setFluid(i, id, this.depth[i] + amount);
      else this.setFluid(i, id, amount);
    } else {
      this.gas[i] = id;
      this.gasAmt[i] = Math.min(1, this.gasAmt[i] + amount);
    }
    return true;
  }

  static readonly MAX_DECOR = DecorStore.MAX;

  // Whether a spell may put a voxel here. Not inside the land: it would be
  // hidden, except where its faces lie on the land's own top or cut side and
  // the two flicker through each other. A voxel where a tree, a house or any
  // cover stands takes its place (covers are under two voxels tall), so a
  // wall built through a village knocks houses down instead of overlapping them.
  voxelFits(x: number, y: number, level: number): boolean {
    const i = Math.round(y) * this.w + Math.round(x);
    const top = Math.round(this.height[i] * 0.5);
    if (level < top) return false;
    if (level < top + 2 && this.cover[i] !== C.NONE) {
      if (this.voxelGuard?.(i)) return false;
      this.setCover(i, C.NONE);
    }
    return true;
  }
  // Set by the runtime while a spell's code runs: true where that spell may
  // not clear a cover to put a voxel (another spell's ward against harm).
  voxelGuard: ((i: number) => boolean) | null = null;

  setVoxel(x: number, y: number, level: number, color: number | null, kind: number = VK.STONE): void {
    if (!this.inside(Math.round(x), Math.round(y)) || level < -60 || level > 380) return;
    const key = voxelKey(x, y, level);
    if (color !== null && !this.voxelFits(x, y, level)) return;
    if (color === null) {
      if (this.decor.delete(key)) {
        this.decorVersion++;
        this.voxels.removals++;
      }
    } else if (this.decor.has(key) || this.decor.size < World.MAX_DECOR) {
      this.decor.set(key, packVoxel(color, kind));
      this.voxels.burning.delete(key);
      this.decorVersion++;
    }
  }

  // Removes free standing voxels whose cell lies within r of (x, y).
  clearVoxels(x: number, y: number, r: number): void {
    for (const key of this.decor.keys()) {
      const cx = keyX(key);
      const cy = keyY(key);
      if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) this.decor.delete(key);
    }
    this.decorVersion++;
    this.voxels.removals++;
  }

  layerName(layer: Layer, id: number): string {
    return this.materials.get(layer, id).name;
  }

  emit(event: WorldEvent): void {
    this.events.push(event);
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
  }
}

// Builds a fresh land: hills, a sea, a river, forests and a few villages.
// With `land` (4.4), a biome and a shape of the player's choosing (land.ts);
// without, the island every version before 4.4 made, which the test run's
// practice island and the checks keep, so no spell's verdict moves.
// `recent`: the wonder sets of the player's last islands, never made again
// (4.4.5 part B).
// `defs`: the pool of wonders written as programs (4.4.5 part C); they are
// built by raiseWonders (wonderbuild.ts) once the island has a runtime.
export function generateWorld(w: number, h: number, seed: number, land?: LandOptions, recent: readonly string[] = [], defs: readonly WonderDef[] = []): World {
  if (land) return generateLand(w, h, seed, land, recent, defs);
  const world = new World(w, h, seed);
  const rng = world.rng;
  const { height, ground } = world;
  const scale = 1 / 48;

  // Hills from fractal noise, pulled down toward one corner so there is a coast.
  const coastX = rng.next() < 0.5 ? 0 : w;
  const coastY = rng.next() < 0.5 ? 0 : h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const n = fbm(x * scale, y * scale, seed);
      const ridge = 1 - Math.abs(fbm(x * scale * 0.7, y * scale * 0.7, seed + 31) * 2 - 1);
      const coast = Math.hypot((x - coastX) / w, (y - coastY) / h);
      height[i] = 2 + n * 26 + ridge * ridge * 6 + Math.min(1, coast * 1.4) * 6 - 4;
    }
  }

  // Heights are rescaled from their own distribution, so every map gets about
  // a fifth of water and a few snowy peaks, whatever the noise did.
  const sorted = Float32Array.from(height).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const low = at(0.02);
  const sea = at(0.2);
  const high = at(0.995);
  for (let i = 0; i < world.n; i++) {
    // Sea level ends up at 8, the highest peaks near 32.
    const v = height[i];
    height[i] = v < sea ? 8 - ((sea - v) / Math.max(0.01, sea - low)) * 6 : 8 + ((v - sea) / Math.max(0.01, high - sea)) * 24;
  }
  const rockLine = at(0.9) < sea ? 26 : 8 + ((at(0.9) - sea) / Math.max(0.01, high - sea)) * 24;
  const snowLine = 8 + ((at(0.975) - sea) / Math.max(0.01, high - sea)) * 24;

  // A river from a high point, walking downhill until it reaches the sea.
  carveRiver(world, rng);

  // Water fills everything below sea level.
  for (let i = 0; i < world.n; i++) {
    if (height[i] < world.seaLevel) world.setFluid(i, F.WATER, world.seaLevel - height[i]);
  }

  // Ground from height and slope.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const hgt = height[i];
      const slope = Math.abs(height[i] - height[Math.min(w * h - 1, i + 1)]) + Math.abs(height[i] - height[Math.min(w * h - 1, i + w)]);
      if (hgt < world.seaLevel + 0.7) ground[i] = G.SAND;
      else if (hgt > snowLine) ground[i] = G.SNOW;
      else if (hgt > rockLine || slope > 2.2) ground[i] = G.ROCK;
      else if (fbm(x / 20, y / 20, seed + 5, 3) > 0.7) ground[i] = G.DIRT;
      else ground[i] = G.GRASS;
      world.temp[i] = world.ambient(i);
    }
  }

  // Forests where a second noise is high, scattered bushes and flowers elsewhere.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (ground[i] !== G.GRASS || world.depth[i] > 0) continue;
      const forest = fbm(x / 26, y / 26, seed + 13, 4);
      const r = rng.next();
      if (forest > 0.56 && r < (forest - 0.5) * 2.2) world.setCover(i, C.TREE);
      else if (r < 0.025) world.setCover(i, C.BUSH);
      else if (r < 0.035) world.setCover(i, C.FLOWER);
    }
  }
  for (let i = 0; i < world.n; i++) if (ground[i] === G.ROCK && rng.next() < 0.02) world.setCover(i, C.BOULDER);

  // Villages on the flattest dry land, away from each other: score many
  // candidate spots and keep the best ones.
  const villages = Math.max(2, Math.round((w * h) / 12000));
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let k = 0; k < 600; k++) {
    const x = rng.int(12, w - 13);
    const y = rng.int(12, h - 13);
    const score = landScore(world, x, y, 7);
    if (score < Infinity) candidates.push({ x, y, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  const centers: { x: number; y: number }[] = [];
  for (const c of candidates) {
    if (centers.length >= villages) break;
    if (centers.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < Math.min(w, h) / 3.2)) continue;
    centers.push(c);
    buildVillage(world, c.x, c.y, rng);
  }
  return world;
}

function generateLand(w: number, h: number, seed: number, land: LandOptions, recent: readonly string[], defs: readonly WonderDef[]): World {
  const world = new World(w, h, seed);
  const rng = world.rng;
  const { peak } = buildLand(world, land);
  placeVillages(world, rng, world.seaLevel + Math.max(10, peak * 0.62));
  // 4.4.5 part B: wonders shape the land before the plants grow round them.
  placeWonders(world, BIOMES, peak, recent, defs);
  // 4.4.5: what grows where, rare variants, villages' looks, refuges.
  ecology(world, BIOMES, peak, drainage(world).filled);
  settleWonders(world);
  dressSettlements(world, BIOMES);
  growSettlements(world, true);
  layOutVillages(world, BIOMES);
  markRefuges(
    world,
    SPECIES.map((s) => ({ name: s.kind.name, habitat: s.habitat })),
  );
  return world;
}

// Villages on the flattest dry land, away from each other and from rivers:
// score many candidate spots and keep the best ones.
function placeVillages(world: World, rng: Rng, top: number): void {
  const { w, h } = world;
  const villages = Math.max(2, Math.round((w * h) / 12000));
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let k = 0; k < Math.max(600, (w * h) / 40); k++) {
    const x = rng.int(12, w - 13);
    const y = rng.int(12, h - 13);
    const score = landScore(world, x, y, 7, top, (world.seaLevel + top) / 2);
    if (score < Infinity) candidates.push({ x, y, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  const centers: { x: number; y: number }[] = [];
  for (let spread = 3.2; spread <= 8 && centers.length < villages; spread *= 1.6) {
    for (const c of candidates) {
      if (centers.length >= villages) break;
      if (centers.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < Math.min(w, h) / spread)) continue;
      centers.push(c);
      buildVillage(world, c.x, c.y, rng);
      // 4.4.5: each village's look and extras start from its center.
      world.settlements.push({ x: c.x, y: c.y, style: 0, level: 1, jobs: [], store: 0, street: 0, name: "" });
    }
  }
}

function carveRiver(world: World, rng: Rng): void {
  const { w, height } = world;
  let best = 0;
  for (let k = 0; k < 200; k++) {
    const i = rng.int(0, world.n - 1);
    if (height[i] > height[best] && height[i] < 24) best = i;
  }
  let x = best % w;
  let y = Math.floor(best / w);
  for (let step = 0; step < w * 3; step++) {
    const i = y * w + x;
    if (height[i] < world.seaLevel) break;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (!world.inside(nx, ny)) continue;
        const j = ny * w + nx;
        const cut = dx === 0 && dy === 0 ? 1.4 : 0.6;
        height[j] = Math.min(height[j], height[i] - cut * 0.4);
      }
    }
    // Next cell: the lowest neighbor, with a little noise so it meanders.
    let nx = x;
    let ny = y;
    let low = Infinity;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const cx = x + dx;
      const cy = y + dy;
      if (!world.inside(cx, cy)) continue;
      const v = height[cy * w + cx] + rng.next() * 0.8;
      if (v < low) {
        low = v;
        nx = cx;
        ny = cy;
      }
    }
    if (nx === x && ny === y) break;
    // Keep the bed going downhill so water can flow along it.
    height[ny * w + nx] = Math.min(height[ny * w + nx], height[i] - 0.05);
    x = nx;
    y = ny;
  }
}

// How rough the land is around a spot (lower is flatter), or Infinity when
// it is wet, too high or too close to the edge.
function landScore(world: World, cx: number, cy: number, r: number, top = 24, middle = 14): number {
  const base = world.height[world.idx(cx, cy)];
  if (base < world.seaLevel + 1 || base > top) return Infinity;
  let rough = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!world.inside(x, y)) return Infinity;
      const i = y * world.w + x;
      if (world.depth[i] > 0 || world.fluid[i] === F.LAVA) return Infinity;
      rough += Math.abs(world.height[i] - base);
    }
  }
  // Prefer the middle heights: not on the beach, not on the mountain.
  return rough + Math.abs(base - middle) * 20;
}

// Houses are 2 by 2 blocks around a square, with fields on the outskirts.
export function buildVillage(world: World, cx: number, cy: number, rng: Rng, count = 0): void {
  const { w } = world;
  const base = world.height[world.idx(cx, cy)];
  const flatten = (x: number, y: number) => {
    const i = y * w + x;
    world.height[i] = base + (world.height[i] - base) * 0.3;
  };
  // Drawn even when a count is given, so a fresh island's stream is unchanged.
  const drawn = rng.int(5, 9);
  const houses = count > 0 ? count : drawn;
  for (let k = 0; k < houses; k++) {
    const a = (k / houses) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = rng.range(4, 8);
    const hx = Math.round(cx + Math.cos(a) * d);
    const hy = Math.round(cy + Math.sin(a) * d);
    for (let y = hy; y < hy + 2; y++) {
      for (let x = hx; x < hx + 2; x++) {
        if (!world.inside(x, y)) continue;
        flatten(x, y);
        world.ground[y * w + x] = G.DIRT;
        world.setCover(y * w + x, C.HOUSE);
      }
    }
  }
  // A dirt square in the middle.
  for (let y = cy - 2; y <= cy + 2; y++)
    for (let x = cx - 2; x <= cx + 2; x++) {
      const i = y * w + x;
      flatten(x, y);
      world.ground[i] = G.DIRT;
      world.setCover(i, C.NONE);
    }
  // Fields in a ring outside the houses.
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, Math.PI * 2);
    const fx = Math.round(cx + Math.cos(a) * 12);
    const fy = Math.round(cy + Math.sin(a) * 12);
    for (let y = fy - 2; y <= fy + 2; y++) {
      for (let x = fx - 3; x <= fx + 3; x++) {
        if (!world.inside(x, y)) continue;
        const i = y * w + x;
        if (world.depth[i] > 0 || world.cover[i] === C.HOUSE) continue;
        world.ground[i] = G.FIELD;
        world.setCover(i, (x + y) % 2 === 0 ? C.CROP : C.NONE);
      }
    }
  }
}

// A gentle land for hand-made challenge islands: low hills of grass at a
// chosen height, no sea. Challenges then carve and plant what they need.
export function plainWorld(w: number, h: number, seed: number, base = 12, hills = 3): World {
  const world = new World(w, h, seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      world.height[i] = base + (fbm(x / 30, y / 30, seed, 3) - 0.5) * hills * 2;
      world.ground[i] = G.GRASS;
      world.temp[i] = world.ambient(i);
    }
  }
  return world;
}

// Plants a forest over a rectangle, thick in the middle.
export function plantForest(world: World, x0: number, y0: number, x1: number, y1: number, density = 0.6): void {
  for (let y = Math.max(0, y0); y < Math.min(world.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(world.w, x1); x++) {
      const i = y * world.w + x;
      if (world.depth[i] > 0 || world.cover[i] !== C.NONE) continue;
      if (world.rng.next() < density) world.setCover(i, world.rng.next() < 0.85 ? C.TREE : C.BUSH);
    }
  }
}
