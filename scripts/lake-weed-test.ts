// Life under water, first version (20 November): clumps of weed and a few stones on lake beds,
// baked in the fine land in eighths (terrain-fine.ts weedAt, GRAPHICS.weed). Each check is measured
// on generated islands as the fine land draws them, by comparing the land with weed on and off:
// a column drawn higher with it on holds weed or a stone.
// Run with the other checks (npm test, scripts/sim-test.ts).
import { createHash } from "node:crypto";
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { readLand } from "../src/sim/land";
import { CHUNK, FLUID_LIFT, Terrain, WEED_AGE_MS, columnTop, surfaceY } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { WEED_CAP_CHUNK, WEED_GROWS, WEED_LIGHT_HI, WEED_LIGHT_LO, fineAt, lakeShare, weedClumps } from "../src/sim/voxel/terrain-fine";
import { F } from "../src/sim/materials";
import type { Biome, Shape } from "../src/sim/land-options";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SUB = 8;

// The looks of a quality level, the land's own switches on (as in the game).
function withLevel<T>(level: "medium" | "high" | "low", weed: boolean, run: () => T): T {
  const was = { ...GRAPHICS };
  for (const [f, on] of Object.entries(PRESETS[level])) GRAPHICS[f as LooksFlag] = on;
  GRAPHICS.weed = weed;
  try {
    return run();
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

interface Built {
  terrain: Terrain;
  meshes: Mesh[];
  land: MeshBasicMaterial;
  fluid: MeshBasicMaterial;
}
// The island's land, every chunk built in eighths. `before` runs between the first scan and the
// build (to make water young); the clock is `clock` ms.
function build(world: World, clock = { t: 0 }, before?: (t: Terrain) => void): Built {
  const meshes: Mesh[] = [];
  const land = new MeshBasicMaterial();
  const fluid = new MeshBasicMaterial();
  const terrain = new Terrain(
    world,
    land,
    fluid,
    (m) => meshes.push(m),
    (m) => meshes.splice(meshes.indexOf(m), 1),
  );
  terrain.wetClock = () => clock.t;
  terrain.scan();
  before?.(terrain);
  terrain.rebuild(true);
  terrain.focus(world.w * 0.3, 60, world.h * 0.3, 0, 0);
  terrain.updateFine(0, true);
  return { terrain, meshes, land, fluid };
}

// A hash of the shown meshes, whatever their order (a chunk built again is added last).
function hashOf(b: Built, which: "land" | "water"): string {
  const each: string[] = [];
  for (const m of b.meshes) {
    if (!m.visible) continue;
    if ((m.material === b.fluid) !== (which === "water")) continue;
    const h = createHash("sha256");
    for (const a of ["position", "color", "waterFine", "wave"]) {
      const at = m.geometry.getAttribute(a);
      if (at) h.update(Buffer.from((at.array as ArrayLike<number> & { buffer: ArrayBuffer }).buffer));
    }
    if (m.geometry.index) h.update(Buffer.from((m.geometry.index.array as Uint32Array).buffer));
    each.push(h.digest("hex"));
  }
  return createHash("sha256").update(each.sort().join("")).digest("hex").slice(0, 12);
}

function landTriangles(b: Built): number {
  let n = 0;
  for (const m of b.meshes) {
    if (!m.visible || m.material !== b.land) continue;
    n += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.getAttribute("position").count / 3;
  }
  return n;
}

// The highest top over each eighth column of the island (NaN where none) and its colour, from
// the land's shown meshes.
function eighthTops(world: World, b: Built): { y: Float32Array; col: Uint32Array } {
  const W = world.w * SUB;
  const y = new Float32Array(W * world.h * SUB).fill(NaN);
  const col = new Uint32Array(W * world.h * SUB);
  for (const m of b.meshes) {
    if (!m.visible || m.material !== b.land || !m.geometry.index) continue;
    const p = m.geometry.getAttribute("position").array as Float32Array;
    const c = m.geometry.getAttribute("color").array as Uint8Array;
    const cs = m.geometry.getAttribute("color").itemSize;
    for (let q = 0; q < p.length / 12; q++) {
      const top = p[q * 12 + 1];
      if (p[q * 12 + 4] !== top || p[q * 12 + 7] !== top || p[q * 12 + 10] !== top) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        x0 = Math.min(x0, p[q * 12 + k * 3]);
        x1 = Math.max(x1, p[q * 12 + k * 3]);
        z0 = Math.min(z0, p[q * 12 + k * 3 + 2]);
        z1 = Math.max(z1, p[q * 12 + k * 3 + 2]);
      }
      const v = q * 4 * cs;
      const rgb = (c[v] << 16) | (c[v + 1] << 8) | c[v + 2];
      const i0 = Math.round((x0 + world.w / 2) * SUB);
      const i1 = Math.round((x1 + world.w / 2) * SUB);
      const j0 = Math.round((z0 + world.h / 2) * SUB);
      const j1 = Math.round((z1 + world.h / 2) * SUB);
      for (let j = Math.max(0, j0); j < Math.min(world.h * SUB, j1); j++)
        for (let i = Math.max(0, i0); i < Math.min(W, i1); i++) {
          const s = j * W + i;
          if (!(y[s] >= top)) {
            y[s] = top;
            col[s] = rgb;
          }
        }
    }
  }
  return { y, col };
}

function luma(c: number): number {
  return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
}

// The surface the fine land reads over cell i (FineCells.water).
function level(world: World, i: number): number {
  return Math.max(surfaceY(world, i), columnTop(world, i) + FLUID_LIFT);
}

interface Raised {
  s: number; // eighth column
  i: number; // its cell
  raise: number; // eighths above the bed drawn without weed
  top: number; // eighths
  avail: number; // eighths of water over the bed, under the lowest surface round the cell
  ratio: number; // its top's light over the bed's
}
// The columns drawn higher with weed than without it.
function raised(world: World, on: Built, off: Built): Raised[] {
  const a = eighthTops(world, on);
  const b = eighthTops(world, off);
  const W = world.w * SUB;
  const out: Raised[] = [];
  for (let s = 0; s < a.y.length; s++) {
    if (!(a.y[s] > b.y[s] + 1e-4)) continue;
    const x = Math.floor((s % W) / SUB);
    const z = Math.floor(Math.floor(s / W) / SUB);
    const i = z * world.w + x;
    let lv = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) lv = Math.min(lv, level(world, i + dy * world.w + dx));
    const bed = Math.round(b.y[s] * SUB);
    out.push({
      s,
      i,
      raise: Math.round((a.y[s] - b.y[s]) * SUB),
      top: Math.round(a.y[s] * SUB),
      avail: Math.floor(lv * SUB) - bed,
      ratio: luma(a.col[s]) / Math.max(1, luma(b.col[s])),
    });
  }
  return out;
}

