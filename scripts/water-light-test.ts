// Water and light (16 November, the owner: "even water would need a light shader"; water "seen from
// the side is huge flat walls with grid lines", "the sea floor and depth steps ... big pale squares",
// "the pond has a white foam outline like thick tape", "snowy peaks still read as big white-topped
// cubes", Big Bang's ground "a busy camouflage patchwork"). Each check holds one fix, measured on
// generated islands as the fine land draws them on high, and fails on main before it.
import { MeshBasicMaterial, ShaderLib, type BufferGeometry, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { DEFAULT_LAND } from "../src/sim/land-options";
import { BOTTOM, columnTop, type Terrain } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS } from "../src/sim/voxel/graphics";
import { Looks } from "../src/sim/voxel/looks";
import { WaterLight } from "../src/sim/voxel/water-light";
import { C, F, G } from "../src/sim/materials";
import { landOf, withFine } from "./movement-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

// The meshes of the fluid's material (the water) that are shown.
function waterMeshes(terrain: Terrain, meshes: Mesh[]): Mesh[] {
  const fluid = (terrain as unknown as { fluidMaterial: unknown }).fluidMaterial;
  return meshes.filter((m) => m.visible && m.material === fluid);
}

// Each column's top as a chunk's fine mesh drew it (FineTops), in voxels; NaN where none.
function columnTopAt(terrain: Terrain, x: number, y: number): number {
  const t = terrain as unknown as { fineTops: ({ h: Int16Array; x0: number; y0: number; stride: number } | undefined)[]; fineLevel: Uint8Array; cols: number };
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const c = Math.floor(cy / 32) * t.cols + Math.floor(cx / 32);
  const tops = t.fineTops[c];
  if (!tops) return NaN;
  const sub = t.fineLevel[c];
  const sx = (cx - tops.x0) * sub + Math.min(sub - 1, Math.floor((x - cx) * sub));
  const sy = (cy - tops.y0) * sub + Math.min(sub - 1, Math.floor((y - cy) * sub));
  return tops.h[sy * tops.stride + sx] / sub;
}

// The colour of the highest top face over each cell's middle, from the land's fine meshes.
function topColors(world: World, meshes: Mesh[], land: unknown): Map<number, [number, number, number]> {
  const best = new Map<number, { y: number; c: [number, number, number] }>();
  for (const m of meshes) {
    if (!m.visible || m.material !== land) continue;
    const g = m.geometry as BufferGeometry;
    if (!g.index) continue;
    const p = g.getAttribute("position").array as Float32Array;
    const col = g.getAttribute("color").array as Uint8Array;
    const quads = p.length / 12;
    for (let q = 0; q < quads; q++) {
      const y = p[q * 12 + 1];
      if (p[q * 12 + 4] !== y || p[q * 12 + 7] !== y || p[q * 12 + 10] !== y) continue;
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
      for (let cz = Math.ceil(z0 + world.h / 2 - 0.5); cz + 0.5 <= z1 + world.h / 2; cz++)
        for (let cx = Math.ceil(x0 + world.w / 2 - 0.5); cx + 0.5 <= x1 + world.w / 2; cx++) {
          if (cx < 0 || cz < 0 || cx >= world.w || cz >= world.h) continue;
          const i = cz * world.w + cx;
          const was = best.get(i);
          if (was && was.y >= y) continue;
          best.set(i, { y, c: [col[q * 12], col[q * 12 + 1], col[q * 12 + 2]] });
        }
    }
  }
  return new Map([...best].map(([i, v]) => [i, v.c]));
}

// How far two colours are in hue, whatever their light: the difference of their channels' shares.
function chroma(a: [number, number, number], b: [number, number, number]): number {
  const sa = Math.max(1, a[0] + a[1] + a[2]);
  const sb = Math.max(1, b[0] + b[1] + b[2]);
  return Math.abs(a[0] / sa - b[0] / sb) + Math.abs(a[1] / sa - b[1] / sb) + Math.abs(a[2] / sa - b[2] / sb);
}

