import { BufferAttribute, BufferGeometry, Mesh, type Material, type Scene } from "three";
import { Rng } from "../noise";
import { C, isBuilding } from "../materials";
import { HOUSE_STYLES, type Settlement } from "../ecology";
import type { World } from "../world";
import { pushBox, type Box } from "./models";
import { columnTop } from "./terrain";

// Every house and building with a job on an island with villages (4.4.5
// part B), each from its own seed: no two alike. A house is a two by two
// block of house cells; its builder picks a size (hut, cottage, longhouse,
// two storeys), a roof (thatch, tile, slate, flat, turf) in a color of its
// kind, walls of its village's style, a chimney, a porch, shutters, a
// lean-to once its village has grown, and a patch on a roof rebuilt after a
// fire. It turns its door to the village's plaza.
//
// All of them are merged into one mesh, one draw call for the whole island,
// rebuilt only when a building appears, burns or is patched (a few times a
// minute at most). The lit windows at night and the chimneys' smoke come
// from each building's own shape.

const B = (x: number, y: number, z: number, w: number, h: number, d: number, color: number): Box => ({ x, y, z, w, h, d, color });

function vary(rng: Rng, color: number, amount = 0.08): number {
  const k = 1 + (rng.next() - 0.5) * 2 * amount;
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((color >> s) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng.next() * list.length)];

type Roof = "thatch" | "tile" | "slate" | "flat" | "turf";
const ROOF_COLORS: Record<Roof, number[]> = {
  thatch: [0xc8a85a, 0xd4b464, 0xb8984e, 0xc09a50],
  tile: [0xb5523b, 0xc05d44, 0xa84a35, 0xc8703e, 0x9a4030],
  slate: [0x5a6270, 0x667080, 0x525a68, 0x4a5262, 0x6a6a78],
  flat: [0xc89c64, 0xd0a46c, 0xb88c58],
  turf: [0x5f8a3a, 0x6a9442, 0x557f34],
};
const STYLE: Record<string, { walls: number[]; roofs: Roof[]; trim: number }> = {
  timber: { walls: [0xe8dcc0, 0xdcd0b0, 0xf0e4c8, 0xd8c8a8], roofs: ["tile", "thatch", "slate", "tile"], trim: 0x6a4a2e },
  adobe: { walls: [0xd8b07a, 0xe0bc88, 0xcca06c, 0xdcb482], roofs: ["flat", "flat", "flat", "thatch"], trim: 0x7a5a38 },
  stone: { walls: [0x9a9aa0, 0x8e8e94, 0xa6a2a0, 0x948c86], roofs: ["slate", "slate", "turf", "tile"], trim: 0x4a3a2e },
  stilts: { walls: [0xb89a6a, 0xc4a676, 0xac8e60], roofs: ["thatch", "thatch", "turf"], trim: 0x5b3d24 },
  snowroof: { walls: [0x9a7a5a, 0x8a6a4a, 0xa68660], roofs: ["slate", "turf", "slate"], trim: 0x4a3420 },
};

export interface Shape {
  boxes: Box[];
  // Lit at night: a point on a wall and which way it faces (0 +z, 1 +x).
  windows: { x: number; y: number; z: number; axis: 0 | 1 }[];
  chimneys: { x: number; y: number; z: number }[];
}

// A pitched roof as steps: wide and low first, narrow on top.
function roof(out: Box[], rng: Rng, kind: Roof, x0: number, z0: number, w: number, d: number, y: number, color: number, snow: boolean): number {
  if (kind === "flat") {
    out.push(B(x0 - 0.03, y, z0 - 0.03, w + 0.06, 0.1, d + 0.06, color));
    out.push(B(x0 - 0.05, y + 0.1, z0 - 0.05, w + 0.1, 0.07, 0.12, vary(rng, color)));
    out.push(B(x0 - 0.05, y + 0.1, z0 + d - 0.07, w + 0.1, 0.07, 0.12, vary(rng, color)));
    return y + 0.17;
  }
  const steps = kind === "slate" ? 4 : kind === "turf" ? 2 : 3;
  const over = kind === "thatch" ? 0.12 : 0.07;
  const rise = kind === "slate" ? 0.17 : kind === "turf" ? 0.14 : kind === "thatch" ? 0.2 : 0.15;
  // Along the longer side the ridge runs; the other side narrows.
  const alongX = w >= d;
  let top = y;
  for (let k = 0; k < steps; k++) {
    const f = 1 - k / steps;
    const ww = alongX ? w + over * 2 : (w + over * 2) * f;
    const dd = alongX ? (d + over * 2) * f : d + over * 2;
    const c = k === steps - 1 && snow ? 0xf4f8fb : vary(rng, color, 0.05);
    out.push(B(x0 + (w - ww) / 2, top, z0 + (d - dd) / 2, ww, rise, dd, c));
    top += rise;
  }
  if (snow) out.push(B(x0 - over, y + rise - 0.02, z0 - over, w + over * 2, 0.05, d + over * 2, 0xeef3f8));
  return top;
}

