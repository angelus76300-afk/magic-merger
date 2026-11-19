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
import { lakeShare } from "../src/sim/voxel/terrain-fine";
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
  lakeChecks(check);
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
    // of the sea as sand islets (the lead's review, 17 November). Since the waterline in eighths (18
    // November) a water cell's columns on the land's side of the line are the shore's sand: each is
    // joined to a dry cell's land through such columns, never alone in the water.
    const levels = (terrain as unknown as { fluidLevel: Float32Array }).fluidLevel;
    let above = 0;
    let alone = 0;
    let wetCols = 0;
    for (let y = 2; y < world.h - 2; y++)
      for (let x = 2; x < world.w - 2; x++) {
        const i = y * world.w + x;
        if (world.fluid[i] !== F.WATER || !(levels[i] > -1e8)) continue;
        let up = false;
        for (let k = 0; k < 64; k++) {
          const h = columnTopAt(terrain, x + ((k % 8) + 0.5) / 8, y + (Math.floor(k / 8) + 0.5) / 8);
          if (Number.isNaN(h)) continue;
          wetCols++;
          if (h >= levels[i]) {
            above++;
            up = true;
          }
        }
        if (up) alone += isletColumns(world, terrain, levels, x, y);
      }
    check(
      "no islet: the ground of a cell under water is drawn under the water's surface, but for the shore's sand joined to the land",
      wetCols > 10000 && alone === 0,
      `${alone} of ${wetCols} columns of wet cells above their water and not joined to land (${above} above it, the shore's)`,
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
    riverChecks(check, world, terrain, fine);
    coastChecks(check, world, terrain, fine, "the temperate island of seed 7");
  });
  withFine(() => {
    const world = generateWorld(152, 152, 7, { ...DEFAULT_LAND, biome: "desert" });
    const { terrain, meshes } = landOf(world);
    const fine = waterMeshes(terrain, meshes).filter((m) => m.geometry.getAttribute("waterFine"));
    coastChecks(check, world, terrain, fine, "the desert island of seed 7");
    // Sand's small steps (18 November, the owner: dark wavy contour lines across flat sand): their
    // risers lit as the slope is (landWet one half), not as a wall's dark side turned from the sun.
    let risers = 0;
    let walls = 0;
    for (const m of meshes) {
      const g = m.geometry as BufferGeometry;
      const wet = g.getAttribute("landWet");
      if (!m.visible || !wet || !g.index) continue;
      const p = g.getAttribute("position").array as Float32Array;
      const col = g.getAttribute("color").array as Uint8Array;
      for (let q = 0; q < p.length / 12; q++) {
        const xs = [0, 1, 2, 3].map((k) => p[q * 12 + k * 3]);
        const ys = [0, 1, 2, 3].map((k) => p[q * 12 + k * 3 + 1]);
        const zs = [0, 1, 2, 3].map((k) => p[q * 12 + k * 3 + 2]);
        const flat = (a: number[]) => a.every((v) => Math.abs(v - a[0]) < 1e-6);
        const tall = Math.max(...ys) - Math.min(...ys);
        if (!(flat(xs) || flat(zs)) || tall <= 0 || tall > 0.26) continue;
        const [r, gg, b] = [col[q * 12], col[q * 12 + 1], col[q * 12 + 2]];
        // Sand's colour (warm, not grey pebbles, green grass or brown soil).
        if (!(r > gg && gg > b && r - b > 50 && gg - b > 30 && r > 150)) continue;
        risers++;
        if (wet.getX(q * 4) < 0.25) walls++;
      }
    }
    check(
      "sand's small steps are lit as its slope, not as walls: no dark riser lines across sand",
      risers > 1000 && walls / risers < 0.05,
      `${walls} of ${risers} small risers of sand lit as walls`,
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
    // Glints are rare sparkles, not blotches (18 November, the owner on the Fold: "big bright white
    // blotches" on lakes on high). The sun's glint as the shader computes it, with its numbers read
    // from the shader, over a lake of 40 by 40 cells in eighths, the sun reflected straight at the
    // camera (the worst case), at 20 moments: the share of eighths it makes brighter than half white.
    // It was 64% (nearly every eighth lit, in cell-wide blobs); scripts/water-glints-frames.mjs
    // measures the bright share of the water on a real frame.
    const num = (re: RegExp) => Number(re.exec(f)?.[1] ?? NaN);
    const tilt = [...f.matchAll(/(0\.\d+) \* sin\(p\./g)].map((m) => Number(m[1]));
    const power = num(/normalize\(wlSunDir \+ wlV\)\), 0\.0\), ([\d.]+)\)/);
    const gain = num(/wlSpec \* wlSunCol \* ([\d.]+)/);
    const sparkle = /wlSpec = [^;]*\* wlSparkle;/.test(f) ? num(/wlSparkle = step\(([\d.]+), wlHash/) : 0;
    const hash = (x: number, y: number) => {
      const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    let lit = 0;
    let all = 0;
    for (let t = 0; t < 20; t++) {
      const time = t * 0.37;
      for (let cy = 0; cy < 320; cy++)
        for (let cx = 0; cx < 320; cx++) {
          const h = hash(cx, cy);
          const [px, py] = [cx * 0.125, cy * 0.125];
          const nx = tilt[0] * Math.sin(px * 2.3 + py * 1.1 + time * 1.2) + tilt[1] * Math.sin(py * 3.7 - px * 1.3 - time * 0.9 + h * 2.0);
          const nz = tilt[2] * Math.sin(py * 2.1 - px * 0.9 + time * 1.0) + tilt[3] * Math.sin(px * 3.3 + py * 1.7 + time * 1.1 + h * 2.0);
          const ny = 1 / Math.hypot(nx, 1, nz);
          const on = sparkle > 0 ? (hash(cx + Math.floor(time * 2) * 7.31, cy + Math.floor(time * 2) * 7.31) >= sparkle ? 1 : 0) : 1;
          all++;
          if (Math.pow(ny, power) * gain * on > 0.5) lit++;
        }
    }
    check(
      "the sun's glints on water are rare sparkles: under 3% of the eighths lit brighter than half white with the sun straight in the water, the opacity raised by 0.3 at most",
      tilt.length === 4 && Number.isFinite(power) && Number.isFinite(gain) && lit / all < 0.03 && f.includes("min(wlAlpha + 0.3,"),
      `${((100 * lit) / all).toFixed(1)}% of eighths lit (ripple tilt ${tilt.join(", ")}, power ${power}, gain ${gain}, sparkle above ${sparkle})`,
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

// Lakes with a floor (19 November, the owner: "not having a bottom for some lakes looks weird"). On
// the temperate island of lakes of seed 7, as the water's shader (water-light.ts) reads its map:
// opacity 0.4 + 0.56 * sqrt(depth / 4.5), colour from the map's shallow colour toward the deep one
// by sqrt(depth / 5). Before, a lake 13 deep was as opaque as the open sea (0.96), so its floor
// vanished, and the bed under a lake kept the colour of a shallow shelf however deep it lay.
function lakeChecks(check: Check): void {
  withFine(() => {
    const world = generateWorld(152, 152, 7, { ...DEFAULT_LAND, shape: "lakes" });
    const { terrain, meshes } = landOf(world);
    const t = terrain as unknown as { waterData: Uint8Array; wet: Uint8Array; waterAt(i: number): [number, number] };
    const data = t.waterData;
    const look = (i: number) => (data[i * 4 + 3] / 255) * 8;
    const opacity = (d: number) => 0.4 + 0.56 * Math.sqrt(Math.min(1, d / 4.5));
    const channels = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    // The colour the shader draws a cell's water in, from its map, and as it would from its depth.
    const drawn = (i: number) => {
      const deep = channels(t.waterAt(i)[1]);
      const k = Math.sqrt(Math.min(1, look(i) / 5));
      return [0, 1, 2].map((c) => data[i * 4 + c] + (deep[c] - data[i * 4 + c]) * k);
    };
    const byDepth = (i: number) => {
      const deep = channels(t.waterAt(i)[1]);
      const shallow = channels(t.waterAt(i)[0]).map((v, c) => v * 0.55 + [0x86, 0xea, 0xdc][c] * 0.45);
      const k = Math.sqrt(Math.min(1, Math.min(8, world.depth[i]) / 5));
      return [0, 1, 2].map((c) => shallow[c] + (deep[c] - shallow[c]) * k);
    };
    let lakes = 0;
    let clearest = 1;
    let murkiest = 0;
    let colourOff = 0;
    let sea = 0;
    let seaOff = 0;
    const land = meshes.find((m) => m.geometry.index)?.material;
    const tops = topColors(world, meshes, land);
    const light = (c: [number, number, number]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const shelf: number[] = [];
    const deep: number[] = [];
    for (let i = 0; i < world.n; i++) {
      if (t.wet[i] !== 1 || world.fluid[i] !== F.WATER) continue;
      const surface = world.height[i] + world.depth[i];
      const d = world.depth[i];
      if (surface < world.seaLevel + 0.05 && d > 1) {
        // The sea, away from narrow water: its look is its depth, as before.
        sea++;
        if (data[i * 4 + 3] !== Math.max(1, Math.min(255, Math.round((d / 8) * 255)))) seaOff++;
      }
      if (surface < world.seaLevel + 1.5) continue;
      if (d > 12.5) {
        lakes++;
        clearest = Math.min(clearest, opacity(look(i)));
        murkiest = Math.max(murkiest, opacity(look(i)));
        const a = drawn(i);
        const b = byDepth(i);
        colourOff = Math.max(colourOff, ...[0, 1, 2].map((c) => Math.abs(a[c] - b[c])));
      }
      const c = tops.get(i);
      if (!c) continue;
      const bed = surface - columnTop(world, i) / 0.5;
      if (bed > 1 && bed < 3) shelf.push(light(c));
      else if (bed > 13) deep.push(light(c));
    }
    check(
      "a lake deeper than 12.5 is still a little clear, unlike the open sea, in its deep blue; the sea as before",
      lakes > 50 && murkiest < 0.9 && clearest > 0.75 && colourOff < 6 && sea > 500 && seaOff === 0,
      `${lakes} lake cells deeper than 12.5, opaque ${clearest.toFixed(2)} to ${murkiest.toFixed(2)} (the sea 0.96), colour ${colourOff.toFixed(1)} off its depth's at most; ${seaOff} of ${sea} sea cells off their depth`,
    );
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    check(
      "a lake's floor darkens with depth: 13 deep is clearly darker than a shelf 1 to 3 deep",
      shelf.length > 20 && deep.length > 20 && mean(deep) < mean(shelf) * 0.6,
      `the floor's light ${mean(deep).toFixed(0)} over ${deep.length} cells deeper than 13, ${mean(shelf).toFixed(0)} over ${shelf.length} cells 1 to 3 deep`,
    );
  });
}

// Narrow rivers read as water (18 November, the owner on the Fold: rivers one or two cells wide
// were "pale translucent blocky bands with hard light borders"). Measured on the fine water's mesh
// of the first island: the cells of water at most two cells across (along x or y) and those at
// least eight across both ways. Before the fix the foam, reaching three eighths from each bank,
// covered most of a narrow river's top; the small falls of a river had pale sides (0x8fd8e6 mixed
// a quarter toward the deep colour).
function riverChecks(check: Check, world: World, terrain: Terrain, fine: Mesh[]): void {
  const levels = (terrain as unknown as { fluidLevel: Float32Array }).fluidLevel;
  const wet = (x: number, y: number) => x < 0 || y < 0 || x >= world.w || y >= world.h || levels[y * world.w + x] > -1e8;
  const run = (x: number, y: number, dx: number, dy: number, most: number) => {
    let n = 1;
    for (const s of [-1, 1]) for (let k = 1; k <= most && wet(x + s * k * dx, y + s * k * dy); k++) n++;
    return n;
  };
  const kind = new Int8Array(world.n);
  for (let y = 0; y < world.h; y++)
    for (let x = 0; x < world.w; x++) {
      if (!(levels[y * world.w + x] > -1e8)) continue;
      const across = Math.min(run(x, y, 1, 0, 8), run(x, y, 0, 1, 8));
      kind[y * world.w + x] = across <= 2 ? 1 : across >= 8 ? 2 : 0;
    }
  // The share of top area (in eighths) with foam, over narrow and over wide water; the sides less
  // than a cell tall over narrow water and how many are pale.
  const area = [0, 0, 0];
  const foamy = [0, 0, 0];
  let steps = 0;
  let pale = 0;
  for (const m of fine) {
    const p = m.geometry.getAttribute("position").array as Float32Array;
    const wf = m.geometry.getAttribute("waterFine").array as Float32Array;
    const col = m.geometry.getAttribute("color").array as Float32Array;
    const cs = m.geometry.getAttribute("color").itemSize;
    for (let t = 0; t < p.length / 9; t++) {
      const v = t * 3;
      const cx = Math.floor((p[v * 3] + p[v * 3 + 3] + p[v * 3 + 6]) / 3 + world.w / 2);
      const cz = Math.floor((p[v * 3 + 2] + p[v * 3 + 5] + p[v * 3 + 8]) / 3 + world.h / 2);
      if (cx < 0 || cz < 0 || cx >= world.w || cz >= world.h) continue;
      const k = kind[cz * world.w + cx];
      if (wf[v * 2] > 0.8) {
        // The triangle's area, in eighths squared.
        const ax = p[v * 3 + 3] - p[v * 3];
        const az = p[v * 3 + 5] - p[v * 3 + 2];
        const bx = p[v * 3 + 6] - p[v * 3];
        const bz = p[v * 3 + 8] - p[v * 3 + 2];
        const a = (Math.abs(ax * bz - az * bx) / 2) * 64;
        area[k] += a;
        if (wf[v * 2 + 1] > 0) foamy[k] += a;
      } else if (k === 1) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let q = 0; q < 3; q++) {
          lo = Math.min(lo, p[(v + q) * 3 + 1]);
          hi = Math.max(hi, p[(v + q) * 3 + 1]);
        }
        if (hi - lo >= 1 || hi - lo < 0.01) continue;
        steps++;
        const r = col[v * cs] * 255;
        const g = col[v * cs + 1] * 255;
        const b = col[v * cs + 2] * 255;
        // Pale: light and grey-blue, as 0x8fd8e6 mixed toward the deep colour was.
        if ((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b)) < 0.55 || r + g + b > 420) pale++;
      }
    }
  }
  // The water's map the shader reads: a narrow river drawn as deep water, bluer; wide water as
  // before (its depth, its shallow colour mixed 45% toward the pale turquoise).
  const map = (terrain as unknown as { waterData: Uint8Array }).waterData;
  let narrowCells = 0;
  let shallowLook = 0;
  let wideCells = 0;
  let wideChanged = 0;
  for (let i = 0; i < world.n; i++) {
    if (kind[i] === 1) {
      narrowCells++;
      if ((map[i * 4 + 3] / 255) * 8 < 1.9) shallowLook++;
    } else if (kind[i] === 2 && world.fluid[i] === F.WATER) {
      // A lake deeper than a unit is drawn clearer since 19 November (lakeChecks).
      if (world.depth[i] > 1 && lakeShare(world.height[i] + world.depth[i], world.seaLevel) > 0) continue;
      wideCells++;
      const t = [0x86, 0xea, 0xdc];
      const w = [0x4a, 0xa0, 0xdc];
      const want = Math.max(1, Math.min(255, Math.round((world.depth[i] / 8) * 255)));
      if (Math.abs(map[i * 4 + 3] - want) > 0 || [0, 1, 2].some((c) => Math.abs(map[i * 4 + c] - (w[c] * 0.55 + t[c] * 0.45)) > 1)) wideChanged++;
    }
  }
  check(
    "the shader draws a narrow river as deep blue water and wide water as before",
    narrowCells > 200 && shallowLook === 0 && wideCells > 2000 && wideChanged === 0,
    `${shallowLook} of ${narrowCells} narrow river cells drawn shallower than 1.9, ${wideChanged} of ${wideCells} wide water cells drawn otherwise than before`,
  );
  const share = (k: number) => foamy[k] / Math.max(1, area[k]);
  check(
    "a narrow river has no foam: rivers one or two cells wide are water, not a band of white",
    area[1] > 500 && share(1) < 0.02,
    `${(share(1) * 100).toFixed(1)}% of ${area[1].toFixed(0)} eighths of narrow river tops foamy`,
  );
  check(
    "a lake's and the sea's shore keep their foam",
    area[2] > 20000 && foamy[2] > 2000,
    `${foamy[2].toFixed(0)} eighths foamy of ${area[2].toFixed(0)} of wide water (${(share(2) * 100).toFixed(1)}%)`,
  );
  check(
    "a river's small falls are its own blue, not pale outlines",
    steps > 20 && pale === 0,
    `${pale} of ${steps} side triangles under a cell tall on narrow rivers pale`,
  );
}

// The columns of wet cell (x, y) at or above its water that no path of such columns (in the cell and
// the eight round it, through other wet cells' such columns) joins to a dry cell's land.
function isletColumns(world: World, terrain: Terrain, levels: Float32Array, x: number, y: number): number {
  const sub = 8;
  const n = 3 * sub;
  const x0 = (x - 1) * sub;
  const y0 = (y - 1) * sub;
  // 0: water or not drawn, 1: land of a wet cell, 2: land of a dry cell.
  const kind = new Uint8Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const px = (x0 + i + 0.5) / sub;
      const py = (y0 + j + 0.5) / sub;
      const c = Math.floor(py) * world.w + Math.floor(px);
      const h = columnTopAt(terrain, px, py);
      if (Number.isNaN(h)) continue;
      if (levels[c] > -1e8) kind[j * n + i] = h >= levels[c] ? 1 : 0;
      else kind[j * n + i] = h >= levels[y * world.w + x] - 0.001 ? 2 : 0;
    }
  const seen = new Uint8Array(n * n);
  const queue: number[] = [];
  for (let k = 0; k < n * n; k++)
    if (kind[k] === 2) {
      seen[k] = 1;
      queue.push(k);
    }
  while (queue.length) {
    const k = queue.pop()!;
    const i = k % n;
    const j = (k - i) / n;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const t = b * n + a;
      if (seen[t] || !kind[t]) continue;
      seen[t] = 1;
      queue.push(t);
    }
  }
  let alone = 0;
  for (let j = sub; j < 2 * sub; j++) for (let i = sub; i < 2 * sub; i++) if (kind[j * n + i] === 1 && !seen[j * n + i]) alone++;
  return alone;
}

