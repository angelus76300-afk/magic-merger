# Wonders and villages that differ, measured (4.4.5, part B)

Same setup as `nature-4.4.5.md`: `scripts/perf-phone.mjs` on `lab/perf.html` in a phone sized headless Chromium (Pixel 7, touch, 30 frames a second at most), software WebGL, pixel density 1, two runs per line, islands as the game makes them (`mixed=1`). Seed 7 is a desert at medium (four wonders: a sunken temple, a sinkhole lake, ruins, geysers) and a mixed island at large; seed 3 a tundra at medium (a sinkhole lake, a lone tree) and a mixed island at large. "Before" is main at da6d2b8 (part A), measured from a copy of it before any change; "after" this branch. Raw lines: `wonders-4.4.5-b-before.jsonl` and `wonders-4.4.5-b-after.jsonl`. Runs vary by about 10% (the camera turns, creatures move).

## The HUD and the bench, before and after

| Island           | HUD sim p50 / p95 | HUD calls | HUD triangles | bench tick p50 / p95 | bench draw p50 / p95 | parts   |
| ---------------- | ----------------- | --------- | ------------- | -------------------- | -------------------- | ------- |
| Medium 7, before | 2.4-2.6 / 8       | 39-40     | 68-71k        | 2.1-2.2 / 3.1-3.5    | 2.6-2.8 / 4.8-5.5    | 271-369 |
| Medium 7, after  | 3.8-3.9 / 10-12   | 45-47     | 71-72k        | 2.3 / 3.8            | 2.8-3.3 / 5.3-5.6    | 291-296 |
| Medium 3, before | 2.1 / 6-7         | 32-47     | 56-81k        | 1.8-2.1 / 2.8-5.2    | 2.7-5.1 / 4.1-13.6   | 168-185 |
| Medium 3, after  | 2.0-3.1 / 6-8     | 36-50     | 57-83k        | 1.8-2.0 / 3.1-3.6    | 3.3-3.4 / 5.8-6.3    | 186     |
| Large 7, before  | 9.1-10.3 / 24-27  | 51-64     | 120-151k      | 4.0-4.1 / 6.2-7.3    | 3.8 / 6.6-6.8        | 218-271 |
| Large 7, after   | 10.0-11.0 / 26    | 55-69     | 119-152k      | 4.0-4.8 / 6.3-7.7    | 4.2-4.8 / 7.6-7.7    | 208-233 |
| Large 3, before  | 8.2-14.9 / 21-25  | 60-71     | 233-253k      | 3.6-3.8 / 6.2        | 4.7-5.2 / 9.8        | 190-251 |
| Large 3, after   | 8.6-14.2 / 24-25  | 60-73     | 227-258k      | 4.0 / 6.4-6.6        | 5.7 / 10.8-12.5      | 216-382 |

What it says:

1. **Drawing costs what it did, give or take a few calls**: two to eight calls for the wonders (one mesh each, one more for what shines), one for every house and building of the island instead of one per house look, so medium 7 went from 39-40 to 45-47 and the rest moved by four at most. Triangles are within the runs' spread: a house is now one model of about 25 boxes instead of four small models of five.
2. **The simulation**: the bench tick, one tick alone, moved by 0 to 10% (medium 7 p50 2.1-2.2 to 2.3, large 3 3.6-3.8 to 4.0). The HUD's simulation p50 on medium 7 went from 2.5 to 3.9 ms, which is not the tick (the bench shows it): the HUD counts the ticks run in a frame, and that island's frames were slower in both of its runs (18 frames a second instead of 20, frame p95 100-117 ms instead of 83 in the software renderer, the raster unchanged), so more ticks fell in each. Worth watching on a real phone: `/api/perf` will say. Profiled in Node on three islands (`stepWorld` with its phase marks, two minutes each), physics, creatures and the life cycle were within the noise of two identical runs (about 10%), except physics on large islands, a few percent up from the wider rivers (below).
3. **Still inside 4.4's envelope** (medium 134-169k triangles and 36 to 49 calls with everything on), except medium 7 at 45-47 calls and large 3's triangles, as in part A.

## The frames

`docs/visual-checks/4.4.5-b/`:

- `seed3-`, `seed7-` and `seed21-before-after.jpg`: up close, then from above, before on the left. Seed 7 up close: the adobe houses were four small boxes each, now one house each, of two storeys or one, with shutters, a chimney, a flat roof with a parapet. From above: the sinkhole lake and the geysers stand out; the plaza has a main street.
- `ten-islands-before.jpg` and `ten-islands-after.jpg`: seeds 1 to 10, medium, as the game makes them. Every village now has its street and its own houses; from this distance the wonders show on some (the sinkhole of seed 7, the crater of seed 5), not on all: the first look is what shows them.
- `wonders.jpg`: every kind, from the islands that have one (frozen waterfall, hot spring with its steam, stone arch, cave mouth, the crater at night, floating rock; fairy ring and sunken temple at night, ruins, geysers, sinkhole lake, sea stacks; lone tree, bones, waterfall, world tree, the sleeping dragon on its hoard). `arch-cave-fall.jpg`: the arch, the cave mouth and a waterfall from the side they read best from (the first look flies to that side).
- `villages-before-after.jpg`: four villages up close, before and after (desert, tundra, temperate by day and at night with the windows lit from each house's own shape).
- `first-look.jpg`: the flight on seed 7, wonder by wonder, each with its card.
- `rivers-huge-water-map.jpg`: a huge island's fresh water after three minutes (light blue water, white ice), before and after: the rivers were one cell and froze white in the cold; now they are wider and still run.

What the frames say, honestly: up close no two houses are alike, and the wonders are the strongest thing on an island. From above, the land still decides the look at a glance (seeds 1, 2, 3 and 8 are tundras again), and a box model wonder is small at that distance: the first look, not the overview, is what makes an island read as special. The arch seen along its axis looks like a pillar (as on seed 1 from the default angle); the flight turns to its side.

## Generation and saves

Generation in Node, ten islands each: medium 129 to 125 ms, large 191 to 213 ms (placing wonders, laying out villages; the large one also widens its rivers). Once per new island. A save grows by a few kilobytes (medium 0.424M to 0.428M characters): the wonders, the names, the buildings and the patched roofs.

## How to measure again

```bash
npx vite --port 5174 &
RUNS=2 node scripts/perf-phone.mjs medium 8 "dpr=1&mixed=1&seed=7"
RUNS=2 node scripts/perf-phone.mjs large 8 "dpr=1&mixed=1&seed=3"
node scripts/perf-shots.mjs /tmp/shots "look:mixed=1&seed=7&dpr=1&time=60&look=1" "hoard:mixed=1&seed=36&dpr=1&time=60&tx=93&ty=139&dist=0.12&phi=0.95"
```

`look=1` (part B) plays the first look in the Perf Lab; `theta` turns the camera.
