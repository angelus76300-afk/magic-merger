import { Runtime } from "../src/sim/runtime";
import { plainWorld } from "../src/sim/world";
import { stepHeadless } from "../src/sim/tick";
import { lightAt } from "../src/sim/reactions";
import { DAY_LENGTH } from "../src/sim/daylight";

Runtime.slowMs = Infinity;
const world = plainWorld(64, 64, 5, 12, 0);
world.reactions = true;
const rt = new Runtime(world, (_k, _n, m) => console.log("err", m));
world.time = DAY_LENGTH * 0.72;
rt.cast(
  {
    key: "w",
    name: "Gloom Wraith",
    tier: "major",
    code: `const spell = { creatures: [{ name: "gloom wraith", base: "beast", hp: 100, speed: 0.01, weak: ["light"], active: "night" }], *cast(w) { w.spawn("gloom wraith", w.x, w.y); } };`,
  },
  32,
  32,
);
for (let k = 0; k < 15; k++) stepHeadless(world, rt);
const c = world.creatures[0];
rt.cast({ key: "a", name: "Wall", tier: "major", code: `const spell = { *cast(w) { w.wall(w.x - 4, w.y - 6, w.x - 4, w.y + 6, { height: 10, thick: 2 }); } };` }, 32, 32);
for (let k = 0; k < 15; k++) stepHeadless(world, rt);
rt.cast({ key: "b", name: "Lantern", tier: "major", code: `const spell = { *cast(w) { w.light(w.x, w.y, 12, "#fff3b0", 6); } };` }, 24, 32);
for (let k = 0; k < 150; k++) {
  stepHeadless(world, rt);
  if (k % 10 === 0) console.log(k, c.x.toFixed(2), c.y.toFixed(2), c.hp.toFixed(1), lightAt(world, c.x, c.y).lit.toFixed(2), c.fear.toFixed(1));
}
