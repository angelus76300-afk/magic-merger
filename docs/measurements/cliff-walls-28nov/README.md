# Cliffs: flat walls that follow the land, 28 November

The owner's decision on 27 November, typed in the lead session: "cliffs: flat walls". The cliff outline (`cliffOutline` in `src/sim/voxel/terrain-fine.ts`, behind `CLIFF_OUTLINE.on`) now draws each wall between its lip's points as one slanted flat strip, keeps a mesa's corners on the cells' outline, lets the rock at a cliff's foot fill lava, and has a guard so a walker never stands on land drawn a cliff away from its cell. The flag stays off in the game (see "Flag" below).

Each sheet holds the same cameras in three columns: before (`cliffs=corner`, the game today), the outline without flat walls or sharp corners (`cliffs=outline&walls=0&sharp=0`, the 27 November prototype plus this pass's mesa, lava and lattice fixes) and flat walls (`cliffs=outline`, the game's settings with the flag on). Made with `node scripts/cliff-frames.mjs` against `npx vite --port 5174`. Every camera stands on and looks at a cell's middle, which no mode moves, so the frames line up. Raw numbers: `cliff-frames.json` (lip rows, then `"bench"` rows) and `triangles.txt`.

## The five problems

| Problem                                  | Before                                                                             | Now                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ribbed walls                             | 100% of a slanted wall's area at mid-height turned more than 10° (main, prototype) | 0 to 1.0% at sub 8, 0 to 1.3% at sub 4, at 18.4, 26.6, 45 and 63.4°. Sheets: `close-wall-*.jpg`, `close-desert-wall-*.jpg`                                                                                                                                                                                                                                       |
| Mesa tops rounded, `sharp=3` did nothing | Mesa rectangles became one curve                                                   | A pass touching a mesa cell keeps the cells' outline, and no wall strip is cut beside a mesa cell (that bevelled its corners by a column). Synthetic block and stairs on mesa: 0 columns moved. `sharp=3` now keeps the block's corners (0 moved) and lets the notch round (39 moved); sharp 0 moves 48 / 39. Sheets: `mesa-5-compare-*.jpg`, `close-mesa-*.jpg` |
| Lava foot                                | Lava took fill only, lip unmoved on volcanic-6                                     | Synthetic 26.6°: RMS 0.257 / 17 teeth, now 0.130 / 8 at sub 8 and 0.093 / 0 at sub 4 (716 and 188 columns filled). volcanic-6's run: RMS 0.276 / 7 teeth, now 0.202 / 1                                                                                                                                                                                          |
| Dark slot on desert-3                    | A slot in the lip and a dark column at the foot                                    | Gone in the flat walls column. Two causes: corners of different cliffs read through different level sets (now one pass per cliff), and step risers sampled their corners at different insets (now one shared reading per lattice point)                                                                                                                          |
| Sim walker guard                         | None                                                                               | `World.walkGuard`, from `Terrain` while the flag is on. 111 beasts at cliff feet on desert-plateau-3 for 20 s: 194 to 210 steps onto such points without it (runs differ), 0 with it                                                                                                                                                                             |

## Synthetic cliffs (`scripts/cliff-outline-test.ts`, in `npm test`)

Kept from 27 November, with flat walls on: sub 8 RMS / teeth 18.4° 0.038 / 0, 26.6° 0.050 / 0, 45° 0.041 / 0, 63.4° 0.053 / 0; sub 4 0.068, 0.077, 0.082, 0.077, all 0 teeth. Terrace (three levels): RMS 0.057 / 0.059, 0 teeth, no level of its own (main: 0.157 / 0.164, 14 teeth). Water beds still trade nothing: 0 of 67 and 0 of 38 land columns in water cells stand more than SHORE_LOW over the water. The lake hashes of `lake-weed-test` and the ground blend's ONE_LAND hash `370d4587` are unchanged (flag off).

## Triangles (`scripts/cliff-walls-count.ts`, whole island, every chunk in eighths)

| Island           | Main      | Flat walls         | Slanted wall triangles |
| ---------------- | --------- | ------------------ | ---------------------- |
| plateau-7        | 1,848,880 | 1,862,582 (+0.74%) | 8,706                  |
| desert-plateau-3 | 869,300   | 890,908 (+2.49%)   | 14,250                 |
| mesa-5           | 1,083,270 | 1,040,232 (-3.97%) | 0                      |
| volcanic-6       | 2,207,868 | 2,211,082 (+0.15%) | 1,432                  |
| forest-plateau-2 | 1,661,814 | 1,691,374 (+1.78%) | 24,496                 |

