// Casts spell programs in the Spell Lab page with a headless browser and
// writes, for each one, its frames as PNG and what it did to the world as JSON.
//
//   npx vite --port 5174 &          # serves lab/index.html
//   node scripts/spell-lab.mjs <out-dir> <spell.js | spell.json>...
//
// A .js file is a bare program (tier from LAB_TIER, default major). A .json
// file is a saved /api/spell response ({ name, tier, spec: { code } }).
// Dev only; needs Playwright with a Chromium it can launch.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createRequire } from "node:module";

// require, not import: it also finds a Playwright installed globally (NODE_PATH).
const { chromium } = createRequire(import.meta.url)("playwright");

const [outDir, ...files] = process.argv.slice(2);
if (!outDir || !files.length) {
  console.error("usage: node scripts/spell-lab.mjs <out-dir> <spell.js | spell.json>...");
  process.exit(1);
}
const url = process.env.LAB_URL ?? "http://localhost:5174/lab/";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 540 } });
page.on("pageerror", (err) => console.error("page error:", err.message));
await page.goto(url);
await page.waitForFunction(() => window.labReady === true);

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const json = extname(file) === ".json" ? JSON.parse(text) : null;
  const code = json ? (json.spec?.code ?? json.code) : text;
  const tier = json?.tier ?? process.env.LAB_TIER ?? "major";
  const shots = process.env.LAB_SHOTS ? process.env.LAB_SHOTS.split(",").map(Number) : undefined;
  const name = basename(file, extname(file));
  const result = await page.evaluate(([c, o]) => window.runSpell(c, o), [code, { tier, shots, size: process.env.LAB_SIZE }]);
  const saved = result.frames.map((frame, i) => {
    const path = join(outDir, `${name}.${i}.png`);
    writeFileSync(path, Buffer.from(frame.png.split(",")[1], "base64"));
    return { t: frame.t, path };
  });
  delete result.frames;
  writeFileSync(join(outDir, `${name}.lab.json`), JSON.stringify({ name, ...result, shots: saved }, null, 2));
  const c = result.creatures;
  console.log(
    `${name} [${tier}]: ${result.ok ? "ok" : "FAILED"}${result.errors.length ? ` errors=${JSON.stringify(result.errors)}` : ""} worst tick ${result.worstTickMs}ms, dead ${c.after.dead - c.before.dead}, terrain ${JSON.stringify(result.terrain)}`,
  );
}
await browser.close();
