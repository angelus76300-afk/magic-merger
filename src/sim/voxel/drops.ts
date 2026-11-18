// Where a raindrop or a snowflake is (issue #69: "tied to the island, not the
// camera"). Each drop has a fixed place over the island, in a tile of
// DROP_TILE scene units that repeats; it falls and drifts with the time only.
// The camera's target picks which copy of the tile is drawn: a drop that
// leaves the box around the target comes back on the far side, so panning
// and zooming never drag the rain along. The shader in sky.ts does the same
// sums; this copy is for the check in scripts/sim-test.ts.

export const DROP_TILE = 90;
// How tall the falling column is, and how much of it is under the target.
export const DROP_HEIGHT = DROP_TILE * 0.6;
export const DROP_BELOW = 0.25;

// Wrapped into [-half, half) around zero.
const wrap = (v: number, size: number, below = 0.5) => v - size * Math.floor(v / size + below);

export function dropAt(
  seed: [number, number, number],
  center: { x: number; y: number; z: number },
  time: number,
  snow: number,
): { x: number; y: number; z: number } {
  const fall = 0.9 + (0.12 - 0.9) * snow;
  const x = (seed[0] + snow * 0.05 * Math.sin(time * 0.7 + seed[2] * 40) + time * 0.02) * DROP_TILE;
  const y = (seed[1] - time * fall) * DROP_HEIGHT;
  const z = seed[2] * DROP_TILE;
  return {
    x: center.x + wrap(x - center.x, DROP_TILE),
    y: center.y + wrap(y - center.y, DROP_HEIGHT, DROP_BELOW),
    z: center.z + wrap(z - center.z, DROP_TILE),
  };
}

// The share of drops drawn. Close up the camera sees a small patch, so more
// of the tile's drops show there: about as many on screen at any zoom, as
// before, without the box shrinking around the camera.
export function dropShare(amount: number, dist: number): number {
  const view = Math.min(DROP_TILE, Math.max(30, dist * 0.9));
  return amount * (30 / view) ** 2;
}

// How big a drop's square is on screen, in device pixels, `depth` scene units from the camera.
// Capped (18 November, the owner on the unfolded Fold: rain fell as large blurry bars): a raindrop
// 12 cells away was a square of 107 device pixels at two pixels a CSS pixel, its streak 15 wide.
export const DROP_MAX = 40;
export function dropSize(depth: number, pixels: number, snow: number, grain = 1): number {
  const size = ((16 + (6 - 16) * snow) * pixels * grain * 40) / Math.max(4, depth);
  return Math.min(size, DROP_MAX * pixels);
}

// A raindrop is a thin streak whatever its size: this many device pixels across, the same near
// and far. Its length still grows as it comes close.
export const RAIN_WIDTH = 1.25;
// How much of a pixel `off` device pixels from the streak's middle is covered (the fragment shader
// in sky.ts does the same sum).
export function rainCover(off: number): number {
  return Math.max(0, Math.min(1, RAIN_WIDTH / 2 + 0.5 - Math.abs(off), RAIN_WIDTH));
}
// The streak's width on screen, in device pixels: the pixels it covers, added up across.
export function rainWidth(size: number): number {
  let sum = 0;
  for (let x = Math.floor(-size / 2); x <= Math.ceil(size / 2); x++) sum += Math.abs(x) <= size / 2 ? rainCover(x) : 0;
  return sum;
}

// The same placement for the vertex shader. `position` is the seed, `rank`
// a random number per drop deciding when it shows.
export const DROP_SHADER = `uniform float time; uniform vec3 center; uniform float share; uniform float snow; uniform float pixels; uniform float nearest; uniform float grain;
  attribute float rank;
  varying float vShow;
  varying float vSize;
  float wrapped(float v, float size, float below) { return v - size * floor(v / size + below); }
  void main() {
    vec3 p = position;
    vShow = step(rank, share);
    if (vShow < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float fall = mix(0.9, 0.12, snow);
    float x = (p.x + snow * 0.05 * sin(time * 0.7 + p.z * 40.0) + time * 0.02) * ${DROP_TILE.toFixed(1)};
    float y = (p.y - time * fall) * ${DROP_HEIGHT.toFixed(1)};
    float z = p.z * ${DROP_TILE.toFixed(1)};
    vec3 w = center + vec3(
      wrapped(x - center.x, ${DROP_TILE.toFixed(1)}, 0.5),
      wrapped(y - center.y, ${DROP_HEIGHT.toFixed(1)}, ${DROP_BELOW.toFixed(2)}),
      wrapped(z - center.z, ${DROP_TILE.toFixed(1)}, 0.5));
    vec4 mv = modelViewMatrix * vec4(w, 1.0);
    // Not in the eye of the one seen from (eyes.ts): a drop a hand away fills the screen.
    if (-mv.z < nearest) { vShow = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    gl_PointSize = min(mix(16.0, 6.0, snow) * pixels * grain * 40.0 / max(4.0, -mv.z), ${DROP_MAX.toFixed(1)} * pixels);
    vSize = gl_PointSize;
    gl_Position = projectionMatrix * mv;
  }`;
