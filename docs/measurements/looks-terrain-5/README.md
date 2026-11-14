# The land's looks, fifth pass (5.2.5), 14 November 2026

The owner, after pass 4: "I'd like to have more variation, here once again it looks like a slope. Even a flat surface should look like it has a small variation of height, variation in where the slope starts from the edge, slope variation that looks different from '\'. Whatever the terrain generation came up with, keep it continuous and just refine it further ... Physical blocks will not change but rendered ones will be more refined and have better curves." And still: "we still want that voxel look of lots of little cubes".

## What changed from pass 4

- **The land is drawn from the generator's continuous heights.** The simulation already keeps them: `world.height` is a float per cell, straight from the generator and changed by spells, and only `columnTop` rounds it to whole voxels. Every island and every save carries it, so nothing new is saved and no save changes.
  - The fine land draws a bicubic (Catmull-Rom) through those heights (`fieldHeight` in `src/sim/voxel/terrain-fine.ts`). Slopes curve, start at varied distances from a cell's side and change steepness along their length.
  - Open ground swells gently, about an eighth voxel either way, over a few cells.
  - Cliffs between cells two or more voxels apart stay cliffs.
- **Where something stands, the ground keeps the simulation's height.** That covers covers (trees, crops, houses, boulders), paths, built columns, and ground next to water. Around such a cell's middle the drawn ground is the cell's rounded height, eased out toward its sides; a house's cell is flat all over.
  - Creatures, the camera and bodies follow the drawn ground (`groundAt`).
  - Worst gap between the drawn ground and the cell's height on three islands (`scripts/terrain-looks-test.ts`): 0.000 under plants, paths and the water's edge, at their foot; 0.000 under houses, across the whole floor. That is 60,000 points.
- **Little cubes, never a smooth surface.** The field is rounded to eighth (close) or quarter voxels with a small wobble of position, so a slope that runs diagonally breaks into irregular little steps rather than a checkerboard. Each riser keeps a darker side, and pass 4's slope light, hollows, height tint and rock cliffs stay on top.
- **Practical.**
  - The quarter-voxel ring is tighter: in at 28, out at 34, was 34 and 42.
  - The mesher reads the field from the chunk's own arrays: 16 neighbours a column, no calls.
  - Far zoom keeps the coarse land.

With every switch off, the land and water are main's, byte for byte.

## Numbers

### Triangles and build time

`scripts/terrain-measure.ts`, node, all switches on. Land triangles, pass 4 → pass 5. Pass 4's counts are from pass 3's table, since the geometry of passes 3 and 4 differs only in shading.

| Island               | Zoom  | Pass 3 / 4 | Pass 5  | Fine chunks (eighths) | Chunk build, total | Tile p95 / longest |
| -------------------- | ----- | ---------- | ------- | --------------------- | ------------------ | ------------------ |
| medium coast (152)   | close | 298 412    | 389 964 | 8 (1)                 | 46 ms              | 1.0 / 3.7 ms       |
| medium coast         | mid   | 239 116    | 165 540 | 3 (0)                 | 24 ms              | 0.4 / 1.0 ms       |
| medium coast         | far   | 69 762     | 69 762  | 0                     |                    |                    |
| large mixed (208)    | close | 330 522    | 515 474 | 8 (3)                 | 52 ms              | 0.5 / 2.5 ms       |
| large mixed          | mid   | 207 322    | 220 776 | 4 (0)                 | 23 ms              | 0.4 / 1.0 ms       |
| large mixed          | far   | 112 818    | 112 818 | 0                     |                    |                    |
| small plateau desert | close | 250 572    | 477 722 | 8 (3)                 | 45 ms              | 0.4 / 2.4 ms       |
| small plateau desert | mid   | 135 200    | 171 966 | 4 (0)                 | 24 ms              | 0.4 / 1.0 ms       |
| small plateau desert | far   | 40 676     | 40 676  | 0                     |                    |                    |

A chunk is built over frames: at most 4 ms a frame for a new chunk, 1.5 ms for one rebuilt after a change, plus the tile in progress. In node no tile took more than 4 ms.

### Steady frame time in the headless browser

`scripts/perf-phone.mjs medium 8`, Pixel 7 viewport, software WebGL, so the raster runs on the CPU. The camera keeps turning. Values are p50 / p95 in ms.

| Zoom  | Frame, off | Frame, on | Draw (JS), off | Draw (JS), on | Raster, off | Raster, on | Triangles, off / on |
| ----- | ---------- | --------- | -------------- | ------------- | ----------- | ---------- | ------------------- |
| close | 83 / 150   | 117 / 217 | 3.4 / 8.2      | 5.3 / 9.8     | 74 / 90     | 114 / 135  | 194 690 / 436 936   |
| mid   | 83 / 150   | 100 / 200 | 3.1 / 6.4      | 4.1 / 8.7     | 77 / 97     | 100 / 121  | 202 772 / 297 096   |
| far   | 83 / 167   | 83 / 167  | 3.5 / 7.1      | 3.3 / 7.4     | 96 / 111    | 96 / 117   | 223 304 / 222 778   |

## Frames

`*-390x844-pass4-vs-5.jpg`: pass 4 on the left, this pass on the right, for the hill, the mountain (the highest dry ground, 8 cells inside the rim), the shore and the village. Seed 7, medium island, the same spots for both.
