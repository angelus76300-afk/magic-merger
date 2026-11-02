// Dev only: CPU time per frame of the voxel view, part by part, in a headless
// browser (software WebGL, so only the JavaScript side is meaningful: GPU time
// is not measured). Same seeded island as the Spell Lab.
//
//   npx vite --port 5174 &
//   node scripts/prof-view.mjs
//
// Prints p50 / p95 / max in ms for each part of VoxelView.render.
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const url = process.env.LAB_URL ?? "http://localhost:5174/lab/";

const SCENES = {
  idle: "const spell = { *cast(w) { yield 0.1; } };",
  "burning forest": `const spell = { *cast(w) {
    w.tree(w.x, w.y, { style: "giant", height: 60 });
    for (let k = 0; k < 16; k++) w.tree(w.x + Math.cos(k) * 14, w.y + Math.sin(k) * 14, { style: k % 2 ? "oak" : "pine", height: 18 });
    yield 4;
    w.ignite(w.x, w.y, 30, 1);
  } };`,
  // 3.5: three hundred creatures of every body, walking near the camera. The
  // same program runs on code from before 3.5 (unknown kinds become beasts,
  // bodies are ignored), so the two can be compared.
  crowd: `const spell = {
    creatures: [
      { name: "imp", base: "beast", color: "#aa3333", features: ["horns", "wings", "spear"] },
      { name: "eye", base: "spirit", color: "#ffffff", model: [[-3, 3, -3, 6, 6, 6, "#f2efe6"], [-2, 4, 3, 4, 4, 1, "#3a7fd0", "glow"], [-3, 0, -1, 1, 3, 1, "#c05050", "leg"], [2, 0, -1, 1, 3, 1, "#c05050", "leg2"]] },
      { name: "drake", base: "beast", color: "#b03a2e", body: "dragon", radius: 1.2 },
    ],
    *cast(w) {
      const kinds = ["villager", "villager", "villager", "beast", "spirit", "golem", "deer", "rabbit", "wolf", "boar", "bear", "bird", "imp", "eye", "drake"];
      for (let k = 0; k < 300; k++) w.spawn(kinds[k % kinds.length], w.x + w.rand(-14, 14), w.y + w.rand(-14, 14));
      yield 10;
    } };`,
  darkness: `const spell = { *cast(w) {
    w.darken(0.85, 14);
    for (let k = 0; k < 6; k++) w.light(w.x + k * 4 - 10, w.y, 6, "#ffd166", 12);
    w.ignite(w.x + 12, w.y + 8, 6, 1);
    yield 12;
  } };`,
};

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 2 });
page.on("pageerror", (err) => console.error("page error:", err.message));
await page.goto(url);
await page.waitForFunction(() => window.labReady === true);
const only = process.argv[2];
for (const [name, code] of Object.entries(SCENES)) {
  if (only && !name.includes(only)) continue;
  const r = await page.evaluate(([c]) => window.runSpell(c, { tier: "legendary", shots: [12], settle: 0, profile: true }), [code]);
  console.log(
    `${name}: ${r.draw.calls} draw calls, ${Math.round(r.draw.triangles / 1000)}k triangles${r.errors.length ? ", errors: " + r.errors.join("; ") : ""}`,
  );
  for (const [part, [p50, p95, max]] of Object.entries(r.timing)) console.log(`  ${part.padEnd(10)} ${p50} / ${p95} / ${max}`);
}
await browser.close();
