# The land's looks (5.2.5), 13 November 2026

The owner, after the new light: "maybe we need to improve terrain as well as buildings. Make it less minecrafty and refine the definition/transition between heights and different blocks". Then the cottage island reference: the land, the house and the trees all one small cube, about a quarter of one of our cells.

## What was built

Near the camera (close and mid zoom) each cell of land is drawn as 4 by 4 columns of quarter voxels (`src/sim/voxel/terrain-fine.ts`). Farther away, and for the whole island from the sky, the land is the one cell mesh of main. A chunk switches when the camera comes within 34 units of it (height counts half) and back past 42; nothing is drawn finely when the camera is higher than 42 units. Fine chunks are built one a frame, nearest first, and kept until the land changes or the camera goes 90 units away. A chunk whose land changed keeps showing its old fine mesh until the new one is built, at most one rebuilt every 0.4 s, so a flowing river does not churn the fine land. Tops of the same height and colour are merged into rectangles.

Drawing only. The simulation's heights and grounds are read, never changed; the 2 by 2 columns in the middle of a cell keep its height, so what stands on the cell still stands on it. No file of the simulation changes.

Switches (`src/sim/voxel/land-looks.ts`, part of `GRAPHICS`, "off=fine,steps" in the Perf Lab):

| Switch  | What it draws                                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `fine`  | The quarter voxel land near the camera                                                                                      |
| `steps` | A rise of one voxel as four small irregular steps; a broken lip on cliffs of two or more                                    |
| `blend` | Grounds that meet mixed over one or two quarter voxels; sand poking out of the shallows; grass and snow hanging over cliffs |
| `grain` | A tone for each 2 by 2 patch of quarter voxels and for each column of soil; stone in level strata bands                     |
| `foam`  | A ring of white foam quarter voxels where water meets land, and a broken second ring                                        |
| `bits`  | Flowers on grass and pebbles on sand, single quarter voxels seeded by position                                              |
| `bands` | Water in five bands of colour by depth, light turquoise and clear in the shallows (everywhere, not only near)               |

With all of them off the land and water meshes of three islands are byte for byte main's (`scripts/terrain-looks-test.ts`, in `npm test`). Each switch changes the mesh, the same way every time, and the whole island from the sky has no fine chunk.

## Triangles and build time

`scripts/terrain-measure.ts`, node, medians of three builds. Camera at phi 0.95 over the island's middle: close 16, mid 45, far 0.55 of the island's side.

| Island               | Zoom  | Land triangles before | after   | Fine chunks | Fine build, a chunk |
| -------------------- | ----- | --------------------- | ------- | ----------- | ------------------- |
| medium coast (152)   | close | 69 762                | 287 908 | 9           | 8 to 13 ms          |
| medium coast         | mid   | 69 762                | 229 482 | 8           | 8.7 ms              |
| medium coast         | far   | 69 762                | 69 762  | 0           |                     |
| large mixed (208)    | close | 112 818               | 280 894 | 9           | 8.0 ms              |
| large mixed          | mid   | 112 818               | 241 124 | 8           | 7.2 ms              |
| large mixed          | far   | 112 818               | 112 818 | 0           |                     |
| small plateau desert | close | 40 676                | 267 428 | 12          | 7.3 ms              |
| small plateau desert | mid   | 40 676                | 192 580 | 9           | 5.1 ms              |
| small plateau desert | far   | 40 676                | 40 676  | 0           |                     |

The whole island's first build (one cell meshes) is unchanged: 20 to 60 ms before and after, within the noise of the runs. Water triangles do not change (the bands are colours only).

Per switch, medium coast, close (land triangles, on top of `fine` alone: 113 466): steps 181 064, blend 175 532, grain 303 960 when every quarter voxel had its own tone, cut to patches of 2 by 2 (all on: 396 920 before the cut, 287 908 after), foam 123 034, bits 140 970.

## Steady frame time in the headless browser

`scripts/perf-phone.mjs medium 8 "dpr=1&dist=…"`, Pixel 7 viewport, software WebGL (SwiftShader: the raster runs on the CPU, so it counts triangles far more than a phone's GPU would). Frame and raster ms p50 / p95, draw is the JavaScript of a frame.

| Zoom          | Off: frame | On: frame | Off: draw  | On: draw   | Off: raster | On: raster | Triangles off / on |
| ------------- | ---------- | --------- | ---------- | ---------- | ----------- | ---------- | ------------------ |
| close (0.105) | 100 / 217  | 167 / 417 | 4.5 / 26.8 | 5.8 / 22.6 | 111 / 215   | 130 / 277  | 194 630 / 302 684  |
| mid (0.296)   | 133 / 300  | 183 / 450 | 4.3 / 8.5  | 5.3 / 30.3 | 114 / 256   | 160 / 259  | 199 020 / 290 444  |
| far (0.55)    | 117 / 233  | 117 / 217 | 4.4 / 7.5  | 4.3 / 13.7 | 119 / 160   | 126 / 178  | 212 580 / 212 272  |

The draw's p95 of about 30 ms near the island is a fine chunk being built while the camera turns (one a frame, 5 to 13 ms each in node, more on a phone). From the sky nothing changes.

## Frames

Seed 7, medium island, the Perf Lab, `scripts/terrain-frames.mjs`, off (`-off`) and on (`-on`) at 390 by 844 and 344 by 882: `village-*` (the highest village, distance 26), `beach-*` (a beach under the highest rise, distance 24), `island-*` (the whole island) and `shore-*` (a close shore of grass, sand and water, distance 11).
