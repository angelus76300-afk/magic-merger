// Taller peaks (5.2.5, land.ts uplift and volcano, LandOptions.peaks): islands made from now on
// get higher summits, steeper upper slopes and deeper craters; every island made before keeps its
// exact heights. The hashes below were taken with the generator of main before the change
// (14 November 2026): every challenge island, the golden save, and an island of every land and
// shape, made without `peaks`. The generated islands' hashes were taken again on 19 November,
// when rivers on new islands became curves (land.ts water()): every one of them has a river; the
// challenges and the golden save, which are islands players already have, kept theirs.
import { readFileSync } from "node:fs";
import { SCENARIOS } from "../src/sim/scenarios";
import { generateWorld } from "../src/sim/world";
import { BIOMES, SHAPES, DEFAULT_LAND, resolveLand, type LandOptions } from "../src/sim/land-options";
import { loadWorld, type SavedWorld } from "../src/sim/save";
import { C, F } from "../src/sim/materials";
import { watchIsland } from "./director-run";

type Check = (name: string, ok: boolean, detail?: string) => void;

const BEFORE: Record<string, string> = {
  "challenge wildfire": "1a24a804",
  "challenge lava": "4004c59c",
  "challenge river": "5d4d4701",
  "challenge drought": "5d215f12",
  "challenge flood": "27fb8fa7",
  "island temperate/coast": "58ee52e8",
  "island temperate/archipelago": "65ac7c26",
  "island temperate/plateau": "49181007",
  "island temperate/ridges": "c50b1354",
  "island temperate/lakes": "cf703c72",
  "island temperate/delta": "39f8e77d",
  "island desert/coast": "3f0d6db8",
  "island desert/archipelago": "42dcabb7",
  "island desert/plateau": "331b961a",
  "island desert/ridges": "158e7709",
  "island desert/lakes": "b60a7b94",
  "island desert/delta": "d2260529",
  "island tundra/coast": "db6d10da",
  "island tundra/archipelago": "a73eba68",
  "island tundra/plateau": "05065207",
  "island tundra/ridges": "8fdb6053",
  "island tundra/lakes": "3a2e1dde",
  "island tundra/delta": "b009709e",
  "island jungle/coast": "84610dd4",
  "island jungle/archipelago": "7f310da8",
  "island jungle/plateau": "a7ed0bca",
  "island jungle/ridges": "0f0972ea",
  "island jungle/lakes": "eb1b1bef",
  "island jungle/delta": "79f9b87b",
  "island swamp/coast": "4a958ee5",
  "island swamp/archipelago": "2ec503d5",
  "island swamp/plateau": "4dbb7595",
  "island swamp/ridges": "425d154c",
  "island swamp/lakes": "63b8d77a",
  "island swamp/delta": "03ef887f",
  "island volcanic/coast": "bdbbc57c",
  "island volcanic/archipelago": "c2383e5b",
  "island volcanic/plateau": "08247903",
  "island volcanic/ridges": "33df0596",
  "island volcanic/lakes": "9c1e44b7",
  "island volcanic/delta": "2eac078e",
  "island mesa/coast": "792b7a23",
  "island mesa/archipelago": "0bc79575",
  "island mesa/plateau": "873882d8",
  "island mesa/ridges": "6aa04de9",
  "island mesa/lakes": "7e985bc0",
  "island mesa/delta": "409a10d4",
  "mixed 3": "67ffe3ee",
  "mixed 11": "63706257",
  "mixed 29": "bfb98154",
  "save island-2026-11-11.json": "8d7e86ea",
};

const fnv = (a: Float32Array): string => {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 0x811c9dc5;
  for (let k = 0; k < b.length; k++) h = Math.imul(h ^ b[k], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
};

export function heightHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of SCENARIOS) out[`challenge ${s.id}`] = fnv(s.build().world.height);
  const golden = JSON.parse(readFileSync("lab/saves/island-2026-11-11.json", "utf8")) as { save: SavedWorld };
  const saved = loadWorld(golden.save, () => {});
  out["save island-2026-11-11.json"] = saved ? fnv(saved.height) : "unreadable";
  for (const biome of BIOMES)
    for (const shape of SHAPES) out[`island ${biome}/${shape}`] = fnv(generateWorld(112, 112, 5, { ...DEFAULT_LAND, biome, shape }).height);
  for (const seed of [3, 11, 29]) out[`mixed ${seed}`] = fnv(generateWorld(208, 208, seed, resolveLand(DEFAULT_LAND, seed, 208)).height);
  return out;
}