// A house on a two by two block: x and z from 0 to 2, the door on the +z side.
export function houseShape(seed: number, style: string, grown: boolean, patched: boolean): Shape {
  const rng = new Rng(seed);
  const st = STYLE[style] ?? STYLE.timber;
  const out: Box[] = [];
  const windows: Shape["windows"] = [];
  const chimneys: Shape["chimneys"] = [];
  const size = pick(rng, ["hut", "cottage", "cottage", "longhouse", "two"] as const);
  const [w, d, h] =
    size === "hut"
      ? [1.25 + rng.next() * 0.15, 1.2 + rng.next() * 0.15, 0.6]
      : size === "cottage"
        ? [1.55 + rng.next() * 0.2, 1.4 + rng.next() * 0.2, 0.75]
        : size === "longhouse"
          ? [1.85, 1.15 + rng.next() * 0.1, 0.68]
          : [1.45 + rng.next() * 0.15, 1.4 + rng.next() * 0.15, 1.45];
  const x0 = (2 - w) / 2 + (rng.next() - 0.5) * 0.15;
  const z0 = (2 - d) / 2 + (rng.next() - 0.5) * 0.1;
  const lift = style === "stilts" ? 0.42 : 0;
  if (lift) {
    for (const [px, pz] of [
      [x0 + 0.05, z0 + 0.05],
      [x0 + w - 0.13, z0 + 0.05],
      [x0 + 0.05, z0 + d - 0.13],
      [x0 + w - 0.13, z0 + d - 0.13],
    ])
      out.push(B(px, 0, pz, 0.08, lift + 0.02, 0.08, 0x5b3d24));
    out.push(B(x0 - 0.06, lift - 0.06, z0 - 0.06, w + 0.12, 0.07, d + 0.18, 0x8a6a44));
  }
  const wall = vary(rng, pick(rng, st.walls), 0.06);
  out.push(B(x0, lift, z0, w, h, d, wall));
  // Timber frames on two storeys: a beam between the floors.
  if (size === "two" && style === "timber") out.push(B(x0 - 0.01, lift + h * 0.5, z0 - 0.01, w + 0.02, 0.06, d + 0.02, st.trim));
  // Door and windows on the front.
  const door = x0 + w * (0.3 + rng.next() * 0.4) - 0.11;
  out.push(B(door, lift, z0 + d, 0.22, 0.42, 0.02, st.trim));
  const shutters = rng.next() < 0.5 ? pick(rng, [0x3a6a9a, 0x2f7a4a, 0x9a3a2a, 0x6a4a8a, 0x2a5a5a]) : -1;
  const spots = [x0 + 0.22, x0 + w - 0.22].filter((wx) => Math.abs(wx - (door + 0.11)) > 0.3);
  for (const wx of spots) {
    for (const wy of size === "two" ? [0.3, h * 0.72] : [0.32]) {
      out.push(B(wx - 0.09, lift + wy - 0.08, z0 + d, 0.18, 0.16, 0.015, 0x3a3028));
      windows.push({ x: wx, y: lift + wy, z: z0 + d + 0.02, axis: 0 });
      if (shutters >= 0) {
        out.push(B(wx - 0.17, lift + wy - 0.09, z0 + d, 0.07, 0.18, 0.025, shutters));
        out.push(B(wx + 0.1, lift + wy - 0.09, z0 + d, 0.07, 0.18, 0.025, shutters));
      }
    }
  }
  // A side window, for the light at night.
  windows.push({ x: x0 + w + 0.02, y: lift + 0.32, z: z0 + d * 0.5, axis: 1 });
  out.push(B(x0 + w, lift + 0.24, z0 + d * 0.5 - 0.09, 0.015, 0.16, 0.18, 0x3a3028));
  // A porch: a slab, two posts and a little roof.
  if (rng.next() < 0.35 && size !== "hut") {
    out.push(B(door - 0.2, lift, z0 + d, 0.62, 0.06, 0.32, vary(rng, 0x8a6a44)));
    out.push(B(door - 0.18, lift, z0 + d + 0.26, 0.05, 0.42, 0.05, st.trim));
    out.push(B(door + 0.35, lift, z0 + d + 0.26, 0.05, 0.42, 0.05, st.trim));
  }
  const kind = pick(rng, st.roofs);
  const color = vary(rng, pick(rng, ROOF_COLORS[kind]), 0.06);
  const top = roof(out, rng, kind, x0, z0, w, d, lift + h, color, style === "snowroof");
  if (kind !== "flat" && size !== "hut" && rng.next() < 0.3) out.push(B(x0 + w * 0.35, lift + h + 0.05, z0 + d - 0.05, w * 0.3, 0.22, 0.2, vary(rng, color))); // a dormer
  // A chimney through the roof, toward one end.
  if (rng.next() < 0.65) {
    const cx = rng.next() < 0.5 ? x0 + 0.18 : x0 + w - 0.36;
    const cz = z0 + d * (0.3 + rng.next() * 0.3);
    const ch = top - lift - h + 0.25;
    out.push(B(cx, lift + h, cz, 0.18, ch, 0.18, style === "adobe" ? 0xc89c64 : 0x8a7a70));
    chimneys.push({ x: cx + 0.09, y: lift + h + ch, z: cz + 0.09 });
  }
  // A lean-to added later, on the side away from the door.
  if (grown && rng.next() < 0.45 && size !== "longhouse") {
    const side = rng.next() < 0.5 ? -1 : 1;
    const lw = 0.38;
    const lx = side < 0 ? Math.max(0.02, x0 - lw) : Math.min(2 - lw - 0.02, x0 + w);
    out.push(B(lx, lift, z0 + 0.12, lw, h * 0.6, d - 0.3, vary(rng, wall, 0.1)));
    out.push(B(lx - 0.04, lift + h * 0.6, z0 + 0.08, lw + 0.08, 0.08, d - 0.22, vary(rng, color, 0.1)));
  }
  // A roof rebuilt after a fire: patches of newer straw or tiles.
  if (patched)
    for (let k = 0; k < 3; k++) {
      const pw = 0.22 + rng.next() * 0.15;
      out.push(
        B(x0 + rng.next() * (w - pw), lift + h + 0.12 + k * 0.05, z0 + rng.next() * (d - pw), pw, 0.08, pw, vary(rng, k % 2 ? 0xe0c070 : 0xd07050, 0.1)),
      );
    }
  return { boxes: out, windows, chimneys };
}

