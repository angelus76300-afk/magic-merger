import type { Reference } from "./reference";

// An object at its real size, on what bears it: a sword drawn up from a mossy stone. 1.2 across, 2 tall.
export const SWORD: Reference = {
  name: "Sword in the Stone",
  kind: "object",
  note: "a long thin blade over a heavy base reads from far; bevelled edges and a dark fuller give the steel three tones; the glowing runes are the accent",
  code: `const stone = ["#5f6066", "#75767c", "#8b8c90", "#a3a3a6"];
const steel = ["#9aa3ad", "#c3cbd3", "#e6ecf1"];
const gold = ["#9c7424", "#c9982f", "#ecc456"];
const leather = "#4a2c1e";
const moss = ["#3f6b2e", "#56853a"];
const rune = "#7ff0ff";
const p = [];
// The stone: a broad base, a cracked middle and a smaller top, each with grain, then loose chips.
p.push([-0.625, -0.5, 0, 1.25, 1, 0.25, stone[0], "grain"]);
p.push([-0.5, -0.4375, 0.25, 1, 0.875, 0.1875, stone[1], "grain"]);
p.push([-0.375, -0.3125, 0.4375, 0.75, 0.625, 0.1875, stone[2], "grain"]);
p.push([-0.25, -0.25, 0.625, 0.5, 0.5, 0.0625, stone[3]]);
p.push([0.3125, -0.4375, 0.25, 0.25, 0.25, 0.25, stone[1], "wedge", { rz: 180 }]);
p.push([-0.5625, 0.125, 0.25, 0.25, 0.3125, 0.1875, stone[2], "wedge"]);
for (const [x, y] of [[0.75, 0.25], [-0.8125, -0.3125], [0.5, 0.5625]]) p.push([x, y, 0, 0.1875, 0.125, 0.0625, stone[1]]);
// Moss over its shoulders.
p.push([-0.5, 0.25, 0.4375, 0.375, 0.1875, 0.0625, moss[0]], [0.125, 0.1875, 0.625, 0.25, 0.125, 0.03125, moss[1]]);
p.push([-0.625, -0.1875, 0.25, 0.0625, 0.375, 0.0625, moss[1]]);
// The blade: the flat, two bright bevels, the dark fuller, runes down it.
p.push([-0.09375, -0.03125, 0.5, 0.1875, 0.0625, 1.125, steel[1]]);
p.push([-0.125, -0.03125, 0.5, 0.03125, 0.0625, 1.125, steel[2]], [0.09375, -0.03125, 0.5, 0.03125, 0.0625, 1.125, steel[2]]);
p.push([-0.015625, -0.046875, 0.6875, 0.03125, 0.09375, 0.875, steel[0]]);
for (let k = 0; k < 4; k++) p.push([-0.03125, -0.0625, 0.75 + k * 0.1875, 0.0625, 0.03125, 0.0625, rune, "glow"]);
// The guard, swept up at its ends, a gem in its middle.
p.push([-0.375, -0.0625, 1.625, 0.75, 0.125, 0.09375, gold[1]]);
p.push([-0.4375, -0.0625, 1.625, 0.125, 0.125, 0.1875, gold[0], "wedge", { rz: 180 }]);
p.push([0.3125, -0.0625, 1.625, 0.125, 0.125, 0.1875, gold[0], "wedge"]);
p.push([-0.0625, -0.09375, 1.59375, 0.125, 0.03125, 0.125, "#d62f4a"]);
// The grip, wrapped in leather with gold bands, and a round pommel.
p.push([-0.046875, -0.046875, 1.71875, 0.09375, 0.09375, 0.3125, leather, "cyl"]);
for (const z of [1.75, 1.875, 2.0]) p.push([-0.0625, -0.0625, z, 0.125, 0.125, 0.03125, gold[1], "cyl"]);
p.push([-0.09375, -0.09375, 2.03125, 0.1875, 0.1875, 0.125, gold[2], "dome"]);
p.push([-0.0625, -0.0625, 2.03125, 0.125, 0.125, 0.0625, gold[0], "cyl"]);
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Sword in the Stone" });`,
};
