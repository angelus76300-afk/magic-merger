// Lava tops in the fluid's shader (view.ts withWaves), apart from the view so the checks can
// read them (scripts/lava-test.ts).

// Lava (18 November, the owner on the Fold: the volcano's lava was "a flat bright orange sticker").
// A lava top is drawn as plates of dark cooling crust with bright cracks between them, on the
// eighth grid like the fine land. The plates are a Voronoi pattern about 1.7 cells across; their
// seeds wander a little and the whole crust drifts about a cell in twenty seconds, so the cracks
// slowly open, close and move. The crust is the lava's colour, greyed a little, at about 0.35, lit
// by the day like the land (dark at night, with a faint warmth left); the cracks are the lava's
// colour turned yellow at about 1.2, lit by themselves, so they glow at night. A plate's edge is
// a little warmer than its middle. Nine cells of a hash per lava pixel; no texture, no geometry,
// no draw call. Low draws no lava top this way (terrain.ts, LAVA_TOP).
// The bloom's glow mask (looks.ts, lavaMaskMaterial) draws a lava top with the same mmLava, so at
// night on high the glow follows the bright cracks and moves with them, and the dark crust does not
// glow (19 November, the owner: the pool still glowed as one flat orange sheet).
export const LAVA_CRUST = `
vec2 mmLavaHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
vec3 mmLava(vec2 at, vec3 lit, vec3 own, float t) {
  vec2 p = (floor(at * 8.0) + 0.5) * 0.125 + vec2(t * 0.045, t * 0.028);
  vec2 s = p / 1.7;
  vec2 cell = floor(s);
  vec2 f = fract(s);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 near = vec2(0.0);
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = mmLavaHash(cell + o);
      vec2 r = o + 0.5 + 0.38 * sin(t * 0.25 + 6.2832 * h) - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        near = cell + o;
      } else if (d < d2) d2 = d;
    }
  float edge = sqrt(d2) - sqrt(d1);
  float crack = 1.0 - smoothstep(0.035, 0.11, edge);
  float rim = 1.0 - smoothstep(0.11, 0.38, edge);
  float plate = mmLavaHash(near + 17.0).x;
  float pulse = 0.88 + 0.12 * sin(t * 1.3 + plate * 6.2832);
  vec3 grey = vec3(dot(lit, vec3(0.3, 0.45, 0.25)));
  vec3 crust = mix(lit, grey, 0.4) * (0.26 + 0.14 * plate + 0.2 * rim) + own * vec3(0.05, 0.01, 0.0);
  vec3 hot = mix(own, vec3(1.0, 0.78, 0.3), 0.45) * 1.2 * pulse;
  return mix(crust, hot, crack);
}`;

// Where a lava top's pixel takes its colour: before the material's opaque output, so fog, the
// drawings and a spell's darkness still apply after it. `vWave` -1 marks a lava top (terrain.ts).
export const LAVA_TOP_FRAGMENT = `// A lava top (wave -1, terrain.ts): dark crust lit by the day, cracks glowing by themselves.
if (vWave < -0.5) outgoingLight = mmLava(vSea, outgoingLight, vColor.rgb, waveTime);
#include <opaque_fragment>`;

// The lava in the bloom's glow mask (looks.ts, lavaMaskMaterial), drawn over black: a lava top
// (wave -1) takes the same crust and cracks as in the frame, `lavaLit` being the fluid's day colour
// (view.ts applyDaylight sets it), then only what is lava's bright red-orange glows, so the cracks
// glow and the crust stays black. Lava without the mark (low) keeps its own flat colour, and water
// stays black. One branch and nine hash cells per lava pixel at a quarter of the width; no pass.
export const LAVA_MASK_FRAGMENT = `if (vWave < -0.5) outgoingLight = mmLava(vSea, outgoingLight * lavaLit, outgoingLight, waveTime);
outgoingLight *= smoothstep(0.12, 0.3, outgoingLight.r - outgoingLight.b) * step(0.55, outgoingLight.r);
#include <opaque_fragment>`;
