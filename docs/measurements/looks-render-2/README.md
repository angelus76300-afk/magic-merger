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
- Pixel caps per level (`PIXEL_CAPS`): high up to 2 device pixels per CSS
  pixel (the Fold folded has about 2.6), medium up to 1.5, low 2 as before.
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

The pixel caps change no JavaScript; they change the pixels the GPU fills. At
390x844 a cap of 2 is 1.32 million pixels a frame, 1.5 is 0.74 million (56%);
at 344x882 (the Fold folded), 1.21 and 0.68 million. Medium, the level a device
starts at, used to draw at 2: it now draws 44% fewer pixels, and high as many
as before. The late-only rule can be judged only on the phone.
