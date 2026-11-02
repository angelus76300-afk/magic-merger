// Dev only (3.7): the creatures of every stored program, without rewriting
// one. Compiles each program in Node (nothing is cast), then reads every kind
// it defines the way the island will draw it: its body and where it came
// from (declared, its name, a model that moves, a still model fallen back to
// a plan, its base), its drawn height against a villager, and whether two of
// its parts share a face. Writes lab/stored-creatures.json for the bestiary.
//
//   npx wrangler d1 execute magic-merger --remote --json --command "SELECT s.key, e.name, e.tier, s.spec FROM spells s LEFT JOIN elements e ON e.key = s.key" > spells.json
//   npx esbuild scripts/stored-creatures.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/stored-creatures.mjs && node node_modules/.cache/stored-creatures.mjs spells.json
import { readFileSync, writeFileSync } from "node:fs";
import { modelOf, modelMoves, planOf } from "../src/sim/body";
import { BUILTIN_KINDS, KINDS } from "../src/sim/creatures";
import { Runtime } from "../src/sim/runtime";
import { generateWorld } from "../src/sim/world";
import { isTier } from "../shared/tiers";
import { sharedFaces } from "../src/sim/voxel/faces";
import { buildRig, drawScale, HOUSE_HEIGHT, villagerUnits } from "../src/sim/voxel/rigs";

interface Row {
  key: string;
  name: string | null;
  tier: string | null;
  spec: string;
}

const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rows: Row[] = Array.isArray(raw) && raw[0]?.results ? raw[0].results : raw;
const world = generateWorld(64, 64, 3);
const rt = new Runtime(world, () => {});
const V = villagerUnits();
const out: {
  spell: string;
  name: string;
  source: string;
  plan: string;
  features: string[];
  color: number;
  color2: number | null;
  radius: number;
  height: number;
  model: unknown;
  faces: number;
}[] = [];
const sources = new Map<string, number>();
let programs = 0;
let broken = 0;
for (const row of rows) {
  let code: unknown;
  try {
    code = JSON.parse(row.spec).code;
  } catch {
    code = undefined;
  }
  if (typeof code !== "string" || !code.includes("creatures")) continue;
  const before = new Set(KINDS.keys());
  let spell: { creatures?: unknown[] };
  try {
    spell = rt.compile({ key: row.key, name: row.name ?? row.key, tier: isTier(row.tier) ? row.tier : "major", code }).spell as { creatures?: unknown[] };
  } catch {
    broken++;
    continue;
  }
  programs++;
  const declared = new Map<string, Record<string, unknown>>();
  for (const c of Array.isArray(spell.creatures) ? spell.creatures : [])
    if (c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string")
      declared.set(((c as { name: string }).name as string).toLowerCase().slice(0, 30), c as Record<string, unknown>);
  for (const [name, k] of KINDS) {
    if (before.has(name) || BUILTIN_KINDS.has(name)) continue;
    const d = declared.get(name.split("#")[0]) ?? {};
    const model = modelOf(d.model);
    const source = model
      ? modelMoves(model)
        ? "a model that moves"
        : "a still model, fallen back to a plan"
      : planOf(d.body)
        ? "declared"
        : "its name or base";
    sources.set(source, (sources.get(source) ?? 0) + 1);
    const rig = buildRig(k.body, 0);
    const scale = drawScale(k.body, k.radius, rig);
    out.push({
      spell: row.name ?? row.key,
      name,
      source,
      plan: k.body.model ? "model" : k.body.plan,
      features: k.body.features,
      color: k.color,
      color2: k.body.color2,
      radius: k.radius,
      height: +((rig.height * scale) / V).toFixed(2),
      model: k.body.model,
      faces: sharedFaces(rig).length,
    });
  }
}
out.sort((a, b) => b.height - a.height);
console.log(`${programs} programs define creatures (${broken} do not compile), ${out.length} kinds`);
for (const [s, n] of sources) console.log(`  ${n} from ${s}`);
const tall = out.filter((c) => c.height > 1.3);
console.log(`${tall.length} drawn taller than 1.3 villagers (a house is ${(HOUSE_HEIGHT / V).toFixed(2)}):`);
for (const c of tall) console.log(`  ${c.name} (${c.spell}): ${c.plan}, radius ${c.radius}, ${c.height} villagers`);
console.log(`${out.filter((c) => c.faces).length} with two parts sharing a face`);
const path = process.env.OUT ?? "lab/stored-creatures.json";
writeFileSync(path, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${path}`);
