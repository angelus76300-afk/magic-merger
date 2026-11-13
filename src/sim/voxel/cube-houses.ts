import { Rng } from "../noise";
import type { HousePlan, Shape, Tagged } from "./buildings";
import { Vox, h3, mix, tone } from "./cubes";

// The village houses, buildings with a job and building sites in small cubes (5.2.5): the same
// house the builder chose (buildings.ts houseShape: its size, walls, door, roof, chimney, porch,
// lean-to), drawn as the reference cottage is: walls in a timber frame of a contrasting wood,
// windows set one cube back in their frames over a sill, a door set back under a lintel, a step,
// roofs of tile rows with a darker eave row and a ridge, a chimney, and a few things by the door
// (a barrel, a crate, a flower box, a bench) chosen by the house's seed; a grown village's houses
// and the bigger ones get more. Each region's style keeps its own: timber, adobe (smooth walls,
// round corners, beams out under a flat roof), stone (coursed blocks, light quoins), stilts
// (plank walls on a deck, steps down) and snow roofs (log walls, snow on the tiles).
//
// The block is 2 by 2 cells, 16 by 16 cubes; x east, y south (the door's side), z up. What
// lights at night (windows, chimneys) is returned at the new places, in the same order.

const E = 8;
const r8 = (v: number) => Math.round(v * E);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface FineHouse {
  vox: Vox;
  windows: Shape["windows"];
  chimneys: Shape["chimneys"];
}

const GLASS = 0x2c3440;
const GLASS_TOP = 0x48586a;
const DOOR = [0x6a4228, 0x5a3820];
const FLOWERS = [0xe8584a, 0xf2c94c, 0xf28ab0, 0xf4f0ea, 0xa98cf0];

