// Casts spell specs in the Spell Lab page with a headless browser and writes,
// for each spec, its frames as PNG and what it did to the world as JSON.
//
//   npx vite --port 5174 &          # serves lab/index.html
//   node scripts/spell-lab.mjs <out-dir> <spec.json>...
//
// A spec file may be a bare spec or an /api/spell response ({ name, spec }).
// Dev only; needs Playwright with a Chromium it can launch.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createRequire } from "node:module";

// require, not import: it also finds a Playwright installed globally (NODE_PATH).
const { chromium } = createRequire(import.meta.url)("playwright");

const [outDir, ...files] = process.argv.slice(2);
if (!outDir || !files.length) {
  console.error("usage: node scripts/spell-lab.mjs <out-dir> <spec.json>...");
  process.exit(1);
}
const url = process.env.LAB_URL ?? "http://localhost:5174/lab/";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (err) => console.error("page error:", err.message));
await page.goto(url);
await page.waitForFunction(() => window.labReady === true);

for (const file of files) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const spec = raw.spec ?? raw;
  const name = basename(file, ".json");
  const result = await page.evaluate(([s, o]) => window.runSpell(s, o), [spec, { maxScale: raw.maxScale, width: Number(process.env.LAB_WIDTH) || undefined, height: Number(process.env.LAB_HEIGHT) || undefined }]);
  const shots = result.frames.map((frame, i) => {
    const path = join(outDir, `${name}.${i}.png`);
    writeFileSync(path, Buffer.from(frame.png.split(",")[1], "base64"));
    return { t: frame.t, path };
  });
  delete result.frames;
  writeFileSync(join(outDir, `${name}.lab.json`), JSON.stringify({ name, ...result, shots }, null, 2));
  console.log(`${name}: release ${result.timing.releaseAt}s, end ${result.timing.castEnd}s, terrain ${JSON.stringify(result.terrainChange)}`);
}
await browser.close();
