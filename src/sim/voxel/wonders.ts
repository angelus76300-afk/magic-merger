import { BufferAttribute, BufferGeometry, Group, Mesh, type Material, type Scene } from "three";
import { Rng } from "../noise";
import { biomeAt } from "../land";
import { daylight } from "../daylight";
import type { World } from "../world";
import { floatAt, ruinHouses, vents, type Wonder } from "../wonders";
import { pushBox, type Box } from "./models";
import { columnTop, surfaceY } from "./terrain";

// The wonders above the land (4.4.5 part B), each built from its own seed:
// an arch, a world tree, giant bones, a sunken temple... Box models like the
// rest of the island, one mesh per wonder and a second for what shines (an
// ore vein, a fairy ring's caps, a temple's runes), so an island's wonders
// cost two to eight draw calls and nothing of the voxels spells share.
// Coordinates: x and z in cells from the wonder's center, y up from its
// ground, in the view's units (a cell across, two land heights up).

const B = (x: number, y: number, z: number, w: number, h: number, d: number, color: number): Box => ({ x, y, z, w, h, d, color });

function vary(rng: Rng, color: number, amount = 0.08): number {
  const k = 1 + (rng.next() - 0.5) * 2 * amount;
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((color >> s) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng.next() * list.length)];

interface Model {
  lit: Box[];
  glow: Box[];
  // Shown only while the dragon sleeps.
  dragon?: Box[];
  // Turned to face (ax, ay).
  turned?: boolean;
}

// A ball of boxes, ragged: crowns, rocks, gold piles.
function lump(out: Box[], rng: Rng, cx: number, cy: number, cz: number, r: number, squash: number, colors: number[], parts = 5): void {
  for (let k = 0; k < parts; k++) {
    const s = r * (0.6 + rng.next() * 0.5);
    const h = s * squash * (0.7 + rng.next() * 0.5);
    const ox = (rng.next() - 0.5) * r * 0.9;
    const oz = (rng.next() - 0.5) * r * 0.9;
    const oy = (rng.next() - 0.3) * r * squash * 0.5;
    out.push(B(cx + ox - s / 2, cy + oy, cz + oz - s / 2, s, h, s, vary(rng, pick(rng, colors))));
  }
}

function tree(out: Box[], rng: Rng, height: number, girth: number, crown: number, leaves: number[], bark: number): void {
  out.push(B(-girth / 2, -0.3, -girth / 2, girth, height + 0.3, girth, vary(rng, bark, 0.05)));
  // Roots flaring out.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rng.next() * 0.6;
    const l = girth * (0.9 + rng.next() * 0.5);
    out.push(B(Math.cos(a) * l * 0.6 - girth * 0.2, -0.2, Math.sin(a) * l * 0.6 - girth * 0.2, girth * 0.4, girth * 0.45, girth * 0.4, vary(rng, bark)));
  }
  // Branches, then the crown in tiers.
  for (let k = 0; k < 3; k++) {
    const a = rng.next() * Math.PI * 2;
    const y = height * (0.55 + k * 0.12);
    const l = crown * 0.45;
    out.push(B(Math.cos(a) * l * 0.5 - l * 0.25, y, Math.sin(a) * l * 0.5 - girth * 0.15, l * 0.5, girth * 0.3, girth * 0.3, vary(rng, bark)));
  }
  const tiers = 3;
  for (let k = 0; k < tiers; k++) {
    const f = 1 - k / (tiers + 0.5);
    const s = crown * f;
    lump(out, rng, 0, height * 0.72 + k * crown * 0.28, 0, s, 0.45, leaves, crown > 8 ? 9 : 4);
  }
}