// Buildings with a job, each its own look, door to +z.
export function jobShape(seed: number, kind: number, style: string): Shape {
  const rng = new Rng(seed);
  const st = STYLE[style] ?? STYLE.timber;
  const out: Box[] = [];
  const windows: Shape["windows"] = [];
  const chimneys: Shape["chimneys"] = [];
  const wall = vary(rng, pick(rng, st.walls), 0.05);
  const roofKind = st.roofs[0];
  const roofColor = vary(rng, pick(rng, ROOF_COLORS[roofKind]));
  const snow = style === "snowroof";
  const win = (x: number, y: number, z: number) => {
    out.push(B(x - 0.09, y - 0.08, z, 0.18, 0.16, 0.015, 0x3a3028));
    windows.push({ x, y, z: z + 0.02, axis: 0 });
  };
  switch (kind) {
    case C.SMITHY: {
      out.push(B(0.2, 0, 0.3, 1.4, 0.7, 1.2, vary(rng, 0x8e8e94)));
      roof(out, rng, "slate", 0.2, 0.3, 1.4, 1.2, 0.7, vary(rng, 0x4a5262), snow);
      out.push(B(1.25, 0.7, 0.55, 0.3, 0.75, 0.3, 0x6a6a70));
      chimneys.push({ x: 1.4, y: 1.45, z: 0.7 });
      // The forge's glow through a wide door, an anvil outside.
      out.push(B(0.6, 0, 1.5, 0.5, 0.45, 0.02, 0x2a2420));
      windows.push({ x: 0.85, y: 0.25, z: 1.53, axis: 0 });
      out.push(B(0.25, 0, 1.6, 0.25, 0.2, 0.18, 0x3a3a40));
      out.push(B(0.2, 0.2, 1.58, 0.35, 0.07, 0.22, 0x4a4a52));
      break;
    }
    case C.GRANARY: {
      // A tall store on stone feet, a pointed roof.
      for (const [px, pz] of [
        [0.45, 0.45],
        [1.35, 0.45],
        [0.45, 1.35],
        [1.35, 1.35],
      ])
        out.push(B(px, 0, pz, 0.2, 0.3, 0.2, 0x8a8a90));
      out.push(B(0.4, 0.3, 0.4, 1.2, 1.1, 1.2, vary(rng, 0xc8a868)));
      out.push(B(0.38, 0.75, 0.38, 1.24, 0.06, 1.24, st.trim));
      out.push(B(0.85, 0.3, 1.6, 0.3, 0.45, 0.02, st.trim));
      let y = 1.4;
      for (let k = 0; k < 4; k++) {
        const s = 1.4 * (1 - k / 4);
        out.push(B(1 - s / 2, y, 1 - s / 2, s, 0.2, s, k === 3 && snow ? 0xf4f8fb : vary(rng, roofColor, 0.04)));
        y += 0.2;
      }
      break;
    }
    case C.BAKERY: {
      out.push(B(0.2, 0, 0.25, 1.3, 0.75, 1.2, wall));
      roof(out, rng, roofKind, 0.2, 0.25, 1.3, 1.2, 0.75, roofColor, snow);
      win(0.5, 0.35, 1.45);
      // The oven: a dome of steps on the side, a chimney.
      out.push(B(1.5, 0, 0.5, 0.45, 0.35, 0.7, 0xb08060));
      out.push(B(1.55, 0.35, 0.58, 0.35, 0.15, 0.54, 0xa07050));
      out.push(B(1.65, 0.5, 0.75, 0.15, 0.5, 0.15, 0x8a6050));
      chimneys.push({ x: 1.72, y: 1.0, z: 0.82 });
      out.push(B(1.0, 0, 1.47, 0.24, 0.42, 0.02, st.trim));
      break;
    }
    case C.BARN: {
      const red = vary(rng, pick(rng, [0xa8402e, 0x983a2a, 0x8a5a3a, 0xb04a32]));
      out.push(B(0.12, 0, 0.15, 1.76, 0.9, 1.5, red));
      out.push(B(0.7, 0, 1.65, 0.6, 0.65, 0.02, 0xe8e0d0));
      out.push(B(0.78, 0, 1.66, 0.44, 0.58, 0.02, red));
      // A gambrel roof: steep, then shallow.
      out.push(B(0.05, 0.9, 0.1, 1.9, 0.3, 1.6, vary(rng, 0x5a4a40)));
      out.push(B(0.05, 1.2, 0.35, 1.9, 0.2, 1.1, vary(rng, 0x5a4a40)));
      out.push(B(0.05, 1.4, 0.6, 1.9, 0.12, 0.6, snow ? 0xf4f8fb : vary(rng, 0x4a3e36)));
      // Hay outside.
      out.push(B(1.6, 0, 1.7, 0.3, 0.25, 0.25, 0xd8c060));
      break;
    }
    case C.TAVERN: {
      out.push(B(0.15, 0, 0.2, 1.7, 1.4, 1.35, wall));
      out.push(B(0.14, 0.7, 0.19, 1.72, 0.06, 1.37, st.trim));
      roof(out, rng, roofKind, 0.15, 0.2, 1.7, 1.35, 1.4, roofColor, snow);
      for (const x of [0.45, 1.0, 1.55]) {
        win(x, 0.35, 1.55);
        win(x, 1.05, 1.55);
      }
      // The sign on its post, barrels by the door.
      out.push(B(1.85, 0, 1.75, 0.05, 0.85, 0.05, st.trim));
      out.push(B(1.7, 0.6, 1.76, 0.2, 0.18, 0.03, pick(rng, [0xd8a030, 0x9a3a2a, 0x3a6a9a])));
      out.push(B(0.2, 0, 1.62, 0.2, 0.25, 0.2, 0x7a5a38));
      out.push(B(0.42, 0, 1.64, 0.18, 0.22, 0.18, 0x6a4a2e));
      chimneys.push({ x: 0.4, y: 2.1, z: 0.7 });
      out.push(B(0.3, 1.4, 0.6, 0.2, 0.7, 0.2, 0x8a7a70));
      break;
    }
    case C.MARKET: {
      // Stalls round a little square, each its awning.
      const colors = [0xd83a3a, 0x3a7ad8, 0xe8c040, 0x3aa85a, 0xd87a2a, 0x9a5ad8];
      for (let k = 0; k < 4; k++) {
        const sx = k % 2 ? 1.1 : 0.15;
        const sz = k < 2 ? 0.15 : 1.1;
        const c = colors[(k + Math.floor(rng.next() * 6)) % 6];
        for (const [px, pz] of [
          [sx, sz],
          [sx + 0.67, sz],
          [sx, sz + 0.67],
          [sx + 0.67, sz + 0.67],
        ])
          out.push(B(px, 0, pz, 0.05, 0.62, 0.05, 0x6a4a2e));
        out.push(B(sx - 0.04, 0.62, sz - 0.04, 0.8, 0.06, 0.8, c));
        out.push(B(sx - 0.04, 0.62, sz + 0.2, 0.8, 0.07, 0.2, 0xf4f0e8));
        out.push(B(sx + 0.1, 0, sz + 0.2, 0.5, 0.3, 0.3, 0x9a7a50));
        out.push(B(sx + 0.15, 0.3, sz + 0.25, 0.15, 0.08, 0.15, pick(rng, [0xe86a3a, 0xf2c94c, 0x6aa83a, 0xa83a6a])));
      }
      break;
    }
    case C.CHAPEL: {
      const white = vary(rng, pick(rng, [0xe8e4da, 0xdcd8cc, 0xd0ccc0]), 0.03);
      out.push(B(0.35, 0, 0.15, 1.1, 0.95, 1.45, white));
      roof(out, rng, "slate", 0.35, 0.15, 1.1, 1.45, 0.95, roofKind === "flat" ? 0xb5523b : roofColor, snow);
      win(0.9, 0.5, 1.6);
      // The bell tower and its spire over the door.
      out.push(B(0.7, 0.95, 1.2, 0.4, 0.75, 0.4, white));
      out.push(B(0.75, 1.3, 1.6, 0.3, 0.22, 0.01, 0x3a3028));
      out.push(B(0.82, 1.4, 1.58, 0.16, 0.12, 0.04, 0xd8b040));
      let y = 1.7;
      for (let k = 0; k < 4; k++) {
        const s = 0.46 * (1 - k / 4);
        out.push(B(0.9 - s / 2, y, 1.4 - s / 2, s, 0.18, s, k === 3 ? 0xd8b040 : 0x5a6270));
        y += 0.18;
      }
      break;
    }
    case C.WATCHTOWER: {
      for (const [px, pz] of [
        [0.55, 0.55],
        [1.3, 0.55],
        [0.55, 1.3],
        [1.3, 1.3],
      ])
        out.push(B(px, 0, pz, 0.12, 2.6, 0.12, 0x6a4a2e));
      out.push(B(0.55, 0.9, 0.6, 0.85, 0.05, 0.05, 0x7a5a38));
      out.push(B(0.55, 1.7, 1.33, 0.85, 0.05, 0.05, 0x7a5a38));
      out.push(B(0.4, 2.3, 0.4, 1.2, 0.08, 1.2, 0x8a6a44));
      out.push(B(0.4, 2.38, 0.4, 1.2, 0.25, 0.05, 0x7a5a38));
      out.push(B(0.4, 2.38, 1.55, 1.2, 0.25, 0.05, 0x7a5a38));
      roof(out, rng, roofKind === "flat" ? "thatch" : roofKind, 0.4, 0.4, 1.2, 1.2, 2.85, roofColor, snow);
      for (const [px, pz] of [
        [0.4, 0.4],
        [1.55, 0.4],
        [0.4, 1.55],
        [1.55, 1.55],
      ])
        out.push(B(px, 2.38, pz, 0.05, 0.48, 0.05, 0x6a4a2e));
      windows.push({ x: 1, y: 2.5, z: 1.62, axis: 0 });
      break;
    }
    case C.LUMBERYARD: {
      // An open shed, piles of logs, a saw bench.
      for (const [px, pz] of [
        [0.15, 0.15],
        [1.1, 0.15],
        [0.15, 0.95],
        [1.1, 0.95],
      ])
        out.push(B(px, 0, pz, 0.08, 0.7, 0.08, 0x6a4a2e));
      out.push(B(0.08, 0.7, 0.08, 1.2, 0.08, 1.05, vary(rng, 0x7a5a38)));
      out.push(B(0.25, 0.78, 0.2, 0.9, 0.08, 0.8, snow ? 0xf4f8fb : vary(rng, 0x6a4a2e)));
      for (let k = 0; k < 3; k++) out.push(B(1.35, k * 0.14, 0.3 + (k % 2) * 0.07, 0.55, 0.14, 1.2 - k * 0.14, vary(rng, 0x8a6040, 0.1)));
      out.push(B(0.35, 0, 1.35, 0.9, 0.12, 0.12, 0x9a7048));
      out.push(B(0.35, 0.12, 1.37, 0.9, 0.1, 0.08, 0x8a6040));
      out.push(B(0.3, 0, 0.35, 0.7, 0.3, 0.45, vary(rng, 0xa07850)));
      break;
    }
    case C.FISHERHUT: {
      for (const [px, pz] of [
        [0.3, 0.3],
        [1.2, 0.3],
        [0.3, 1.0],
        [1.2, 1.0],
      ])
        out.push(B(px, 0, pz, 0.07, 0.3, 0.07, 0x5b3d24));
      out.push(B(0.25, 0.28, 0.25, 1.1, 0.06, 0.9, 0x8a6a44));
      out.push(B(0.35, 0.34, 0.32, 0.9, 0.55, 0.7, vary(rng, 0x9a8a6a)));
      roof(out, rng, "thatch", 0.35, 0.32, 0.9, 0.7, 0.89, vary(rng, 0xb8984e), snow);
      win(0.8, 0.6, 1.02);
      // Nets drying, a boat pulled up.
      out.push(B(1.55, 0, 0.3, 0.05, 0.7, 0.05, 0x6a4a2e));
      out.push(B(1.55, 0, 1.2, 0.05, 0.7, 0.05, 0x6a4a2e));
      out.push(B(1.56, 0.25, 0.33, 0.02, 0.4, 0.9, 0x8a8a6a));
      out.push(B(0.2, 0, 1.45, 1.3, 0.16, 0.4, 0x7a5232));
      out.push(B(0.3, 0.06, 1.52, 1.1, 0.1, 0.26, 0x5a3a22));
      break;
    }
  }
  return { boxes: out, windows, chimneys };
}

