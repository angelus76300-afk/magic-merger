import { Rng } from "../noise";
import { TREE_STYLES, type TreeStyle } from "../ecology";
import type { Box } from "./models";

// The island's plants, rocks and village extras drawn as small box models
// (4.4.5). Each tree style comes in VARIANTS shapes drawn from its own seed
// (one: each more costs a draw call per style, and two or three lifted a
// large island's calls from about 45 to 80):
// height, lean, how its crown sits and its colors, from the palettes of the
// structure kit (structures.ts) that spells grow trees with. On top of that
// every tree is scaled, leaned and tinted by its cell in the view, so no two
// trees and no two forests repeat. Every model is one instanced draw call;
// models stay under ten boxes so a forest costs what it did.

export const VARIANTS = 1;

const B = (x: number, y: number, z: number, w: number, h: number, d: number, color: number): Box => ({ x, y, z, w, h, d, color });

// A color a little lighter or darker, and a little warmer or cooler.
function vary(rng: Rng, color: number, amount = 0.1): number {
  const k = 1 + (rng.next() - 0.5) * 2 * amount;
  const warm = (rng.next() - 0.5) * amount * 0.6;
  const ch = (s: number, f: number) => Math.max(0, Math.min(255, Math.round(((color >> s) & 255) * f)));
  return (ch(16, k * (1 + warm)) << 16) | (ch(8, k) << 8) | ch(0, k * (1 - warm));
}

const pick = (rng: Rng, list: number[]) => list[Math.floor(rng.next() * list.length)];

// A trunk: one box, set a little off the middle the way the tree leans
// (the view leans the whole tree too).
function trunk(out: Box[], rng: Rng, height: number, width: number, color: number, lean: number, from = 0): { x: number; z: number; top: number } {
  const a = rng.next() * Math.PI * 2;
  const x = 0.5 + Math.cos(a) * lean * 0.5;
  const z = 0.5 + Math.sin(a) * lean * 0.5;
  out.push(B(x - width / 2, from, z - width / 2, width, height + 0.02, width, vary(rng, color, 0.06)));
  return { x: x + Math.cos(a) * lean * 0.5, z: z + Math.sin(a) * lean * 0.5, top: from + height };
}

// A crown of leaves: a few boxes around a point, wide at the bottom, and under
// it a narrower, darker layer: from a creature's eyes (2026-11-12) a crown was
// one flat slab; this gives it a shaded, layered underside, as foliage has.
function crown(out: Box[], rng: Rng, cx: number, cz: number, y: number, width: number, height: number, leaves: number[], parts = 2): void {
  const under = width * 0.72;
  const shade = vary(rng, pick(rng, leaves), 0.05);
  const dark = ((((shade >> 16) & 255) * 0.62) << 16) | ((((shade >> 8) & 255) * 0.62) << 8) | ((shade & 255) * 0.62);
  out.push(B(cx - under / 2, y - 0.16, cz - under / 2, under, 0.18, under, Math.round(dark)));
  for (let k = 0; k < parts; k++) {
    const f = k / parts;
    const wk = width * (1 - f * 0.45) * (0.9 + rng.next() * 0.2);
    const ox = (rng.next() - 0.5) * width * 0.2;
    const oz = (rng.next() - 0.5) * width * 0.2;
    const hk = (height / parts) * (1.2 + rng.next() * 0.3);
    out.push(
      B(cx - wk / 2 + ox, y + (height / parts) * k * 0.95, cz - wk / 2 + oz, wk, hk, wk * (0.85 + rng.next() * 0.3), vary(rng, pick(rng, leaves), 0.08)),
    );
  }
}

const OAK = [0x3f8a2e, 0x4a9a35, 0x357a27, 0x56a63d];
const BIRCH_LEAVES = [0x8cc63f, 0x9ed24f, 0x7ab535];
const PINE = [0x1f5a32, 0x256a3a, 0x2b7044];
const BARK = 0x5b3a1e;

type Maker = (rng: Rng, v: number) => Box[];