const MAKERS: Record<string, (rng: Rng, w: Wonder, world: World) => Model> = {
  waterfall: (rng, w, world) => {
    const lit: Box[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rng.next() * 0.4;
      const r = 2.2 + rng.next() * 0.6;
      const s = 0.5 + rng.next() * 0.6;
      lit.push(B(Math.cos(a) * r - s / 2, -0.3, Math.sin(a) * r - s / 2, s, s * 0.7, s, vary(rng, pick(rng, [0x5f6a5a, 0x6a7468, 0x4f8a3a]))));
    }
    // The falling water: a curtain from the lip down to the pool, and foam.
    const W = world.w;
    const foot = columnTop(world, Math.round(w.y) * W + Math.round(w.x));
    const lip = columnTop(world, Math.round(w.ay) * W + Math.round(w.ax)) + 0.3;
    const dx = w.ax - w.x;
    const dz = w.ay - w.y;
    const steps = 10;
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const y = (lip - foot) * f;
      lit.push(
        B(
          dx * f - 0.55,
          y - 0.2,
          dz * f - 0.55,
          1.1,
          Math.max(0.5, (lip - foot) / steps + 0.25),
          1.1,
          vary(rng, pick(rng, [0xdff2ff, 0xbfe3f5, 0x9fd4f5, 0xeef8ff]), 0.03),
        ),
      );
    }
    lit.push(B(-1.1, -0.15, -1.1, 2.2, 0.2, 2.2, 0xeef6fb));
    return { lit, glow: [] };
  },
  "hot spring": (rng) => {
    const lit: Box[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const s = 0.45 + rng.next() * 0.35;
      lit.push(
        B(
          Math.cos(a) * 2.6 - s / 2,
          -0.25,
          Math.sin(a) * 2.6 - s / 2,
          s,
          0.3 + rng.next() * 0.3,
          s,
          vary(rng, pick(rng, [0xd8c8a8, 0xc8b890, 0xe0a860, 0xb8a888])),
        ),
      );
    }
    return { lit, glow: [B(-1.5, -0.32, -1.5, 3, 0.06, 3, 0x6ad8e8)] };
  },
  "cave mouth": (rng) => {
    // A mound of rock against the hill (toward +x), a dark mouth on its
    // open side, boulders before it.
    const lit: Box[] = [];
    const rock = [0x6f6f78, 0x5e5e66, 0x7a7a82, 0x666670];
    for (let k = 0; k < 4; k++) {
      const s = 4.2 - k * 0.9;
      lit.push(B(-1.2 + k * 0.55, -0.4 + k * 0.85, -s / 2 + (rng.next() - 0.5) * 0.3, s, 1, s, vary(rng, pick(rng, rock))));
    }
    lit.push(B(-1.25, -0.4, -0.8, 0.3, 1.9, 1.6, 0x0e0c0b));
    for (let k = 0; k < 7; k++) {
      const a = (k / 6) * Math.PI;
      lit.push(B(-1.45, Math.sin(a) * 1.9 - 0.4, -Math.cos(a) * 1.05 - 0.28, 0.5, 0.56, 0.56, vary(rng, pick(rng, rock))));
    }
    for (let k = 0; k < 4; k++) lit.push(B(rng.range(-3.2, -1.8), -0.3, rng.range(-1.6, 1.4), 0.55, 0.4, 0.5, vary(rng, pick(rng, rock))));
    // Moss and a hanging vine over the mouth.
    lit.push(B(-1.5, 1.6, -1.2, 0.6, 0.14, 2.4, vary(rng, 0x4f8a3a)));
    lit.push(B(-1.5, 0.6, 0.5, 0.1, 1.1, 0.1, 0x3f7f34));
    return { lit, glow: [], turned: true };
  },
  "stone arch": (rng, w, world) => {
    const biome = biomeAt(world, Math.round(w.y) * world.w + Math.round(w.x));
    const colors = biome === "mesa" ? [0xb8603a, 0xa8542f, 0xc8704a] : biome === "desert" ? [0xd8b880, 0xc8a870, 0xe0c490] : [0x8e8e94, 0x9a9aa0, 0x82828a];
    const lit: Box[] = [];
    const span = 3.5;
    const H = 4.5 + rng.next() * 2;
    const T = 1.1 + rng.next() * 0.4;
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI;
      const x = -Math.cos(a) * span;
      const y = Math.sin(a) * H;
      const thick = T * (k === 0 || k === 16 ? 1.5 : 1 + 0.3 * Math.abs(Math.cos(a)));
      lit.push(
        B(
          x - thick / 2,
          y - (k === 0 || k === 16 ? y + 0.4 : 0.1),
          -T / 2 + (rng.next() - 0.5) * 0.15,
          thick,
          k === 0 || k === 16 ? H * 0.35 + 0.4 : thick * 0.9,
          T,
          vary(rng, pick(rng, colors)),
        ),
      );
    }
    // Stones fallen at its feet.
    for (let k = 0; k < 4; k++) lit.push(B(rng.range(-4, 4), -0.2, rng.range(-1.8, 1.8), 0.5, 0.35, 0.45, vary(rng, pick(rng, colors))));
    return { lit, glow: [], turned: true };
  },
  "lone tree": (rng) => {
    const lit: Box[] = [];
    const leaves = pick(rng, [
      [0x3f8a2e, 0x4a9a35, 0x357a27],
      [0xe8b41e, 0xd4a017, 0xf1c40f],
      [0xf2a7c3, 0xf7c4d6, 0xe891b4],
      [0xc0392b, 0xd4442f, 0xa93226],
      [0x2f6a3a, 0x3a7a44, 0x2a5a32],
    ]);
    tree(lit, rng, 4 + rng.next() * 1.5, 0.8, 4.2 + rng.next() * 1.2, leaves, 0x5b3a1e);
    return { lit, glow: [] };
  },
  ruins: (rng, w) => {
    const lit: Box[] = [];
    const stone = [0x9a948a, 0x8a847a, 0xa8a296];
    for (const h of ruinHouses(w)) {
      const x0 = h.x - w.x;
      const z0 = h.y - w.y;
      for (let k = 0; k < 6; k++) {
        if (rng.next() < 0.35) continue;
        const side = k % 4;
        const t = rng.next() * 1.7;
        const height = 0.3 + rng.next() * rng.next() * 1.6;
        const [x, z, ww, dd] =
          side === 0
            ? [x0 + t, z0, 0.35, 0.25]
            : side === 1
              ? [x0 + t, z0 + 1.75, 0.35, 0.25]
              : side === 2
                ? [x0, z0 + t, 0.25, 0.35]
                : [x0 + 1.75, z0 + t, 0.25, 0.35];
        lit.push(B(x, -0.2, z, ww, height + 0.2, dd, vary(rng, pick(rng, stone))));
      }
    }
    // A fallen column and an archway still standing by the square.
    lit.push(B(-1.6, -0.1, 0.8, 2.6, 0.35, 0.35, vary(rng, 0xb0aaa0)));
    lit.push(B(-0.9, -0.2, -1.4, 0.35, 2, 0.35, 0xa8a296));
    lit.push(B(0.7, -0.2, -1.4, 0.35, 1.4, 0.35, 0xa8a296));
    lit.push(B(-0.9, 1.8, -1.45, 1.5, 0.3, 0.45, 0x9a948a));
    return { lit, glow: [] };
  },
  "sinkhole lake": (rng) => {
    const lit: Box[] = [];
    for (let k = 0; k < 10; k++) {
      const a = rng.next() * Math.PI * 2;
      const s = 0.4 + rng.next() * 0.5;
      lit.push(B(Math.cos(a) * 5 - s / 2, -0.3, Math.sin(a) * 5 - s / 2, s, s * 0.6, s, vary(rng, pick(rng, [0x6f6f78, 0x4f8a3a, 0x5e5e66]))));
    }
    // Vines down the wall.
    for (let k = 0; k < 6; k++) {
      const a = rng.next() * Math.PI * 2;
      lit.push(B(Math.cos(a) * 4.3, -2.6, Math.sin(a) * 4.3, 0.12, 2.5, 0.12, vary(rng, 0x3f7f34)));
    }
    return { lit, glow: [] };
  },
  geysers: (rng, w) => {
    const lit: Box[] = [];
    for (const v of vents(w)) {
      const x = v.x - w.x;
      const z = v.y - w.y;
      for (let k = 0; k < 3; k++) {
        const s = 1.4 - k * 0.4;
        lit.push(B(x + 0.5 - s / 2, -0.2 + k * 0.12, z + 0.5 - s / 2, s, 0.18, s, vary(rng, pick(rng, [0xe8e0d0, 0xd8a060, 0xc88a48]))));
      }
      lit.push(B(x + 0.35, 0.15, z + 0.35, 0.3, 0.06, 0.3, 0x2a5a7a));
    }
    return { lit, glow: [] };
  },
  "sea stacks": (rng, w, world) => {
    // Nests and white tops on the tallest stacks.
    const lit: Box[] = [];
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const i = (w.y + dy) * world.w + w.x + dx;
        if (!world.inside(w.x + dx, w.y + dy) || world.height[i] < world.seaLevel + 4) continue;
        const top = columnTop(world, i) - columnTop(world, Math.round(w.y) * world.w + Math.round(w.x));
        if (rng.next() < 0.5) lit.push(B(dx + 0.1, top, dy + 0.1, 0.8, 0.06, 0.8, 0xf0f0ea));
        if (rng.next() < 0.25) lit.push(B(dx + 0.3, top + 0.05, dy + 0.3, 0.4, 0.15, 0.4, 0x8a6a44));
      }
    return { lit, glow: [] };
  },
  crater: (rng) => {
    const lit: Box[] = [];
    const glow: Box[] = [];
    // The stone that fell, veined with light.
    lump(lit, rng, 0, -0.6, 0, 1.6, 0.8, [0x2a2626, 0x3a3434, 0x302a2a], 6);
    for (let k = 0; k < 5; k++)
      glow.push(B(rng.range(-0.8, 0.6), rng.range(-0.3, 0.6), rng.range(-0.8, 0.6), 0.2, 0.2, 0.2, pick(rng, [0x7fe8d8, 0x9af0c8, 0x5fd0e0])));
    return { lit, glow };
  },
  "floating rock": (rng) => {
    const lit: Box[] = [];
    const glow: Box[] = [];
    const R = 3 + rng.next() * 1.2;
    // A grassy top over a cone of rock, a tree, roots and moss hanging.
    lit.push(B(-R, 0, -R * 0.9, R * 2, 0.5, R * 1.8, vary(rng, 0x5d9c3a)));
    for (let k = 1; k <= 4; k++) {
      const s = R * (1 - k / 5);
      lit.push(B(-s + (rng.next() - 0.5) * 0.4, -k * 0.9, -s * 0.9, s * 2, 0.95, s * 1.8, vary(rng, pick(rng, [0x7a6a5a, 0x6a5a4a, 0x8a7a6a]))));
    }
    for (let k = 0; k < 7; k++)
      lit.push(B(rng.range(-R, R) * 0.7, -rng.range(1, 3.2), rng.range(-R, R) * 0.6, 0.12, rng.range(0.8, 2), 0.12, vary(rng, 0x4f7a3a)));
    const sub: Box[] = [];
    tree(sub, rng, 1.6, 0.35, 1.8, [0x4a9a35, 0x3f8a2e], 0x5b3a1e);
    for (const b of sub) lit.push({ ...b, x: b.x + R * 0.3, y: b.y + 0.5, z: b.z - R * 0.2 });
    glow.push(B(-0.4, -4.6, -0.4, 0.8, 0.8, 0.8, 0x9af0ff));
    return { lit, glow };
  },
  bones: (rng, w, world) => {
    const lit: Box[] = [];
    const bone = [0xe8e0cc, 0xdcd2bc, 0xf0e8d8];
    // A spine along +x, ribs rising from it, the skull at its end.
    for (let k = -5; k <= 3; k++) lit.push(B(k, -0.3, -0.3, 0.9, 0.5, 0.6, vary(rng, pick(rng, bone), 0.04)));
    for (let k = -4; k <= 2; k++) {
      const h = 2.2 + (1 - Math.abs(k + 1) / 4) * 1.6;
      for (const s of [-1, 1]) {
        lit.push(B(k + 0.2, -0.3, s * 1.4 - 0.15, 0.3, h * 0.6, 0.3, vary(rng, pick(rng, bone), 0.04)));
        lit.push(B(k + 0.2, h * 0.55 - 0.3, s * 0.9 - 0.15, 0.3, 0.3, 0.6 * s > 0 ? 0.6 : 0.6, vary(rng, pick(rng, bone), 0.04)));
      }
    }
    lit.push(B(3.4, -0.4, -1.1, 2.2, 1.6, 2.2, vary(rng, 0xe8e0cc, 0.03)));
    lit.push(B(5.4, -0.4, -0.8, 1.2, 0.9, 1.6, vary(rng, 0xdcd2bc, 0.03)));
    lit.push(B(4.2, 0.4, -1.12, 0.5, 0.45, 0.02, 0x2a2420));
    lit.push(B(4.2, 0.4, 1.1, 0.5, 0.45, 0.02, 0x2a2420));
    // Horns curling back.
    lit.push(B(3.6, 1.2, -1.4, 0.3, 1.2, 0.3, 0xc8bca0));
    lit.push(B(3.6, 1.2, 1.1, 0.3, 1.2, 0.3, 0xc8bca0));
    void world;
    return { lit, glow: [], turned: true };
  },
  "frozen waterfall": (rng, w, world) => {
    // A curtain of ice down the drop, icicles hanging off its lip.
    const lit: Box[] = [];
    const glow: Box[] = [];
    const W = world.w;
    const foot = columnTop(world, Math.round(w.y) * W + Math.round(w.x));
    const lip = columnTop(world, Math.round(w.ay) * W + Math.round(w.ax)) + 0.4;
    const dx = w.ax - w.x;
    const dz = w.ay - w.y;
    const ice = [0xcfeaf8, 0xbfe3f5, 0xe6f6ff, 0xa8d8f0];
    for (let k = 0; k <= 10; k++) {
      const f = k / 10;
      const y = (lip - foot) * f;
      for (let s = -1; s <= 1; s++)
        lit.push(
          B(
            dx * f - 0.45 + s * 0.8,
            y - 0.3,
            dz * f - 0.45 - s * 0.3,
            0.8,
            Math.max(0.6, (lip - foot) / 10 + 0.4) + rng.next() * 0.3,
            0.8,
            vary(rng, pick(rng, ice), 0.04),
          ),
        );
    }
    for (let k = 0; k < 10; k++) {
      const h = 0.8 + rng.next() * 1.6;
      lit.push(B(dx + rng.range(-1.6, 1.6), lip - h, dz + rng.range(-1.4, 1.4), 0.25, h, 0.25, vary(rng, pick(rng, ice), 0.04)));
    }
    for (let k = 0; k < 6; k++) lit.push(B(rng.range(-2, 1.6), -0.3, rng.range(-2, 1.6), 0.4, rng.range(0.6, 1.6), 0.4, vary(rng, pick(rng, ice))));
    glow.push(B(-1.2, -0.25, -1.2, 2.4, 0.06, 2.4, 0xd8f4ff));
    return { lit, glow };
  },
  "fairy ring": (rng) => {
    const glow: Box[] = [];
    const lit: Box[] = [];
    const n = 14 + Math.floor(rng.next() * 5);
    const cap = pick(rng, [0x9a7aff, 0x46f0a8, 0xff8ad8, 0x5fb8ff]);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const r = 3 + (rng.next() - 0.5) * 0.4;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = 0.2 + rng.next() * 0.25;
      lit.push(B(x - 0.05, -0.1, z - 0.05, 0.1, h + 0.1, 0.1, 0xefe6d2));
      glow.push(B(x - 0.16, h, z - 0.16, 0.32, 0.1, 0.32, vary(rng, cap, 0.1)));
    }
    // Motes of light over the ring.
    for (let k = 0; k < 8; k++) glow.push(B(rng.range(-2.5, 2.5), rng.range(0.8, 2.2), rng.range(-2.5, 2.5), 0.08, 0.08, 0.08, 0xfff8c8));
    return { lit, glow };
  },
  "world tree": (rng) => {
    const lit: Box[] = [];
    const glow: Box[] = [];
    const leaves = pick(rng, [
      [0x3f8a2e, 0x4a9a35, 0x357a27, 0x56a63d],
      [0x2f7a5a, 0x3a8a6a, 0x2a6a4a],
      [0x8ac63f, 0x7ab535, 0x9ed24f],
    ]);
    tree(lit, rng, 16 + rng.next() * 5, 2.6, 13 + rng.next() * 4, leaves, 0x6a4424);
    // Great roots over the land.
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rng.next() * 0.4;
      for (let s = 1; s <= 3; s++) lit.push(B(Math.cos(a) * s * 1.2 - 0.4, -0.3, Math.sin(a) * s * 1.2 - 0.4, 0.8, 0.9 - s * 0.2, 0.8, vary(rng, 0x5b3a1e)));
    }
    // Fruit of light in the crown.
    for (let k = 0; k < 12; k++)
      glow.push(B(rng.range(-6, 6), rng.range(12, 22), rng.range(-6, 6), 0.35, 0.35, 0.35, pick(rng, [0xfff2a0, 0xbff0ff, 0xffd0f0])));
    return { lit, glow };
  },
  hoard: (rng) => {
    const glow: Box[] = [];
    const lit: Box[] = [];
    const gold = [0xf2c94c, 0xe8b830, 0xffd866];
    for (let k = 0; k < 7; k++) lump(glow, rng, rng.range(-3, 3), -0.3, rng.range(-3, 3), 1.1 + rng.next() * 0.6, 0.45, gold, 3);
    // Chests and a crown on the pile.
    for (let k = 0; k < 3; k++) {
      const x = rng.range(-3, 3);
      const z = rng.range(-3, 3);
      lit.push(B(x, -0.2, z, 0.7, 0.45, 0.5, 0x6a4424));
      lit.push(B(x - 0.02, 0.25, z - 0.02, 0.74, 0.12, 0.54, 0x8a6a34));
    }
    // The dragon, curled up asleep on its gold.
    const dragon: Box[] = [];
    const red = pick(rng, [0x8a2a1c, 0x2a6a3a, 0x2a3a7a, 0x4a2a5a]);
    const belly = 0xe0a030;
    dragon.push(B(-1.6, 0, -1, 3.2, 1.3, 2, red));
    dragon.push(B(-1.4, 0, -0.9, 2.8, 0.5, 1.8, belly));
    // Neck and head resting on its forepaws.
    dragon.push(B(1.4, 0.2, -1.6, 1, 0.8, 0.9, red));
    dragon.push(B(2.2, 0, -2, 1.3, 0.7, 0.9, red));
    dragon.push(B(3.4, 0.1, -1.9, 0.5, 0.45, 0.7, vary(rng, red, 0.1)));
    dragon.push(B(2.4, 0.7, -2.1, 0.2, 0.5, 0.2, 0xe8e0cc));
    dragon.push(B(2.4, 0.7, -1.4, 0.2, 0.5, 0.2, 0xe8e0cc));
    // Folded wings, a tail round the pile.
    dragon.push(B(-1.2, 1.3, -1.3, 2.4, 0.25, 1.1, vary(rng, red, 0.15)));
    dragon.push(B(-1.2, 1.3, 0.2, 2.4, 0.25, 1.1, vary(rng, red, 0.15)));
    for (let k = 0; k < 6; k++) {
      const a = Math.PI * 0.5 + k * 0.45;
      dragon.push(B(Math.cos(a) * 2.4 - 0.3, 0, Math.sin(a) * 2.2 - 0.3, 0.6, 0.45 - k * 0.04, 0.6, red));
    }
    return { lit, glow, dragon };
  },
  "sunken temple": (rng, w, world) => {
    const lit: Box[] = [];
    const glow: Box[] = [];
    const stone = [0xc8c0a8, 0xb8b098, 0xd0c8b0];
    // From the seabed: steps, columns (some broken off above the water), a
    // fallen pediment half out of the sea.
    const i = Math.round(w.y) * world.w + Math.round(w.x);
    const water = surfaceY(world, i) - columnTop(world, i);
    for (let k = 0; k < 3; k++) lit.push(B(-3.5 + k * 0.5, k * 0.3 - 0.2, -2.5 + k * 0.5, 7 - k, 0.3, 5 - k, vary(rng, pick(rng, stone))));
    for (let k = 0; k < 8; k++) {
      const x = -2.6 + (k % 4) * 1.7;
      const z = k < 4 ? -1.8 : 1.4;
      const h = water + (rng.next() < 0.3 ? -0.3 : rng.range(0.6, 2.2));
      lit.push(B(x, 0.7, z, 0.45, h, 0.45, vary(rng, pick(rng, stone))));
    }
    lit.push(B(-3, water + 1.5, -2.1, 6.2, 0.4, 1, vary(rng, 0xb8b098)));
    lit.push(B(-1.6, water + 1.9, -2, 3.4, 0.4, 0.8, vary(rng, 0xc8c0a8)));
    lit.push(B(1.4, water - 0.2, 0.4, 2.4, 0.5, 0.9, vary(rng, 0xb0a890)));
    for (let k = 0; k < 10; k++) glow.push(B(rng.range(-3, 3), 0.95, rng.range(-2.2, 2.2), 0.3, 0.04, 0.3, pick(rng, [0x5fe0ff, 0x7fffd8, 0x9ab8ff])));
    glow.push(B(-0.5, water + 1.6, -1.15, 1, 0.3, 0.04, 0x7fffd8));
    return { lit, glow };
  },
};

