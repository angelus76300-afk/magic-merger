// The land's redraw after a big spell (the owner, 17 November: "the state calculations when a
// spell destroys land or starts fires takes a bit to appear and we have visible chunks"). A seeded
// island is drawn as on high (every look of the land on), the camera at a mid zoom over its middle;
// then a change of the land in one tick, and the frames played as the view plays them (rebuild),
// each frame's work timed on this machine's real clock, with 16 ms of the frame for the rest of
// the scene. Prints the frames until the last changed chunk shows its new land, the work per frame,
// and the frame each chunk's new land showed in. Run it on main and on a branch to compare.
//
//   npx esbuild scripts/land-lag-measure.ts --bundle --platform=node --format=esm --outfile=/tmp/land-lag.mjs && node /tmp/land-lag.mjs
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld } from "../src/sim/world";
import { GRAPHICS } from "../src/sim/voxel/graphics";
import { Terrain } from "../src/sim/voxel/terrain";
import { LOOK_ISLANDS, LOOK_SWITCHES } from "./terrain-looks-test";
import { burn, crater, type Change } from "./land-lag-test";

interface Inside {
  dirtyLand: Set<number>;
  dirtyFluid: Set<number>;
  fineStale: Uint8Array;
  fine: (Mesh | null | undefined)[];
}

function play(k: number, change: Change, frameMs = 16): { frames: number; frameMs: number[]; order: number[]; shownAt: number[]; changed: number } {
  const { cells, seed, land } = LOOK_ISLANDS[k];
  const was = { ...GRAPHICS };
  const flags = GRAPHICS as unknown as Record<string, boolean>;
  for (const s of LOOK_SWITCHES) flags[s] = true;
  GRAPHICS.warmlight = true;
  try {
    const world = generateWorld(cells, cells, seed, land);
    const mat = new MeshBasicMaterial();
    const terrain = new Terrain(
      world,
      mat,
      mat,
      () => {},
      () => {},
    );
    terrain.scan();
    terrain.rebuild(true);
    const dist = 45;
    terrain.focus(dist * 0.81 * Math.SQRT1_2, dist * 0.58 + 8, dist * 0.81 * Math.SQRT1_2, 0, 0);
    terrain.updateFine(0, true);
    const inside = terrain as unknown as Inside;
    // A second and more after the first build, as in the game.
    const wait = performance.now() + 1100;
    while (performance.now() < wait);
    change.apply(world);
    const before = inside.fine.slice();
    terrain.scan();
    const changed = new Set<number>([...inside.dirtyLand, ...inside.dirtyFluid]);
    for (let c = 0; c < inside.fineStale.length; c++) if (inside.fineStale[c]) changed.add(c);
    const times: number[] = [];
    const order: number[] = [];
    const shownAt: number[] = [];
    let f = 0;
    for (; f < 2000; f++) {
      const t0 = performance.now();
      terrain.rebuild(false);
      times.push(performance.now() - t0);
      for (const c of changed)
        if (inside.fine[c] !== before[c] && !order.includes(c)) {
          order.push(c);
          shownAt.push(f + 1);
        }
      if (order.length === changed.size) break;
      const until = t0 + frameMs;
      while (performance.now() < until);
    }
    return { frames: f + 1, frameMs: times, order, shownAt, changed: changed.size };
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

for (const k of [0, 1]) {
  const { cells, name } = LOOK_ISLANDS[k];
  const mid = Math.floor(cells / 2);
  for (const change of [crater(mid - 6, mid - 6, 10, 6), crater(mid, mid, 30, 10), burn(mid, mid, 40)]) {
    const r = play(k, change);
    const busy = r.frameMs.filter((m) => m > 0.5);
    console.log(
      `${name.padEnd(13)} ${change.name.padEnd(22)} chunks ${String(r.changed).padStart(2)}  frames ${String(r.frames).padStart(4)}  ` +
        `max frame ${Math.max(...r.frameMs).toFixed(1)} ms  mean busy ${(busy.reduce((a, b) => a + b, 0) / Math.max(1, busy.length)).toFixed(1)} ms`,
    );
    console.log(`   shown (chunk@frame): ${r.order.map((c, j) => `${c}@${r.shownAt[j]}`).join(" ")}`);
    console.log(`   ms a frame: ${r.frameMs.map((m) => m.toFixed(0)).join(" ")}`);
  }
}
