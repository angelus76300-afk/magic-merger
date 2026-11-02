// Visual check for faces drawn on top of each other (3.4): one Spell Lab cast
// per case, frames saved as PNG. Run it before and after a change to the
// renderer and compare with docs/visual-checks.
//
//   node scripts/overlap-lab.mjs <out-dir> [case...]
//
// Cases:
//   waterfall  a river spilling off the island's edge, over the cut side
//   shore      a pond against a higher bank: water walls next to land walls
//   blocks     spell blocks placed partly inside the land, a slope, trees and houses
//   decal      a magic circle and a drawing painted over water, banks and cliffs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openLab } from "./lab-browser.mjs";

const CASES = {
  // Nothing cast: the island's own river at its edge.
  waterfall: { aim: "edge", dist: 34, phi: 1.25, code: "const spell = { *cast(w) { const x = w.x, y = w.y; yield 0.1; } };" },
  shore: {
    aim: "shore",
    dist: 30,
    phi: 1.1,
    code: "const spell = { *cast(w) { const x = w.x, y = w.y; w.flood(x, y, 5, 'water', 4); yield 0.1; } };",
  },
  blocks: {
    aim: "village",
    dist: 30,
    phi: 1.0,
    code: `const spell = { *cast(w) { const x = w.x, y = w.y;
      // A wall through houses and trees, starting below the ground.
      w.box(x - 14, y - 2, -2, 28, 2, 4, ['#d8d0c0', '#c8bca8']);
      // A boulder half sunk in the land.
      w.sphere(x + 4, y + 7, 0, 3, ['#8a8a92', '#6f6f78']);
      // Single blocks one voxel into the ground, next to the cast point.
      for (let k = 0; k < 6; k++) w.voxel(x - 6 + k, y + 6, -1, '#e05a5a');
      yield 0.1;
    } };`,
  },
  decal: {
    aim: "shore",
    dist: 36,
    phi: 0.9,
    code: `const spell = { *cast(w) { const x = w.x, y = w.y;
      w.circle(x, y, 9, '#b48cff', '#f4d58d', 20);
      w.draw((ctx) => { ctx.strokeStyle = '#ffdf40'; ctx.lineWidth = 0.6; ctx.strokeRect(x - 7, y - 7, 14, 14); }, 20);
      yield 0.1;
    } };`,
  },
};

const [outDir, ...picked] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/overlap-lab.mjs <out-dir> [case...]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const lab = await openLab();
for (const name of picked.length ? picked : Object.keys(CASES)) {
  const c = CASES[name];
  for (const theta of [0.785, 3.93]) {
    const result = await lab.cast(c.code, { aim: c.aim, dist: c.dist, phi: c.phi, theta, shots: [1.5], settle: 0, time: 60 });
    const path = join(outDir, `${name}-${theta < 1 ? "a" : "b"}.png`);
    writeFileSync(path, Buffer.from(result.frames[0].png.split(",")[1], "base64"));
    console.log(`${name}: target ${JSON.stringify(result.target)} ${result.errors.length ? `errors ${result.errors}` : ""} -> ${path}`);
  }
}
await lab.close();
