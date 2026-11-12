// Where the mist starts and ends, in scene units (one cell is one unit),
// measured from the camera along its view.
//
// At the player's usual view (the camera about half an island away) the
// mist begins 1.6 islands out and is full at 5: the island itself stays
// clear, the far sea and the horizon soften. The camera can pull back to 6
// islands, and with fixed distances the whole island then sat inside full
// mist: one flat pale slab (the owner, on a Z Fold, 7 November). So the mist
// moves back with the camera: zoomed out, it lies just as far behind the
// island as at the usual view, and the island keeps its colours.
//
// `weather` (0 clear, 1 thick) brings it in, as rain, snow and fog do; it
// moves back with the camera the same way, so a misty island looks as misty
// from afar as from its usual view.
export const USUAL_VIEW = 0.55;

export function fogRange(side: number, dist: number, weather: number): { near: number; far: number } {
  const k = Math.min(1, Math.max(0, weather));
  const lead = Math.max(0, dist - side * USUAL_VIEW);
  return { near: side * 1.6 * (1 - k * 0.85) + lead, far: side * 5 * (1 - k * 0.8) + lead };
}

// At the eye of a creature (eyes.ts) the far side of the island and the rim
// of the world, where it ends in the void, are seen edge on: the mist takes
// them from 28 cells out and they are gone at 80, a village across a valley a
// blue shape, as a far hill is. The eye view, second pass (the owner: "the
// performance of the fpv isn't great"): nothing is drawn past EYE_DRAW, where
// the mist is whole, so the far island costs nothing (it was mist from 110
// out and drawn in full to the rim). A grand spell's reach (46 cells, eyes.ts)
// stays well inside the clear part.
export const EYE_DRAW = 84;
export function eyeFogRange(weather: number, cut = true): { near: number; far: number } {
  const k = Math.min(1, Math.max(0, weather));
  // Uncut: the mist as it was before (30 to 110), for a before and after in the same scene.
  return cut ? { near: 28 * (1 - k * 0.7), far: 80 * (1 - k * 0.6) } : { near: 30 * (1 - k * 0.7), far: 110 * (1 - k * 0.6) };
}

// The covers around the eye are placed again each time it has gone COVER_STEP
// cells or turned COVER_TURN radians (view.ts placeCovers). Between two
// placings, every cover it may then see must already be there: those within
// the mist and a step beyond it, ahead of the look within COVER_WEDGE either
// side (the view is about 38 degrees either side, plus the turn allowed), and
// all of those within NEAR_ALL cells, for a quick turn.
export const COVER_STEP = 8;
export const COVER_TURN = 0.7;
export const COVER_WEDGE = 1.85;
export const NEAR_ALL = 10;

// Whether a cover at (dx, dy) cells from the eye is drawn, the look along (lx, ly) (a unit vector).
export function eyeKeepsCover(dx: number, dy: number, lx: number, ly: number): boolean {
  const d2 = dx * dx + dy * dy;
  if (d2 > (EYE_DRAW + COVER_STEP) ** 2) return false;
  return d2 <= NEAR_ALL * NEAR_ALL || dx * lx + dy * ly >= Math.cos(COVER_WEDGE) * Math.sqrt(d2);
}

// Whether a square of land (x0, y0, side cells) is drawn from an eye at (x, y): its nearest point
// within EYE_DRAW (terrain.ts showWithin).
export function eyeKeepsChunk(x0: number, y0: number, side: number, x: number, y: number, r = EYE_DRAW): boolean {
  const nx = Math.max(x0, Math.min(x0 + side, x));
  const ny = Math.max(y0, Math.min(y0 + side, y));
  return Math.hypot(nx - x, ny - y) <= r;
}

// How much mist covers a point at this depth from the camera (three.js's
// linear fog): 0 clear, 1 only mist.
export function fogAt(depth: number, range: { near: number; far: number }): number {
  return Math.min(1, Math.max(0, (depth - range.near) / Math.max(1e-6, range.far - range.near)));
}
