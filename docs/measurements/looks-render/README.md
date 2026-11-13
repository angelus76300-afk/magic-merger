# Looks revamp, render side (roadmap 5.2.5 / 5.2)

The reference dioramas (the owner's pictures, 13 November) are offline
path-traced. What makes them beautiful and can run on a phone, built here as
four switches in `src/sim/voxel/graphics.ts`, each measured alone, drawn in
`src/sim/voxel/looks.ts`:

- `shadows`: one directional sun that casts soft shadows (a 1024 map, four-tap
  PCF) over the land, trees, houses, props, wonders and creatures, following
  the hour; warm where it lights, cool in the shade. Sky view only, nothing at
  night or in the eye view.
- `grade`: a filmic tone curve and a colour grade (deeper middle tones,
  greens muted rather than pushed, warm in the light and cool in shade) through
  three.js's own tone-mapping hook, so it costs no extra pass; plus haze over
  the far side of the island, tuned with the existing fog.
- `bloom`: glow that spills around bright parts, at night and in a spell's
  darkness only. Three passes at a quarter width (a sixteenth of the pixels).
- `tilt`: the miniature's depth of field (the owner: "more than bloom it's more
  depth of field", then "it's really only when we zoom a lot"). Nothing over the
  whole island or at a mid zoom: it begins 40 cells from what the camera looks
  at and is full at 10 (the sky view's closest is 8), where it shows two thirds
  of the blurred frame, with a sharp zone 12% of the focus distance deep in
  front and behind (the owner: "a bit strong", "make the in-focus zone a bit
  bigger"). In focus at the point
  under the middle of the screen, blurred more the farther in front of it or
  behind it; off in the eye view. The depth comes from a depth texture the
  scene's own pass writes (no extra pass); the blur is two passes at half
  width, drawn only when the camera is close.

A quality preset (low, medium, high) is chosen from the device's own frame
times (`QualityChooser`), with each look assigned to a level: low is the game
as it was before 5.2.5, medium adds shadows and the grade, high adds bloom and
the blur. The owner can pick a level, "auto" (the device's), or toggle one
look at a time in the frame HUD (long press the title, open the World).

## The frames

Five island views, each with every look off (`-low`) and with the high preset
(`-high`), at 390x844 (a phone) and 344x882 (the owner's Z Fold folded):

- `village-day-*` a village by day
- `village-night-*` the same village at night, lit windows and glowing items
- `island-day-*` the whole island from above
- `village-mid-*` the village at a mid zoom (no blur)
- `village-close-*` the village at the closest zoom (the depth of field)

## Cost (CPU side only; the phone must judge the GPU)

The headless browser draws with a software GPU, so its raster time is not a
phone's. What is honest from here is the view's own JavaScript per frame (the
"draw" below, p50) and the number of draw calls and passes each look adds. The
GPU cost of the extra passes and the shadow map is the owner's phone to tell.

Measured alone at 700x830 (the Fold open), medium island, dpr 1:

| look          | draw village           | draw island           | extra calls | passes after scene                                                     |
| ------------- | ---------------------- | --------------------- | ----------- | ---------------------------------------------------------------------- |
| off (low)     | 3.5 ms                 | 3.9 ms                | 0           | 0                                                                      |
| shadows       | 4.4 ms                 | 4.9 ms                | +45 (map)   | 0                                                                      |
| grade         | ~0 extra               | ~0 extra              | 0           | 0                                                                      |
| bloom (night) | +0.3 ms                | n/a (day)             | 0           | 3                                                                      |
| tilt (depth)  | +0.4 ms (closest zoom) | 0 (whole island: off) | 0           | 3 when close, 0 at mid zoom and over the whole island (depth: no pass) |

Shadows cost one extra scene pass into the map (its draw calls scale with what
casts). Grade is free on the CPU (a shader change, no pass). Bloom and tilt add
reduced-resolution screen passes; the frame is drawn into a texture first.
Each switch at `graphics.ts` (or `off=`/`on=` and `quality=` in the Perf Lab,
`scripts/looks-render-frames.mjs`) turns its look fully off, proven by the
`-low` frames and by `scripts/looks-test.ts`.
