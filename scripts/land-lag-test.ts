// The land after a spell (17 November, the owner: "the state calculations when a spell destroys
// land or starts fires takes a bit to appear and we have visible chunks"). On high each changed
// chunk of the fine land was built again whole, one after the other, some twenty frames each. Now
// the chunks a change reaches are built again in one group, only the tiles the change reaches, and
// shown in the same frame (terrain.ts updateFine). These checks build seeded islands as on high,
// change their land, play the frames with a clock that counts work instead of the machine's
// speed, and compare the land drawn in part with the same island built whole, byte for byte.
import { MeshBasicMaterial, type BufferGeometry, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { F, G } from "../src/sim/materials";
import { GRAPHICS } from "../src/sim/voxel/graphics";
import { CHUNK, Terrain } from "../src/sim/voxel/terrain";
import { LOOK_ISLANDS, LOOK_SWITCHES } from "./terrain-looks-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

// What the checks read inside the terrain.
interface Inside {
  fine: (Mesh | null | undefined)[];
  fineWater: (Mesh | null | undefined)[];
  fineTops: ({ h: Int16Array } | undefined)[];
  fineStale: Uint8Array;
  group: unknown;
}

// A tile of the fine land costs about a third of a millisecond on the machine of 17 November; the
// clock moves TICK_MS each time it is read (three reads a tile), so a frame's share holds the same
// number of tiles on every machine.
const TICK_MS = 0.11;

export interface Change {
  name: string;
  apply: (world: World) => void;
}

// A crater of radius r at (cx, cy): the land lowered in a bowl, its floor burnt to ash.
export function crater(cx: number, cy: number, r: number, depth: number): Change {
  return {
    name: `crater of ${r} at ${cx},${cy}`,
    apply: (world) => {
      for (let y = Math.max(0, cy - r); y < Math.min(world.h, cy + r + 1); y++)
        for (let x = Math.max(0, cx - r); x < Math.min(world.w, cx + r + 1); x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > r) continue;
          const i = y * world.w + x;
          world.height[i] = Math.max(0.5, world.height[i] - depth * (1 - (d / r) ** 2));
          world.ground[i] = d < r * 0.8 ? G.ASH : G.DIRT;
          world.cover[i] = 0;
        }
    },
  };
}

// A fire's ash: one cell in three of the grass within r burnt.
export function burn(cx: number, cy: number, r: number): Change {
  return {
    name: `ash of ${r} at ${cx},${cy}`,
    apply: (world) => {
      let s = 12345;
      for (let y = Math.max(0, cy - r); y < Math.min(world.h, cy + r + 1); y++)
        for (let x = Math.max(0, cx - r); x < Math.min(world.w, cx + r + 1); x++) {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          if (Math.hypot(x - cx, y - cy) > r || s % 3 !== 0) continue;
          const i = y * world.w + x;
          if (world.ground[i] === G.GRASS) world.ground[i] = G.ASH;
        }
    },
  };
}

// Crystal in two cells of three within r, as Big Bang's stardust leaves it: a spell's ground, drawn
// in soft patches of the colour of the cells round it (terrain.ts readSoft), which reach farthest.
export function crystal(cx: number, cy: number, r: number): Change {
  return {
    name: `crystal of ${r} at ${cx},${cy}`,
    apply: (world) => {
      let s = 777;
      for (let y = Math.max(0, cy - r); y < Math.min(world.h, cy + r + 1); y++)
        for (let x = Math.max(0, cx - r); x < Math.min(world.w, cx + r + 1); x++) {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          const i = y * world.w + x;
          if (Math.hypot(x - cx, y - cy) > r || s % 3 === 0 || world.fluid[i] !== 0) continue;
          world.ground[i] = G.CRYSTAL;
        }
    },
  };
}

// A pool of lava, three cells across, on dry land: its glow reaches three cells into the land
// round it (terrain-fine.ts GLOW_REACH).
export function lava(cx: number, cy: number): Change {
  return {
    name: `lava at ${cx},${cy}`,
    apply: (world) => {
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let x = cx - 1; x <= cx + 1; x++) {
          const i = y * world.w + x;
          world.fluid[i] = F.LAVA;
          world.depth[i] = 0.4;
        }
    },
  };
}

// A pond poured on dry land, five cells across: new water, drawn in eighths with its tops and sides.
export function pond(cx: number, cy: number): Change {
  return {
    name: `pond at ${cx},${cy}`,
    apply: (world) => {
      for (let y = cy - 2; y <= cy + 2; y++)
        for (let x = cx - 2; x <= cx + 2; x++) {
          const i = y * world.w + x;
          world.fluid[i] = F.WATER;
          world.depth[i] = 0.8;
        }
    },
  };
}

// One cell raised, on the corner of four chunks.
export function bump(x: number, y: number): Change {
  return {
    name: `one cell raised at ${x},${y}`,
    apply: (world) => {
      world.height[y * world.w + x] += 3;
    },
  };
}