function geometryOf(boxes: Box[]): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  for (const b of boxes) pushBox(pos, col, b);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

interface Built {
  w: Wonder;
  kind: string;
  group: Group;
  glow: Mesh | null;
  dragon: Mesh | null;
}

// Glowing parts that only show at night: a fairy ring, runes, fruit of light.
const NIGHT_ONLY = new Set(["fairy ring", "sunken temple", "world tree", "crater"]);

export class WonderModels {
  private built: Built[] = [];

  constructor(
    private scene: Scene,
    private lit: Material,
    private shine: Material,
  ) {}

  update(world: World, time: number): void {
    // Rebuilt when the list changes (a wonder destroyed, a fall thawed).
    if (this.built.length !== world.wonders.length || this.built.some((b, k) => b.w !== world.wonders[k] || b.kind !== b.w.kind)) this.rebuild(world);
    const night = daylight(time).night;
    for (const b of this.built) {
      if (b.w.kind === "floating rock") {
        const p = floatAt(world, b.w, time);
        const ground = columnTop(world, Math.round(p.y) * world.w + Math.round(p.x));
        b.group.position.set(p.x + 0.5 - world.w / 2, Math.max(ground, 4) + p.z, p.y + 0.5 - world.h / 2);
        b.group.rotation.y = time * 0.05;
      }
      if (b.glow) b.glow.visible = !NIGHT_ONLY.has(b.w.kind) || night > 0.2;
      if (b.dragon) b.dragon.visible = b.w.state === 0;
      // Steam off a hot spring, spray at a waterfall's foot.
      const k = b.w.kind;
      if ((k === "hot spring" || k === "waterfall") && Math.random() < 0.35)
        world.particles.add({
          x: b.w.x + 0.5 + (Math.random() - 0.5) * 2.5,
          y: b.w.y + 0.5 + (Math.random() - 0.5) * 2.5,
          z: 0.3,
          vz: k === "hot spring" ? 0.9 : 1.6,
          vx: world.wind.x * 0.4 + (Math.random() - 0.5),
          vy: world.wind.y * 0.4 + (Math.random() - 0.5),
          life: k === "hot spring" ? 2.6 : 1.2,
          color: 0xf2f6f8,
          size: k === "hot spring" ? 1.5 : 1.1,
          drag: 0.5,
          gravity: k === "hot spring" ? -0.25 : 0.6,
        });
    }
  }

