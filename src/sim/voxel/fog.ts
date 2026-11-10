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

// How much mist covers a point at this depth from the camera (three.js's
// linear fog): 0 clear, 1 only mist.
export function fogAt(depth: number, range: { near: number; far: number }): number {
  return Math.min(1, Math.max(0, (depth - range.near) / Math.max(1e-6, range.far - range.near)));
}