// Each style about as many boxes as the tree it replaces (3 to 7), so a
// forest costs the triangles it did.
const MAKERS: Record<Exclude<TreeStyle, "">, Maker> = {
  oak: (rng) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 0.55 + rng.next() * 0.2, 0.18 + rng.next() * 0.06, BARK, rng.next() * 0.12);
    crown(out, rng, t.x, t.z, t.top - 0.1, 0.85 + rng.next() * 0.15, 0.75 + rng.next() * 0.25, OAK, 2);
    return out;
  },
  pine: (rng) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 0.4 + rng.next() * 0.15, 0.14 + rng.next() * 0.04, 0x4f3219, rng.next() * 0.06);
    const H = 1.0 + rng.next() * 0.45;
    for (let k = 0; k < 3; k++) {
      const wk = (0.82 + rng.next() * 0.08) * (1 - (k / 3) * 0.7);
      out.push(B(t.x - wk / 2, t.top - 0.1 + (H / 3) * k * 0.92, t.z - wk / 2, wk, (H / 3) * 1.15, wk, vary(rng, pick(rng, PINE), 0.06)));
    }
    return out;
  },
  birch: (rng) => {
    const out: Box[] = [];
    const h = 0.8 + rng.next() * 0.3;
    const t = trunk(out, rng, h, 0.11, 0xe8e4da, rng.next() * 0.1);
    crown(out, rng, t.x, t.z, t.top - 0.25, 0.5 + rng.next() * 0.12, 0.7 + rng.next() * 0.2, BIRCH_LEAVES, 2);
    return out;
  },
  willow: (rng) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 0.7 + rng.next() * 0.15, 0.22, 0x4e3a26, rng.next() * 0.1);
    const w = 0.9 + rng.next() * 0.1;
    const leaf = [0x5f8a3a, 0x6a9442, 0x648e40, 0x7fae3c];
    out.push(B(t.x - w / 2, t.top, t.z - w / 2, w, 0.32 + rng.next() * 0.1, w, vary(rng, pick(rng, leaf))));
    // Strands hanging from the crown's rim, on three sides.
    const drop = 0.45 + rng.next() * 0.2;
    out.push(B(t.x - w / 2 - 0.03, t.top - drop, t.z - w / 2 + 0.05, 0.13, drop + 0.05, w - 0.1, vary(rng, pick(rng, leaf))));
    out.push(B(t.x + w / 2 - 0.1, t.top - drop * 0.9, t.z - w / 2 + 0.07, 0.13, drop * 0.9 + 0.05, w - 0.14, vary(rng, pick(rng, leaf))));
    out.push(B(t.x - w / 2 + 0.09, t.top - drop * 0.8, t.z + w / 2 - 0.1, w - 0.18, drop * 0.8 + 0.05, 0.13, vary(rng, pick(rng, leaf))));
    return out;
  },
  palm: (rng) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 1.0 + rng.next() * 0.35, 0.14, 0x8a6a44, 0.18 + rng.next() * 0.16);
    const leaf = [0x3f8a36, 0x4a9a3c, 0x377a30];
    const span = 0.85 + rng.next() * 0.25;
    out.push(B(t.x - span / 2, t.top - 0.04, t.z - 0.13, span, 0.09, 0.26, vary(rng, pick(rng, leaf))));
    out.push(B(t.x - 0.12, t.top - 0.02, t.z - span / 2, 0.24, 0.09, span, vary(rng, pick(rng, leaf))));
    out.push(B(t.x - 0.18, t.top + 0.03, t.z - 0.18, 0.36, 0.12, 0.36, vary(rng, pick(rng, leaf))));
    return out;
  },
  dead: (rng) => {
    const out: Box[] = [];
    const color = pick(rng, [0x5a5048, 0x4a423c, 0x6a5e54]);
    const t = trunk(out, rng, 0.8 + rng.next() * 0.35, 0.15, color, rng.next() * 0.15);
    for (let k = 0; k < 2; k++) {
      const y = t.top * (0.5 + k * 0.22);
      const len = 0.25 + rng.next() * 0.15;
      if (k) out.push(B(t.x - 0.03, y, t.z - len, 0.06, 0.06, len, vary(rng, color)));
      else out.push(B(t.x - len, y, t.z - 0.03, len, 0.06, 0.06, vary(rng, color)));
      // A twig rising at its end.
      out.push(B(t.x - (k ? 0.025 : len), y + 0.04, t.z - (k ? len : 0.025), 0.05, 0.18 + rng.next() * 0.1, 0.05, vary(rng, color)));
    }
    return out;
  },
  mushroom: (rng) => {
    const out: Box[] = [];
    const h = 0.6 + rng.next() * 0.35;
    out.push(B(0.4, 0, 0.4, 0.2, h, 0.2, 0xefe6d2));
    const w = 0.85 + rng.next() * 0.25;
    const cap = pick(rng, [0xd8352a, 0xc42a20, 0xb8642a, 0x8a5a3a]);
    out.push(B(0.5 - w / 2, h - 0.04, 0.5 - w / 2, w, 0.18, w, vary(rng, cap)));
    out.push(B(0.5 - w * 0.33, h + 0.13, 0.5 - w * 0.33, w * 0.66, 0.13, w * 0.66, vary(rng, cap)));
    out.push(B(0.5 - w * 0.12, h + 0.25, 0.5 - w * 0.12, w * 0.24, 0.05, w * 0.24, 0xf6f0e6));
    return out;
  },
  snowpine: (rng) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 0.38 + rng.next() * 0.12, 0.15, 0x5b3d24, rng.next() * 0.05);
    const H = 1.05 + rng.next() * 0.4;
    for (let k = 0; k < 3; k++) {
      const wk = 0.8 * (1 - (k / 3) * 0.55);
      const y = t.top - 0.08 + (H / 3) * k * 0.95;
      out.push(B(t.x - wk / 2, y, t.z - wk / 2, wk, (H / 3) * 1.05, wk, vary(rng, pick(rng, [0x2a5a40, 0x306848, 0x387452]), 0.06)));
      out.push(B(t.x - wk / 2 + 0.02, y + (H / 3) * 1.05, t.z - wk / 2 + 0.02, wk - 0.04, 0.06, wk - 0.04, 0xf4f8fb));
    }
    return out;
  },
  jungle: (rng) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 1.1 + rng.next() * 0.4, 0.24, 0x5e4026, rng.next() * 0.1);
    const leaf = [0x2f7d2a, 0x3a8f32, 0x2a7026, 0x358a2e];
    out.push(B(t.x - 0.58, t.top - 0.12, t.z - 0.58, 1.16, 0.42, 1.16, vary(rng, pick(rng, leaf))));
    out.push(B(t.x - 0.4, t.top + 0.28, t.z - 0.4, 0.8, 0.32, 0.8, vary(rng, pick(rng, leaf))));
    return out;
  },
  juniper: (rng) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 0.3 + rng.next() * 0.12, 0.16, 0x6b4a2b, 0.08 + rng.next() * 0.12);
    crown(out, rng, t.x, t.z, t.top - 0.06, 0.62 + rng.next() * 0.18, 0.55 + rng.next() * 0.25, [0x4f6a3a, 0x5a7842, 0x46603a], 2);
    return out;
  },
  cherry: (rng) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 0.5 + rng.next() * 0.2, 0.16, 0x4a2e22, 0.08 + rng.next() * 0.12);
    crown(out, rng, t.x, t.z, t.top - 0.08, 0.9 + rng.next() * 0.15, 0.6 + rng.next() * 0.2, [0xf2a7c3, 0xf7c4d6, 0xe891b4, 0xfad4e2], 2);
    return out;
  },
  autumn: (rng, v) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 0.55 + rng.next() * 0.2, 0.18, BARK, rng.next() * 0.1);
    const sets = [
      [0xc0392b, 0xd4442f, 0xa93226],
      [0xe67e22, 0xd35400, 0xf0922e],
      [0xe8b41e, 0xf1c40f, 0xd4a017],
    ];
    // Each variant leans to one color; with one variant, the crown mixes them.
    const leaves = VARIANTS > 1 ? [...sets[v % 3], sets[(v + 1) % 3][0]] : sets.flat();
    crown(out, rng, t.x, t.z, t.top - 0.1, 0.85 + rng.next() * 0.15, 0.75 + rng.next() * 0.2, leaves, 2);
    return out;
  },
  bamboo: (rng) => {
    const out: Box[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + rng.next() * 0.5;
      const r = 0.12 + rng.next() * 0.22;
      const x = 0.5 + Math.cos(a) * r - 0.04;
      const z = 0.5 + Math.sin(a) * r - 0.04;
      const h = 1.3 + rng.next() * 0.8;
      out.push(B(x, 0, z, 0.075, h, 0.075, vary(rng, pick(rng, [0x7aa83a, 0x8ab842, 0x6a9a32]), 0.06)));
      if (k < 2) out.push(B(x - 0.12, h - 0.25, z - 0.12, 0.3, 0.16, 0.3, vary(rng, pick(rng, [0x5f9a2e, 0x6faa36]))));
    }
    return out;
  },
  mangrove: (rng) => {
    const out: Box[] = [];
    // Stilt roots, the trunk above them.
    for (const [x, z] of [
      [0.22, 0.24],
      [0.7, 0.3],
      [0.42, 0.7],
    ])
      out.push(B(x, 0, z, 0.07, 0.36 + rng.next() * 0.08, 0.07, 0x5a4632));
    const t = trunk(out, rng, 0.45 + rng.next() * 0.15, 0.17, 0x5a4632, rng.next() * 0.06, 0.3);
    crown(out, rng, t.x, t.z, t.top - 0.08, 1.0 + rng.next() * 0.1, 0.5 + rng.next() * 0.15, [0x2f6a2a, 0x377a30, 0x2a6125], 1);
    return out;
  },
  glowcap: (rng) => {
    const out: Box[] = [];
    const h = 0.7 + rng.next() * 0.4;
    out.push(B(0.41, 0, 0.41, 0.18, h, 0.18, 0xcfe8f0));
    const w = 0.8 + rng.next() * 0.3;
    const cap = pick(rng, [0x3fe0d0, 0x5fb8ff, 0x9a7aff, 0x46f0a8]);
    out.push(B(0.5 - w / 2, h - 0.05, 0.5 - w / 2, w, 0.16, w, vary(rng, cap, 0.05)));
    out.push(B(0.5 - w * 0.3, h + 0.1, 0.5 - w * 0.3, w * 0.6, 0.12, w * 0.6, vary(rng, cap, 0.05)));
    return out;
  },
  cypress: (rng) => {
    const out: Box[] = [];
    // A flared foot standing in the water, a tall narrow crown.
    out.push(B(0.32, 0, 0.32, 0.36, 0.2, 0.36, 0x5a4a36));
    const t = trunk(out, rng, 0.7 + rng.next() * 0.3, 0.16, 0x5a4a36, rng.next() * 0.06, 0.18);
    const leaf = [0x4a6a3a, 0x526f3e, 0x5a7a44];
    out.push(B(t.x - 0.26, t.top - 0.3, t.z - 0.26, 0.52, 0.6 + rng.next() * 0.3, 0.52, vary(rng, pick(rng, leaf))));
    out.push(B(t.x - 0.18, t.top + 0.25, t.z - 0.18, 0.36, 0.35, 0.36, vary(rng, pick(rng, leaf))));
    return out;
  },
  acacia: (rng) => {
    const out: Box[] = [];
    const t = trunk(out, rng, 0.75 + rng.next() * 0.25, 0.12, 0x6a4a2e, 0.15 + rng.next() * 0.15);
    const w = 1.0 + rng.next() * 0.2;
    const leaf = [0x7a8a3a, 0x86964a, 0x6e7e34];
    out.push(B(t.x - w / 2, t.top - 0.02, t.z - w / 2, w, 0.13, w * 0.85, vary(rng, pick(rng, leaf))));
    out.push(B(t.x - w * 0.32, t.top + 0.1, t.z - w * 0.28, w * 0.64, 0.09, w * 0.56, vary(rng, pick(rng, leaf))));
    return out;
  },
};

