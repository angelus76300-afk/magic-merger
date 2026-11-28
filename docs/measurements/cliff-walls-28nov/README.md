# Cliffs: flat walls that follow the land, 28 November

The owner's decision on 27 November, typed in the lead session: "cliffs: flat walls". The cliff outline (`cliffOutline` in `src/sim/voxel/terrain-fine.ts`, behind `CLIFF_OUTLINE.on`) now draws each wall between its lip's points as one slanted flat strip, keeps a mesa's corners on the cells' outline, lets the rock at a cliff's foot fill lava, and has a guard so a walker never stands on land drawn a cliff away from its cell. The flag is on in the game from this pull request's last commit (see "Flag" below).

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

Kept from 27 November, with flat walls on: sub 8 RMS / teeth 18.4° 0.038 / 0, 26.6° 0.050 / 0, 45° 0.041 / 0, 63.4° 0.053 / 0; sub 4 0.068, 0.077, 0.082, 0.077, all 0 teeth. Terrace (three levels): RMS 0.057 / 0.059, 0 teeth, no level of its own (main: 0.157 / 0.164, 14 teeth). Water beds still trade nothing: 0 of 67 and 0 of 38 land columns in water cells stand more than SHORE_LOW over the water. With the flag on, the lake hashes of `lake-weed-test` are unchanged; the ground blend's ONE_LAND hash moves from `370d4587` to `e550a1c6`, and is `370d4587` again with `CLIFF_OUTLINE.on` false, so nothing but the outline changed it.

## Triangles (`scripts/cliff-walls-count.ts`, whole island, every chunk in eighths)

Counted as the index holds them: a wall piece cut to share its neighbours' corners is often a triangle, and its empty half is left out of the index (`quadsGeometry`).

| Island           | Main      | Flat walls         | Slanted wall triangles |
| ---------------- | --------- | ------------------ | ---------------------- |
| plateau-7        | 1,848,880 | 1,869,204 (+1.10%) | 14,927                 |
| desert-plateau-3 | 869,300   | 897,199 (+3.21%)   | 21,779                 |
| mesa-5           | 1,083,270 | 1,040,232 (-3.97%) | 0                      |
| volcanic-6       | 2,207,868 | 2,211,402 (+0.16%) | 2,085                  |
| forest-plateau-2 | 1,661,814 | 1,701,744 (+2.40%) | 38,649                 |

Up from the first pass (desert-plateau-3 +2.49%, 14,250 slanted) for two fixes below: wall pieces now split where their neighbours' edges break (the pinholes), and the lip's kinks are eased (the concave seam). Without the easing desert-plateau-3 is +3.09%; easing every crossing, not only the kinks, was +3.39%. Mesa-5 drops because its walls stay on the cells' sides, which take fewer faces than main's corner cut. Tile build time p50 rises from about 5.5 ms to 7.2 to 8.8 ms in Node.

## Frame time at 344 by 882 (the Z Fold folded)

Sixty frames with the camera held, each waited for (`BENCH=60`). SwiftShader in this container, so the frame column is the software rasterizer, not a phone's GPU, and it swings by up to about 9% between runs of the same build (main's plateau-7 wide: 410, 412.7 and 432.1 ms in three runs). Eye: the eye camera at the run's foot. Wide: the play angle from 60 cells away. Slanted strips are culled by their own facing (below).

| Island           | Camera | Draw ms p50 / p95, main then walls | Frame ms p50, main then walls | Triangles drawn, main then walls |
| ---------------- | ------ | ---------------------------------- | ----------------------------- | -------------------------------- |
| plateau-7        | eye    | 3.2 / 6.7, 3.3 / 6                 | 291.7, 297.6 (+2.0%)          | 1,181,490, 1,188,888 (+0.6%)     |
|                  | wide   | 3.9 / 6, 3.8 / 6.6                 | 432.1, 446.1 (+3.2%)          | 1,691,098, 1,709,042 (+1.1%)     |
| desert-plateau-3 | eye    | 2.9 / 5.4, 3.2 / 7                 | 83.7, 90.4 (+8.0%)            | 259,186, 265,895 (+2.6%)         |
|                  | wide   | 3.4 / 6, 3 / 5                     | 172.3, 170.1 (-1.3%)          | 564,906, 582,972 (+3.2%)         |
| mesa-5           | eye    | 2.9 / 6, 3.1 / 5                   | 78.4, 74.6 (-4.8%)            | 216,424, 211,452 (-2.3%)         |
|                  | wide   | 3.4 / 4.8, 3.6 / 6.4               | 209.9, 191 (-9.0%)            | 804,120, 792,084 (-1.5%)         |
| volcanic-6       | eye    | 3 / 5.4, 2.9 / 6.9                 | 251.7, 243.9 (-3.1%)          | 1,071,428, 1,075,549 (+0.4%)     |
|                  | wide   | 4 / 5.9, 3.5 / 6.2                 | 499.6, 505.2 (+1.1%)          | 1,985,862, 1,992,106 (+0.3%)     |
| forest-plateau-2 | eye    | 3.1 / 6.2, 3.6 / 6.4               | 280, 302.8 (+8.1%)            | 1,449,334, 1,466,385 (+1.2%)     |
|                  | wide   | 4.7 / 8.1, 4.8 / 8.9               | 517, 529.5 (+2.4%)            | 2,193,712, 2,228,781 (+1.6%)     |