// The highest dry ground, and the deepest a volcano's crater floor lies below its rim.
function summit(land: LandOptions, seed: number, side: number): { top: number; crater: number } {
  const w = generateWorld(side, side, seed, land);
  let top = -1e9;
  let lava = 1e9;
  for (let i = 0; i < w.n; i++) {
    if (w.fluid[i] === F.NONE) top = Math.max(top, w.height[i]);
    if (w.fluid[i] === F.LAVA) lava = Math.min(lava, w.height[i]);
  }
  return { top, crater: lava < 1e8 ? top - lava : 0 };
}

export function peaksChecks(check: Check): void {
  const now = heightHashes();
  const changed = Object.keys(BEFORE).filter((k) => now[k] !== BEFORE[k]);
  check(
    "islands made without taller peaks keep their exact heights (challenges, the golden save, every land and shape)",
    changed.length === 0 && Object.keys(now).length === Object.keys(BEFORE).length,
    changed.length ? changed.map((k) => `${k} ${BEFORE[k]} -> ${now[k]}`).join(", ") : `${Object.keys(now).length} islands`,
  );
  // Taller: the same seeds with `peaks`.
  const rows: string[] = [];
  let taller = true;
  for (const [name, land, seed, side] of [
    ["ridges", { ...DEFAULT_LAND, shape: "ridges", relief: 0.7 }, 7, 152],
    ["tundra coast", { ...DEFAULT_LAND, biome: "tundra", relief: 0.8 }, 11, 152],
    ["volcanic", { ...DEFAULT_LAND, biome: "volcanic" }, 5, 152],
  ] as [string, LandOptions, number, number][]) {
    const a = summit(land, seed, side);
    const b = summit({ ...land, peaks: true }, seed, side);
    rows.push(`${name} ${a.top.toFixed(1)} -> ${b.top.toFixed(1)}${b.crater ? `, crater ${a.crater.toFixed(1)} -> ${b.crater.toFixed(1)} deep` : ""}`);
    if (!(b.top > a.top * 1.2)) taller = false;
    if (name === "volcanic" && !(b.crater > a.crater + 2)) taller = false;
  }
  check("islands made with taller peaks rise at least a fifth higher, volcanoes with deeper craters", taller, rows.join("; "));
  // The low ground, where villages, roads and rivers are, is left as it was.
  const plain = generateWorld(152, 152, 7, { ...DEFAULT_LAND, shape: "ridges", relief: 0.7 });
  const tall = generateWorld(152, 152, 7, { ...DEFAULT_LAND, shape: "ridges", relief: 0.7, peaks: true });
  // Villages still find the flat ground they need: as many houses, each on ground no more than a
  // voxel from its neighbours (rivers may run elsewhere off the taller summits, and villages with them).
  const top = (w: typeof plain, i: number) => Math.round(w.height[i] * 0.5);
  const houses = (w: typeof plain) => {
    let n = 0;
    let steep = 0;
    for (let i = 0; i < w.n; i++) {
      if (w.cover[i] !== C.HOUSE) continue;
      n++;
      const x = i % w.w;
      const y = (i - x) / w.w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (x + dx >= 0 && y + dy >= 0 && x + dx < w.w && y + dy < w.h && Math.abs(top(w, i) - top(w, i + dx + dy * w.w)) > 1) steep++;
    }
    return { n, steep };
  };
  const a = houses(plain);
  const b = houses(tall);
  check(
    "with taller peaks villages still stand on flat ground",
    b.n > 0 && b.n >= a.n * 0.7 && b.steep <= a.steep,
    `${a.n} house cells (${a.steep} by a step of two or more) / with taller peaks ${b.n} (${b.steep})`,
  );
  // The director's shots on an island with taller peaks: never empty, never off the island.
  const shots = watchIsland(7, 120, 152, true).summary;
  check(
    "the director frames an island with taller peaks: no empty air, no shot off the island",
    shots.shots > 0 && shots.empty === 0 && shots.off === 0,
    JSON.stringify({ shots: shots.shots, empty: shots.empty, off: shots.off, wide: shots.byKind.wide ?? 0 }),
  );
}
