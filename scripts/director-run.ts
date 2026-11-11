// An untouched island watched by the director (src/sim/director.ts) for some
// simulated minutes: every shot it took and for how long. Used by npm test
// (scripts/director-test.ts) and by scripts/stories-probe.ts.
import { populate } from "../src/sim/creatures";
import { Director, type ShotKind } from "../src/sim/director";
import { storyOn } from "../src/sim/kin";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { raiseWonders } from "../src/sim/wonderbuild";
import { generateWorld } from "../src/sim/world";

export interface Watched {
  shots: { kind: ShotKind; key: string; sort: string; caption: string; since: number; held: number }[];
  summary: {
    shots: number;
    byKind: Record<string, number>;
    longest: number;
    // Seconds with no shot at all.
    empty: number;
    // The same subject shown again within a minute.
    repeats: number;
    // Two everyday shots of the same task in a row.
    alike: number;
    // Story lines of weight 3 told with a place, and how many the camera was within 12 cells of when told, or went to within 8 s.
    big: number;
    bigSeen: number;
    // A subject off the island.
    off: number;
  };
}

export function watchIsland(seed: number, seconds: number, size = 152): Watched {
  Runtime.slowMs = Infinity;
  const world = generateWorld(size, size, seed, resolveLand({ ...DEFAULT_LAND }, seed, size));
  populate(world);
  const rt = new Runtime(world, () => undefined);
  raiseWonders(world, rt);
  storyOn(world);
  const director = new Director(seeded(seed + 1));
  const shots: Watched["shots"] = [];
  let empty = 0;
  let off = 0;
  let told = 0;
  const big: { t: number; x: number; y: number; seen: boolean }[] = [];
  for (let k = 0; k < seconds * 30; k++) {
    stepHeadless(world, rt);
    if (k % 8 !== 0) continue;
    const { shot, cut } = director.update(world);
    if (!shot) empty += 8 / 30;
    else if (!(shot.x >= 0 && shot.y >= 0 && shot.x < world.w && shot.y < world.h)) off++;
    if (cut && shot) {
      const last = shots[shots.length - 1];
      if (last) last.held = world.time - last.since;
      shots.push({ kind: shot.kind, key: shot.key, sort: shot.sort, caption: shot.caption, since: world.time, held: 0 });
    }
    for (const h of world.happenings) {
      if (h.t <= told || h.weight < 3) continue;
      big.push({ t: h.t, x: h.x, y: h.y, seen: false });
    }
    told = world.time;
    if (shot) for (const b of big) if (!b.seen && world.time - b.t <= 8 && Math.hypot(shot.x - b.x, shot.y - b.y) <= 12 + shot.r) b.seen = true;
  }
  storyOn(null);
  const last = shots[shots.length - 1];
  if (last) last.held = world.time - last.since;
  const byKind: Record<string, number> = {};
  let repeats = 0;
  let alike = 0;
  shots.forEach((s, n) => {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
    if (shots.slice(0, n).some((o) => o.key === s.key && s.since - o.since < 60)) repeats++;
    if (n && s.kind === "life" && shots[n - 1].kind === "life" && shots[n - 1].sort === s.sort) alike++;
  });
  return {
    shots,
    summary: {
      shots: shots.length,
      byKind,
      longest: Math.max(0, ...shots.map((s) => s.held)),
      empty,
      repeats,
      alike,
      big: big.length,
      bigSeen: big.filter((b) => b.seen).length,
      off,
    },
  };
}
