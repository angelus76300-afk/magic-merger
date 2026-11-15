// Dev only (feedback #156): how a cart moves on its trip: speed, turning, progress.
import { populate } from "../src/sim/creatures";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { onTrip, towCart } from "../src/sim/map";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { raiseWonders } from "../src/sim/wonderbuild";
import { generateWorld } from "../src/sim/world";

Runtime.slowMs = Infinity;
const all = {
  speed: [] as number[],
  others: [] as number[],
  turn: 0,
  dist: 0,
  loops: 0,
  trips: 0,
  stuck: 0,
  durs: [] as number[],
  cturn: 0,
  cloops: 0,
  arrived: 0,
  pace: [] as number[],
};
for (const size of (process.env.SIZES ?? "112,152,208").split(",").map(Number)) {
  for (const seed of [3, 8]) {
    Math.random = seeded(seed * 31 + size);
    const world = generateWorld(size, size, seed, resolveLand({ ...DEFAULT_LAND }, seed, size));
    populate(world);
    const rt = new Runtime(world, () => undefined);
    raiseWonders(world, rt);
    const last = new Map<
      number,
      { x: number; y: number; hd: number; turn: number; dist: number; t0: number; net0: number; cart: number; cturn: number; to: { x: number; y: number } }
    >();
    for (let t = 0; t < 12 * 60 * 30; t++) {
      stepHeadless(world, rt);
      if (t < 3 * 60 * 30) continue;
      for (const c of world.creatures) {
        if (c.dead || c.kind !== "villager") continue;
        const on = onTrip(c);
        const p = last.get(c.id);
        if (!on) {
          if (p) {
            last.delete(c.id);
            all.trips++;
            all.durs.push(world.time - p.t0);
            all.turn += p.turn;
            all.dist += p.dist;
            if (p.turn > 4 * Math.PI) all.loops++;
            all.cturn += p.cturn;
            if (p.cturn > 4 * Math.PI) all.cloops++;
            if (Math.hypot(p.to.x - c.x, p.to.y - c.y) < 8) all.arrived++;
          } else if (t % 15 === 0) {
            const q = c as unknown as { vx: number; vy: number };
            if (q.vx !== undefined) all.others.push(Math.hypot(q.vx, q.vy));
          }
          continue;
        }
        if (!p) {
          last.set(c.id, {
            x: c.x,
            y: c.y,
            hd: c.hd,
            turn: 0,
            dist: 0,
            t0: world.time,
            net0: 0,
            cart: c.hd,
            cturn: 0,
            to: (c.data.trip as { to: { x: number; y: number } }).to,
          });
          continue;
        }
        const dd = Math.hypot(c.x - p.x, c.y - p.y);
        let dh = c.hd - p.hd;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.turn += Math.abs(dh);
        const nc = towCart(p.cart, c.hd, dd, 1);
        p.cturn += Math.abs(Math.atan2(Math.sin(nc - p.cart), Math.cos(nc - p.cart)));
        p.cart = nc;
        p.dist += dd;
        if (t % 15 === 0) all.speed.push(dd * 30);
        p.x = c.x;
        p.y = c.y;
        p.hd = c.hd;
      }
    }
    all.stuck += last.size;
  }
}
const med = (a: number[]) => (a.sort((x, y) => x - y), a[Math.floor(a.length / 2)] ?? 0);
const p90 = (a: number[]) => (a.sort((x, y) => x - y), a[Math.floor(a.length * 0.9)] ?? 0);
console.log(
  `trips ${all.trips}, cart speed median ${med(all.speed).toFixed(2)} p90 ${p90(all.speed).toFixed(2)} cells/s, other villagers median ${med(all.others).toFixed(2)}; turning ${((all.turn / Math.max(1, all.dist)) * (180 / Math.PI)).toFixed(1)} deg per cell walked; trips that turned > 2 full circles ${all.loops}; trip median ${med(all.durs).toFixed(0)} s; arrived ${all.arrived}; cart (towed) ${((all.cturn / Math.max(1, all.dist)) * (180 / Math.PI)).toFixed(1)} deg per cell, > 2 circles ${all.cloops}; unfinished at the end ${all.stuck}`,
);
