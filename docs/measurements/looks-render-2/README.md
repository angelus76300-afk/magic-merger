# Looks revamp, render side, part 2: finer pixels (roadmap 5.2.5)

The owner, 13 November: "when we look at the render resolution of the images I
sent the render is finer ... it must look refined and detailed, not messy and
too busy." Part of that is the render itself: edges were jagged (no
antialiasing) and the pixel density dropped under load even when frames kept
their cadence.

- `aa` (a new switch in `src/sim/voxel/graphics.ts`, on the high preset): FXAA
  at full resolution, nine taps a pixel, in the last pass of `looks.ts`. It
  needs the frame drawn into a texture first; when bloom or the depth of field
  already do that, it adds no pass.
- Pixel caps per level (`PIXEL_CAPS`): 2 device pixels per CSS pixel at every
  level (the Fold folded has about 2.6), as before; the owner wants it finer, so
  the level a device starts at (medium) does not get coarser.
- On high the density drops only when frames are actually late (`LATE_ONLY`,
  `nextPixelRatio`): a long draw with frames on time keeps the pixels. Low and
  medium keep the old rule (late frames, or a draw over 30 ms).

## Frames

Before (`high` with `aa` off) on the left, after (`high`) on the right, both at
2 device pixels per CSS pixel, a 320 by 320 square of device pixels around the
middle of the screen, unscaled: `village-close-*` and `village-mid-*`, at
390x844 and 344x882. Villagers move between the two runs; the land, roofs and
walls are the same. The roof and wall edges are where the difference shows.

## Cost, each alone (CPU side; the phone must judge the GPU)

At 700x830, medium island, 1 device pixel per CSS pixel, the view's own
JavaScript per frame (p50):

| look      | island | village mid | village close | passes after the scene |
| --------- | ------ | ----------- | ------------- | ---------------------- |
| off (low) | 3.4 ms | 3.3 ms      | 2.7 ms        | 0                      |
| `aa`      | 3.5 ms | 3.4 ms      | 2.8 ms        | 1 (none more with DoF) |

The pixel caps are as before (2), so they change neither the JavaScript nor
the pixels filled. The late-only rule on high can be judged only on the phone.

## The white squares over villages

They were chimney smoke (and a hot spring's steam, a waterfall's spray, dust):
particles that do not glow were drawn as hard, opaque, untinted squares, so
each new puff showed as a white box over a house, day and night, and bloom made
it glow. They were meant to be soft puffs that rise and fade. They are now
round, soft-edged and lit by the day (bluish grey at night), in `view.ts`
`pointCloud`. `scripts/puff-proof.mjs` draws one puff alone and reads the
pixels: the corner of its square must be untouched, its middle must show, and
at night it must not be white; it fails on the old squares. Frames before (left)
and after (right), high preset: `puffs-village-{day,night}-{390x844,344x882}-before-after.png`.
