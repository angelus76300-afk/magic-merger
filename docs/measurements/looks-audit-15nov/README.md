# Looks audit, 15 November 2026

The owner, on main after #151, #159, #162 and #164: "Let's just keep 1/8 all the time, the transitions look super weird. The sand looks quite weird. I like having terrain variation but there is a bit too much of it when the terrain should be flat, can we keep it but just on bigger patches, it looks a bit too granulated now. ... Love some of the finer trees that got updated, don't like the old ones."

## How the frames were taken

`scripts/looks-audit-frames.mjs`, the Perf Lab on the high preset, `dpr=1`, theta 45 degrees.

- Islands: `village` (temperate coast, seed 7, its first village), `sand` (desert coast, seed 7, a beach under a rise), `peaks` (volcanic ridges, seed 11, `peaks=1`, its highest dry cell).
- Zooms: `eye` (distance 8, phi 1.36), `close` (12, 1.0), `mid` (28, 0.95), `whole` (0.55 of the island's side, 0.95).
- Light: `day` (time 60) and `low` sun (time 194).
- Sizes: 344 by 882 (the Fold folded) and 700 by 830 (unfolded).

`main/` holds main at `64e2571`, 48 frames. `after/` holds this branch at 344 by 882. Three after frames are missing: the sand and peaks whole views, and the peaks whole at low sun, because one frame took more than 240 seconds in the software renderer (see the numbers below). Each folder's `frames.jsonl` has the triangles of each frame as the renderer counted them, the shadow pass included.

## What looked wrong on main

1. **Rings where the land changes.** The land is eighths near the camera, quarters a little farther and whole cells beyond, and the change shows as a line across the view.
   - `main/peaks-close-day-344x882-main.jpg`, `main/peaks-eye-day-344x882-main.jpg`: the summit chunk is in whole cells next to fine snow. Snow blocks a cell wide stand beside slopes of eighth cubes.
   - `main/village-mid-day-344x882-main.jpg`: fine slopes in the middle, quarter cubes round them.
   - `main/village-whole-day-344x882-main.jpg`, `main/sand-whole-day-344x882-main.jpg`: the whole island in whole cells, a different shape and different colours from close up.
2. **Flat ground too granular.** `main/village-close-day-344x882-main.jpg`, `main/village-close-low-344x882-main.jpg`.
   - Each cell picks one of its ground's three or four colours, so grass is a checkerboard of cells.
   - On top of that the tone patches change every 2.6 cells, with a second speckle every 0.8 cells.
   - Each generator height is followed cell by cell, so flat ground breaks into rings of one-cube steps. The dirt plaza is full of holes.
3. **Sand.** `main/sand-close-day-344x882-main.jpg`, `main/sand-mid-low-344x882-main.jpg`. The sand reads as a washboard, for three reasons:
   - Every eighth step has a dark side, which shows strongly on a bright ground.
   - The slope light was read from the next column only, so each terrace was light at one edge and dark at the other.
   - A dark line was drawn at the foot of every step.
4. **Old trees.**
   - `main/village-whole-day-344x882-main.jpg`, `main/village-mid-day-700x830-main.jpg`: past the cube budget the old two-box trees.
   - `main/village-eye-day-344x882-main.jpg`: the eye view's trees are all old box models.
   - Cube trees were scaled with the tree, so their cubes differed in size from tree to tree.
5. **Snowy slopes as a maze.** `main/peaks-mid-low-344x882-main.jpg`: white tops over black risers, because snow covered only a quarter voxel of each wall.
6. **Black cliff walls.** `main/peaks-close-day-344x882-main.jpg`: the volcanic stone (0x4a4648, deep 0x2e2a2c) under the walls' own shade reads as flat black slabs.
7. Seen, not changed here:
   - Lava pools are whole-cell squares (`main/peaks-close-day-344x882-main.jpg`): fluids are drawn by cell.
   - Shrubs and cacti are plain boxes (`main/sand-eye-day-344x882-main.jpg`).
   - From the whole view, fog weather reads as a flat sheet over the island (`main/peaks-whole-day-344x882-main.jpg`). The same view with weather off is clear.

## What changed

1. **One size at every distance.**
   - The land: every chunk is drawn in eighth voxels (`FINE_SUB`) at every distance. There is no quarter ring and no whole-cell view.
   - Houses, building sites and trees: in cubes at every distance, the eye view included (`cubes.ts`: `lodAt` is 1 whenever the cubes are on).
   - Spell looks: `LOOK_VOXEL` is 0.125 and `FAR_COARSEN` is 1.
   - Trees keep their cube size. A tree is 6 to 13 cubes across by its size (`treeSize`) and is placed at scale 1, so a bigger tree has more cubes, never bigger ones.
   - Fine chunks are now indexed meshes with byte colours: four vertices a face instead of six, about half the memory.
2. **Flat ground in wider, softer patches.**
   - Ground colour: the fine land takes the mean of the ground's colours, not one per cell.
   - Tone patches: three shades of plus or minus 4%, every 6.5 cells.
   - Swell: about a tenth of a voxel either way, over 7 cells.
   - Rounding: its wobble now changes over a cell, not half a cell.
   - Heights: the generator's heights are averaged over each cell and the cells its land joins (`softValue`), so single-cell bumps become swells and slopes keep their course.
3. **Sand.**
   - The slope light is read over two columns either way and three rows, so a whole terrace takes one light.
   - The dark line at each step's foot is gone.
   - On sand and snow a step's dark side is half as dark.
   - See `after/sand-close-day-344x882-after.jpg` and `after/sand-mid-low-344x882-after.jpg`. At mid zoom the contours still show, softer.
4. **Trees.** No old box tree at any zoom while the cubes are on (`after/village-whole-day-344x882-after.jpg`, `after/village-eye-day-344x882-after.jpg`).
5. **Snow and rock.**
   - Snow covers its steps' walls down to a voxel below the cell's top, and lies on the cliffs' small ledges.
   - Dark stone, soil and deep rock below a luminance of 95 are raised toward it, at most by half.
   - See `after/peaks-mid-low-344x882-after.jpg`. Snowy slopes are white now, but a dark band remains under each snow terrace where cells differ by two voxels or more.
6. **Checks** (`scripts/terrain-looks-test.ts`, `scripts/cubes-test.ts`):
   - "one size of cube": every chunk is in eighths close, mid and over the whole island, and the land's meshes are the same at the three zooms. Fails on main, where the far view has 0 fine chunks.
   - "fieldFine equals fieldHeight": the mesher's own heights against groundAt's, at 64 points of every chunk. It fails with fieldFine lifted by 0.5 (worst gap 0.5), while the old "stands on the drawn ground" check still passes with that lift.
   - Trees on the cube grid at every size; looks at `CUBE`.
   - The shore sample in the "stands on" check had read the next row's first cell as the east neighbour of the last column. That never showed while far chunks were whole cells. Fixed.

With every look switched off, land and water are still main's, byte for byte (the existing hashes).

## Numbers

### Land triangles, whole island, node (`scripts/looks-count.ts`)

| Island               | Main far (whole cells) | All eighths, first try | This branch |
| -------------------- | ---------------------- | ---------------------- | ----------- |
| medium coast (152)   | 69 762                 | 2 452 094              | 2 078 820   |
| large mixed (208)    | 112 818                | 3 403 194              | 2 622 706   |
| small plateau desert | 40 676                 | 1 144 810              | 859 452     |

On the medium coast, with every shading switch off, the slopes alone still cost about 1.25 million. Most of that is the eighth steps of real slopes: about 650 000 in risers and 420 000 in tops. Calmer colours brought the count down by 15 to 25%.

Trees in cubes on a whole island (`scripts/looks-trees-count.ts`): 2 438 trees and 1.68 million triangles on the medium coast, 2 263 trees and 1.55 million on the large mixed island, 317 trees and 172 000 on the plateau desert.

### Drawn triangles and time per zoom, browser

`scripts/looks-zoom-bench.mjs`: 344 by 882, high preset, village island, land finished first. Triangles are the renderer's (shadow pass included). Software WebGL, so raster is the CPU drawing pixels: compare the two columns, not against a phone. Draw and raster are p50 / p95 ms over 5 frames.

| Zoom  | Triangles, main | Triangles, branch | Draw (JS), main | Draw (JS), branch | Raster, main | Raster, branch |
| ----- | --------------- | ----------------- | --------------- | ----------------- | ------------ | -------------- |
| eye   | 1 413 264       | 4 791 412         | 5.8 / 17.2      | 7.5 / 28.6        | 304          | 744            |
| close | 1 006 398       | 4 791 418         | 5.7 / 9.3       | 6.8 / 62.5        | 263          | 748            |
| mid   | 982 242         | 5 246 016         | 7.2 / 11.3      | 6.4 / 29.7        | 277          | 797            |
| whole | 422 022         | 5 435 366         | 6.2 / 17.4      | 5.4 / 25.5        | 195          | 872            |

Building the whole island's fine land takes about 2 seconds of work (medium coast), spread at 4 ms a frame: about 500 frames, or 8 seconds at 60 a second, during which unbuilt chunks show the whole-cell land.

The close view costs as much as the whole view for two reasons. The sun's shadow pass draws every chunk, and the tree instances are not culled, so the whole island's land and trees are drawn twice even when the camera looks at one village.

This is far over the 600 000 budget. Nothing visible has been cut; the choices are in the pull request.
