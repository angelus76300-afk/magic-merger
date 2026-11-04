# The view and bigger islands, measured (4.4)

Every number here comes from `scripts/perf-phone.mjs` on `lab/perf.html`: one island as the World tab shows it, in a phone sized headless Chromium (Pixel 7: 412 by 915, touch, so drawing is capped at 30 a second as on a phone), software WebGL (SwiftShader) on a 4 core container, the pixel density pinned at 1 so two runs draw the same pixels. Raw lines: `view-4.4-before.jsonl` (before any change) and `view-4.4-after.jsonl`.

Two kinds of numbers per run:

1. **The HUD's**, from the real frame loop (`hud`): frame, simulation and draw p50 / p95, draw calls, triangles. In this browser frames are slow (software raster), so a frame holds two or three ticks and the HUD's simulation number is per frame, not per tick.
2. **A bench of fixed work** (`bench`), 150 to 200 frames: one tick, a small turn of the camera, one draw, then a one pixel read back that waits for the frame to be rasterized. `tick` and `draw` are the JavaScript side (what a phone's CPU pays), `raster` is SwiftShader drawing the pixels on the CPU: it says whether a change draws more, not what a phone's GPU pays. The GPU is not measured here; a real phone with the HUD on is still the test for that (ROADMAP, "What to watch").

Runs vary by about 10% (the camera turns, creatures move); each line below is two runs.

## Each improvement alone, medium island (152 by 152), bench p50 / p95 in ms

| Island and what is on                                     | tick              | draw              | raster         | calls | triangles |
| --------------------------------------------------------- | ----------------- | ----------------- | -------------- | ----- | --------- |
| Before 4.4 (main, the old island)                         | 1.8 / 2.9         | 2.1 / 4.1         | 64-76 / 76-89  | 24-30 | 129-135k  |
| 4.4, the old island, every improvement off                | 1.9 / 3.1         | 2.2-2.5 / 5.0-5.7 | 71-76 / 97     | 24-37 | 123-157k  |
| 4.4, a temperate island (new land), every improvement off | 2.1-2.3 / 3.5-3.7 | 2.5-2.9 / 5.3-5.9 | 68-80 / 82-98  | 33-43 | 140-159k  |
| + ambient occlusion                                       | 2.2-2.3 / 3.6-3.8 | 2.7-2.8 / 5.9-6.4 | 70-78 / 92-99  | 30-49 | 134-169k  |
| + water (depth color, foam, waves)                        | 2.2 / 3.6-3.9     | 2.5-2.8 / 5.8-6.3 | 69-78 / 82-107 | 35-37 | 138-142k  |
| + weather (rain, the most drawn)                          | 2.1-2.2 / 3.4-3.8 | 2.6-2.9 / 5.0     | 70-79 / 84-99  | 31-44 | 134-159k  |
| + sky (night: moon and stars)                             | 2.1 / 3.4-3.6     | 2.8-3.0 / 5.0-5.9 | 73-78 / 93-95  | 34-39 | 140-152k  |
| Everything on, in the rain at night                       | 2.0 / 3.2-3.5     | 2.8-3.0 / 5.1-5.3 | 70-75 / 85-99  | 36-38 | 134-149k  |

What it says:

1. **Each improvement costs less than the noise of the measure**: at most about 0.3 ms of drawing at p50, no measurable change in raster. Ambient occlusion and water colors are baked into the vertex colors when a chunk is built (no cost per frame); waves are a few sines in the vertex shader of water tops only; rain and snow are one draw call of 2,400 points that fall in the vertex shader (no CPU per frame); the sky is three draw calls (sun, moon, stars).
2. **The new land costs about 0.2 ms per tick** (springs, and rivers that keep flowing).
3. **A bug the measure found**: the first version of the new land drew in 6.2 ms instead of 2.5. Flowing rivers changed the water's level by hundredths and wetted and dried thin films at their edges every tick, and each change rebuilt its terrain chunks (43 cells flipping per tick, 19 chunks rebuilt). Now a cell is drawn wet from a depth of 0.06 and dry below 0.005, a level is redrawn when it moved 0.15, and chunks dirtied only by flowing water wait in a slow queue (one every third frame). A spell's flood, lava or new land is still drawn at once.

## Island sizes, everything on, bench p50 / p95 in ms

| Size        | Cells   | tick        | draw        | raster    | calls | triangles | creatures | HUD frame p95 |
| ----------- | ------- | ----------- | ----------- | --------- | ----- | --------- | --------- | ------------- |
| Large (208) | 43,264  | 3.7 / 4.9   | 3.6 / 6.9   | 76 / 92   | 49    | 183k      | 144       | 150           |
| Huge (288)  | 82,944  | 6.9 / 11.0  | 5.6 / 11.3  | 135 / 172 | 41    | 319k      | 269       | 217           |
| Giant (384) | 147,456 | 12.9 / 21.7 | 10.0 / 20.6 | 170 / 199 | 27    | 419k      | 448       | 350           |

In Node (no drawing), a jungle island: tick mean 2.4 ms at 152, 3.3 at 208, 5.9 at 288, 11.6 at 384; generation 140 to 280 ms; the save 0.41M characters of JSON at 152 and 2.5M at 384, 0.11M and 0.64M gzipped.

The simulation grows with the cells, as `headroom.ts` assumes (huge is 1.9 times large, giant 3.4 times; the ticks above grow 1.9 and 3.5 times). This container would not be offered either: its frames are already late on a large island (p95 150 ms, the rule wants under 40), and its tick p95 on large (4.9 ms) projects to 9.4 ms on huge, 16.7 on giant (budget 12). A desktop drawing a large island on time with a tick p95 of 3 ms gets both.

## How to measure again

```bash
npx vite --port 5174 &
RUNS=2 node scripts/perf-phone.mjs medium 8 "dpr=1&biome=temperate&off=ao,water,weather,sky"   # every improvement off
RUNS=2 node scripts/perf-phone.mjs medium 8 "dpr=1&biome=temperate&weather=rain&time=270"       # everything on
RUNS=1 node scripts/perf-phone.mjs giant 8 "dpr=1&biome=temperate"
node scripts/perf-shots.mjs /tmp/shots "rain:biome=jungle&weather=rain&dpr=1"                   # to look at it
```

`off=` takes `ao`, `water`, `weather`, `sky`; `land=old` draws the island before 4.4; `weather=` holds `rain`, `snow` or `fog`; `time=` sets the hour (270 is night); `phi` and `theta` turn the camera.