// The columns of the island the water's tops cover, as a set of (column x, column z) on the eighth
// grid, from the fine water meshes' top triangles.
function waterColumns(world: World, fine: Mesh[]): Set<number> {
  const out = new Set<number>();
  const key = (i: number, j: number) => (i + 4096) * 8192 + j + 4096;
  for (const m of fine) {
    const p = m.geometry.getAttribute("position").array as Float32Array;
    const wf = m.geometry.getAttribute("waterFine").array as Float32Array;
    for (let t = 0; t < p.length / 9; t++) {
      if (wf[t * 6] < 0.8) continue;
      const v = t * 9;
      const ax = (p[v] + world.w / 2) * 8;
      const az = (p[v + 2] + world.h / 2) * 8;
      const bx = (p[v + 3] + world.w / 2) * 8;
      const bz = (p[v + 5] + world.h / 2) * 8;
      const cx = (p[v + 6] + world.w / 2) * 8;
      const cz = (p[v + 8] + world.h / 2) * 8;
      const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      for (let i = Math.floor(Math.min(ax, bx, cx)); i < Math.ceil(Math.max(ax, bx, cx)); i++)
        for (let j = Math.floor(Math.min(az, bz, cz)); j < Math.ceil(Math.max(az, bz, cz)); j++) {
          const px = i + 0.5;
          const pz = j + 0.5;
          const e0 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
          const e1 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx);
          const e2 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
          if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)) out.add(key(i, j));
        }
    }
  }
  return out;
}