// The undergrowth, rocks and village extras, one look each.
export const COVER_MODELS: Record<string, Box[]> = {
  reeds: [B(0.25, 0, 0.3, 0.05, 0.6, 0.05, 0x8a9a4a), B(0.55, 0, 0.55, 0.05, 0.72, 0.05, 0x96a452), B(0.54, 0.62, 0.54, 0.07, 0.14, 0.07, 0x6a4a2e)],
  fern: [B(0.1, 0.06, 0.42, 0.8, 0.05, 0.16, 0x3f7f34), B(0.42, 0.11, 0.1, 0.16, 0.05, 0.8, 0x47893a), B(0.2, 0.17, 0.2, 0.6, 0.05, 0.6, 0x4f9440)],
  berries: [
    B(0.18, 0, 0.18, 0.64, 0.42, 0.64, 0x3f7a33),
    B(0.25, 0.4, 0.25, 0.5, 0.12, 0.5, 0x46843a),
    B(0.14, 0.24, 0.3, 0.06, 0.06, 0.06, 0xc0233a),
    B(0.5, 0.5, 0.6, 0.06, 0.06, 0.06, 0x3a3a9a),
  ],
  log: [B(0.04, 0, 0.36, 0.92, 0.26, 0.28, 0x6a4a2e), B(0.03, 0.03, 0.39, 0.02, 0.2, 0.22, 0xb08a5a), B(0.2, 0.25, 0.4, 0.45, 0.04, 0.2, 0x4f7a3a)],
  fungi: [
    B(0.2, 0, 0.25, 0.06, 0.12, 0.06, 0xefe6d2),
    B(0.13, 0.11, 0.18, 0.2, 0.07, 0.2, 0xb8642a),
    B(0.6, 0, 0.5, 0.07, 0.17, 0.07, 0xefe6d2),
    B(0.52, 0.16, 0.42, 0.23, 0.08, 0.23, 0xd8352a),
  ],
  "fungi-glow": [
    B(0.2, 0, 0.25, 0.06, 0.14, 0.06, 0xcfe8f0),
    B(0.12, 0.13, 0.17, 0.22, 0.07, 0.22, 0x3fe0d0),
    B(0.6, 0, 0.5, 0.07, 0.2, 0.07, 0xcfe8f0),
    B(0.51, 0.19, 0.41, 0.25, 0.08, 0.25, 0x5fb8ff),
  ],
  cactus: [B(0.41, 0, 0.41, 0.18, 0.95, 0.18, 0x4f8a3a), B(0.24, 0.35, 0.44, 0.17, 0.4, 0.12, 0x5a9642), B(0.59, 0.5, 0.45, 0.16, 0.34, 0.1, 0x467e34)],
  scree: [B(0.08, 0, 0.12, 0.3, 0.1, 0.26, 0x8a8a8e), B(0.5, 0, 0.3, 0.24, 0.08, 0.22, 0x7e7e84), B(0.28, 0, 0.6, 0.34, 0.12, 0.28, 0x96969a)],
  pebbles: [B(0.15, 0, 0.2, 0.1, 0.05, 0.08, 0xb0aaa0), B(0.55, 0, 0.32, 0.08, 0.04, 0.1, 0x9a948a), B(0.35, 0, 0.62, 0.12, 0.06, 0.09, 0xc4beb4)],
  "standing stone": [
    B(0.32, 0, 0.38, 0.36, 1.25, 0.24, 0x8e8e94),
    B(0.36, 1.24, 0.41, 0.28, 0.12, 0.18, 0x9a9aa2),
    B(0.27, 0, 0.33, 0.46, 0.08, 0.34, 0x7f7f86),
  ],
  crystals: [
    B(0.4, 0, 0.42, 0.14, 0.75, 0.14, 0xb9a4ff),
    B(0.22, 0, 0.25, 0.1, 0.45, 0.1, 0xd3c6ff),
    B(0.62, 0, 0.58, 0.11, 0.55, 0.11, 0x9f88f5),
    B(0.28, 0, 0.64, 0.08, 0.32, 0.08, 0xe6deff),
  ],
  "petrified tree": [
    B(0.38, 0, 0.38, 0.24, 0.85, 0.24, 0x9a8a7a),
    B(0.2, 0.5, 0.44, 0.2, 0.08, 0.1, 0x8a7a6c),
    B(0.6, 0.62, 0.45, 0.18, 0.08, 0.09, 0xa89888),
    B(0.33, 0, 0.33, 0.34, 0.12, 0.34, 0x8a7a6c),
  ],
  well: [
    B(0.18, 0, 0.18, 0.64, 0.32, 0.12, 0x9a9aa0),
    B(0.18, 0, 0.7, 0.64, 0.32, 0.12, 0x8a8a90),
    B(0.18, 0, 0.3, 0.12, 0.32, 0.4, 0x8a8a90),
    B(0.7, 0, 0.3, 0.12, 0.32, 0.4, 0x9a9aa0),
    B(0.3, 0.02, 0.3, 0.4, 0.26, 0.4, 0x2f6fb0),
    B(0.2, 0.32, 0.46, 0.06, 0.5, 0.08, 0x6a4a2e),
    B(0.74, 0.32, 0.46, 0.06, 0.5, 0.08, 0x6a4a2e),
    B(0.12, 0.8, 0.3, 0.76, 0.1, 0.4, 0xa84a35),
  ],
  windmill: [
    B(0.2, 0, 0.2, 0.6, 1.4, 0.6, 0xe8dcc0),
    B(0.15, 1.38, 0.15, 0.7, 0.25, 0.7, 0xa84a35),
    B(0.25, 1.62, 0.25, 0.5, 0.18, 0.5, 0xb5523b),
    // Sails on the south face, crossed.
    B(0.46, 0.45, 0.8, 0.08, 1.5, 0.04, 0x8a6a44),
    B(-0.25, 1.16, 0.81, 1.5, 0.08, 0.04, 0x8a6a44),
    B(0.43, 1.12, 0.79, 0.14, 0.14, 0.06, 0x5b3d24),
    B(0.4, 0, 0.79, 0.2, 0.36, 0.02, 0x5b3d24),
  ],
  shrine: [
    B(0.15, 0, 0.15, 0.7, 0.16, 0.7, 0xc8c0b0),
    B(0.2, 0.15, 0.2, 0.08, 0.6, 0.08, 0xd8d0c0),
    B(0.72, 0.15, 0.2, 0.08, 0.6, 0.08, 0xd8d0c0),
    B(0.2, 0.15, 0.72, 0.08, 0.6, 0.08, 0xd8d0c0),
    B(0.72, 0.15, 0.72, 0.08, 0.6, 0.08, 0xd8d0c0),
    B(0.1, 0.74, 0.1, 0.8, 0.1, 0.8, 0xb5523b),
    B(0.25, 0.83, 0.25, 0.5, 0.12, 0.5, 0xc05d44),
    B(0.4, 0.15, 0.4, 0.2, 0.2, 0.2, 0xf2c94c),
  ],
  dock: [
    B(0, 0.22, 0.05, 1, 0.08, 0.9, 0x8a6a44),
    B(0.04, -0.6, 0.08, 0.1, 0.84, 0.1, 0x5b3d24),
    B(0.86, -0.6, 0.08, 0.1, 0.84, 0.1, 0x5b3d24),
    B(0.04, -0.6, 0.82, 0.1, 0.84, 0.1, 0x5b3d24),
    B(0.86, -0.6, 0.82, 0.1, 0.84, 0.1, 0x5b3d24),
  ],
  // 4.9 (roads.ts): a plank bridge on a road, its deck's top at 0.3, rails
  // either side and a post down into the water; planks run across the way.
  "bridge-x": [
    B(0, 0.22, 0.08, 0.32, 0.08, 0.84, 0x8a6a44),
    B(0.33, 0.22, 0.08, 0.33, 0.08, 0.84, 0x7a5c3a),
    B(0.67, 0.22, 0.08, 0.33, 0.08, 0.84, 0x94744c),
    B(0, 0.16, 0.06, 1, 0.07, 0.08, 0x5b3d24),
    B(0, 0.16, 0.86, 1, 0.07, 0.08, 0x5b3d24),
    B(0.44, 0.3, 0.07, 0.1, 0.38, 0.07, 0x6a4a2e),
    B(0.44, 0.3, 0.86, 0.1, 0.38, 0.07, 0x6a4a2e),
    B(0, 0.6, 0.075, 1, 0.05, 0.05, 0x8a6a44),
    B(0, 0.6, 0.865, 1, 0.05, 0.05, 0x8a6a44),
    B(0.45, -1.1, 0.15, 0.1, 1.28, 0.1, 0x4a3420),
    B(0.45, -1.1, 0.75, 0.1, 1.28, 0.1, 0x4a3420),
  ],
  "bridge-z": [
    B(0.08, 0.22, 0, 0.84, 0.08, 0.32, 0x8a6a44),
    B(0.08, 0.22, 0.33, 0.84, 0.08, 0.33, 0x7a5c3a),
    B(0.08, 0.22, 0.67, 0.84, 0.08, 0.33, 0x94744c),
    B(0.06, 0.16, 0, 0.08, 0.07, 1, 0x5b3d24),
    B(0.86, 0.16, 0, 0.08, 0.07, 1, 0x5b3d24),
    B(0.07, 0.3, 0.44, 0.07, 0.38, 0.1, 0x6a4a2e),
    B(0.86, 0.3, 0.44, 0.07, 0.38, 0.1, 0x6a4a2e),
    B(0.075, 0.6, 0, 0.05, 0.05, 1, 0x8a6a44),
    B(0.865, 0.6, 0, 0.05, 0.05, 1, 0x8a6a44),
    B(0.15, -1.1, 0.45, 0.1, 1.28, 0.1, 0x4a3420),
    B(0.75, -1.1, 0.45, 0.1, 1.28, 0.1, 0x4a3420),
  ],
  // A surveyor's peg with a red rag, where a road is marked out and not laid yet.
  "road-peg": [B(0.46, 0, 0.46, 0.08, 0.55, 0.08, 0xd8c8a0), B(0.5, 0.42, 0.46, 0.16, 0.1, 0.03, 0xc0402e)],
  "fence-x": [B(0.45, 0, 0.45, 0.1, 0.42, 0.1, 0x6a4a2e), B(0, 0.28, 0.47, 1, 0.06, 0.06, 0x8a6a44), B(0, 0.12, 0.475, 1, 0.05, 0.05, 0x8a6a44)],
  "fence-z": [B(0.45, 0, 0.45, 0.1, 0.42, 0.1, 0x6a4a2e), B(0.47, 0.28, 0, 0.06, 0.06, 1, 0x8a6a44), B(0.475, 0.12, 0, 0.05, 0.05, 1, 0x8a6a44)],
  // 4.4.5 part B: a crater's strange ore and a dragon's gold, both shining.
  "strange ore": [B(0.3, 0, 0.32, 0.22, 0.32, 0.2, 0x7fe8d8), B(0.55, 0, 0.5, 0.16, 0.22, 0.18, 0x9af0c8), B(0.2, 0, 0.6, 0.14, 0.16, 0.14, 0x5fd0e0)],
  "dragon hoard": [B(0.1, 0, 0.12, 0.8, 0.22, 0.76, 0xe8b830), B(0.25, 0.2, 0.25, 0.5, 0.16, 0.5, 0xf2c94c), B(0.4, 0.34, 0.38, 0.2, 0.1, 0.22, 0xffd866)],
  // Drawn in their own colors per instance: a tuft of grass in the ground's
  // color, flowers in their drift's.
  tuft: [B(0.34, 0, 0.38, 0.05, 0.24, 0.05, 0xdcdcdc), B(0.5, 0, 0.5, 0.05, 0.3, 0.05, 0xffffff)],
  bloom: [B(0.15, 0.04, 0.2, 0.14, 0.1, 0.14, 0xffffff), B(0.55, 0.06, 0.32, 0.14, 0.1, 0.14, 0xf0f0f0), B(0.32, 0.03, 0.62, 0.14, 0.1, 0.14, 0xe8e8e8)],
  lily: [B(0.15, 0, 0.2, 0.36, 0.03, 0.32, 0x3f8a36), B(0.55, 0, 0.5, 0.3, 0.03, 0.3, 0x4a9a3c)],
  spark: [B(-0.5, 0, -0.5, 1, 0.2, 1, 0xffffff)],
};