  private rebuild(world: World): void {
    this.dispose();
    for (const w of world.wonders) {
      const make = MAKERS[w.kind];
      if (!make) continue;
      const model = make(new Rng(w.seed + 77), w, world);
      const group = new Group();
      const i = Math.round(w.y) * world.w + Math.round(w.x);
      group.position.set(w.x + 0.5 - world.w / 2, columnTop(world, i), w.y + 0.5 - world.h / 2);
      if (model.turned) group.rotation.y = Math.atan2(-w.ay, w.ax || 1e-6);
      let glow: Mesh | null = null;
      let dragon: Mesh | null = null;
      if (model.lit.length) group.add(new Mesh(geometryOf(model.lit), this.lit));
      if (model.glow.length) group.add((glow = new Mesh(geometryOf(model.glow), this.shine)));
      if (model.dragon?.length) group.add((dragon = new Mesh(geometryOf(model.dragon), this.lit)));
      for (const m of group.children) m.frustumCulled = false;
      this.scene.add(group);
      this.built.push({ w, kind: w.kind, group, glow, dragon });
    }
  }

  // How many meshes the wonders draw, for the HUD.
  meshes(): number {
    return this.built.reduce((n, b) => n + b.group.children.filter((m) => m.visible).length, 0);
  }

  dispose(): void {
    for (const b of this.built) {
      this.scene.remove(b.group);
      for (const m of b.group.children) (m as Mesh).geometry.dispose();
    }
    this.built = [];
  }
}