// Coasts (18 November, the owner on the Fold: "Actually coasts are bad too"): on a diagonal shore
// the water stepped in whole-cell teeth, the waterline along the cells' edges. A tooth: a dry cell
// of a low shore (at most a voxel above the water) with water on one x side, one y side and the
// diagonal between them, whose corner column toward them is drawn as land (the step's corner); a
// notch: the same with water and land swapped, its corner column drawn as water. The line cut
// across the step leaves neither. And the dark line along the shore: the water's side where it
// stood over the dry ground next to it, counted as side triangles along a low shore.
function coastChecks(check: Check, world: World, terrain: Terrain, fine: Mesh[], where: string): void {
  const levels = (terrain as unknown as { fluidLevel: Float32Array }).fluidLevel;
  const covered = waterColumns(world, fine);
  const isWater = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < world.w && y < world.h && levels[y * world.w + x] > -1e8 && world.fluid[y * world.w + x] === F.WATER;
  const isDry = (x: number, y: number) => x >= 0 && y >= 0 && x < world.w && y < world.h && !(levels[y * world.w + x] > -1e8);
  // A coast of still water, the sea's or a lake's: its three cells at one level. A river's banks,
  // whose water falls from cell to cell, are a waterline of their own (19 November: rivers on new
  // islands are curves in bands one to three cells wide, and their low banks came into this count).
  const still = (a: number, b: number, c: number) => Math.max(levels[a], levels[b], levels[c]) - Math.min(levels[a], levels[b], levels[c]) < 0.01;
  let corners = 0;
  let teeth = 0;
  let notches = 0;
  let wetCorners = 0;
  for (let y = 2; y < world.h - 2; y++)
    for (let x = 2; x < world.w - 2; x++) {
      const i = y * world.w + x;
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        // The corner column toward (dx, dy), and whether the fine land is drawn there.
        const cx = dx > 0 ? x * 8 + 7 : x * 8;
        const cy = dy > 0 ? y * 8 + 7 : y * 8;
        if (Number.isNaN(columnTopAt(terrain, (cx + 0.5) / 8, (cy + 0.5) / 8))) continue;
        const k = (cx + 4096) * 8192 + cy + 4096;
        if (
          isDry(x, y) &&
          world.fluid[i] === F.NONE &&
          isWater(x + dx, y) &&
          isWater(x, y + dy) &&
          isWater(x + dx, y + dy) &&
          isDry(x - dx, y) &&
          isDry(x, y - dy)
        ) {
          if (columnTop(world, i) - levels[(y + dy) * world.w + x] > 1) continue;
          if (!still((y + dy) * world.w + x, y * world.w + x + dx, (y + dy) * world.w + x + dx)) continue;
          corners++;
          if (!covered.has(k)) teeth++;
        } else if (isWater(x, y) && isDry(x + dx, y) && isDry(x, y + dy) && isDry(x + dx, y + dy) && isWater(x - dx, y) && isWater(x, y - dy)) {
          if (columnTop(world, (y + dy) * world.w + x) - levels[i] > 1) continue;
          if (!still(i, y * world.w + x - dx, (y - dy) * world.w + x)) continue;
          wetCorners++;
          if (covered.has(k)) notches++;
        }
      }
    }
  check(
    `a diagonal coast's waterline cuts across its cells, not in whole-cell teeth (${where})`,
    corners > 40 && wetCorners > 40 && teeth / corners < 0.15 && notches / wetCorners < 0.15,
    `${teeth} of ${corners} land corners of a step drawn as a tooth, ${notches} of ${wetCorners} water corners as a notch`,
  );
}