// Houses by village style (ecology.ts, HOUSE_STYLES).
export const HOUSE_MODELS: Record<string, Box[]> = {
  "house-adobe": [
    B(0.08, 0, 0.08, 0.84, 0.75, 0.84, 0xd8b07a),
    B(0.42, 0, 0.92, 0.18, 0.42, 0.02, 0x5b3d24),
    B(0.05, 0.74, 0.05, 0.9, 0.1, 0.9, 0xc89c64),
    B(0.03, 0.83, 0.03, 0.94, 0.08, 0.12, 0xc89c64),
    B(0.2, 0.55, 0.9, 0.12, 0.08, 0.04, 0x7a5a38),
  ],
  "house-stone": [
    B(0.08, 0, 0.08, 0.84, 0.7, 0.84, 0x9a9aa0),
    B(0.42, 0, 0.92, 0.18, 0.4, 0.02, 0x4a3a2e),
    B(0.0, 0.7, 0.0, 1, 0.22, 1, 0x5a6270),
    B(0.15, 0.92, 0.15, 0.7, 0.2, 0.7, 0x667080),
    B(0.32, 1.12, 0.32, 0.36, 0.14, 0.36, 0x525a68),
  ],
  "house-stilts": [
    B(0.1, 0, 0.1, 0.08, 0.4, 0.08, 0x5b3d24),
    B(0.82, 0, 0.1, 0.08, 0.4, 0.08, 0x5b3d24),
    B(0.1, 0, 0.82, 0.08, 0.4, 0.08, 0x5b3d24),
    B(0.82, 0, 0.82, 0.08, 0.4, 0.08, 0x5b3d24),
    B(0.06, 0.38, 0.06, 0.88, 0.08, 0.88, 0x8a6a44),
    B(0.12, 0.45, 0.12, 0.76, 0.55, 0.76, 0xb89a6a),
    B(0.0, 0.99, 0.0, 1, 0.2, 1, 0xc8a85a),
    B(0.2, 1.18, 0.2, 0.6, 0.2, 0.6, 0xd4b464),
  ],
  "house-snowroof": [
    B(0.08, 0, 0.08, 0.84, 0.7, 0.84, 0x9a7a5a),
    B(0.42, 0, 0.92, 0.18, 0.4, 0.02, 0x4a3420),
    B(0.0, 0.7, 0.0, 1, 0.22, 1, 0x6a4a3a),
    B(0.02, 0.91, 0.02, 0.96, 0.06, 0.96, 0xf4f8fb),
    B(0.15, 0.96, 0.15, 0.7, 0.2, 0.7, 0xeef3f8),
    B(0.32, 1.15, 0.32, 0.36, 0.12, 0.36, 0xffffff),
  ],
};

