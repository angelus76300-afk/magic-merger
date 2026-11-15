// Taller peaks (5.2.5, land.ts uplift and volcano, LandOptions.peaks): islands made from now on
// get higher summits, steeper upper slopes and deeper craters; every island made before keeps its
// exact heights. The hashes below were taken with the generator of main before the change
// (14 November 2026): every challenge island, the golden save, and an island of every land and
// shape, made without `peaks`.
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
  "island temperate/coast": "aa20185f",
  "island temperate/archipelago": "4bf97a84",
  "island temperate/plateau": "703fdf67",
  "island temperate/ridges": "74e9b53d",
  "island temperate/lakes": "caeb4bea",
  "island temperate/delta": "315a748a",
  "island desert/coast": "67644ffa",
  "island desert/archipelago": "ac687d14",
  "island desert/plateau": "9cad4c14",
  "island desert/ridges": "6d2baba8",
  "island desert/lakes": "46470569",
  "island desert/delta": "021d2bb5",
  "island tundra/coast": "f76a56ba",
  "island tundra/archipelago": "db48e412",
  "island tundra/plateau": "5b26c641",
  "island tundra/ridges": "ac2b7449",
  "island tundra/lakes": "39ce81d9",
  "island tundra/delta": "cff45a3e",
  "island jungle/coast": "5f1ede53",
  "island jungle/archipelago": "39dc08f9",
  "island jungle/plateau": "4ffd1781",
  "island jungle/ridges": "6ec80d51",
  "island jungle/lakes": "d8f7b47c",
  "island jungle/delta": "2c3576b1",
  "island swamp/coast": "e7af7dff",
  "island swamp/archipelago": "452b3c65",
  "island swamp/plateau": "313376d9",
  "island swamp/ridges": "ef2d69b6",
  "island swamp/lakes": "0bfd40a3",
  "island swamp/delta": "119bafb6",
  "island volcanic/coast": "bf14bf43",
  "island volcanic/archipelago": "4f6f152f",
  "island volcanic/plateau": "c3f4078a",
  "island volcanic/ridges": "75d724ff",
  "island volcanic/lakes": "74678a08",
  "island volcanic/delta": "a917292c",
  "island mesa/coast": "49e87cd8",
  "island mesa/archipelago": "3fa8b470",
  "island mesa/plateau": "360d62f0",
  "island mesa/ridges": "601adc15",
  "island mesa/lakes": "dd95915d",
  "island mesa/delta": "70a6cf94",
  "mixed 3": "103d1303",
  "mixed 11": "f47736fa",
  "mixed 29": "25c47e9e",
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
