// Looks revamp, phase 0: one small frame each of a few items, to put next to the numbers of
// docs/measurements/looks-2026-11-13.md. Offline: casts each program (from the measure's cache) in the
// Spell Lab on its medium island, near a village, and saves a frame after a few seconds.
//
//   node scripts/look-frames.mjs /tmp/look-measure/cache docs/measurements/looks-2026-11-13 key1 key2 ...
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openLab } from "./lab-browser.mjs";

const [cache, outDir, ...keys] = process.argv.slice(2);
if (!cache || !outDir || !keys.length) {
  console.error("usage: node scripts/look-frames.mjs <cache-dir> <out-dir> <key>...");
  process.exit(1);
}
const key = (n) => n.trim().toLowerCase().replace(/\s+/g, " ");
const items = new Map();
for (const f of ["programs", "programs-creatures", "challenge-candidates"])
  for (const r of JSON.parse(readFileSync(join(cache, `${f}.json`), "utf8"))) if (r.code && !items.has(key(r.name))) items.set(key(r.name), r);
for (const r of JSON.parse(readFileSync(join(cache, "library.json"), "utf8")).spells) if (r.code && !items.has(key(r.name))) items.set(key(r.name), r);
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
mkdirSync(outDir, { recursive: true });
const lab = await openLab({ width: 420, height: 420 });
for (const k of keys) {
  const it = items.get(key(k));
  if (!it) {
    console.error(`no program for ${k}`);
    continue;
  }
  const r = await lab.cast(it.code, {
    tier: it.tier,
    kind: it.kind === "artifact" ? "artifact" : "spell",
    shots: [4],
    settle: 1,
    dist: 20,
    phi: 0.95,
    time: 40,
  });
  const png = r.frames[r.frames.length - 1].png.replace(/^data:image\/png;base64,/, "");
  writeFileSync(join(outDir, `${slug(k)}.png`), Buffer.from(png, "base64"));
  console.log(`${k}: ${png.length} base64 bytes, errors ${r.errors?.length ?? 0}`);
}
await lab.close();