export function waterLightChecks(check: Check): void {
  // 1. The water in eighths, on the usual first island.
  withFine(() => {
    const world = generateWorld(152, 152, 7, DEFAULT_LAND);
    const { terrain, meshes } = landOf(world);
    const water = waterMeshes(terrain, meshes);
    const fine = water.filter((m) => m.geometry.getAttribute("waterFine"));
    const whole = water.filter((m) => !m.geometry.getAttribute("waterFine"));
    let lowest = Infinity;
    let tallest = 0;
    let offGrid = 0;
    const foam = new Set<number>();
    for (const m of water) {
      const p = m.geometry.getAttribute("position").array as Float32Array;
      const wf = m.geometry.getAttribute("waterFine")?.array as Float32Array | undefined;
      for (let v = 0; v < p.length / 3; v++) {
        lowest = Math.min(lowest, p[v * 3 + 1]);
        if (wf && wf[v * 2] > 0.8) {
          // A top's corners on the eighth grid (a fan's middle on the sixteenth).
          for (const a of [p[v * 3], p[v * 3 + 2]]) if (Math.abs(a * 16 - Math.round(a * 16)) > 0.01) offGrid++;
          if (wf[v * 2 + 1] > 0) foam.add(Math.round(wf[v * 2 + 1] * 100));
        }
      }
      // The tallest side.
      if (wf)
        for (let q = 0; q < p.length / 18; q++) {
          if (wf[q * 12] > 0.8) continue;
          let lo = Infinity;
          let hi = -Infinity;
          for (let k = 0; k < 6; k++) {
            lo = Math.min(lo, p[(q * 6 + k) * 3 + 1]);
            hi = Math.max(hi, p[(q * 6 + k) * 3 + 1]);
          }
          tallest = Math.max(tallest, hi - lo);
        }
    }
    // No wall inside the water: a side between two columns whose tops meet (a slope, level water)
    // showed as small pale blocks across the sea (fine water, first build).
    const tops = new Map<number, number>();
    const col = (x: number, z: number) => (Math.round(x * 8) + 4096) * 8192 + Math.round(z * 8) + 4096;
    for (const m of fine) {
      const p = m.geometry.getAttribute("position").array as Float32Array;
      const wf = m.geometry.getAttribute("waterFine").array as Float32Array;
      for (let q = 0; q < p.length / 18; q++) {
        if (wf[q * 12] < 0.8) continue;
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        let y = 0;
        for (let k = 0; k < 6; k++) {
          const v = (q * 6 + k) * 3;
          x0 = Math.min(x0, p[v]);
          x1 = Math.max(x1, p[v]);
          z0 = Math.min(z0, p[v + 2]);
          z1 = Math.max(z1, p[v + 2]);
          y += p[v + 1] / 6;
        }
        for (let x = Math.round(x0 * 8); x < Math.round(x1 * 8); x++)
          for (let z = Math.round(z0 * 8); z < Math.round(z1 * 8); z++) tops.set(col(x / 8, z / 8), y);
      }
    }
    let inner = 0;
    let sides = 0;
    for (const m of fine) {
      const p = m.geometry.getAttribute("position").array as Float32Array;
      const wf = m.geometry.getAttribute("waterFine").array as Float32Array;
      for (let q = 0; q < p.length / 18; q++) {
        if (wf[q * 12] > 0.8) continue;
        sides++;
        const v = q * 18;
        let hi = -Infinity;
        for (let k = 0; k < 6; k++) hi = Math.max(hi, p[v + k * 3 + 1]);
        const alongX = Math.abs(p[v] - p[v + 3]) > 1e-6 || Math.abs(p[v] - p[v + 6]) > 1e-6;
        const x = Math.min(p[v], p[v + 3], p[v + 6]);
        const z = Math.min(p[v + 2], p[v + 5], p[v + 8]);
        const a = alongX ? tops.get(col(x, z - 0.125)) : tops.get(col(x - 0.125, z));
        const b = alongX ? tops.get(col(x, z)) : tops.get(col(x, z));
        if (a !== undefined && b !== undefined && a >= hi - 0.02 && b >= hi - 0.02) inner++;
      }
    }
    check(
      "no wall inside the water: a side only where the surface breaks (a fall, the shore, the island's edge)",
      sides > 0 && inner === 0,
      `${inner} of ${sides} sides stand between two water tops that meet`,
    );
    // No T-junction: no corner of a water top lies partway along another top's edge (the review of
    // 17 November: hairline cracks and doubled lines where large tops met smaller ones).
    const onLine = new Map<string, number[]>();
    const sixteenth = (a: number) => Math.round(a * 16);
    for (const m of fine) {
      const p = m.geometry.getAttribute("position").array as Float32Array;
      const wf = m.geometry.getAttribute("waterFine").array as Float32Array;
      for (let v = 0; v < p.length / 3; v++) {
        if (wf[v * 2] < 0.8) continue;
        const x = sixteenth(p[v * 3]);
        const z = sixteenth(p[v * 3 + 2]);
        for (const key of [`z${z}`, `x${x}`]) {
          const list = onLine.get(key) ?? [];
          list.push(key[0] === "z" ? x : z);
          onLine.set(key, list);
        }
      }
    }
    const sorted = new Map<string, Int32Array>();
    for (const [k, v] of onLine) sorted.set(k, Int32Array.from(new Set(v)).sort());
    let tees = 0;
    let edges = 0;
    for (const m of fine) {
      const p = m.geometry.getAttribute("position").array as Float32Array;
      const wf = m.geometry.getAttribute("waterFine").array as Float32Array;
      for (let t = 0; t < p.length / 9; t++) {
        if (wf[t * 6] < 0.8) continue;
        for (let e = 0; e < 3; e++) {
          const a = t * 3 + e;
          const b = t * 3 + ((e + 1) % 3);
          const ax = sixteenth(p[a * 3]);
          const az = sixteenth(p[a * 3 + 2]);
          const bx = sixteenth(p[b * 3]);
          const bz = sixteenth(p[b * 3 + 2]);
          let line: Int32Array | undefined;
          let lo = 0;
          let hi = 0;
          if (az === bz && ax !== bx) [line, lo, hi] = [sorted.get(`z${az}`), Math.min(ax, bx), Math.max(ax, bx)];
          else if (ax === bx && az !== bz) [line, lo, hi] = [sorted.get(`x${ax}`), Math.min(az, bz), Math.max(az, bz)];
          else continue;
          edges++;
          if (line && line.some((q) => q > lo && q < hi)) tees++;
        }
      }
    }
    check(
      "no crack in the water: no corner of a top lies partway along another top's edge",
      edges > 1000 && tees === 0,
      `${tees} of ${edges} edges of water tops with a corner partway along them`,
    );
    let deepest = 0;
    for (let i = 0; i < world.n; i++) if (world.fluid[i] === F.WATER) deepest = Math.max(deepest, world.depth[i] * 0.5);
    check(
      "the water is drawn in eighths where the land is: its tops on the eighth grid, none in whole cells",
      fine.length > 0 && whole.length === 0 && offGrid === 0,
      `${fine.length} meshes in eighths, ${whole.length} in whole cells shown, ${offGrid} corners off the grid`,
    );
    check(
      "no flat wall of water: a side is never taller than the deepest water, never down to the island's foot",
      tallest <= deepest + 0.5 && lowest > BOTTOM + 1,
      `tallest side ${tallest.toFixed(2)} (deepest water ${deepest.toFixed(2)}), lowest point ${lowest.toFixed(2)} (foot ${BOTTOM})`,
    );
    // The bed under the water curves as the land does: columns of a water cell away from its height.
    let bed = 0;
    let curved = 0;
    for (let y = 2; y < world.h - 2; y++)
      for (let x = 2; x < world.w - 2; x++) {
        const i = y * world.w + x;
        if (world.fluid[i] !== F.WATER || world.depth[i] < 0.06) continue;
        for (const [fx, fy] of [
          [0.06, 0.06],
          [0.94, 0.5],
          [0.5, 0.94],
        ]) {
          const h = columnTopAt(terrain, x + fx, y + fy);
          if (Number.isNaN(h)) continue;
          bed++;
          if (h !== columnTop(world, i)) curved++;
        }
      }
    // A wet cell's ground stays under its water: risen toward the shore, barely wet cells stood out
    // of the sea as sand islets (the lead's review, 17 November).
    const levels = (terrain as unknown as { fluidLevel: Float32Array }).fluidLevel;
    let above = 0;
    let wetCols = 0;
    for (let y = 2; y < world.h - 2; y++)
      for (let x = 2; x < world.w - 2; x++) {
        const i = y * world.w + x;
        if (world.fluid[i] !== F.WATER || !(levels[i] > -1e8)) continue;
        for (let k = 0; k < 64; k += 9) {
          const h = columnTopAt(terrain, x + ((k % 8) + 0.5) / 8, y + (Math.floor(k / 8) + 0.5) / 8);
          if (Number.isNaN(h)) continue;
          wetCols++;
          if (h >= levels[i]) above++;
        }
      }
    check(
      "no islet: the ground of a cell under water is drawn under the water's surface",
      wetCols > 1000 && above === 0,
      `${above} of ${wetCols} columns of wet cells at or above their water`,
    );
    check(
      "the sea floor curves in eighths (no flat squares a cell wide)",
      bed > 0 && curved / bed > 0.3,
      `${((curved / Math.max(1, bed)) * 100).toFixed(0)}% of ${bed} bed columns off their cell's height`,
    );
    // The foam: soft levels in the water, no white tape on the land.
    let tape = 0;
    for (const m of meshes) {
      if (!m.visible || m.material === (terrain as unknown as { fluidMaterial: unknown }).fluidMaterial || !m.geometry.index) continue;
      const col = m.geometry.getAttribute("color").array as Uint8Array;
      for (let k = 0; k < col.length; k += 3) if (col[k] === 0xf4 && col[k + 1] === 0xf9 && col[k + 2] === 0xfc) tape++;
    }
    check(
      "the foam is a soft band in the water, in steps, not a white line on the land",
      tape === 0 && foam.size >= 2,
      `${tape} white foam vertices on the land, foam levels ${[...foam].sort((a, b) => a - b).join(", ")}`,
    );
  });

  // 2. The water's light: in the water's shader, on the water in eighths only; on high only.
  check(
    "the water's light is on at high only, off at medium and low",
    PRESETS.high.waterlight && !PRESETS.medium.waterlight && !PRESETS.low.waterlight,
    `low ${PRESETS.low.waterlight}, medium ${PRESETS.medium.waterlight}, high ${PRESETS.high.waterlight}`,
  );
  {
    const world = generateWorld(64, 64, 3, DEFAULT_LAND);
    const terrainMap = { image: { data: new Uint8Array(world.n * 4) } } as never;
    const light = new WaterLight(terrainMap, world.w, world.h);
    const m = light.apply(new MeshBasicMaterial({ vertexColors: true, transparent: true }));
    const shader = { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader };
    m.onBeforeCompile(shader as never, null as never);
    const f = shader.fragmentShader;
    check(
      "the water's light: Fresnel, the sun's and the moon's glints, lights reflected at night, all on the water in eighths only",
      f.includes("vWaterFine.x > 0.5") &&
        f.includes("pow(1.0 - wlNV, 3.0)") &&
        f.includes("normalize(wlSunDir + wlV)") &&
        f.includes("normalize(wlMoonDir + wlV)") &&
        f.includes("wlLights[i]") &&
        shader.vertexShader.includes("attribute vec2 waterFine") &&
        "wlSunDir" in shader.uniforms,
      `${f.length} characters of fragment shader`,
    );
  }

  // 3. Warm sun and cool shade, in the eye view too, warmer as the sun sets; the night's glow.
  {
    const was = { warmlight: GRAPHICS.warmlight, shadows: GRAPHICS.shadows };
    const renderer = { shadowMap: { type: 0, autoUpdate: true, enabled: false }, toneMapping: 0 };
    const scene = { add: () => {}, traverse: () => {} };
    const looks = new Looks(renderer as never, scene as never, new Set());
    const u = (looks as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    const frame = (o: { sunHeight: number; night: number; eye: boolean }) =>
      looks.frame({ ...o, dark: 0, overcast: 0, sunAz: 1, eye: o.eye, cover: 1, phi: 0.95, cx: 0, cz: 0, radius: 20, side: 152, top: 10, dist: 30 });
    GRAPHICS.shadows = true;
    GRAPHICS.warmlight = true;
    frame({ sunHeight: 0.9, night: 0, eye: true });
    const noon = u.sunWarm.value as number;
    const noonBlue = (u.warmLit.value as { z: number }).z;
    frame({ sunHeight: 0.1, night: 0, eye: true });
    const duskBlue = (u.warmLit.value as { z: number }).z;
    frame({ sunHeight: -0.2, night: 1, eye: false });
    const glow = u.nightGlow.value as number;
    GRAPHICS.warmlight = false;
    frame({ sunHeight: 0.9, night: 0, eye: true });
    const off = u.sunWarm.value as number;
    Object.assign(GRAPHICS, was);
    check(
      "warm sun and cool shade by day in the eye view, warmer as the sun goes down, and the land's glow at night; none with the switch off",
      noon > 0.3 && duskBlue < noonBlue && glow > 0.5 && off === 0,
      `warmth ${noon.toFixed(2)} at noon (${off} off), sunlit blue ${noonBlue.toFixed(2)} at noon, ${duskBlue.toFixed(2)} at dusk, night glow ${glow.toFixed(2)}`,
    );
  }

  // 4. The night's glow round lava and houses, baked in the fine land.
  withFine(() => {
    const was = GRAPHICS.warmlight;
    const glowOf = (on: boolean) => {
      GRAPHICS.warmlight = on;
      const world = generateWorld(152, 152, 7, { ...DEFAULT_LAND, biome: "volcanic", peaks: true });
      const { meshes } = landOf(world);
      let lit = 0;
      let far = 0;
      const lava: [number, number][] = [];
      const houses: [number, number][] = [];
      for (let i = 0; i < world.n; i++) {
        if (world.fluid[i] === F.LAVA) lava.push([(i % world.w) + 0.5, Math.floor(i / world.w) + 0.5]);
        if (world.cover[i] === C.HOUSE) houses.push([(i % world.w) + 0.5, Math.floor(i / world.w) + 0.5]);
      }
      for (const m of meshes) {
        const g = m.geometry.getAttribute("landGlow");
        if (!m.visible || !g) continue;
        const p = m.geometry.getAttribute("position").array as Float32Array;
        const a = g.array as Uint8Array;
        for (let v = 0; v < a.length; v++) {
          if (!a[v]) continue;
          lit++;
          const x = p[v * 3] + world.w / 2;
          const z = p[v * 3 + 2] + world.h / 2;
          const near = (list: [number, number][], r: number) => list.some(([lx, lz]) => Math.abs(lx - x) <= r && Math.abs(lz - z) <= r);
          if (!near(lava, 4.1) && !near(houses, 3.6)) far++;
        }
      }
      return { lit, far, lava: lava.length };
    };
    const on = glowOf(true);
    const off = glowOf(false);
    GRAPHICS.warmlight = was;
    check(
      "at night the land round lava and lit houses glows, baked within a few cells, and nowhere else",
      on.lava > 0 && on.lit > 0 && on.far === 0 && off.lit === 0,
      `${on.lit} glowing vertices round ${on.lava} lava cells (${on.far} farther than four cells), ${off.lit} with the switch off`,
    );
  });

  // 5. Snowy peaks: steps of two or three voxels between cells of snow or rock curve.
  withFine(() => {
    const world = generateWorld(152, 152, 7, { ...DEFAULT_LAND, biome: "tundra", shape: "ridges", peaks: true });
    const { terrain, meshes } = landOf(world);
    let borders = 0;
    let soft = 0;
    let worst = 0;
    const steep = (i: number) => world.ground[i] === G.SNOW || world.ground[i] === G.ROCK;
    for (let y = 2; y < world.h - 2; y++)
      for (let x = 2; x < world.w - 3; x++) {
        const a = y * world.w + x;
        const b = a + 1;
        const dt = Math.abs(columnTop(world, a) - columnTop(world, b));
        if (dt < 2 || dt > 8 || !steep(a) || !steep(b) || world.fluid[a] || world.fluid[b] || world.cover[a] || world.cover[b]) continue;
        // The largest step between two columns along the line from one cell's middle to the other's.
        let step = 0;
        let prev = columnTopAt(terrain, x + 0.5 + 1 / 16, y + 0.5);
        for (let k = 1; k < 8; k++) {
          const h = columnTopAt(terrain, x + 0.5 + (k + 0.5) / 8, y + 0.5);
          step = Math.max(step, Math.abs(h - prev));
          prev = h;
        }
        borders++;
        if (step <= 1) soft++;
        worst = Math.max(worst, step);
      }
    check(
      "a step of two to eight voxels between snow or rock cells curves: no column rises more than a voxel over the next",
      borders > 20 && soft / borders > 0.9,
      `${soft} of ${borders} such borders curve (largest step ${worst.toFixed(2)} voxels)`,
    );
    // The small steps of those slopes are lit as the slope is (landWet one half), not as walls turned
    // from the sun: lone blue faces across the snow (the lead's review, 17 November).
    let slopeLit = 0;
    for (const m of meshes) {
      const a = m.geometry.getAttribute("landWet");
      if (!m.visible || !a) continue;
      for (let v = 0; v < a.count; v++) if (Math.abs(a.getX(v) - 0.5) < 0.05) slopeLit++;
    }
    check("the small steps of snow and rock are lit as their slope, not as lone walls", slopeLit > 1000, `${slopeLit} vertices lit as their slope`);
  });

  // 6. Big Bang's ground: stardust, the crystal it becomes and the land it left, in soft patches.
  withFine(() => {
    const world = generateWorld(96, 96, 5, DEFAULT_LAND);
    const dust = world.materials.define(
      world.materials.makeMaterial("stardust", "ground", [0x241a40, 0x2e2152, 0x3a2a63, 0x4a3578], { glow: true, fallback: "crystal" }),
    );
    // Seeded, as the spell does it: most cells stardust, some crystal, some left as they were.
    let s = 99;
    const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const region: number[] = [];
    for (let i = 0; i < world.n; i++) {
      if (world.fluid[i] !== F.NONE) continue;
      const r = rand();
      if (r < 0.75) world.ground[i] = dust;
      else if (r < 0.87) world.ground[i] = G.CRYSTAL;
      const x = i % world.w;
      const y = Math.floor(i / world.w);
      if (x > 8 && y > 8 && x < world.w - 8 && y < world.h - 8) region.push(i);
    }
    const { meshes } = landOf(world);
    const land = meshes.find((m) => m.geometry.index)?.material;
    const tops = topColors(world, meshes, land);
    let pairs = 0;
    let sharp = 0;
    let sum: [number, number, number] = [0, 0, 0];
    let n = 0;
    for (const i of region) {
      const a = tops.get(i);
      const b = tops.get(i + 1);
      if (!a) continue;
      sum = [sum[0] + a[0], sum[1] + a[1], sum[2] + a[2]];
      n++;
      if (!b || world.fluid[i + 1] !== F.NONE || world.cover[i] || world.cover[i + 1]) continue;
      pairs++;
      if (chroma(a, b) > 0.12) sharp++;
    }
    const mean = [sum[0] / n, sum[1] / n, sum[2] / n];
    check(
      "a spell's ground is drawn in soft patches, not cell sized blots, and still in the spell's purple",
      pairs > 500 && sharp / pairs < 0.06 && mean[2] > mean[0] && mean[0] > mean[1],
      `${((sharp / Math.max(1, pairs)) * 100).toFixed(1)}% of ${pairs} neighbouring cells sharply apart in colour; mean colour ${mean.map((v) => Math.round(v)).join(",")}`,
    );
  });
}
