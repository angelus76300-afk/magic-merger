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

## Second pass, 15 November: culling, the seam, the volcano, assets, shadows

The owner on the draft: "we can see the seam ... it was extremely obvious", "Option 1 if you are confident in the results. 2 is also fair", "the new version is pretty good except the top of the volcano, which has big cubes still", "review all assets", and "Shadows though are very bad and flicker a lot".

### 1. What the camera cannot see is not drawn

- Cube trees outside the view whose shadow cannot reach it are not drawn. The test sweeps each tree's sphere down the sun's ray to the island's floor (`view.ts` `cullCubeTrees`).
- A land chunk whose shadow cannot reach the view does not cast into the shadow map.
- Each pass draws only the walls that can face it. The land is drawn from its front side, and three draws the shadow map from the back side, so a wall facing away is never drawn either way. Each fine chunk's faces are sorted by the way they face, and two meshes share the geometry, one drawing the north, top and west run, the other the east and south run (`terrain.ts` `drawFacing`).
- Proof (`scripts/looks-cull-proof.mjs`, frames in `cull/`): the same frame with culling off and on, at close, mid and whole. **Max difference 0, mean 0, at all three zooms.** The noise floor, the same frame drawn twice, is also 0. Triangles drawn: close 4.92M → 1.20M, mid 5.34M → 1.55M, whole 5.44M → 2.31M.

### 2. Quarter cubes where an eighth is under a pixel: measured, left off

`scripts/looks-seam.mjs` and `scripts/looks-seam.py` (crops in `seam/`):

- The camera is set so the line between eighth and quarter chunks crosses the screen. The same frame is drawn all in eighths and with the switch, between two all-eighths frames for the noise.
- The script crops an 80-pixel strip at the seam and saves both crops and an enlarged side by side.

| View, threshold   | Chunks in quarters | Strip mean diff | Noise mean | Pixels off > 8 | Noise | Triangles     |
| ----------------- | ------------------ | --------------- | ---------- | -------------- | ----- | ------------- |
| low, 3 px         | 10 of 25           | 0.087%          | 0.074%     | 0.76%          | 0.66% | 1.78M → 1.40M |
| whole, 1.5 px     | 3                  | 1.06%           | 0          | 10.9%          | 0     | 2.49M → 2.14M |
| whole, 2 px       | 10                 | 1.36%           | 0          | 14.4%          | 0     | 2.49M → 1.90M |
| whole, 3 px (all) | 20                 | 2.79% (frame)   | 0          | 31% (frame)    | 0     | 2.49M → 1.41M |

Only far, hazy land passes (low view, 3 px). The whole view does not pass at any threshold that switches a chunk, and at 1 px nothing switches. So the switch stays off (`LOD_PX = 0`) and every chunk stays in eighths.

### 3. The volcano's big cubes

Two causes:

- **Basalt was treated as built ground.** `builtColor` lists it as built, so the fine land drew the crater rim as plain whole-cell columns: the black slabs. In the fine land basalt is now natural ground, with slopes, strata and lighter stone (`fineBuilt`).
- **Lava picked one of its three colours cell by cell**, a checkerboard of whole cells. With the fine land on, every fluid other than water takes the mean of its colours.

What remains: the lava's surface is flat and its edge follows cells, and the tall crater terraces are the simulation's own cell heights. See `assets/lava-main.jpg` against `assets/lava-branch.jpg`.

### 4. Assets at 1/8

`assets/` holds one close frame each at 344 by 882, main and branch (`scripts/looks-assets.mjs`); the sheets are `assets/assets-sheet-1.jpg` to `-3.jpg`.

- **Converted** (at draw time, cached, nothing stored changes; with the cubes off they draw as before):
  - Wonders: their boxes are filled into the 1/8 grid (`shapes.ts` `boxesInCubes`).
  - Stored spell looks of plain boxes, held looks included, scaled before they are filled, so the cubes keep their size.
  - Every cover's old box model: shrubs, cacti, flowers, crops, fences, berries. They are placed at scale 1.
- **Still a problem after conversion:** a large plain box filled with eighth cubes is still one smooth box, with only rounded edges and corner shade (`assets/wonder-branch.jpg`, `assets/looks-branch.jpg`, `assets/cacti-branch.jpg`). To read as small cubes they need tone patches by cube, like the trees and the land. That is a style choice not made here.
- **Not converted:**
  - Villagers and animals (`rigs.ts`, `figures.ts`): free boxes that turn every frame. A cube grid per part would make thin limbs vanish or crawl as they turn. That needs a per-part grid design of its own.
  - Effects (sparks, puffs, flames, bolts): moving light, not solid things.
  - The lava's cell-shaped edge (fluids are drawn per cell).

### 5. Shadows

The flicker came from the sun turning a little every frame: the shadow map's texels are laid across the small cubes differently each time, so whole crowns and grass patches switched between lit and shaded. Also, the map's size followed the zoom in steps of 8 cells, so its texels changed size often.

The fix (`looks.ts` `placeSun`):

- The sun turns in steps of 0.75 degrees, about one a second of island time; each step moves a shadow by about a cube.
- The map's size is set in bands of 32, 48, 64, 96, 128 cells, so zooming within a band keeps the texels.
- Texel snapping and the four-tap filter with normal offset stay.

`scripts/looks-shadow-flicker.mjs` counts pixels that change by more than 12 between consecutive frames, with the sun as before (`sunSteps` off) and as now. Strips of four consecutive frames are in `shadows/sun-strip-before.jpg` and `shadows/sun-strip-after.jpg`.

| Move (camera still unless named)       | Before, mean / max    | After, mean / max |
| -------------------------------------- | --------------------- | ----------------- |
| the sun moving (0.25 s of day a frame) | 1 268 / 6 600         | 565 / 754         |
| pan, zoom, orbit                       | the same in both runs | the same          |

The pan, zoom and orbit runs counted the same pixels with the old and new sun (texel snapping already held the map still while the camera moved). The shadow pass in the software renderer: 2.1 ms before and 4.6 ms after on one still frame, within this renderer's noise; the pass itself does the same work.

### 6. Triangles and draw time per zoom (344 by 882, high, village island)

| Zoom  | Main  | First pass | Now   | Raster p50: main / first / now |
| ----- | ----- | ---------- | ----- | ------------------------------ |
| eye   | 1.41M | 4.79M      | 1.15M | 304 / 744 / 442 ms             |
| close | 1.01M | 4.79M      | 1.20M | 263 / 748 / 421 ms             |
| mid   | 0.98M | 5.25M      | 1.35M | 277 / 797 / 443 ms             |
| whole | 0.42M | 5.44M      | 2.29M | 195 / 872 / 631 ms             |

Close and mid are still about twice the 600 000 target. What is left is the land in view at eighths and its shadow pass. The only way under the target found here is coarser cubes far away, and the seam check says that shows.