export function fineHouse(shape: Shape, seed: number): FineHouse {
  const P = shape.plan as HousePlan;
  const v = new Vox(16, 44, 2);
  const style = P.style;
  const X0 = clamp(r8(P.x0), 1, 9);
  const X1 = clamp(r8(P.x0 + P.w), X0 + 6, 15);
  const Y0 = clamp(r8(P.z0), 1, 9);
  const Y1 = clamp(r8(P.z0 + P.d), Y0 + 6, 14);
  const L = r8(P.lift);
  const H = Math.max(5, r8(P.h));
  const top = L + H;
  const trim = P.trim;
  const stoneLight = 0xb4b0aa;
  const rng = new Rng(seed ^ 0x6a09e667);

  // Walls by style.
  const wallAt = (x: number, y: number, z: number, base = P.wall): number => {
    switch (style) {
      case "stilts":
        return (x + y) % 2 ? base : tone(base, 0.9);
      case "snowroof":
        return z % 2 ? base : tone(base, 0.86);
      case "stone": {
        const u = x + y + (z % 2);
        return tone(base, 0.9 + h3(u >> 1, z, 0, seed) * 0.16);
      }
      default:
        return base;
    }
  };

  // Stilts and the deck on them.
  if (L > 0) {
    for (const [px, py] of [
      [X0, Y0],
      [X1 - 1, Y0],
      [X0, Y1 - 1],
      [X1 - 1, Y1 - 1],
    ])
      v.box(px, py, 0, px + 1, py + 1, L - 1, 0x5b3d24);
    v.box(X0 - 1, Y0 - 1, L - 1, X1 + 1, Y1 + 2, L, (x) => (x % 2 ? 0x8a6a44 : 0x7c5e3c));
  }
  const floor = L > 0 ? L : 1;
  // A plinth of stone along the foot.
  if (L === 0) v.box(X0, Y0, 0, X1, Y1, 1, (x, y) => tone(style === "adobe" ? 0xa88a60 : 0x7e7a74, 0.92 + h3(x, y, 0, seed) * 0.12));
  v.box(X0, Y0, floor, X1, Y1, top, (x, y, z) => wallAt(x, y, z));

  // Corners: timber posts, light stone quoins, log ends, or rounded adobe.
  const corners: [number, number, number, number][] = [
    [X0, Y0, -1, -1],
    [X1 - 1, Y0, 1, -1],
    [X0, Y1 - 1, -1, 1],
    [X1 - 1, Y1 - 1, 1, 1],
  ];
  for (const [cx, cy, sx, sy] of corners)
    for (let z = floor; z < top; z++) {
      if (style === "adobe") v.clear(cx, cy, z);
      else if (style === "stone") v.set(cx, cy, z, z % 2 ? stoneLight : tone(stoneLight, 0.9));
      else if (style === "snowroof") {
        v.set(cx, cy, z, trim);
        if (z % 2 === 0) {
          v.set(cx + sx, cy, z, tone(P.wall, 0.8));
          v.set(cx, cy + sy, z, tone(P.wall, 0.8));
        }
      } else v.set(cx, cy, z, trim);
    }

  // The timber frame: a sill beam, a beam under the eaves, one between the floors, posts between.
  const openings: [number, number][] = [];
  const dc = clamp(r8(P.door + 0.11), X0 + 2, X1 - 2);
  openings.push([dc - 2, dc + 1]);
  if (style === "timber") {
    const ring = (z: number) => {
      for (let x = X0; x < X1; x++) {
        v.set(x, Y0, z, trim);
        v.set(x, Y1 - 1, z, trim);
      }
      for (let y = Y0; y < Y1; y++) {
        v.set(X0, y, z, trim);
        v.set(X1 - 1, y, z, trim);
      }
    };
    ring(top - 1);
    if (P.size === "two") ring(L + Math.floor(H / 2));
  }

  // Windows: set back one cube, glass in two tones, a sill out from the wall, a lintel, and
  // shutters or a frame either side. Front and east are lit at night; back and west mirror them.
  const windows: Shape["windows"] = [];
  const front: number[] = [];
  const sill = style === "stone" ? stoneLight : style === "adobe" ? 0x8a6a44 : tone(trim, 1.15);
  const lintel = style === "stone" ? stoneLight : style === "adobe" ? 0x7a5a38 : trim;
  const side = P.shutters;
  const flowerBoxes = P.grown || rng.next() < 0.4;
  // A window on the wall facing `n` (0 south, 1 east, 2 north, 3 west), centred at u along it.
  const windowAt = (n: number, u: number, zc: number, flowers: boolean) => {
    const put = (a: number, z: number, out: number, c: number) => {
      // a: along the wall; out: 0 the wall's outer layer, 1 a cube out, -1 a cube in.
      if (n === 0) v.set(a, Y1 - 1 + out, z, c);
      else if (n === 2) v.set(a, Y0 - out, z, c);
      else if (n === 1) v.set(X1 - 1 + out, a, z, c);
      else v.set(X0 - out, a, z, c);
    };
    const clr = (a: number, z: number) => {
      if (n === 0) v.clear(a, Y1 - 1, z);
      else if (n === 2) v.clear(a, Y0, z);
      else if (n === 1) v.clear(X1 - 1, a, z);
      else v.clear(X0, a, z);
    };
    for (const a of [u - 1, u])
      for (const z of [zc - 1, zc]) {
        clr(a, z);
        put(a, z, -1, z === zc ? GLASS_TOP : GLASS);
      }
    for (let a = u - 1; a <= u; a++) {
      if (style !== "timber" || zc + 1 < top - 1) put(a, zc + 1, 0, lintel);
      put(a, zc - 2, 1, flowers ? 0x7a5232 : sill);
    }
    if (flowers) for (const a of [u - 1, u]) put(a, zc - 1, 1, h3(a, zc, n, seed) < 0.6 ? FLOWERS[Math.floor(h3(a, n, zc, seed) * FLOWERS.length)] : 0x4f8a36);
    if (side >= 0)
      for (const z of [zc - 1, zc]) {
        put(u - 2, z, 0, side);
        put(u + 1, z, 0, side);
      }
  };
  for (const w of shape.windows) {
    const zc = clamp(r8(w.y), floor + 2, top - 2);
    if (w.axis === 0) {
      const u = clamp(r8(w.x), X0 + 2, X1 - 2);
      front.push(u);
      openings.push([u - 2, u + 1]);
      windowAt(0, u, zc, flowerBoxes && rng.next() < 0.7);
      windows.push({ x: u / E, y: zc / E, z: (Y1 - 1) / E + 0.02, axis: 0 });
      // The back wall gets its own, unlit.
      windowAt(2, X0 + X1 - u, zc, false);
    } else {
      const u = clamp(r8(w.z), Y0 + 2, Y1 - 2);
      windowAt(1, u, zc, false);
      windows.push({ x: (X1 - 1) / E + 0.02, y: zc / E, z: u / E, axis: 1 });
      windowAt(3, u, zc, false);
    }
  }
  // Posts along the long walls of a timber house, where no window or door is.
  if (style === "timber")
    for (let x = X0 + 3; x < X1 - 2; x += 4) if (!openings.some(([a, b]) => x >= a && x <= b)) for (let z = floor; z < top; z++) v.set(x, Y1 - 1, z, trim);

  // The door, set back, planks in two tones, its frame and a lintel; a step before it.
  const dz = floor;
  for (const a of [dc - 1, dc])
    for (let z = dz; z < dz + 4; z++) {
      v.clear(a, Y1 - 1, z);
      v.set(a, Y1 - 2, z, DOOR[a % 2]);
    }
  for (let z = dz; z < dz + 4; z++) {
    v.set(dc - 2, Y1 - 1, z, style === "adobe" ? P.wall : lintel);
    v.set(dc + 1, Y1 - 1, z, style === "adobe" ? P.wall : lintel);
  }
  for (let a = dc - 2; a <= dc + 1; a++) v.set(a, Y1 - 1, dz + 4, lintel);
  if (L > 0) for (let k = 1; k < L; k++) v.box(dc - 1, Y1 + 1 + k, L - 1 - k, dc + 1, Y1 + 2 + k, L - k, 0x7c5e3c);
  else if (!P.porch) v.box(dc - 2, Y1, 0, dc + 2, Y1 + 1, 1, 0x8e8a82);

  // A porch: a floor of planks, two posts and a little roof over the door.
  if (P.porch) {
    const az = Math.min(top - 1, dz + 5);
    if (L === 0) v.box(dc - 3, Y1, 0, dc + 3, Y1 + 3, 1, (x) => (x % 2 ? 0x8a6a44 : 0x7c5e3c));
    for (const px of [dc - 3, dc + 2]) v.box(px, Y1 + 2, dz, px + 1, Y1 + 3, az, trim);
    v.box(dc - 4, Y1, az, dc + 4, Y1 + 3, az + 1, (x, y) => (y === Y1 + 2 ? tone(P.roofColor, 0.75) : tone(P.roofColor, x % 2 ? 1 : 0.93)));
  }

  // Adobe: beams out of the wall under the roof.
  if (style === "adobe")
    for (let x = X0 + 1; x < X1 - 1; x += 3) {
      v.set(x, Y1, top - 2, 0x6a4a2e);
      v.set(x, Y0 - 1, top - 2, 0x6a4a2e);
    }

  // The roof.
  roofOf(v, P, seed, X0, X1, Y0, Y1, top, wallAt);

  // The lean-to: lower walls, a roof of one slope.
  if (P.leanTo) {
    const lx0 = clamp(r8(P.leanTo.x), 0, 15);
    const lx1 = clamp(r8(P.leanTo.x + P.leanTo.w), lx0 + 2, 16);
    const ly0 = Y0 + 1;
    const ly1 = Y1 - 2;
    const lh = L + Math.max(3, Math.round(H * 0.6));
    const outer = lx0 < X0 ? lx0 : lx1 - 1;
    v.box(lx0, ly0, floor, lx1, ly1, lh, (x, y, z) => wallAt(x, y, z, P.leanTo!.wall));
    for (let x = lx0 - 1; x <= lx1; x++) {
      const zz = lh + (Math.abs(x - outer) > 1 ? 1 : 0);
      for (let y = ly0 - 1; y <= ly1; y++) v.set(x, y, zz, x === outer || x === outer + (outer < X0 ? -1 : 1) ? tone(P.leanTo.roof, 0.78) : P.leanTo.roof);
    }
  }

  // The chimney: brick by brick, a darker cap, as high as the old one so the smoke comes out of it.
  const chimneys: Shape["chimneys"] = [];
  if (P.chimney) {
    const cx = clamp(r8(P.chimney.x), X0, X1 - 2);
    const cy = clamp(r8(P.chimney.z), Y0, Y1 - 2);
    let roofTop = top;
    for (let z = top; z < v.nz; z++)
      for (const [a, b] of [
        [cx, cy],
        [cx + 1, cy],
        [cx, cy + 1],
        [cx + 1, cy + 1],
      ])
        if (v.has(a, b, z)) roofTop = z + 1;
    const zt = Math.min(v.nz - 1, Math.max(r8(P.chimney.top), roofTop + 2));
    v.box(cx, cy, top, cx + 2, cy + 2, zt, (x, y, z) => (z === zt - 1 ? tone(P.chimney!.color, 0.72) : tone(P.chimney!.color, (x + y + z) % 2 ? 1 : 0.9)));
    chimneys.push({ x: (cx + 1) / E, y: zt / E, z: (cy + 1) / E });
  }

  // Things by the door, by the house's seed: more for a grown village's houses and bigger ones.
  const props = 1 + (P.grown ? 1 : 0) + (P.size === "two" || P.size === "longhouse" ? 1 : 0);
  const ground = L > 0 ? L : 0;
  const py = Y1;
  const busy = (x0: number, x1: number) => (P.porch ? x1 >= dc - 4 && x0 <= dc + 3 : x1 >= dc - 2 && x0 <= dc + 1);
  const spots: number[] = [];
  for (let x = X0 - 1; x + 2 <= X1 + 1; x++) if (!busy(x, x + 2) && (L === 0 || (x >= X0 - 1 && x + 2 <= X1 + 1))) spots.push(x);
  const used: number[] = [];
  for (let k = 0; k < props && spots.length; k++) {
    const x = spots[Math.floor(rng.next() * spots.length)];
    if (used.some((u) => Math.abs(u - x) < 3)) continue;
    used.push(x);
    const kind = Math.floor(rng.next() * 4);
    if (kind === 0) {
      // A barrel: wood in staves, two dark hoops.
      v.box(x, py, ground, x + 2, py + 2, ground + 3, (a, b, z) => (z === ground + 1 ? 0x4a3424 : (a + b) % 2 ? 0x8a5a32 : 0x7a4e2a));
    } else if (kind === 1) {
      // A crate of light planks, a darker lid.
      v.box(x, py, ground, x + 2, py + 2, ground + 2, (a, b, z) => (z === ground + 1 ? 0x9a7444 : (a + b + z) % 2 ? 0xb08a52 : 0xa07c48));
      if (rng.next() < 0.5) v.set(x, py, ground + 2, 0x8a6a3c);
    } else if (kind === 2) {
      // A flower bed against the wall.
      v.box(x, py, ground, x + 3, py + 1, ground + 1, 0x6a4a2e);
      for (let a = x; a < x + 3; a++) v.set(a, py, ground + 1, h3(a, py, 1, seed) < 0.55 ? FLOWERS[Math.floor(h3(a, 2, py, seed) * FLOWERS.length)] : 0x4f8a36);
    } else {
      // A bench: a seat on two legs.
      v.box(x, py, ground + 1, x + 3, py + 1, ground + 2, 0x8a6a44);
      v.set(x, py, ground, 0x5b3d24);
      v.set(x + 2, py, ground, 0x5b3d24);
    }
  }

  // A roof mended after a fire: patches of newer straw or tiles.
  if (P.patched)
    for (let k = 0; k < 3; k++) {
      const px = X0 + Math.floor(rng.next() * (X1 - X0 - 2));
      const pyy = Y0 + Math.floor(rng.next() * (Y1 - Y0 - 2));
      for (const [a, b] of [
        [px, pyy],
        [px + 1, pyy],
        [px, pyy + 1],
        [px + 1, pyy + 1],
      ]) {
        let z = v.nz - 1;
        while (z > top && !v.has(a, b, z)) z--;
        if (z > top) v.set(a, b, z, k % 2 ? 0xe0c070 : 0xd07050);
      }
    }
  return { vox: v, windows, chimneys };
}