Triangles drawn: +0.3 to +3.2% (desert-plateau-3 wide the most), mesa-5 -1.5 and -2.3%. The first pass was up to +8.9%. Frame time: from -9.0% to +8.1%, mean +0.7% over the ten rows, with no tie to the triangles (mesa-5 wide draws fewer and swings -9%); a second run of the same build before the far-chunk change gave -4.5% to +5.0%. In this container the frame time is noise at this size of change.

### Culling the slanted strips

The first pass drew up to 8.9% more triangles in view than main against +2.49% on the whole island: a slanted strip faced two ways at once, so its chunk drew its east or west faces from every side. Now a slanted face has a class of its own (`FACE_SLANT`), drawn by the camera with the tops (a strip is a few faces a chunk) and left out of the sun's shadow pass except in a second copy at the end of the index (`FACE_SLANT_SUN`), so neither pass pulls in a whole axis class. `scripts/looks-cull-proof.mjs` on desert-plateau-3 with `cliffs=outline`: culling on and off draw the same frame (close and mid 0 pixels apart; whole, 0 pixels over 24 in a channel).

## The pinholes and the concave seam

- Pinholes: rows of pale dots down a wall, where two strips' upright edges met at different heights (one from 7 to 9.75 beside one from 7 to 9.625), a T-junction the rasterizer leaves open. Each wall's upright edge is now cut at every height any wall ending at that point breaks at (`slantFlush`). A new check in `cliff-outline-test.ts` counts upright edges with no matching edge on the next wall: 0 on all five angles, the terrace and the lava foot at sub 8 and 4. On forest-plateau-2's eye frame at 832 a detector of lone bright pixels finds 23 dots before and 0 now: `close-pinholes-forest-832.jpg`.
- Concave seam: at a concave corner on desert-plateau-3 the lattice's levels turned the line by about 60 degrees within one column, and that column's strip faced the sun as a pale band. A crossing more than 0.12 of a column's side off its neighbours' line now moves half way toward it, three times (`smoothCuts`); straight runs stay put, so their strips still join. `close-seam-desert-390.jpg`: the band before and the eased corner now. RMS, teeth and ribs on the synthetic cliffs are unchanged.

## Far chunks

A far chunk (drawn in blocks of two columns from far away) drew no flat walls, so where it met a chunk in eighths the border's steps stood on different columns: `far-land-test`'s border check found 1,865 open samples. A far chunk now cuts its walls along its sides, as far in as a border column's crossings read (`FAR.edge` plus 4 columns), and blocks no column a wall crosses. The check now also reads a top by its corners (a cut column's top is a three to five cornered piece, smaller than its box) and counts a wall whose foot crosses the row; with that it finds 0 open both beside far chunks and between chunks in eighths, and still 1,865 with the far walls taken out. A far chunk's triangles: 0.59 of the same chunk in eighths, as before (566,784 against 560,668 without far walls).

## Flag

On. The lead's conditions, measured: triangles drawn within about 3% of main at 344 by 882 (+3.2% at most, desert-plateau-3 wide; frame time inside the software rasterizer's swing), the pinholes gone (0 cracks, 0 dots), the concave seam eased. Left as they are:

