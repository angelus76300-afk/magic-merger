// The land's looks (5.2.5): triangles drawn and build times of the land and water, with the new
// looks off and on, at close, mid and far zoom over the island's middle. "island ms" is the first
// build of the whole island in whole cells; "fine ms" the fine chunks the camera needs, all built
// at once (in the game, one a frame). Medians of three builds.
//
//   npx esbuild scripts/terrain-measure.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/terrain-measure.mjs && node node_modules/.cache/terrain-measure.mjs
import { LOOK_ISLANDS, LOOK_SWITCHES, ZOOMS, islandWith, type Zoom } from "./terrain-looks-test";

const only = process.argv[2];
const runs: [string, string[]][] = [
  ["off", []],
  ...LOOK_SWITCHES.map((s): [string, string[]] => [s, s === "fine" || s === "bands" ? [s] : ["fine", s]]),
  ["all", [...LOOK_SWITCHES]],
];
const mid = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
for (let k = 0; k < LOOK_ISLANDS.length; k++) {
  for (const zoom of Object.keys(ZOOMS) as Zoom[]) {
    for (const [name, on] of runs) {
      if (only && name !== only && name !== "off") continue;
      const builds = Array.from({ length: 3 }, () => islandWith(on, k, zoom));
      const b = builds[0];
      console.log(
        [
          LOOK_ISLANDS[k].name.padEnd(21),
          zoom.padEnd(5),
          name.padEnd(6),
          `land ${String(b.landTriangles).padStart(7)}`,
          `water ${String(b.fluidTriangles).padStart(6)}`,
          `fine chunks ${String(b.fineChunks).padStart(2)}`,
          `island ${mid(builds.map((x) => x.ms))
            .toFixed(1)
            .padStart(6)} ms`,
          `fine ${mid(builds.map((x) => x.fineMs))
            .toFixed(1)
            .padStart(6)} ms`,
          `(${b.fineChunks ? (mid(builds.map((x) => x.fineMs)) / b.fineChunks).toFixed(1) : "-"} a chunk)`,
        ].join("  "),
      );
    }
  }
}
