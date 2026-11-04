# Nature that is never the same twice, measured (4.4.5, part A)

Same setup as `view-4.4.md`: `scripts/perf-phone.mjs` on `lab/perf.html` in a phone sized headless Chromium (Pixel 7, touch, 30 frames a second at most), software WebGL, pixel density 1, two runs per line. Islands as the game makes them (`mixed=1`): seed 7 is a desert at medium and a mixed island at large, seed 3 a tundra at medium and a mixed island at large. "Before" is main at e117292 (4.4.1 and the roadmap), "after" this branch. Raw lines: `nature-4.4.5-before.jsonl` and `nature-4.4.5-after.jsonl`. Runs vary by about 10% (the camera turns, creatures move).

## The HUD and the bench, before and after

| Island           | HUD sim p50 / p95 | HUD calls | HUD triangles | bench tick p50 / p95 | bench draw p50 / p95 | creatures |
| ---------------- | ----------------- | --------- | ------------- | -------------------- | -------------------- | --------- |
| Medium 7, before | 6.8-6.9 / 18      | 29-33     | 61-72k        | 2.8-3.2 / 4.6-5.1    | 3.0-3.2 / 5.5        | 77-85     |
| Medium 7, after  | 5.0-9.4 / 19-21   | 36-42     | 61-75k        | 2.9-3.1 / 5.1-5.2    | 3.1-3.3 / 5.5-5.8    | 95-106    |
| Medium 3, before | 4.7-6.2 / 14-17   | 24-30     | 46-56k        | 2.6 / 4.2-4.9        | 3.5-4.4 / 5.8-7.8    | 74        |
| Medium 3, after  | 4.9-7.6 / 16-18   | 35-37     | 59-66k        | 2.4-3.0 / 4.3-5.3    | 3.6-5.1 / 6.4-9.2    | 93-98     |
| Large 7, before  | 14.8-21.6 / 40-44 | 35-60     | 94-143k       | 5.8-6.1 / 9.6-10.2   | 4.8-5.1 / 8.4-8.5    | 166-168   |
| Large 7, after   | 11.6-22.4 / 42-46 | 47-71     | 113-158k      | 5.8-6.2 / 9.8-10.0   | 5.2-5.3 / 9.2-10.0   | 168-185   |
| Large 3, before  | 9.9-27.5 / 39-42  | 39-52     | 185-207k      | 5.5 / 8.9-9.2        | 6.6-6.9 / 11-12.6    | 138-150   |
| Large 3, after   | 14.1-25.3 / 33-44 | 59-72     | 229-250k      | 5.3-5.5 / 9.1-10     | 7.0-7.1 / 13.3-14.2  | 156-162   |

The whole scene's triangles, counted per mesh in the page (every instance, nothing culled): medium 7 119k to 124k (+5%), medium 3 118k to 123k (+4%), medium 21 216k to 235k (+9%), large 7 213k to 232k (+9%), large 3 300k to 345k (+15%). Terrain and water are unchanged; the difference is the covers.

What it says:

1. **The simulation costs what it did**: the bench tick (a tick alone, what a phone's CPU pays) is within the noise on all four islands. Succession, the balance checks every five seconds, worn paths every second and villages every twenty seconds do not show. The HUD's simulation numbers move more between two runs of one build than between the builds.
2. **Drawing costs a little more**: about 0.2 to 0.5 ms of draw at p50, from more draw calls (one per plant, rock and house look on the island: 8 to 12 more on a medium island, 12 to 20 on a large one) and 4% to 15% more triangles. Still inside what 4.4 measured with everything on (medium 134-169k, large 183k, 36 to 49 calls), except large seed 3 at 229-250k triangles, the busiest island here (a jungle and a swamp full of reeds).
3. **More creatures**: 15 to 25 more on a medium island, from the regional animals. Their cost is in the tick numbers above.
4. **The first version cost twice the triangles** (seed 3 from above 55k to 110k): lily pads drawn on sea cells (a flag left on water), flower drifts four times too dense in the tundra, and models with two to three times the old boxes (three trunk segments, three crown parts). Trunks are one box now (the view leans the whole tree), crowns two, and two or three shapes per tree style became one (each shape is a draw call per style: calls had gone from about 45 to 80 on a large island). Reeds, ferns, berries, lilies and tufts were thinned twice.

## The frames

`docs/visual-checks/4.4.5/`: `seed3-`, `seed7-` and `seed21-before-after.jpg` (up close, then from above, before on the left), `ten-islands-before.jpg` and `ten-islands-after.jpg` (seeds 1 to 10, medium, as the game makes them), `rare-variants.jpg` (a glowing shore at night, a red autumn forest, a petrified forest by a lake, a crystal desert's edge, a flamingo lagoon's coast, bamboo by a village, a cherry grove, a glowing mushroom wood at night), `rain-in-front-of-water.jpg` (before, the rain stops at the sea; after, it falls in front of it).

What the frames say, honestly: up close no two islands look alike now (the trees, the undergrowth, the houses, the wells, the animals). From above at this distance the land still decides the look, and seeds 1 to 10 happen to hold four tundras (seeds 1, 2, 3 and 8; 17% of 400 seeds are tundra at mid sliders) that read alike from far away. Part B's wonders and first look flight are the answer to that distance.

## Generation and saves

Generation in Node: a medium island 116 to 162 ms on average over seeds 1 to 10 (+46 ms), a large one 138-238 to 289-334 ms (about +120 ms): the ecology pass, its surveys, the lake fill it checks against, and the refuges (each species' habitat sampled per block). Once per new island, behind the reset dialog. A save: medium 0.42M characters (0.07M gzipped), giant 3.0M (0.45M gzipped, kept gzipped past 400k as in 4.4).

## How to measure again

```bash
npx vite --port 5174 &
RUNS=2 node scripts/perf-phone.mjs medium 8 "dpr=1&mixed=1&seed=7"
RUNS=2 node scripts/perf-phone.mjs large 8 "dpr=1&mixed=1&seed=3"
node scripts/perf-shots.mjs /tmp/shots "near:mixed=1&seed=7&dpr=1&time=60&dist=0.14&phi=0.9" "cherry:mixed=1&seed=39&dpr=1&time=60&tx=21&ty=94&dist=0.14&phi=0.9"
```

`tx` and `ty` (4.4.5) point the camera at a cell.