1. Lava: a cliff into lava keeps teeth at its convex corners at sub 8, where a lava cell's middle keeps a notch a quarter cell wide. Synthetic 26.6 degree cliff: 8 teeth at sub 8 (main 17), 0 at sub 4 (main 17); volcanic-6's run: RMS 0.202, 1 tooth (main 0.276, 7). Not fixed: the fill would have to take a lava cell's middle, which the rule that no cell's middle changes forbids.
2. A mesa's long diagonal walls keep the cells' steps (mesa-5's run: RMS 0.422, 14 teeth, as with cliffs off). That is the owner's trade for crisp mesa tops.
3. Desert-plateau-3's eye frame keeps 9 lone dots, the dark notches of the lip against the sky, not cracks.

## The 28 November playtest

Three things the lead's playtest found, measured and fixed on the same branch.

### Walker guard

The guard read the outline's trade (`outlineTrade` of `outlineOfLand`) instead of what the mesher draws, so a lizard at (13.00, 110.62) on desert-9 stood on a point drawn at 7 against 4.375 at its cell's middle. `Terrain.drawnOff` now reads `drawnTop` at the point and at the cell's middle (the fine tops the mesher drew) and refuses a step where they differ by more than a step and a cliff is beside the cell; it falls back to the old reading only where the chunk is not drawn in eighths. The test (`walkGuardRun`) now builds the fine land and counts, once a second, ground creatures whose drawn top at their point and at their cell's middle differ by more than 1.5.

Node, desert-plateau-3, 111 beasts at cliff feet, 20 s: main 11 of 2,078 samples, flat walls 0 of 2,145, flat walls without the guard 24 of 2,126.

Browser (the playtest's walker count, 60 s, a sample a second, every ground creature), main then flat walls, over eight runs:

| Run | desert-9 | desert-plateau-3 |
| --- | -------- | ---------------- |
| 1   | 9, 0     | 1, 0             |
| 2   | 16, 2    | 1, 1             |
| 3   | 24, 2    | 4, 0             |
| 4   | 17, 0    | 2, 1             |
| 5   | 12, 2    | 3, 0             |
| 6   | 16, 0    | 1, 1             |
| 7   | 12, 0    | 5, 0             |
| 8   | 9, 0     | 6, 0             |

Runs 1 to 3 are before the two fixes below, 4 to 6 with the first sliver limit (0.03), 7 and 8 with the final code. At or below main in every run. The playtest's own count with the old guard was 13 to 132 on desert-9 and 19 to 55 on desert-plateau-3.

### The sawtooth along a wall's grass

Real. Where the line ran a few degrees off a column's side, the side's wall (drawn whole, down to the low land) stood behind the crossed column's high part, at most a hundredth of a cell from its strip, and the two showed through each other in triangles. Counted as wall triangles whose middle lies inside another wall triangle facing the same way, within 0.004:

| Island           | Main | Before | Now |
| ---------------- | ---- | ------ | --- |
| desert-plateau-3 | 2    | 196    | 2   |
| desert-9         | 0    | 650    | 0   |
| forest-plateau-2 | 0    | 429    | 16  |

Three fixes in `terrain-fine.ts`: below the high part, a side facing a crossed column is drawn only beside its low part (`lowStretch`, with ghosts so two tiles cut it alike); a line through a corner that would cut off under 1% of a column leaves the column whole (`SLIVER`); a step on a crossed side stops where the column's own side wall starts. `cliff-outline-test` checks desert-plateau-3 against main. The sliver limit costs some flatness: the ribs check (area at mid-height turned more than 10 degrees) reads 1.7 to 4.1% at sub 8 and 2.5 to 3.9% at sub 4, against 0 to 1.4% before, within its 10%; a limit of 3% read up to 12.3%.

### Sky-blue pixels at the lip

Real. A run of strips along a straight line was joined into one piece, and a run of high tops into one quad, but over different runs (a strip breaks where the grass band's wavy edge changes, a top where its land does), so a corner of one fell inside the other's edge: a T-junction, which the rasterizer can leave open. Corners inside an edge off the axes: desert-9 2,565 before, 7 now; desert-plateau-3 3 (main 0). Neither is joined now (`JOIN_ALONG`). `close-sky-dots-desert9-390.jpg`: the same camera before (top) and now, three dots down a wall's corner and a short line gone; the dot at the right is a pebble.

### Triangles after these fixes

Whole island, every chunk in eighths (`cliff-walls-count.ts`), flat walls against main: plateau-7 +0.99% (was +1.10%), desert-plateau-3 +3.19% (+3.21%), volcanic-6 +0.20% (+0.16%), forest-plateau-2 +2.78% (+2.40%); mesa-5 has no cut column and is unchanged. Unjoined pieces add triangles, uncut slivers take some away.

### The low look

A phone on the "low" look (`graphics.ts`, `fine: false`) draws no land in eighths, so it sees none of this change, and the walker guard is off there.

## Sheets

- `<island>-compare-390.jpg`, `-344.jpg`: above, play and eye, the middle 60% of each frame.
- `<island>-compare-700.jpg`, `-832.jpg`, `-1440.jpg`: above and eye.
- The main and outline columns are the frames of the first pass (unchanged code paths); the flat walls column is this pass's.
- forest-plateau-2's eye camera stands against another wall and shows only rock, as on 27 November; judge that island by its above and play frames.
- `close-wall-390.jpg`, `close-wall-700.jpg` (plateau-7), `close-desert-wall-*.jpg`, `close-mesa-*.jpg`: a wall and a mesa from a few cells away.
- `close-seam-desert-390.jpg`, `close-pinholes-forest-832.jpg`: the two fixes, before and now.
