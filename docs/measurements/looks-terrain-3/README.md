# The land's looks, third pass (5.2.5), 13 November 2026

The owner, after seeing passes 1 and 2 side by side: "I'd like something in the middle. Also I am sure we could make some smoother terrain transitions that don't look like stairs, something closer to real life with a secondary terrain map?"

## What changed from pass 2

- **A secondary terrain map** (`fieldHeight` in `src/sim/voxel/terrain-fine.ts`, under the `steps` switch). This is a finer height field built from the cells' heights, for drawing only.
  - Around each cell's middle (0.12 of a cell each way) the field is the cell's own height. Toward a neighbour one voxel higher or lower it eases into that neighbour's height, and the two meet halfway at their common side.
  - A neighbour two or more voxels away is not followed, so the cliff stays.
  - A house's cell stays flat. Wet cells, built columns and roads are not smoothed either.
  - Slopes get a little low-frequency noise.
  - The field is turned into eighth voxels close up and quarter voxels farther out. On slopes, a riser of one or two columns' step takes the colour and light of the ground above it, and each slope is lit by the way it faces, so a hill reads as a tilted surface, not as stripes. The terraces of pass 2 are gone.
- **What stands on the land.** Creatures, bodies and the camera use the view's `groundAt`, which now reads the same field where the land is drawn finely (`Terrain.groundAt`), so they walk on the slopes. Everywhere else, and with the switch off, it returns the cell's height as before. Plants, houses and everything else placed by a cell's height stand where the field equals that height.
  - Measured on three islands (`scripts/terrain-looks-test.ts`, close zoom), the worst gap between the drawn ground and the cell's height was 0.000 under plants and covers (over each one's foot, 0.12 of a cell from the middle) and 0.000 under houses (over the whole floor, 0.45). That is 43,310 points in all; the limit is one eighth voxel.
- **Between pass 1 and pass 2.**
  - Inside each soft patch of tone there is a second, slightly darker shade in smaller patches.
  - Flower clusters are a little more frequent, and small grass tufts (a shade lighter or darker) appear in clusters.
  - Pebbles appear along the shore line only.
  - Foam and calm sand stay as in pass 2.
- **Fine land tied to the quality preset.** With the frame HUD's quality levels of #149, `fine` is off on low and on at medium and high (`PRESETS` in `graphics.ts`). Turning it off returns every chunk to whole cells.
- **Build budget.** A new chunk is built for up to 4 ms a frame. A chunk built again because its land changed gets 1.5 ms a frame.

The simulation's heights do not change, and no sim file changed. With every switch off, the land and water are main's, byte for byte.

## Triangles and build time

`scripts/terrain-measure.ts` in node, every switch on. Land triangles, pass 2 against pass 3:

| Island               | Zoom  | Pass 2  | Pass 3  | Fine chunks (eighths) | Chunk build, total | Tile p95 / longest |
| -------------------- | ----- | ------- | ------- | --------------------- | ------------------ | ------------------ |
| medium coast (152)   | close | 200 076 | 298 412 | 9 (1)                 | 26 ms              | 0.6 / 4.2 ms       |
| medium coast         | mid   | 173 556 | 239 116 | 8 (0)                 | 16 ms              | 0.4 / 3.7 ms       |
| medium coast         | far   | 69 762  | 69 762  | 0                     |                    |                    |
| large mixed (208)    | close | 222 516 | 330 522 | 8 (3)                 | 31 ms              | 0.3 / 5.8 ms       |
| large mixed          | mid   | 168 344 | 207 322 | 6 (0)                 | 15 ms              | 0.3 / 1.0 ms       |
| large mixed          | far   | 112 818 | 112 818 | 0                     |                    |                    |
| small plateau desert | close | 163 144 | 250 572 | 8 (3)                 | 27 ms              | 0.3 / 2.0 ms       |
| small plateau desert | mid   | 104 254 | 135 200 | 6 (0)                 | 14 ms              | 0.3 / 0.8 ms       |
| small plateau desert | far   | 40 676  | 40 676  | 0                     |                    |                    |

Slopes cost triangles: each tiny step has its riser, and a slope's tops differ in height, so fewer of them merge. Pass 3 lands near pass 1's counts (288k close, 229k mid on the medium island). A chunk's build is spread over frames.

## Steady frame time in the headless browser

`scripts/perf-phone.mjs medium 8`, Pixel 7 viewport, software WebGL; the camera keeps turning. Values are p50 / p95 in ms.

| Zoom  | Frame, off | Frame, on | Draw (JS), off | Draw (JS), on | Raster, off | Raster, on | Triangles, off / on |
| ----- | ---------- | --------- | -------------- | ------------- | ----------- | ---------- | ------------------- |
| close | 100 / 167  | 133 / 267 | 3.8 / 7.5      | 5.5 / 17.2    | 89 / 119    | 132 / 186  | 198 266 / 281 804   |
| mid   | 150 / 283  | 167 / 433 | 3.9 / 9.5      | 5.4 / 15.9    | 114 / 194   | 138 / 254  | 199 448 / 291 750   |
| far   | 117 / 233  | 133 / 317 | 4.1 / 7.6      | 4.3 / 10.7    | 127 / 207   | 120 / 174  | 205 548 / 204 802   |

The far row was measured before the 1.5 ms budget for rebuilt chunks; nothing is drawn finely at far zoom.

These runs are noisy: another session's dev server shared the machine, and the same "mid off" ran at 83 and at 150 ms. Most of the JavaScript draw time added close up is chunks being built again as the village changes. `groundAt` costs about 1 µs, 34 calls a frame.

## Frames

`*-pass2-vs-3.jpg`: pass 2 on the left, this pass on the right. Views at 390 by 844 and 344 by 882:

- `shore`: grass, sand and water, distance 11.
- `village`: the highest village, distance 26.
- `hill`: the grass cell with the most one-voxel rises around it and no cliff, distance 13.
- `cliff`: the island's highest drop, distance 14.

Seed 7, medium island, the same spots for both passes (`SPOTS` in `scripts/terrain-frames.mjs`). Pass 2 was served from an export of its commit, c7a0406.
