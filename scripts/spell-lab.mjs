// Casts spell programs in the Spell Lab page with a headless browser and
// writes, for each one, its frames as PNG and what it did to the world as JSON.
//
//   node scripts/spell-lab.mjs <out-dir> <spell.js | spell.json>...
//
// Vite serves lab/index.html; it is started when nothing answers at LAB_URL.
//
// A .js file is a bare program (tier from LAB_TIER, default major). A .json
// file is a saved /api/spell response ({ name, tier, spec: { code } }).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { openLab } from "./lab-browser.mjs";

const [outDir, ...files] = process.argv.slice(2);
if (!outDir || !files.length) {
  console.error("usage: node scripts/spell-lab.mjs <out-dir> <spell.js | spell.json>...");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const lab = await openLab();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const json = extname(file) === ".json" ? JSON.parse(text) : null;
  const code = json ? (json.program?.code ?? json.spec?.code ?? json.code) : text;
  const tier = json?.tier ?? process.env.LAB_TIER ?? "major";
  const shots = process.env.LAB_SHOTS ? process.env.LAB_SHOTS.split(",").map(Number) : undefined;
  const name = basename(file, extname(file));
  const result = await lab.cast(code, {
    tier,
    shots,
    size: process.env.LAB_SIZE,
    dist: Number(process.env.LAB_DIST) || undefined,
    time: process.env.LAB_TIME ? Number(process.env.LAB_TIME) : undefined,
  });
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
await lab.close();
