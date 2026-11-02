// Plays challenges in the Spell Lab page: with no spell, and with spells cast
// at given moments, to check that doing nothing loses and the right magic wins.
//
//   npx vite --port 5174 &
//   node scripts/scenario-lab.mjs <out-dir> <plan.json>
//
// plan.json: [{ "id": "wildfire", "seconds": 60, "shots": [5, 30],
//               "casts": [{ "t": 3, "x": 20, "y": 50, "tier": "grand", "file": "lab/spells/x.js" }] }]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const [outDir, planFile] = process.argv.slice(2);
if (!outDir || !planFile) {
  console.error("usage: node scripts/scenario-lab.mjs <out-dir> <plan.json>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const plan = JSON.parse(readFileSync(planFile, "utf8"));
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 540, height: 540 } });
page.on("pageerror", (err) => console.error("page error:", err.message));
await page.goto(process.env.LAB_URL ?? "http://localhost:5174/lab/");
await page.waitForFunction(() => window.labReady === true);
for (const [n, entry] of plan.entries()) {
  const casts = (entry.casts ?? []).map((c) => ({ ...c, code: readFileSync(c.file, "utf8") }));
  const r = await page.evaluate(([id, o]) => window.runScenario(id, o), [entry.id, { seconds: entry.seconds, shots: entry.shots, casts }]);
  const name = `${n}-${entry.id}${casts.length ? "-cast" : ""}`;
  r.frames.forEach((f, i) => writeFileSync(join(outDir, `${name}.${i}.png`), Buffer.from(f.png.split(",")[1], "base64")));
  delete r.frames;
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(r, null, 2));
  console.log(`${name}: ${r.status}${r.errors.length ? ` errors=${JSON.stringify(r.errors)}` : ""}`);
  for (const t of r.timeline) console.log(`   ${t.t}s ${t.status} ${t.text}`);
}
await browser.close();
