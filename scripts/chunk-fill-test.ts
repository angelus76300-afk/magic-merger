// The land in view first (23 November, the owner: "chunk loading is very slow"). The fine land was
// built nearest the camera's target first, with no thought for what the camera sees, and changed
// land anywhere went before a chunk not built yet; a frame spent 4 ms on it whatever was missing.
// Now a chunk in view not built yet goes first, a change in view next, then the land out of view,
// and a frame spends FILL_BUDGET_MS while land in view is missing and the player is not acting.
// These checks build a small island with a view that sees only some chunks, on a clock that counts
// work instead of the machine's speed (as scripts/land-lag-test.ts does).
import { Frustum, MeshBasicMaterial, Plane, Vector3, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { GRAPHICS } from "../src/sim/voxel/graphics";
import { ACT_QUIET_MS, CHUNK, FILL_BUDGET_MS, Terrain } from "../src/sim/voxel/terrain";
import { LOOK_ISLANDS } from "./terrain-looks-test";
import { crater } from "./land-lag-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

interface Inside {
  fine: (Mesh | null | undefined)[];
  fineStale: Uint8Array;
  group: unknown;
  dropFine(c: number): void;
}

// The clock moves this much each time it is read (three reads a tile), as in land-lag-test.ts.
const TICK_MS = 0.11;

// A view that sees only the chunks in columns cx0..cx1 and rows cy0..cy1 (a box, a little inside
// their edges so it does not touch the chunks round them).
function boxView(world: World, cx0: number, cy0: number, cx1: number, cy1: number): Frustum {
  const x0 = cx0 * CHUNK - world.w / 2 + 1;
  const x1 = (cx1 + 1) * CHUNK - world.w / 2 - 1;
  const z0 = cy0 * CHUNK - world.h / 2 + 1;
  const z1 = (cy1 + 1) * CHUNK - world.h / 2 - 1;
  return new Frustum(
    new Plane(new Vector3(1, 0, 0), -x0),
    new Plane(new Vector3(-1, 0, 0), x1),
    new Plane(new Vector3(0, 0, 1), -z0),
    new Plane(new Vector3(0, 0, -1), z1),
    new Plane(new Vector3(0, 1, 0), 100),
    new Plane(new Vector3(0, -1, 0), 100),
  );
}

interface Island {
  world: World;
  terrain: Terrain;
  inside: Inside;
  cols: number;
  // The clock moves on by ms with no frame drawn.
  wait: (ms: number) => void;
  // One frame: the clock moves on a frame at 30 a second, then the land is redrawn. The time it
  // spent, and the chunks whose fine land changed in it.
  frame: () => { spent: number; shown: number[] };
}

// The small island (4 by 4 chunks), its whole cells drawn, the camera over its middle at a mid zoom.
// `whole`: its fine land built whole too.
function island(whole: boolean): Island {
  const { cells, seed, land } = LOOK_ISLANDS[2];
  const world = generateWorld(cells, cells, seed, land);
  const mat = new MeshBasicMaterial();
  const terrain = new Terrain(
    world,
    mat,
    mat,
    () => {},
    () => {},
  );
  let now = 0;
  terrain.clock = () => (now += TICK_MS);
  terrain.scan();
  // The first frame: every chunk's whole cells (the camera is not known yet, so no fine land).
  terrain.rebuild(true);
  const dist = 45;
  terrain.focus(dist * 0.81 * Math.SQRT1_2, dist * 0.58 + 8, dist * 0.81 * Math.SQRT1_2, 0, 0);
  if (whole) terrain.updateFine(0, true);
  const inside = terrain as unknown as Inside;
  return {
    world,
    terrain,
    inside,
    cols: Math.ceil(world.w / CHUNK),
    wait: (ms) => {
      now += ms;
    },
    frame: () => {
      now += 1000 / 30;
      const was = inside.fine.slice();
      const at = now;
      terrain.rebuild(false);
      return { spent: now - at, shown: inside.fine.map((m, c) => (m !== was[c] ? c : -1)).filter((c) => c >= 0) };
    },
  };
}

// The chunks whose fine land changes, frame by frame, until `done` or 400 frames.
function play(i: Island, done: () => boolean): number[] {
  const order: number[] = [];
  for (let k = 0; k < 400 && !done(); k++) order.push(...i.frame().shown);
  return order;
}

// The corner chunk 0 changed (a crater inside it) and chunk 1 beside it dropped, on the island built
// whole, with a view that sees the chunks in columns cx0..cx1 of row cy: the order they are built in.
function missingAndChanged(cx0: number, cx1: number, cy: number): number[] {
  const i = island(true);
  i.terrain.frustum = boxView(i.world, cx0, cy, cx1, cy);
  i.inside.dropFine(1);
  crater(16, 16, 6, 3).apply(i.world);
  i.terrain.scan();
  return play(i, () => i.inside.fine[1] !== undefined && i.inside.fineStale[0] === 0 && !i.inside.group);
}

function withFine<T>(run: () => T): T {
  const was = GRAPHICS.fine;
  GRAPHICS.fine = true;
  try {
    return run();
  } finally {
    GRAPHICS.fine = was;
  }
}

export function chunkFillChecks(check: Check): void {
  withFine(() => {
    // The view sees only the far corner (chunk 0); the camera looks at the middle, so every other
    // chunk is nearer. The corner is built first.
    const a = island(false);
    a.terrain.frustum = boxView(a.world, 0, 0, 0, 0);
    const orderA = play(a, () => a.inside.fine[0] !== undefined);
    check(
      "the fine land builds a chunk the camera sees before nearer chunks it does not see",
      orderA[0] === 0,
      `built first: ${orderA.join(",") || "none"} (the corner seen is 0)`,
    );

    // The view sees the corner and the chunk beside it: the missing chunk before the change.
    const inView = missingAndChanged(0, 1, 0);
    check(
      "a chunk in view not built yet is built before changed land in view",
      inView.indexOf(1) >= 0 && inView.indexOf(1) < inView.indexOf(0),
      `order: ${inView.join(",")} (missing 1, changed 0)`,
    );

    // The view sees only the corner: the change in view first (a spell cast while the far side
    // fills shows at once).
    const changeSeen = missingAndChanged(0, 0, 0);
    check(
      "changed land in view is built before a chunk out of view not built yet",
      changeSeen.indexOf(0) >= 0 && changeSeen.indexOf(0) < changeSeen.indexOf(1),
      `order: ${changeSeen.join(",")} (changed 0 in view, missing 1 out of view)`,
    );

    // The view sees only the last row: both out of view, the missing chunk first (the island's own
    // life no longer holds the land back).
    const outOfView = missingAndChanged(0, a.cols - 1, a.cols - 1);
    check(
      "out of view, a chunk not built yet is built before changed land",
      outOfView.indexOf(1) >= 0 && outOfView.indexOf(1) < outOfView.indexOf(0),
      `order: ${outOfView.join(",")} (missing 1, changed 0, both out of view)`,
    );

    // The frame's share: FILL_BUDGET_MS while land in view is missing, FINE_BUDGET_MS (4) while the
    // player acts and once the view is full.
    const e = island(false);
    e.terrain.frustum = boxView(e.world, 0, 0, 1, 0);
    const filling = e.frame().spent;
    e.terrain.acted();
    const acting = e.frame().spent;
    e.wait(ACT_QUIET_MS);
    const again = e.frame().spent;
    play(e, () => e.inside.fine[0] !== undefined && e.inside.fine[1] !== undefined);
    const after: number[] = [];
    for (let k = 0; k < 10; k++) after.push(e.frame().spent);
    const full = Math.max(...after);
    check(
      `a frame spends about FILL_BUDGET_MS (${FILL_BUDGET_MS} ms) while land in view is missing, at most about 4 ms while the player acts and once the view is full`,
      filling >= FILL_BUDGET_MS - 1 &&
        filling <= FILL_BUDGET_MS + 3 &&
        acting <= 6 &&
        again >= FILL_BUDGET_MS - 1 &&
        full <= 6 &&
        e.inside.fine.some((m) => m === undefined),
      `filling ${filling.toFixed(1)} ms, acting ${acting.toFixed(1)}, quiet again ${again.toFixed(1)}, view full ${full.toFixed(1)}`,
    );
  });
}
