// The mist from afar (2026-11-07, src/sim/voxel/fog.ts): zoomed out on any
// island, the land keeps its colours; the mist stays on the horizon, and
// weather mist still shows.
import { fogAt, fogRange, USUAL_VIEW } from "../src/sim/voxel/fog";
import { WORLD_SIZES } from "../src/sim/sizes";

type Check = (name: string, ok: boolean, detail?: string) => void;

// OrbitCamera: the closest and farthest the player can zoom.
const MIN_DIST = 8;
const MAX_DIST = 6;

export function fogChecks(check: Check): void {
  let worst = { fog: 0, at: "" };
  let horizon = 1;
  let changed = 0;
  for (const side of Object.values(WORLD_SIZES)) {
    // The island's farthest corner from the camera along its view, with room
    // for the rock under the island's rim. Hills face the camera, so they are
    // nearer, not farther.
    const reach = side * Math.SQRT1_2 + 16;
    for (let dist = MIN_DIST; dist <= side * MAX_DIST; dist += side / 20) {
      const range = fogRange(side, dist, 0);
      const f = fogAt(dist + reach, range);
      if (f > worst.fog) worst = { fog: f, at: `${side} cells at ${(dist / side).toFixed(2)} sides` };
      // Four islands behind the island the mist has the horizon.
      horizon = Math.min(horizon, fogAt(dist + side * 4, range));
    }
    // Up to the usual view nothing changes from before.
    for (let dist = MIN_DIST; dist <= side * USUAL_VIEW; dist += 4)
      for (const k of [0, 0.5, 1]) {
        const r = fogRange(side, dist, k);
        if (Math.abs(r.near - side * 1.6 * (1 - k * 0.85)) > 1e-9 || Math.abs(r.far - side * 5 * (1 - k * 0.8)) > 1e-9) changed++;
      }
  }
  check("zoomed out on any island, no mist on the land in clear weather", worst.fog === 0, `worst ${worst.fog.toFixed(2)} ${worst.at}`);
  check("the horizon past the island is still in mist", horizon >= 0.5, `least ${horizon.toFixed(2)}`);
  check("close up and at the usual view the mist is where it was", changed === 0, `${changed} differ`);
  // Weather mist (thick fog) at the island's centre: the same from afar as at
  // the usual view, and well there.
  const side = WORLD_SIZES.giant;
  const usual = fogAt(side * USUAL_VIEW, fogRange(side, side * USUAL_VIEW, 1));
  const far = fogAt(side * MAX_DIST, fogRange(side, side * MAX_DIST, 1));
  check("thick fog still mists the island from afar", far > 0.3 && Math.abs(far - usual) < 1e-9, `centre ${far.toFixed(2)}, usual view ${usual.toFixed(2)}`);
}