// The nearest dry cell to the island's middle with water two cells away: a crater there reaches
// the water (its tops and sides are drawn again too).
function shore(world: World): { x: number; y: number } {
  let best = { x: world.w >> 1, y: world.h >> 1, d: Infinity };
  for (let y = 8; y < world.h - 8; y++)
    for (let x = 8; x < world.w - 8; x++) {
      const i = y * world.w + x;
      if (world.fluid[i] !== 0 || world.fluid[i + 2] === 0 || world.depth[i + 2] < 0.3) continue;
      const d = Math.hypot(x - world.w / 2, y - world.h / 2);
      if (d < best.d) best = { x, y, d };
    }
  return best;
}

function hashOf(g: BufferGeometry | null | undefined): string {
  if (!g) return "none";
  let h = 0x811c9dc5;
  const arrays = [
    ...Object.keys(g.attributes)
      .sort()
      .map((n) => g.getAttribute(n).array),
    ...(g.index ? [g.index.array] : []),
  ];
  for (const a of arrays) {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let k = 0; k < bytes.length; k++) h = Math.imul(h ^ bytes[k], 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function tilesHash(t: { h: Int16Array } | undefined): string {
  if (!t) return "none";
  let h = 0x811c9dc5;
  const bytes = new Uint8Array(t.h.buffer, t.h.byteOffset, t.h.byteLength);
  for (let k = 0; k < bytes.length; k++) h = Math.imul(h ^ bytes[k], 0x01000193);
  return (h >>> 0).toString(16);
}

// Meshes of the fine land or its water with a position that is not a number.
function nanIn(terrain: Terrain): number {
  const t = terrain as unknown as Inside;
  let n = 0;
  for (const m of [...t.fine, ...t.fineWater]) {
    const p = m?.geometry.getAttribute("position").array;
    if (p && p.some((v) => Number.isNaN(v))) n++;
  }
  return n;
}

// Each chunk's fine land, its water in eighths and the tops creatures stand on.
function drawn(terrain: Terrain): string[] {
  const t = terrain as unknown as Inside;
  return t.fine.map((m, c) => `${hashOf(m?.geometry)}/${hashOf(t.fineWater[c]?.geometry)}/${tilesHash(t.fineTops[c])}`);
}

function withHigh<T>(run: () => T): T {
  const was = { ...GRAPHICS };
  const flags = GRAPHICS as unknown as Record<string, boolean>;
  for (const s of LOOK_SWITCHES) flags[s] = true;
  GRAPHICS.water = true;
  GRAPHICS.warmlight = true;
  try {
    return run();
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

// The island drawn whole, as its first frame and the camera at a mid zoom over its middle have it.
// `like`: the island played, whose water's ages (Terrain.wetSince, for weed) the whole one takes.
function build(world: World, clock?: () => number, like?: Terrain): Terrain {
  const mat = new MeshBasicMaterial();
  const terrain = new Terrain(
    world,
    mat,
    mat,
    () => {},
    () => {},
  );
  if (clock) terrain.clock = clock;
  terrain.scan();
  if (like) {
    const now = like.clock();
    terrain.clock = () => now;
    (terrain as unknown as { wetSince: Float64Array }).wetSince.set((like as unknown as { wetSince: Float64Array }).wetSince);
  }
  terrain.rebuild(true);
  const dist = 45;
  terrain.focus(dist * 0.81 * Math.SQRT1_2, dist * 0.58 + 8, dist * 0.81 * Math.SQRT1_2, 0, 0);
  terrain.updateFine(0, true);
  return terrain;
}

export interface Played {
  frames: number; // frames from the change until its land is drawn
  shown: number[][]; // the chunks whose fine land changed, frame by frame
  tiles: number; // tiles built
  order: number[];
  same: boolean; // drawn as the island built whole
  differ: number; // chunks drawn otherwise
  nan: number; // meshes with a position that is not a number
}

// Plays the frames after each change, one after the other on the same island, and compares the
// land with the island built whole after it.
export function playChanges(k: number, changes: (world: World) => Change[], reach?: number): { world: World; runs: (Played & { name: string })[] } {
  return withHigh(() => {
    const { cells, seed, land } = LOOK_ISLANDS[k];
    const world = generateWorld(cells, cells, seed, land);
    let now = 0;
    const terrain = build(world, () => (now += TICK_MS));
    if (reach !== undefined) terrain.fineReach = reach;
    const inside = terrain as unknown as Inside;
    const runs: (Played & { name: string })[] = [];
    for (const change of changes(world)) {
      // Some seconds of frames at 60 a second with nothing changed: the credit for changed land
      // refills (terrain.ts CREDIT_FRAME_MS).
      for (let k = 0; k < 400; k++) {
        now += 1000 / 60;
        terrain.rebuild(false);
      }
      change.apply(world);
      terrain.scan();
      const shown: number[][] = [];
      let frames = 0;
      const groups = terrain.redraw.groups;
      for (; frames < 400; frames++) {
        const was = inside.fine.slice();
        terrain.rebuild(false);
        shown.push(inside.fine.map((m, c) => (m !== was[c] ? c : -1)).filter((c) => c >= 0));
        if (!inside.group && !inside.fineStale.some((s) => s === 1)) break;
      }
      const whole = drawn(build(world, undefined, terrain));
      const part = drawn(terrain);
      const differ = part.filter((h, c) => h !== whole[c]).length;
      runs.push({
        name: change.name,
        frames: terrain.redraw.groups > groups ? terrain.redraw.frames : 0,
        shown: shown.filter((s) => s.length),
        tiles: terrain.redraw.tiles,
        order: terrain.redraw.order.slice(),
        same: differ === 0,
        differ,
        nan: nanIn(terrain),
      });
    }
    return { world, runs };
  });
}

const CHANGES = (world: World): Change[] => {
  const mid = world.w >> 1;
  const s = shore(world);
  return [
    crater(mid - 5, mid - 7, 10, 6),
    crater(s.x, s.y, 6, 3),
    burn(mid + 9, mid + 4, 12),
    crystal(mid - 12, mid + 10, 7),
    lava(mid - 20, mid + 6),
    pond(mid + 14, mid - 12),
    bump(CHUNK * 2, CHUNK * 2),
  ];
};

export function landLagChecks(check: Check): void {
  const islands = [0, 2].map((k) => ({ k, ...playChanges(k, CHANGES) }));
  const runs = islands.flatMap((i) => i.runs.map((r) => ({ ...r, island: LOOK_ISLANDS[i.k].name })));
  check(
    "a spell's change to the land is drawn in part, and the land is the same, byte for byte, as the island drawn whole after it (no seam, no hole)",
    runs.every((r) => r.same),
    runs.map((r) => `${r.island}, ${r.name}: ${r.same ? "same" : `${r.differ} chunks differ`}, ${r.tiles} tiles`).join("; "),
  );
  check(
    "no mesh of the fine land or its water has a position that is not a number after a change",
    runs.every((r) => r.nan === 0),
    runs.map((r) => `${r.name}: ${r.nan}`).join("; "),
  );
  // The reach is what keeps it so: lava's glow needs 4 cells (a spell's soft ground 5, terrain.ts
  // FINE_REACH); with 3 some chunk keeps a stale edge, and the check above sees it.
  const short = playChanges(0, CHANGES, 3).runs;
  check(
    "with a reach of 3 cells instead of 5, some change leaves the land drawn otherwise than whole (the reach is needed)",
    short.some((r) => !r.same),
    short.map((r) => `${r.name}: ${r.differ} chunks differ`).join("; "),
  );
  check(
    "every chunk a change reaches shows its new land in the same frame (no wave of chunks)",
    runs.every((r) => r.shown.length === 1),
    runs.map((r) => `${r.name}: ${r.shown.map((s) => s.length).join("+")} chunks`).join("; "),
  );
  // A crater of ten cells across four chunks: 4 x 256 tiles whole at 4 ms a frame was some 85
  // frames; in part, with the larger share, a handful.
  const big = runs.filter((r) => r.name.startsWith("crater of 10"));
  check(
    "a crater of ten cells is drawn within 8 frames at a third of a millisecond a tile (85 frames before)",
    big.length === 2 && big.every((r) => r.frames > 0 && r.frames <= 8),
    big.map((r) => `${r.island}: ${r.frames} frames, ${r.tiles} tiles`).join("; "),
  );
  const small = runs.filter((r) => r.name.startsWith("crater of 6") || r.name.startsWith("one cell"));
  check(
    "a small crater and a single cell are drawn within 3 frames",
    small.every((r) => r.frames > 0 && r.frames <= 3),
    small.map((r) => `${r.island}, ${r.name}: ${r.frames} frames, ${r.tiles} tiles`).join("; "),
  );
  // A spell's crater by the middle and, in the same tick, a small crater at the island's far corner
  // (the island's own life changes land anywhere): the crater's chunks are one group, shown without
  // waiting for the corner's, which are drawn after it (terrain.ts touching).
  const both = playChanges(0, (world) => {
    const mid = world.w >> 1;
    const a = crater(mid - 5, mid - 7, 10, 6);
    const b = crater(CHUNK * 4 + 10, CHUNK * 4 + 10, 6, 3);
    return [{ name: "a crater and a far crater", apply: (w) => (a.apply(w), b.apply(w)) }];
  }).runs[0];
  check(
    "a crater and a far change in the same tick: the crater's chunks shown first, in one frame, the far ones after, and the land the same as built whole",
    both.same && both.shown.length === 2 && both.shown[0].length === 4 && both.shown[1].length >= 1 && !both.shown[1].some((c) => both.shown[0].includes(c)),
    `${both.shown.map((s) => `[${s.join(",")}]`).join(" then ")}, ${both.same ? "same" : `${both.differ} chunks differ`}`,
  );
  // Nearest the change first: the chunk the crater's middle is in leads its group.
  const first = islands.map((i) => {
    const mid = i.world.w >> 1;
    const c = Math.floor((mid - 7) / CHUNK) * Math.ceil(i.world.w / CHUNK) + Math.floor((mid - 5) / CHUNK);
    return { c, order: i.runs[0].order };
  });
  check(
    "the chunks of a change are built nearest the change first",
    first.every((f) => f.order[0] === f.c),
    first.map((f) => `${f.order.join(",")} (crater in ${f.c})`).join("; "),
  );
}