// A box turned a quarter turn `q` times about the block's middle (1, 1).
function turn(b: Box, q: number): Box {
  let { x, z, w, d } = b;
  for (let k = 0; k < q; k++) [x, z, w, d] = [2 - z - d, x, d, w];
  return { ...b, x, z, w, d };
}
function turnPoint(p: { x: number; z: number }, q: number): { x: number; z: number } {
  let { x, z } = p;
  for (let k = 0; k < q; k++) [x, z] = [2 - z, x];
  return { x, z };
}

function hash(i: number, seed: number): number {
  let h = Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(seed + 0x1b873593, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

export interface Lights {
  windows: { x: number; y: number; z: number; axis: 0 | 1 }[];
  chimneys: { x: number; y: number; z: number }[];
}

export class Buildings {
  private mesh: Mesh | null = null;
  private key = "";
  readonly lights: Lights = { windows: [], chimneys: [] };

  constructor(
    private scene: Scene,
    private material: Material,
  ) {}

  // Rebuilds the merged mesh when the set of buildings changed. Returns the
  // cells it drew, for the view to leave out of its per cell models.
  update(world: World): Set<number> {
    const drawn = new Set<number>();
    const blocks: { i: number; kind: number; s: Settlement | null }[] = [];
    const W = world.w;
    const isHouse = (i: number) => world.cover[i] === C.HOUSE;
    // Job buildings where their village put them; then houses, two by two.
    for (const s of world.settlements)
      for (const j of s.jobs ?? []) {
        const cells = [j.i, j.i + 1, j.i + W, j.i + W + 1];
        if (cells.every((c) => world.cover[c] === j.kind)) {
          blocks.push({ i: j.i, kind: j.kind, s });
          for (const c of cells) drawn.add(c);
        }
      }
    // 4.6: a building an item raised away from any village's list (w.building
    // in the wild) is drawn by the builder too, in the style of the nearest one.
    for (let i = 0; i < world.n - W - 1; i++) {
      const k = world.cover[i];
      if (k === C.HOUSE || !isBuilding(k) || drawn.has(i) || (i % W) + 1 >= W) continue;
      const cells = [i, i + 1, i + W, i + W + 1];
      if (!cells.every((c) => world.cover[c] === k && !drawn.has(c))) continue;
      blocks.push({ i, kind: k, s: nearest(world, i) });
      for (const c of cells) drawn.add(c);
    }
    for (let i = 0; i < world.n - W - 1; i++) {
      if (!isHouse(i) || drawn.has(i) || (i % W) + 1 >= W) continue;
      const cells = [i, i + 1, i + W, i + W + 1];
      if (!cells.every((c) => isHouse(c) && !drawn.has(c))) continue;
      blocks.push({ i, kind: C.HOUSE, s: nearest(world, i) });
      for (const c of cells) drawn.add(c);
    }
    let key = "";
    for (const b of blocks) {
      const patched = b.kind === C.HOUSE && [b.i, b.i + 1, b.i + W, b.i + W + 1].some((c) => world.patched.has(c));
      key += `${b.i}:${b.kind}:${patched ? 1 : 0}:${(b.s?.level ?? 0) >= 3 ? 1 : 0},`;
    }
    if (key === this.key) return drawn;
    this.key = key;
    const pos: number[] = [];
    const col: number[] = [];
    this.lights.windows = [];
    this.lights.chimneys = [];
    for (const b of blocks) {
      const x = b.i % W;
      const y = Math.floor(b.i / W);
      const cells = [b.i, b.i + 1, b.i + W, b.i + W + 1];
      const tops = cells.map((c) => columnTop(world, c));
      const base = Math.max(...tops);
      const low = Math.min(...tops);
      const style = b.s ? HOUSE_STYLES[b.s.style] : "timber";
      const seed = hash(b.i, world.seed);
      const patched = b.kind === C.HOUSE && cells.some((c) => world.patched.has(c));
      const shape = b.kind === C.HOUSE ? houseShape(seed, style, (b.s?.level ?? 0) >= 3, patched) : jobShape(seed, b.kind, style);
      // The door to the plaza.
      let q = 0;
      if (b.s) {
        const dx = b.s.x - (x + 1);
        const dy = b.s.y - (y + 1);
        q = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 0 : 2;
      }
      // The door is on +z: a turn of q quarters puts it on +x (1), -z (2), -x (3).
      const qq = [0, 3, 2, 1][q];
      const ox = x - world.w / 2;
      const oz = y - world.h / 2;
      const tint = 0.94 + ((seed >>> 8) % 13) / 100;
      const add = (box: Box, k = tint) => {
        const t = turn(box, qq);
        const c = box.color;
        const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
        const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
        const bl = Math.min(255, Math.round((c & 255) * k));
        pushBox(pos, col, { ...t, x: t.x + ox, y: t.y + base, z: t.z + oz, color: (r << 16) | (g << 8) | bl });
      };
      // Footing down to the lowest cell, so nothing floats on a slope.
      if (base - low > 0.05) add(B(0.05, low - base, 0.05, 1.9, base - low + 0.02, 1.9, 0x7a7068), 1);
      for (const box of shape.boxes) add(box);
      for (const wdw of shape.windows) {
        const p = turnPoint(wdw, qq);
        const axis = (qq % 2 === 1 ? 1 - wdw.axis : wdw.axis) as 0 | 1;
        this.lights.windows.push({ x: p.x + ox, y: wdw.y + base, z: p.z + oz, axis });
      }
      for (const ch of shape.chimneys) {
        const p = turnPoint(ch, qq);
        this.lights.chimneys.push({ x: p.x + x, y: ch.y, z: p.z + y });
      }
    }
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (pos.length) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
      g.computeBoundingSphere();
      this.mesh = new Mesh(g, this.material);
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
    }
    return drawn;
  }

  dispose(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
  }
}

function nearest(world: World, i: number): Settlement | null {
  const x = i % world.w;
  const y = Math.floor(i / world.w);
  let best: Settlement | null = null;
  let bestD = 40;
  for (const s of world.settlements) {
    const d = Math.abs(s.x - x) + Math.abs(s.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
