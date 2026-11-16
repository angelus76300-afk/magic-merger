import type { Reference } from "./reference";

// A building: a wayside shrine, 3.5 across, 3.6 tall. Two wedges back to back make its roof; rows
// of tiles, a ridge and eaves make it a roof and not a slab.
export const SHRINE: Reference = {
  name: "Moon Shrine",
  kind: "building",
  note: "a stepped platform, four posts and a deep gabled roof with curled eaves read as a shrine; red lacquer in four tones on grey stone; the moonstone on the altar is the accent",
  code: `const stone = ["#77746e", "#8d8a83", "#a4a099", "#bdb9b0"];
const lacquer = ["#7a1e1e", "#972a24", "#b23a2c", "#c9533a"];
const tile = ["#2f3a3f", "#3e4c52", "#526268"];
const gold = "#d9a93a";
const moon = "#bfe6ff";
const p = [];
// A platform in two steps and a stair at the front.
p.push([-1.75, -1.5, 0, 3.5, 3, 0.25, stone[0], "grain"]);
p.push([-1.5, -1.25, 0.25, 3, 2.5, 0.25, stone[1], "grain"]);
for (let k = 0; k < 3; k++) p.push([-0.5, -1.875 + k * 0.125, k * 0.125, 1, 0.25, 0.125, stone[2 + (k % 2)]]);
// Four lacquered posts, each on a stone base with a gold cap.
for (const [x, y] of [[-1.125, -0.875], [0.875, -0.875], [-1.125, 0.625], [0.875, 0.625]]) {
  p.push([x - 0.0625, y - 0.0625, 0.5, 0.375, 0.375, 0.125, stone[3]]);
  p.push([x, y, 0.625, 0.25, 0.25, 1.625, lacquer[1], "cyl"]);
  p.push([x - 0.03125, y - 0.03125, 2.25, 0.3125, 0.3125, 0.0625, gold]);
}
// Beams that join them, and a hanging plaque.
p.push([-1.25, -0.9375, 2.3125, 2.5, 0.375, 0.1875, lacquer[0]], [-1.25, 0.5625, 2.3125, 2.5, 0.375, 0.1875, lacquer[0]]);
p.push([-1.1875, -0.9375, 2.0, 2.375, 0.125, 0.125, lacquer[2]]);
p.push([-0.3125, -1.0, 1.75, 0.625, 0.0625, 0.3125, lacquer[3]], [-0.25, -1.03125, 1.8125, 0.5, 0.03125, 0.1875, gold]);
// The roof: two wedges back to back, dark eaves curling up at the corners, rows of tiles, a ridge.
p.push([-2.0, -1.375, 2.5, 2.0, 2.75, 1.0, tile[1], "wedge", { rz: 180 }]);
p.push([0.0, -1.375, 2.5, 2.0, 2.75, 1.0, tile[1], "wedge"]);
for (let k = 0; k < 4; k++) {
  p.push([-1.875 + k * 0.4375, -1.4375, 2.5 + k * 0.21875 + 0.125, 0.125, 2.875, 0.0625, tile[2]]);
  p.push([1.75 - k * 0.4375, -1.4375, 2.5 + k * 0.21875 + 0.125, 0.125, 2.875, 0.0625, tile[2]]);
}
p.push([-2.125, -1.5, 2.375, 4.25, 3.0, 0.125, tile[0]]);
for (const [x, y] of [[-2.125, -1.5], [1.875, -1.5], [-2.125, 1.25], [1.875, 1.25]]) p.push([x, y, 2.5, 0.25, 0.25, 0.25, tile[0], "cone"]);
p.push([-0.125, -1.4375, 3.375, 0.25, 2.875, 0.1875, lacquer[0]]);
p.push([-0.1875, -1.5625, 3.375, 0.375, 0.25, 0.375, gold, "cone"], [-0.1875, 1.3125, 3.375, 0.375, 0.25, 0.375, gold, "cone"]);
// The altar: a stone block, a cloth, an offering bowl, and the moonstone that glows.
p.push([-0.5, -0.125, 0.5, 1.0, 0.5, 0.5, stone[2], "grain"]);
p.push([-0.5625, -0.1875, 1.0, 1.125, 0.625, 0.0625, stone[3]]);
p.push([-0.375, -0.1875, 0.75, 0.75, 0.0625, 0.3125, "#e6dcc4"]);
p.push([-0.1875, -0.0625, 1.0625, 0.375, 0.375, 0.125, gold, "cyl"]);
p.push([-0.125, 0.0, 1.1875, 0.25, 0.25, 0.375, moon, "glow", "dome"]);
for (const x of [-0.4375, 0.3125]) p.push([x, -0.0625, 1.0625, 0.125, 0.125, 0.1875, "#efe3c2", "cyl"], [x + 0.03125, -0.03125, 1.25, 0.0625, 0.0625, 0.0625, "#ffcf6b", "glow"]);
// Offerings at the altar's foot: rice cakes and a bowl of fruit.
p.push([-0.75, -0.375, 0.5, 0.25, 0.25, 0.125, "#efe3c2", "cyl"], [0.5, -0.375, 0.5, 0.25, 0.25, 0.0625, stone[3], "cyl"]);
p.push([0.53125, -0.34375, 0.5625, 0.1875, 0.1875, 0.125, "#d8692e", "dome"]);
// Two stone lanterns at the foot of the stair.
for (const x of [-1.5, 1.125]) {
  p.push([x, -2.0, 0, 0.375, 0.375, 0.125, stone[1]], [x + 0.125, -1.875, 0.125, 0.125, 0.125, 0.5, stone[2]]);
  p.push([x + 0.0625, -1.9375, 0.625, 0.25, 0.25, 0.25, "#ffcf6b", "glow"], [x - 0.0625, -2.0625, 0.875, 0.5, 0.5, 0.25, stone[0], "cone"]);
}
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Moon Shrine" });`,
};
