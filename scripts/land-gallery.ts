// Dev only (4.4): every biome (rows) and shape (columns) seen from above, as
// raw RGB (W and H printed as JSON) to turn into a picture. 4.4.1: with
// MIXED=1, mixed islands of the given size, one per seed from the seed
// given, warmth and water going round.
//
//   npx esbuild scripts/land-gallery.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/land-gallery.mjs && node node_modules/.cache/land-gallery.mjs out.rgb [size] [seed]
import { writeFileSync } from "node:fs";
import { BIOMES, SHAPES, DEFAULT_LAND, LOOKS, biomeAt, resolveLand } from "../src/sim/land";
import { BUILTIN, C, F } from "../src/sim/materials";
import { generateWorld, type World } from "../src/sim/world";

const out = process.argv[2] ?? "land.rgb";
const size = Number(process.argv[3] ?? 152);
const seed = Number(process.argv[4] ?? 7);
const mixed = process.env.MIXED === "1";
const cols = mixed ? 4 : SHAPES.length;
const rows = mixed ? 3 : BIOMES.length;
const W = cols * (size + 4);
const H = rows * (size + 4);
const img = new Uint8Array(W * H * 3).fill(24);
const islands: { r: number; c: number; make: () => World }[] = [];
if (mixed)
  for (let k = 0; k < cols * rows; k++) {
    const s = seed + k;
    const choice = { warmth: [0.5, 0.3, 0.7][k % 3], water: [0.5, 0.75, 0.3, 0.5][k % 4], relief: 0.5, forest: 0.5 };
    islands.push({ r: Math.floor(k / cols), c: k % cols, make: () => generateWorld(size, size, s, resolveLand(choice, s, size)) });
  }
else
  BIOMES.forEach((biome, r) =>
    SHAPES.forEach((shape, c) => islands.push({ r, c, make: () => generateWorld(size, size, seed, { ...DEFAULT_LAND, biome, shape }) })),
  );
for (const { r, c, make } of islands) {
  {
    const w = make();
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        let col: number;
        if (w.fluid[i] !== F.NONE && w.depth[i] > 0.02) {
          const m = w.materials.get("fluid", w.fluid[i]);
          col = m.colors[0];
          if (w.fluid[i] === F.WATER) {
            const k = Math.min(1, w.depth[i] / 4);
            col = mix(0x5ab0e8, 0x163f7a, k);
          }
        } else if (w.cover[i] === C.TREE) col = 0x1f5a22;
        else if (w.cover[i] === C.HOUSE) col = 0xc0392b;
        else {
          const m = w.materials.get("ground", w.ground[i]);
          col =
            w.biomeMap && w.ground[i] < BUILTIN.ground.length ? (LOOKS[biomeAt(w, i)].palette[m.name] ?? BUILTIN.ground[w.ground[i]].colors)[0] : m.colors[0];
        }
        // Light from the north west.
        const l = x > 0 && y > 0 ? (w.height[i] - w.height[i - 1 - size]) * 0.12 : 0;
        const f = Math.max(0.55, Math.min(1.35, 1 + l));
        const o = ((r * (size + 4) + y + 2) * W + c * (size + 4) + x + 2) * 3;
        img[o] = Math.min(255, ((col >> 16) & 255) * f);
        img[o + 1] = Math.min(255, ((col >> 8) & 255) * f);
        img[o + 2] = Math.min(255, (col & 255) * f);
      }
  }
}
writeFileSync(out, img);
console.log(JSON.stringify({ W, H }));

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
