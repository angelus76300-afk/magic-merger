# The land's looks, second pass (5.2.5), 13 November 2026

The owner, after the first pass (#151): "This is in the right direction but we need to continue refining even further. ... the render is finer ... while maintaining visual clarity, it must look refined and detailed, not messy and too busy."

## What changed from #151

- **Finer close up.** Chunks near the point the camera looks at are drawn in eighth voxels, the next ring in quarter voxels, the rest in whole cells as on main. A chunk's level comes from its distance to that point, plus half the camera's distance to it. Turning the camera around the point keeps every chunk at its level; zooming out pushes them all farther. The simulation keeps its cells.
- **Calm surfaces.** A ground's tone comes in soft patches a few cells across, three shades per ground; nothing varies voxel by voxel. Sand has no loose cubes. Flowers on grass and pebbles on sand grow in a few small clusters, and pebbles are flat.
- **Detail at the edges.** Every irregularity follows smooth noise of position, so each border is a wavy line, never a sprinkle:
  - where two grounds meet, the border moves up to almost half a cell either way, the same line seen from both sides; a trodden path now blends with the grass too;
  - sand reaches into the shallows flush with the beach;
  - a white foam line runs along the shore, about a fifth of a cell wide, with a softer edge;
  - a rise of one voxel becomes four or eight small steps;
  - cliff lips break in short runs, and grass hangs over the edges in short runs;
  - the grass layer on a wall has a wavy lower edge, and strata bands sit at fixed heights.
- **Merged hard.** Tops of one height and colour merge into rectangles, and walls merge into runs along each line, so most of the cost is at the edges.
- **Built in small tiles.** Each tile is 4 by 4 cells in quarter voxels or 2 by 2 in eighths, built for up to 4 ms a frame. A started chunk is finished before a nearer one is begun. A chunk whose land changed is rebuilt after at least 2 s, or 10 s when only water flowed at its edge, and shows its old mesh until then.

## Triangles and build time

`scripts/terrain-measure.ts`, node, all switches on, camera over the island's middle: close 16, mid 45, far 0.55 of the side. Land triangles, #151 against this pass:

| Island               | Zoom  | #151    | This    | Fine chunks (in eighths) | Chunk build, total | Tile p95 / longest |
| -------------------- | ----- | ------- | ------- | ------------------------ | ------------------ | ------------------ |
| medium coast (152)   | close | 287 908 | 200 076 | 9 (1)                    | 17 ms              | 0.5 / 3.0 ms       |
| medium coast         | mid   | 229 482 | 173 556 | 8 (0)                    | 12 ms              | 0.3 / 0.8 ms       |
| medium coast         | far   | 69 762  | 69 762  | 0                        |                    |                    |
| large mixed (208)    | close | 280 894 | 222 516 | 8 (3)                    | 20 ms              | 0.2 / 0.7 ms       |
| large mixed          | mid   | 241 124 | 168 344 | 6 (0)                    | 11 ms              | 0.2 / 0.9 ms       |
| large mixed          | far   | 112 818 | 112 818 | 0                        |                    |                    |
| small plateau desert | close | 267 428 | 163 144 | 8 (3)                    | 24 ms              | 0.3 / 1.7 ms       |
| small plateau desert | mid   | 192 580 | 104 254 | 6 (0)                    | 11 ms              | 0.2 / 1.4 ms       |
| small plateau desert | far   | 40 676  | 40 676  | 0                        |                    |                    |

A chunk's total is spread over frames, at most 4 ms a frame plus the tile under way. In node, no tile took more than 3 ms. The water's triangles do not change, and with every switch off the land and water are main's, byte for byte (`scripts/terrain-looks-test.ts`).

## Steady frame time in the headless browser

`scripts/perf-phone.mjs medium 8 "dpr=1&dist=…"`: a Pixel 7 viewport and software WebGL, whose raster runs on the CPU and so counts triangles far more than a phone's GPU would. The camera turns all the time. Values are p50 / p95 in ms.

| Zoom  | Frame, off | Frame, on | Draw (JS), off | Draw (JS), on | Raster, off | Raster, on | Triangles, off / on |
| ----- | ---------- | --------- | -------------- | ------------- | ----------- | ---------- | ------------------- |
| close | 100 / 217  | 117 / 233 | 3.8 / 7.6      | 4.3 / 11.9    | 88 / 100    | 114 / 134  | 194 526 / 237 234   |
| mid   | 117 / 217  | 100 / 183 | 3.4 / 8.7      | 3.5 / 9.3     | 89 / 112    | 93 / 126   | 202 956 / 259 866   |
| far   | 117 / 217  | 117 / 217 | 4.0 / 8.0      | 3.6 / 9.0     | 114 / 137   | 122 / 139  | 211 094 / 210 648   |

For comparison, #151 at close measured a JS draw of 5.8 / 22.6 ms. On the same page, with SwiftShader drawing on the same CPU, single tiles sometimes took up to 24 ms, which looks like garbage collection or contention with the raster.

## Frames

`*-151-vs-2.jpg`: on the left #151 (`docs/measurements/looks-terrain/*-on.jpg`), on the right this pass. The views are a shore of grass, sand and water at distance 11, the highest village at 26, and a beach under the highest rise at 24, each at 390 by 844 and 344 by 882. Seed 7, medium island, Perf Lab, `scripts/terrain-frames.mjs`.