// A pitched roof in tile rows: each row a cube higher than the one below it every `run` cubes in,
// the eave row darker, a ridge on top; the gable ends filled with the wall. Flat: a slab and a
// low parapet. Snow on the rows above the eave of a snow roof.
function roofOf(
  v: Vox,
  P: HousePlan,
  seed: number,
  X0: number,
  X1: number,
  Y0: number,
  Y1: number,
  top: number,
  wallAt: (x: number, y: number, z: number) => number,
): void {
  const c = P.roofColor;
  if (P.roof === "flat") {
    v.box(X0, Y0, top, X1, Y1, top + 1, (x, y) => tone(c, 0.94 + h3(x, y, 1, seed) * 0.08));
    for (let x = X0; x < X1; x++) for (const y of [Y0, Y1 - 1]) v.set(x, y, top + 1, tone(c, 0.9));
    for (let y = Y0; y < Y1; y++) for (const x of [X0, X1 - 1]) v.set(x, y, top + 1, tone(c, 0.9));
    if (P.style === "adobe")
      for (let x = X0; x < X1; x++)
        for (let y = Y0; y < Y1; y++) if (x === X0 || y === Y0 || x === X1 - 1 || y === Y1 - 1) v.set(x, y, top - 1, tone(P.wall, 0.94));
    return;
  }
  const alongX = P.w >= P.d;
  const run = P.roof === "slate" ? 1.5 : P.roof === "turf" ? 3 : 2;
  const [A0, A1] = alongX ? [Y0 - 1, Y1 + 1] : [X0 - 1, X1 + 1];
  const [Q0, Q1] = alongX ? [X0 - 1, X1 + 1] : [Y0 - 1, Y1 + 1];
  const [W0, W1] = alongX ? [X0, X1] : [Y0, Y1];
  const A = A1 - A0;
  const hMax = Math.floor((A - 1) / 2 / run);
  const snow = P.style === "snowroof";
  for (let q = Q0; q < Q1; q++)
    for (let r = 0; r < A; r++) {
      const m = Math.min(r, A - 1 - r);
      const hr = Math.floor(m / run);
      const zs = top + hr;
      const [x, y] = alongX ? [q, A0 + r] : [A0 + r, q];
      const inside = q >= W0 && q < W1 && m >= 1;
      for (let z = top; z < zs; z++) {
        if (inside) v.set(x, y, z, wallAt(x, y, z));
        else if (z === zs - 1) v.set(x, y, z, tone(c, 0.66));
      }
      let col: number;
      const eave = m === 0;
      const ridge = hr === hMax;
      if (P.roof === "thatch") col = tone(c, (hr % 2 ? 0.93 : 1) * (0.95 + h3(x, y, zs, seed) * 0.1));
      else if (P.roof === "turf") col = tone(c, 0.92 + h3(x, y, zs, seed) * 0.16);
      else col = tone(c, (hr % 2 ? 0.92 : 1) * (((q + hr) >> 1) % 2 ? 0.96 : 1));
      if (eave) col = tone(c, 0.72);
      else if (ridge) col = tone(c, 0.82);
      if (snow && !eave) col = mix(0xf4f8fb, 0xdde6ee, h3(x, y, zs, seed) * 0.6);
      v.set(x, y, zs, col);
      // Thatch hangs a little lower at the eaves.
      if (eave && P.roof === "thatch") v.set(x, y, zs - 1, tone(c, 0.64));
      // A ridge cap along the top of tiles and slates.
      if (ridge && (P.roof === "tile" || P.roof === "slate") && q > Q0 && q < Q1 - 1) v.set(x, y, zs + 1, snow ? 0xeef3f8 : tone(c, 0.7));
    }
}

