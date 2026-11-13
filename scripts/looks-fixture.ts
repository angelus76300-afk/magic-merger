// Looks revamp, phase 1: the 20 looks of scripts/fixtures/looks-20.json, the
// boxes 20 library items pass to w.model, as given (before readBox). The props
// test builds their meshes and compares them with the meshes main drew before
// the new shapes came in, so a stored look draws byte for byte as it did.
// Offline: reads the cache of scripts/look-measure.ts, writes nothing else.
//
//   npx esbuild scripts/looks-fixture.ts --bundle --platform=node --format=esm --outfile=/tmp/lf.mjs && node /tmp/lf.mjs /tmp/look-measure/cache
import { readFileSync, writeFileSync } from "node:fs";
import { elementKey } from "../shared/elements";
import { isTier, REFERENCE_SIDE } from "../shared/tiers";
import { resetArtifactIds } from "../src/sim/artifacts";
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime, SpellApi, type CastRequest } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld } from "../src/sim/world";

const CACHE = process.argv[2] ?? "/tmp/look-measure/cache";
const SEED = 11;
const WANT = 20;

let given: { boxes: unknown; turn: unknown; vary: unknown }[] | null = null;
const orig = SpellApi.prototype.model;
SpellApi.prototype.model = function (this: SpellApi, ...a: Parameters<typeof orig>) {
  if (given && Array.isArray(a[2])) given.push({ boxes: JSON.parse(JSON.stringify(a[2])), turn: a[3]?.turn ?? 0, vary: a[3]?.vary ?? null });
  return orig.apply(this, a);
} as typeof orig;

const read = <T>(f: string): T => JSON.parse(readFileSync(`${CACHE}/${f}`, "utf8")) as T;
const items = new Map<string, { name: string; kind: string; tier: string; code: string }>();
for (const f of ["programs", "programs-creatures", "challenge-candidates"])
  for (const r of read<{ name: string; kind?: string; tier: string; code: string }[]>(`${f}.json`))
    if (r.code && !items.has(elementKey(r.name))) items.set(elementKey(r.name), { name: r.name, kind: r.kind ?? "spell", tier: r.tier, code: r.code });
for (const r of read<{ spells: { name: string; tier: string; code: string }[] }>("library.json").spells)
  if (r.code && !items.has(elementKey(r.name))) items.set(elementKey(r.name), { name: r.name, kind: "spell", tier: r.tier, code: r.code });

const out: { name: string; turn: unknown; vary: unknown; boxes: unknown }[] = [];
for (const it of [...items.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  if (!it.code.includes("w.model")) continue;
  Math.random = seeded(SEED);
  resetCreatureIds();
  resetArtifactIds();
  const world = generateWorld(REFERENCE_SIDE, REFERENCE_SIDE, SEED);
  populate(world);
  const rt = new Runtime(world, () => {});
  let target = { x: world.w / 2, y: world.h / 2 };
  for (let i = 0; i < world.n; i++)
    if (world.cover[i] === C.HOUSE) {
      target = { x: (i % world.w) + 6, y: Math.floor(i / world.w) + 6 };
      break;
    }
  given = [];
  const req: CastRequest = {
    key: `fx:${elementKey(it.name)}`,
    name: it.name,
    tier: isTier(it.tier) ? it.tier : "major",
    code: it.code,
    kind: it.kind === "spell" ? "spell" : "artifact",
  };
  try {
    rt.cast(req, target.x, target.y);
    const life = seeded(SEED + 2);
    for (let s = 0; s < 5 / TICK; s++) stepHeadless(world, rt, { life });
  } catch {
    // A program that throws gives what it drew before.
  }
  const first = given.find((g) => Array.isArray(g.boxes) && (g.boxes as unknown[]).length > 0);
  given = null;
  if (first) out.push({ name: it.name, ...first });
}
// Twenty spread over the alphabet, so no one family of items fills the set.
const pick = out.length <= WANT ? out : Array.from({ length: WANT }, (_, k) => out[Math.floor((k * out.length) / WANT)]);
writeFileSync("scripts/fixtures/looks-20.json", JSON.stringify(pick) + "\n");
console.log(`${out.length} items draw a model; kept ${pick.length}`);
console.log(pick.map((o) => `${o.name}: ${(o.boxes as unknown[]).length}`).join("\n"));
