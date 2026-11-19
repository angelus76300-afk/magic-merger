// Turned parts drawn whole (19 November): what the change does to looks, as numbers. Prints JSON
// of mesh hashes (the ten references, whole and without their turned parts, the 20 stored looks of plain boxes) and cubes and triangles
// of the looks with thin turned parts. Run it with main's shapes.ts and with this branch's, and compare:
//   npx esbuild scripts/turned-parts-proof.ts --bundle --platform=node --format=esm --outfile=/tmp/tpp.mjs && node /tmp/tpp.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { REFERENCES } from "../shared/looks";
import { readProp, type Prop } from "../src/sim/props";
import { GRAPHICS } from "../src/sim/voxel/graphics";
import { LOOK_VOXEL, LOOK_VOXEL_OFF, propLocal, voxelize } from "../src/sim/voxel/shapes";
import { lookMeshes, type Look } from "./looks-golden";
import { drawnBy } from "./looks-refs-test";

const hash = (a: number[]) =>
  createHash("sha256")
    .update(Buffer.from(new Float32Array(a).buffer))
    .digest("hex")
    .slice(0, 16);
const turnedThin = (p: Prop) => p.boxes.filter((b) => (b.rx || b.ry || b.rz) && Math.min(b.w, b.d, b.h) < 0.22).length;

function measure(name: string, parts: unknown[]) {
  const p = readProp({ key: "k", name, x: 0, y: 0, turn: 0, boxes: parts });
  if (!p) return { name, error: "no prop" };
  const row: Record<string, unknown> = { name, parts: p.boxes.length, turned: p.boxes.filter((b) => b.rx || b.ry || b.rz).length, turnedThin: turnedThin(p) };
  for (const cubes of [true, false]) {
    GRAPHICS.cubes = cubes;
    const m = propLocal(p);
    const tag = cubes ? "on" : "off";
    row[`cubes_${tag}`] = voxelize(p.boxes, cubes ? LOOK_VOXEL : LOOK_VOXEL_OFF).count;
    row[`tris_${tag}`] = m.tris;
    row[`hash_${tag}`] = hash(m.lit.pos) + hash(m.lit.col) + hash(m.glow.pos) + hash(m.glow.col);
  }
  GRAPHICS.cubes = true;
  return row;
}

// A spell file's models, drawn by a stand-in world.
function spellParts(code: string): unknown[] {
  const spell = new Function(`${code}; return spell;`)() as { cast: (w: unknown) => Iterator<unknown> };
  const parts: unknown[] = [];
  const w = { x: 0, y: 0, model: (_x: number, _y: number, ps: unknown[]) => parts.push(...ps), artifact: () => {} };
  const it = spell.cast(w);
  for (let i = 0; i < 100 && !it.next().done; i++);
  return parts;
}

const out: Record<string, unknown> = {};
out.references = REFERENCES.map((r) => measure(r.name, drawnBy(r.code).calls[0]?.parts ?? []));
// The same references with their turned parts left out: what is not turned draws byte for byte.
const unturned = (parts: unknown[]) =>
  parts.filter((q) => !(Array.isArray(q) ? q : []).some((f) => f && typeof f === "object" && ("rx" in f || "ry" in f || "rz" in f)));
out.referencesUnturned = REFERENCES.map((r) => measure(r.name, unturned(drawnBy(r.code).calls[0]?.parts ?? [])));
out.stored = lookMeshes(JSON.parse(readFileSync("scripts/fixtures/looks-20.json", "utf8")) as Look[]);
out.heavy = [measure("turned slabs ring (stand-in)", spellParts(readFileSync("scripts/fixtures/turned-slabs-ring.spell.txt", "utf8")))];
console.log(JSON.stringify(out, null, 1));