const ISLANDS: [string, number, Biome, Shape][] = [
  ["temperate-lakes-7", 7, "temperate", "lakes"],
  ["swamp-lakes-9", 9, "swamp", "lakes"],
  ["tundra-lakes-5", 5, "tundra", "lakes"],
];

export function lakeWeedChecks(check: Check): void {
  for (const [name, seed, biome, shape] of ISLANDS) {
    const world = () => generateWorld(152, 152, seed, readLand({ biome, shape }));
    const w0 = world();
    const on = withLevel("high", true, () => build(w0));
    const again = withLevel("high", true, () => build(world()));
    const off = withLevel("high", false, () => build(world()));
    const rs = raised(w0, on, off);
    const weed = rs.filter((r) => r.raise >= 2);
    const cells = new Set(rs.map((r) => r.i));
    let sea = 0;
    let ice = 0;
    let lava = 0;
    let shallow = 0;
    let deep = 0;
    let near = 0;
    let band = 0;
    let worstLo = Infinity;
    let worstHi = 0;
    for (const r of rs) {
      if (lakeShare(w0.height[r.i] + w0.depth[r.i], w0.seaLevel) <= 0) sea++;
      if (w0.fluid[r.i] === F.ICE) ice++;
      if (w0.fluid[r.i] === F.LAVA) lava++;
      // Weed needs WEED_MIN eighths of water and no more than WEED_MAX; stones (a raise of one)
      // lie on any bed with two.
      if (r.avail < 2 || (r.raise >= 2 && r.avail < 4)) shallow++;
      if (r.raise >= 2 && r.avail > 12) deep++;
      if (r.avail >= 4 ? r.top > Math.floor(r.top - r.raise + r.avail) - 2 : r.top > r.top - r.raise + r.avail - 1) near++;
      worstLo = Math.min(worstLo, r.ratio);
      worstHi = Math.max(worstHi, r.ratio);
    }
    for (const r of rs) if (r.ratio < WEED_LIGHT_LO - 0.02 || r.ratio > WEED_LIGHT_HI + 0.02) band++;
    check(
      `lake weed (${name}): weed and stones grow on its lakes' beds`,
      weed.length > 50 && cells.size > 30,
      `${rs.length} columns raised, ${weed.length} of them weed two eighths tall or more, in ${cells.size} cells`,
    );
    check(
      `lake weed (${name}): the same island draws the same land twice`,
      hashOf(on, "land") === hashOf(again, "land"),
      `${hashOf(on, "land")} ${hashOf(again, "land")}`,
    );
    check(
      `lake weed (${name}): every top at least two eighths under the surface (a stone one), none in the sea, lava or ice, none too shallow or too deep`,
      near === 0 && sea === 0 && ice === 0 && lava === 0 && shallow === 0 && deep === 0,
      `near the surface ${near}, sea ${sea}, ice ${ice}, lava ${lava}, too shallow ${shallow}, too deep ${deep}`,
    );
    check(
      `lake weed (${name}): the water (its foam, waves and sides) is drawn exactly as without weed`,
      hashOf(on, "water") === hashOf(off, "water"),
      `${hashOf(on, "water")} ${hashOf(off, "water")}`,
    );
    check(
      `lake weed (${name}): the light of weed and stones stays within ${WEED_LIGHT_LO} to ${WEED_LIGHT_HI} of the bed's under them`,
      band === 0,
      `${band} out of the band; ${worstLo.toFixed(3)} to ${worstHi.toFixed(3)} (vertex light included)`,
    );
    // The cap, by the ranks the chunk keeps (Terrain.readFine).
    let worst = 0;
    const t = on.terrain;
    for (let c = 0; c < t.cols * t.rows; c++) {
      const f = withLevel("high", true, () => t.readFine(c));
      let n = 0;
      for (let y = f.y0; y < f.y1; y++)
        for (let x = f.x0; x < f.x1; x++) {
          const k = fineAt(f, x, y);
          if (!(f.weed[k] & WEED_GROWS)) continue;
          const ranks: number[] = [];
          weedClumps(x, y, f.weedLand[k], ranks);
          for (const r of ranks) if (r < f.weedKeep[k]) n++;
        }
      worst = Math.max(worst, n);
    }
    check(`lake weed (${name}): at most ${WEED_CAP_CHUNK} clumps a chunk`, worst <= WEED_CAP_CHUNK, `the most in a chunk: ${worst}`);
  }

  // Weed off: the land is drawn as with no weed anywhere (water too young for it everywhere).
  {
    const make = () => generateWorld(152, 152, 7, readLand({ biome: "temperate", shape: "lakes" }));
    const off = withLevel("high", false, () => build(make()));
    const young = withLevel("high", true, () =>
      build(make(), { t: 0 }, (t) => {
        (t as unknown as { wetSince: Float64Array }).wetSince.fill(0);
      }),
    );
    const on = withLevel("high", true, () => build(make()));
    check(
      "lake weed: with GRAPHICS.weed off the land is the land without weed, and weed changes it",
      hashOf(off, "land") === hashOf(young, "land") && hashOf(on, "land") !== hashOf(off, "land"),
      `off ${hashOf(off, "land")}, all water young ${hashOf(young, "land")}, on ${hashOf(on, "land")}`,
    );
    // Low quality: no fine land, weed or not.
    const lowOn = withLevel("low", true, () => build(make()));
    const lowOff = withLevel("low", false, () => build(make()));
    check("lake weed: low quality draws the same land with weed on or off", hashOf(lowOn, "land") === hashOf(lowOff, "land"), hashOf(lowOn, "land"));
  }

  // Young water: a lake that filled since the island was drawn has no weed until it has stood
  // WEED_AGE_MS; then its chunks are built again with weed.
  {
    const world = generateWorld(152, 152, 7, readLand({ biome: "temperate", shape: "lakes" }));
    const lake: number[] = [];
    for (let i = 0; i < world.n; i++)
      if (world.fluid[i] === F.WATER && world.depth[i] > 0.5 && lakeShare(world.height[i] + world.depth[i], world.seaLevel) > 0) lake.push(i);
    const keep = lake.map((i) => world.depth[i]);
    const clock = { t: 0 };
    const offB = withLevel("high", false, () => build(generateWorld(152, 152, 7, readLand({ biome: "temperate", shape: "lakes" }))));
    // Drawn first with the lakes dry, then filled.
    for (const i of lake) world.depth[i] = 0;
    const b = withLevel("high", true, () => build(world, clock));
    lake.forEach((i, k) => (world.depth[i] = keep[k]));
    clock.t = 1000;
    withLevel("high", true, () => {
      b.terrain.scan();
      b.terrain.rebuild();
      b.terrain.updateFine(0, true);
    });
    const youngCount = raised(world, b, offB).length;
    clock.t = 1000 + WEED_AGE_MS + 1;
    withLevel("high", true, () => {
      b.terrain.scan();
      // The slow queue's chunks are built over frames.
      for (let k = 0; k < 400; k++) {
        clock.t += 50;
        b.terrain.rebuild();
        b.terrain.updateFine(0, true);
      }
    });
    const grown = raised(world, b, offB).length;
    check(
      "lake weed: no weed in water younger than ten minutes, weed once it is older",
      youngCount === 0 && grown > 200,
      `young ${youngCount} columns, later ${grown}`,
    );
  }

  // A lake that freezes loses its weed.
  {
    const make = () => generateWorld(152, 152, 7, readLand({ biome: "temperate", shape: "lakes" }));
    const world = make();
    const off = withLevel("high", false, () => build(make()));
    const b = withLevel("high", true, () => build(world));
    const before = raised(world, b, off);
    const frozen = new Set<number>();
    for (const r of before) frozen.add(r.i);
    // As the view does once it has placed the covers (lily pads among them).
    b.terrain.coversChanged = false;
    for (const i of frozen) world.fluid[i] = F.ICE;
    withLevel("high", true, () => {
      b.terrain.scan();
      b.terrain.rebuild();
      b.terrain.updateFine(0, true);
    });
    const after = raised(world, b, off).filter((r) => frozen.has(r.i));
    check(
      "lake weed: water that freezes loses its weed at once",
      before.length > 200 && after.length === 0,
      `${before.length} columns before, ${after.length} on the ice after`,
    );
    check("lily pads are placed again when the water under them freezes", b.terrain.coversChanged, `coversChanged ${b.terrain.coversChanged}`);
  }

  // A chunk at the cap, its lake frozen in part and drawn again in part (the box round the
  // change), is drawn as the same island built whole: which clumps a chunk keeps never depends on
  // what part of it was built (the review of 20 November: a rank over the cells eligible now kept
  // other clumps in the tiles left as they were).
  {
    const make = () => generateWorld(152, 152, 9, readLand({ biome: "swamp", shape: "lakes" }));
    const world = make();
    const b = withLevel("high", true, () => build(world));
    const t = b.terrain;
    let best = -1;
    let most = 0;
    let cells: number[] = [];
    for (let c = 0; c < t.cols * t.rows; c++) {
      const f = withLevel("high", true, () => t.readFine(c));
      let n = 0;
      const grows: number[] = [];
      for (let y = f.y0; y < f.y1; y++)
        for (let x = f.x0; x < f.x1; x++) {
          const k = fineAt(f, x, y);
          if (!(f.weed[k] & WEED_GROWS)) continue;
          n += weedClumps(x, y, f.weedLand[k]);
          grows.push(y * world.w + x);
        }
      if (n > most) {
        most = n;
        best = c;
        cells = grows;
      }
    }
    for (const i of cells.slice(0, 12)) world.fluid[i] = F.ICE;
    withLevel("high", true, () => {
      t.scan();
      t.rebuild();
      t.updateFine(0, true);
    });
    const whole = withLevel("high", true, () => build(world));
    check(
      "lake weed: a chunk at the cap drawn again in part after its lake freezes in part is the island drawn whole",
      most > WEED_CAP_CHUNK && hashOf(b, "land") === hashOf(whole, "land"),
      `chunk ${best}, ${most} clumps in its weed's cells; drawn in part ${hashOf(b, "land")}, whole ${hashOf(whole, "land")}`,
    );
  }

  // Cost: on medium islands of seeds 7 to 18, the weed's triangles against the land shown.
  {
    let worstShare = 0;
    let worstSeed = 0;
    let total = 0;
    let weedT = 0;
    for (let seed = 7; seed <= 18; seed++) {
      const make = () => generateWorld(152, 152, seed, readLand({ biome: "temperate", shape: "lakes" }));
      const on = withLevel("medium", true, () => build(make()));
      const off = withLevel("medium", false, () => build(make()));
      const a = landTriangles(on);
      const extra = a - landTriangles(off);
      total += a;
      weedT += extra;
      if (extra / a > worstShare) {
        worstShare = extra / a;
        worstSeed = seed;
      }
    }
    check(
      "lake weed: on medium, weed adds at most 6% to the land's triangles (lake islands of seeds 7 to 18)",
      worstShare <= 0.06,
      `worst ${(worstShare * 100).toFixed(2)}% (seed ${worstSeed}), all ${((weedT / total) * 100).toFixed(2)}%, ${weedT} of ${total}; ${CHUNK}-cell chunks`,
    );
  }
}
