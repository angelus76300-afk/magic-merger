import type { Reference } from "./reference";

// A creature's figure, facing east: a bird of prey on a perch, 1 across, 1.7 tall. A bird is small
// beside a villager; the perch gives it a height to read from.
export const BIRD: Reference = {
  name: "Ember Hawk",
  kind: "creature",
  note: "a hooked beak, a tail fanned in turned wedges and wings folded at the sides make the bird; three tones of rust; the ember tips are the accent",
  code: `const rust = ["#6a2b17", "#8f3b1e", "#b5532a", "#d6773e"];
const cream = ["#e8d6b0", "#cdb48a"];
const wood = ["#4b3322", "#654530"];
const beak = "#e8b23a";
const ember = "#ffb347";
const p = [];
// The perch: a post on a little cross foot, and a branch the bird grips.
p.push([-0.375, -0.0625, 0, 0.75, 0.125, 0.0625, wood[0]], [-0.0625, -0.375, 0, 0.125, 0.75, 0.0625, wood[0]]);
p.push([-0.0625, -0.0625, 0.0625, 0.125, 0.125, 0.75, wood[1], "cyl", "grain"]);
p.push([-0.5, -0.0625, 0.8125, 1, 0.125, 0.125, wood[0], "cyl", { ry: 90 }]);
p.push([0.375, -0.03125, 0.875, 0.1875, 0.0625, 0.0625, "#4f7a33", { rz: 25 }]);
// Feet round the branch.
p.push([0.0, -0.15625, 0.875, 0.125, 0.0625, 0.125, beak], [0.0, 0.09375, 0.875, 0.125, 0.0625, 0.125, beak]);
// The body: a domed breast in cream with bars, a back in rust, folded wings on each side.
p.push([-0.1875, -0.1875, 1.0, 0.4375, 0.375, 0.375, rust[2], "cyl"]);
p.push([0.0625, -0.15625, 1.0, 0.1875, 0.3125, 0.375, cream[0]]);
for (let k = 0; k < 3; k++) p.push([0.21875, -0.125, 1.0625 + k * 0.1, 0.03125, 0.25, 0.03125, cream[1]]);
p.push([-0.25, -0.25, 1.0625, 0.375, 0.0625, 0.3125, rust[1], "wedge", { ry: -20 }]);
p.push([-0.25, 0.1875, 1.0625, 0.375, 0.0625, 0.3125, rust[1], "wedge", { ry: -20 }]);
p.push([-0.3125, -0.25, 1.0, 0.125, 0.0625, 0.0625, ember, "glow"], [-0.3125, 0.1875, 1.0, 0.125, 0.0625, 0.0625, ember, "glow"]);
// The tail: five feathers fanned down and back.
for (let k = -2; k <= 2; k++) p.push([-0.4375, -0.03125 + k * 0.0625, 0.875, 0.3125, 0.0625, 0.0625, rust[k % 2 ? 0 : 1], { ry: 35, rz: k * 12 }]);
p.push([-0.625, -0.0625, 0.75, 0.0625, 0.125, 0.0625, ember, "glow"]);
// The head: a round crown, a pale cheek, a dark brow, eyes, and a hooked beak.
p.push([0.0, -0.15625, 1.375, 0.3125, 0.3125, 0.25, rust[2]]);
p.push([0.0, -0.15625, 1.625, 0.3125, 0.3125, 0.125, rust[3], "dome"]);
p.push([0.1875, -0.125, 1.375, 0.125, 0.25, 0.125, cream[0]]);
p.push([0.125, -0.171875, 1.5625, 0.1875, 0.34375, 0.03125, rust[0]]);
p.push([0.25, -0.1875, 1.5, 0.0625, 0.03125, 0.0625, "#1a1a1a"], [0.25, 0.15625, 1.5, 0.0625, 0.03125, 0.0625, "#1a1a1a"]);
p.push([0.3125, -0.0625, 1.4375, 0.125, 0.125, 0.125, beak, "wedge", { rz: 180 }]);
p.push([0.40625, -0.03125, 1.40625, 0.0625, 0.0625, 0.0625, "#9a6b1a"]);
// A crest of three ember feathers.
for (let k = 0; k < 3; k++) p.push([-0.0625 - k * 0.0625, -0.03125, 1.75 - k * 0.03, 0.0625, 0.0625, 0.1875, k ? rust[3] : ember, k ? {} : "glow", { ry: -25 - k * 10 }]);
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Ember Hawk" });`,
};
