# Bloom: only what glows, softer, only close (roadmap 5.2.5)

The owner, on the Fold at night (high preset, 59 fps): "Bloom looks weird when
unzoomed, not a fan, maybe lower the bloom quite a bit, love the tilt shift
though." Over the whole island, snow fields and pale ground bloomed into big
white blobs: the bloom took whatever was bright on screen (a luminance
threshold), and snow under the moon is bright.

What changed, in `src/sim/voxel/looks.ts`:

- **Only what is meant to glow blooms.** A glow mask replaces the threshold: the
  scene is drawn again at a quarter of the width with glowing parts (wonders',
  props' and plants' glow parts, creatures' glowing parts, lit windows, flames,
  sparks, bolts), lava and glowing spell bodies in their own colours, and
  everything else black, so a wall still hides the window behind it. Snow, sand
  and moonlit ground never bloom. The sun, moon and stars are left out.
- **Half as strong, a shorter reach:** strength 0.9 (was 1.8), two blur passes
  at 1.2 texels (were three, at 1.6 and 3.2).
- **Only when close:** none over the whole island; it fades in from half an
  island side away (`BLOOM_FROM`) and is whole from 0.38 sides in (`BLOOM_FULL`),
  so at a mid zoom and closer. The depth blur is untouched.

## Frames

Before (left, main) and after (right), high preset, a tundra island at night:
`bloom-island-night-*` (the whole island) and `bloom-village-mid-night-*` (a
village at a mid zoom), at 390x844 and 344x882.

## Cost (CPU side; the phone must judge the GPU)

At 700x830, the view's own JavaScript per frame (p50), bloom alone:

| view                  | off    | bloom  | draw calls | passes after the scene         |
| --------------------- | ------ | ------ | ---------- | ------------------------------ |
| whole island at night | 4.3 ms | 4.1 ms | 80 (same)  | 0 (bloom is off there)         |
| village at a mid zoom | 3.2 ms | 4.6 ms | 54 to 107  | 4 (mask, two blurs, last pass) |

The mask costs a second draw of the scene, at a sixteenth of the pixels: about
1.4 ms and 53 draw calls, only at night and only when the camera is close.
