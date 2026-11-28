# Cliffs on their own line: prototype, 27 November

The cliff outline (`cliffOutline` in `src/sim/voxel/terrain-fine.ts`, behind `CLIFF_OUTLINE.on`, off in the game) draws a cliff along the line its cells make instead of on the cells' sides. Each sheet below holds three cameras (above, play, eye at the cliff's foot), each cropped to the middle 60% of its frame. Columns, left to right: before (cell edges, `cliffs=off`), main (the corner cut of #230), outline. The mesa has a fourth column, outline with `sharp=3`.

Made with `node scripts/cliff-frames.mjs docs/measurements/cliff-outline-27nov` against `npx vite` on port 5174. Every camera stands on and looks at a cell's middle, which no mode moves, so the frames line up. The raw numbers are in `cliff-frames.json`.

## Islands

Each island's run is the longest straight off-axis cliff run of at least 6 cells that the scan found (15 to 75 degrees off the axes). The lip is measured at sub 8 along that run. RMS is the lip's distance from the run's chord in cells, so a curved run keeps some RMS in every mode. A tooth is an axis-aligned stretch of the lip longer than that angle's own step plus 2 columns. Land triangles count the whole island, with every chunk built in eighths. Tile time is the fine mesher's p50 / p95 per tile, in ms.

| Island                 | Run               | Mode    | RMS   | Teeth per 10 cells | Land triangles     | Tile ms p50 / p95 |
| ---------------------- | ----------------- | ------- | ----- | ------------------ | ------------------ | ----------------- |
| plateau-7              | 11.7 cells, 59.0° | before  | 0.294 | 8.57               | 4,630,406          | 0.5 / 1.4         |
|                        |                   | main    | 0.224 | 4.29               | 4,643,818          | 0.5 / 1.6         |
|                        |                   | outline | 0.206 | 0.86               | 4,666,994 (+0.5%)  | 0.7 / 1.9         |
| desert-plateau-3       | 15.6 cells, 39.8° | before  | 0.365 | 11.52              | 2,206,212          | 0.4 / 1.4         |
|                        |                   | main    | 0.310 | 1.28               | 2,230,192          | 0.5 / 3.4         |
|                        |                   | outline | 0.288 | 1.92               | 2,259,948 (+1.3%)  | 0.6 / 2.1         |
| mesa-5                 | 15.7 cells, 26.6° | before  | 0.422 | 8.94               | 3,160,614          | 0.5 / 1.7         |
|                        |                   | main    | 0.374 | 4.47               | 3,269,674          | 0.5 / 1.7         |
|                        |                   | outline | 0.298 | 0.64               | 3,352,994 (+2.5%)  | 0.6 / 1.7         |
|                        |                   | sharp 3 | 0.298 | 0.64               | 3,350,062 (+2.5%)  | 0.6 / 1.7         |
| volcanic-6 (lava foot) | 7.2 cells, 56.3°  | before  | 0.276 | 9.71               | 5,565,270          | 0.5 / 2.1         |
|                        |                   | main    | 0.276 | 9.71               | 5,567,334          | 0.6 / 4.7         |
|                        |                   | outline | 0.276 | 9.71               | 5,570,442 (+0.06%) | 0.6 / 2.7         |
| forest-plateau-2       | 13.6 cells, 36.0° | before  | 0.375 | 10.29              | 4,148,496          | 0.5 / 1.7         |
|                        |                   | main    | 0.301 | 4.41               | 4,203,488          | 0.6 / 1.8         |
|                        |                   | outline | 0.255 | 3.68               | 4,255,848 (+1.2%)  | 0.6 / 2.3         |

Triangle changes are against main. Tile times come from the software renderer in this container, one run each, so the p95 values swing by 2 to 3 ms between runs. The p50 rises by 0 to 0.2 ms with the outline on. These are from the last run, after the water bed fix (see below).

Sheets: `plateau-7-compare-390.jpg`, `desert-plateau-3-compare-390.jpg`, `mesa-5-compare-390.jpg`, `volcanic-6-compare-390.jpg`, `forest-plateau-2-compare-390.jpg`, and the same at 344 (the Z Fold folded).

## Synthetic cliffs (`scripts/cliff-outline-test.ts`, in `npm test`)

A straight cliff 4 high at each angle, on a 40 by 40 island, measured over 18 cells. RMS / teeth, main then outline:

| Angle | sub 8                               | sub 4                               |
| ----- | ----------------------------------- | ----------------------------------- |
| 0°    | 0 / 0, then 0 / 0 (no column moved) | 0 / 0, then 0 / 0 (no column moved) |
| 18.4° | 0.187 / 6, then 0.038 / 0           | 0.196 / 6, then 0.068 / 0           |
| 26.6° | 0.134 / 9, then 0.050 / 0           | 0.143 / 7, then 0.077 / 0           |
| 45°   | 0.044 / 0, then 0.041 / 0           | 0.087 / 0, then 0.082 / 0           |
| 63.4° | 0.132 / 9, then 0.053 / 0           | 0.141 / 6, then 0.077 / 0           |

Triangles per cell of cliff rise by 0 to about 10% (sub 8: 34 to 34 at 0°, 183 to 196 at 45°; sub 4: 25 to 25, 90 to 97). The test reports them and does not assert on them.

Other cases:

- Terrace (three levels, 33.7°): RMS 0.157 / 0.164 with 14 teeth before, then 0.057 / 0.059 with 0 teeth. No level appears that is not one of the cells'.
- Lava foot (26.6°): RMS 0.257 with 17 teeth before, then 0.134. Teeth stay at 17 at sub 8 and drop to 8 at sub 4.
- Kept cells: a house, a path, a road, a built column and a tree. 0 of their columns move. 0 of 35 tree columns within 0.3 cell of the tree's middle move.
- Canyons: a straight canyon 1 cell wide keeps its width of 1 in every mode. At 45° the canyon is 0.50 wide on main and 0.68 to 0.70 with the outline. Its true width is 0.707.

The ground blend's ONE_LAND hash stays `370d4587` with the flag off.

Fixed on the way: at first a water bed could take a dry cliff's rock in its corner. With the outline on, the small desert plateau of `scripts/cliff-corner-test.ts` then had 21 of 65 land columns in water cells standing more than SHORE_LOW over the water, a tan strip down the cliff's face. A water bed now trades nothing, in the mesher and in `fieldHeight`, and the count is 0 of 38. Lava still takes fill.

## What looks wrong

1. **Ribbed walls.** The lip is straight now, but the face below it is a row of eighth-wide vertical columns, each set a little back from the one before. Up close (the eye frames of plateau-7 and mesa-5) that reads as organ pipes. Main ribs too, with wider, flatter facets. Before the flag goes on, the face needs one plane per wall run.
2. **Lava foot.** On the real volcanic island the outline changes 68 columns along the run, and the measured lip does not move. Lava cells only take fill, and the anchored rock cells on the high side cannot cut into lava, so most of a cliff into lava stays on the cells' sides. The synthetic lava foot keeps its convex corners toothed for the same reason.
3. **`sharp=3` does almost nothing on mesa-5.** 2,932 fewer triangles and the same lip. The run is a long 2:1 line with no corner of 3 straight cells, so nothing is kept sharp there. Worse, the outline rounds the mesa's square tops (the upper left of the above frames): those rectangles become one long curve, with or without `sharp=3`. A mesa reads as a mesa by those corners, so the sharp rule needs to catch shorter walls, or mesas keep the cells' sides.
4. **Forest eye frames.** The eye camera at forest-plateau-2's foot stands against another wall and shows only rock. The above and play frames are the ones to judge there.
5. **Desert-plateau-3.** Teeth per 10 cells are 1.92 with the outline against 1.28 on main. That is 3 teeth against 2 on one run, inside the noise of one run. The outline's above and play frames there also show a small dark slot in the lip, near the middle of the run. I have not traced it yet; it may be a lip break the old cell edge left behind.
6. **Known limits.** `groundAt` on a wet cell still returns the water level where filled rock now stands. With `sharpRun` on, the outline reads one cell beyond the chunk's border of 3. At sub 4, the border columns read clamped cells. No sim walker guard is in yet: the prototype left it out.