// Moves boxes apart where two faces would share a plane (they would
// flicker): the later box shrinks a hair on that side.
export function unplane(boxes: Box[]): Box[] {
  const lo = (b: Box, k: number) => [b.x, b.y, b.z][k];
  const size = (b: Box, k: number) => [b.w, b.h, b.d][k];
  const set = (b: Box, k: number, from: number, len: number) => {
    if (k === 0) [b.x, b.w] = [from, len];
    else if (k === 1) [b.y, b.h] = [from, len];
    else [b.z, b.d] = [from, len];
  };
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a];
        const Bx = boxes[b];
        for (let k = 0; k < 3; k++)
          for (const side of [0, 1]) {
            // Bottom faces are never drawn; opposite faces back to back are
            // culled. Two faces looking the same way in one plane flicker.
            if (k === 1 && side === 0) continue;
            const pa = lo(A, k) + side * size(A, k);
            const pb = lo(Bx, k) + side * size(Bx, k);
            if (Math.abs(pa - pb) > 0.003) continue;
            const [u, v] = [(k + 1) % 3, (k + 2) % 3];
            const ou = Math.min(lo(A, u) + size(A, u), lo(Bx, u) + size(Bx, u)) - Math.max(lo(A, u), lo(Bx, u));
            const ov = Math.min(lo(A, v) + size(A, v), lo(Bx, v) + size(Bx, v)) - Math.max(lo(A, v), lo(Bx, v));
            if (ou <= 1e-3 || ov <= 1e-3) continue;
            const s = size(Bx, k);
            if (side === 0) set(Bx, k, lo(Bx, k) + 0.008, s - 0.008);
            else set(Bx, k, lo(Bx, k), s - 0.008);
            moved = true;
          }
      }
    if (!moved) break;
  }
  return boxes;
}