Mesa-5 drops because its walls stay on the cells' sides, which take fewer faces than main's corner cut. Tile build time p50 rises from about 5.6 ms to 7.4 to 8.2 ms in Node (the outline's passes), p95 stays inside the run-to-run swing.

## Frame time at 344 by 882 (the Z Fold folded)

Sixty frames with the camera held, each waited for (`BENCH=60`). SwiftShader in this container, so the frame column is the software rasterizer, not a phone's GPU. Draw is the JavaScript side. Eye: the eye camera at the run's foot. Wide: the play angle from 60 cells away.

| Island           | Camera | Draw ms p50 / p95, main then walls | Frame ms p50, main then walls | Triangles drawn, main then walls |
| ---------------- | ------ | ---------------------------------- | ----------------------------- | -------------------------------- |
| plateau-7        | eye    | 2.8 / 6.7, 2.9 / 5.3               | 257, 266 (+3.6%)              | 1,181,752, 1,234,724 (+4.5%)     |
|                  | wide   | 3.5 / 5.7, 3.8 / 5.8               | 390, 407 (+4.5%)              | 1,690,882, 1,802,564 (+6.6%)     |
| desert-plateau-3 | eye    | 2.5 / 6.4, 2.4 / 5.5               | 75, 76 (+1.5%)                | 258,946, 277,906 (+7.3%)         |
|                  | wide   | 3.1 / 7.0, 2.9 / 4.7               | 153, 154 (+1.0%)              | 565,578, 615,668 (+8.9%)         |
| mesa-5           | eye    | 2.7 / 6.5, 2.9 / 5.8               | 70, 71 (+1.0%)                | 216,424, 213,310 (-1.4%)         |
|                  | wide   | 3.3 / 5.0, 3.4 / 5.0               | 186, 191 (+2.7%)              | 804,360, 798,364 (-0.7%)         |
| volcanic-6       | eye    | 2.7 / 4.9, 2.9 / 4.9               | 223, 241 (+8.1%)              | 1,071,416, 1,115,340 (+4.1%)     |
|                  | wide   | 3.4 / 6.2, 3.5 / 5.4               | 468, 485 (+3.5%)              | 1,986,150, 2,053,908 (+3.4%)     |
| forest-plateau-2 | eye    | 3.1 / 5.2, 3.3 / 5.1               | 278, 279 (+0.3%)              | 1,448,558, 1,521,826 (+5.1%)     |
|                  | wide   | 4.3 / 7.4, 4.6 / 6.5               | 497, 520 (+4.5%)              | 2,192,928, 2,329,758 (+6.2%)     |

The triangles drawn rise more than the island's total (up to +8.9% against +2.49%). A chunk's faces are drawn by the way they face, and a whole class is skipped when the camera is behind all of it (`drawFacing`). A slanted strip faces two ways at once, so its class plane is set to never skip, and a chunk with one slanted strip draws its east or west faces from every side.

## Flag

Off. The five problems are fixed and measured, and the island totals stay under 3%. The cost in view does not: up to 8.9% more triangles drawn and up to 8% longer frames in software. What remains before it goes on:

1. Cull slanted strips by their own facing, for example a seventh face class with two planes, so the triangles drawn rise about as much as the island's total.
2. A thin seam where two flat walls meet at a concave corner (desert-plateau-3's eye frame, the lip's top left). It is real geometry, not a crack, but reads as a dark notch.
3. Pinhole pale dots on walls. In forest-plateau-2's eye frame at 832 they run down one vertical line, so they are most likely cracks where a strip's edge meets the next strip's or a riser's vertices at a different point (T-junctions). Not traced yet.
4. A cliff into lava keeps its convex corners toothed at sub 8 (8 teeth on the synthetic run), where a lava cell's middle keeps a notch a quarter cell wide.
5. A mesa's long diagonal walls keep the cells' steps (mesa-5's run: RMS 0.422, 14 teeth, as with cliffs off). That is the trade for square tops.

## Sheets

- `<island>-compare-390.jpg`, `-344.jpg`: above, play and eye, the middle 60% of each frame.
- `<island>-compare-700.jpg`, `-832.jpg`, `-1440.jpg`: above and eye.
- forest-plateau-2's eye camera stands against another wall and shows only rock, as on 27 November; judge that island by its above and play frames.
- `close-wall-390.jpg`, `close-wall-700.jpg` (plateau-7), `close-desert-wall-*.jpg`, `close-mesa-*.jpg`: a wall and a mesa from a few cells away.