// A building with a job, or a site going up, from its boxes: each filled into cubes, a roof's
// steps in tile rows (the lower row of each darker), a window set back into its wall over a sill.
export function fineBoxes(boxes: Tagged[]): Vox {
  const v = new Vox(16, 44, 4);
  const lo = (a: number) => Math.round(a * E);
  const span = (a: number, w: number): [number, number] => {
    const s = lo(a);
    return [s, Math.max(s + 1, lo(a + w))];
  };
  for (const b of boxes) {
    if (b.y < -0.01) continue;
    const [x0, x1] = span(b.x, b.w);
    const [y0, y1] = span(b.z, b.d);
    const [z0, z1] = span(b.y, b.h);
    if (b.tag === "roof") v.box(x0, y0, z0, x1, y1, z1, (x, y, z) => tone(b.color, z === z0 ? 0.82 : ((x + y) >> 1) % 2 ? 0.96 : 1));
    else if (b.tag === "window") {
      // The plate lies on the wall's face: the wall's outer layer becomes glass, a sill below.
      const front = b.d <= b.w;
      for (let x = x0; x < x1; x++)
        for (let y = y0; y < y1; y++)
          for (let z = z0; z < z1; z++) {
            const [ax, ay] = front ? [x, y - 1] : [x - 1, y];
            v.set(ax, ay, z, z === z1 - 1 ? GLASS_TOP : GLASS);
          }
      if (front) for (let x = x0 - 1; x <= x1; x++) v.set(x, y0, z0 - 1, 0x8a6a44);
      else for (let y = y0 - 1; y <= y1; y++) v.set(x0, y, z0 - 1, 0x8a6a44);
    } else v.box(x0, y0, z0, x1, y1, z1, b.color);
  }
  return v;
}