const cache = new Map<string, Box[]>();

// The boxes of a tree style's variant.
export function treeModel(style: TreeStyle, variant: number): Box[] {
  const key = `${style}:${variant}`;
  let boxes = cache.get(key);
  if (!boxes) {
    const make = style ? MAKERS[style] : MAKERS.oak;
    let seed = 4451 + variant * 977;
    for (let k = 0; k < style.length; k++) seed = Math.imul(seed ^ style.charCodeAt(k), 0x01000193) >>> 0;
    boxes = unplane(make(new Rng(seed), variant).map((b) => ({ ...b })));
    cache.set(key, boxes);
  }
  return boxes;
}

// Every model this module draws, by the key the view uses: "tree:oak:1", "reeds"...
export function floraModels(): Record<string, Box[]> {
  const out: Record<string, Box[]> = {};
  for (const style of TREE_STYLES) if (style) for (let v = 0; v < VARIANTS; v++) out[`tree:${style}:${v}`] = treeModel(style, v);
  for (const [k, boxes] of Object.entries(COVER_MODELS)) out[k] = unplane(boxes.map((b) => ({ ...b })));
  for (const [k, boxes] of Object.entries(HOUSE_MODELS)) out[k] = unplane(boxes.map((b) => ({ ...b })));
  return out;
}

// Models that shine by themselves: never darkened at night.
export const GLOWING = new Set([
  ...Array.from({ length: VARIANTS }, (_, v) => `tree:glowcap:${v}`),
  "fungi-glow",
  "crystals",
  "spark",
  "strange ore",
  "dragon hoard",
]);
