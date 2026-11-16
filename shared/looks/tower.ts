import type { Reference } from "./reference";

// A building: a mage's tower, 2.6 across, 6.5 tall (three houses high). Loops make its courses,
// windows and merlons, so a hundred parts are a few lines.
export const TOWER: Reference = {
  name: "Mage Tower",
  kind: "building",
  note: "a stepped base, a tall shaft, a parapet of merlons and a steep cone roof with a finial: the outline says tower from across the island; stone in four tones, slate in three, lit windows the accent",
  code: `const stone = ["#8f8574", "#a3998a", "#b8ad9c", "#cdc3b1"];
const slate = ["#3b4766", "#4c5a80", "#62729a"];
const wood = ["#5a3c26", "#734d31"];
const lit = "#ffcf6b";
const magic = "#8fe8ff";
const p = [];
const ring = (n, r, f) => { for (let k = 0; k < n; k++) { const a = (k * 2 * Math.PI) / n; f(Math.cos(a) * r, Math.sin(a) * r, a, k); } };
// A stepped base of two rings, grainy, and a mossy foot.
p.push([-1.3125, -1.3125, 0, 2.625, 2.625, 0.25, stone[0], "cyl", "grain"]);
p.push([-1.125, -1.125, 0.25, 2.25, 2.25, 0.25, stone[1], "cyl", "grain"]);
ring(10, 1.25, (x, y) => p.push([x - 0.125, y - 0.125, 0, 0.25, 0.25, 0.125, "#4f7a33"]));
// The shaft in eight courses of alternating tone, a band every third.
for (let k = 0; k < 8; k++) p.push([-0.875, -0.875, 0.5 + k * 0.5, 1.75, 1.75, 0.5, stone[1 + (k % 2)], "cyl", "grain"]);
for (const z of [1.9375, 3.4375]) p.push([-0.9375, -0.9375, z, 1.875, 1.875, 0.125, stone[0], "cyl"]);
// A door in an arch, with steps up to it.
p.push([-0.25, -0.9375, 0.5, 0.5, 0.125, 0.75, wood[0]]);
p.push([-0.3125, -0.96875, 1.25, 0.625, 0.125, 0.1875, stone[3], "dome", { rx: 90 }]);
for (let k = 0; k < 3; k++) p.push([-0.375, -1.375 + k * 0.125, 0.25 + k * 0.0625, 0.75, 0.25, 0.0625, stone[2]]);
p.push([0.0625, -1.0, 0.875, 0.0625, 0.0625, 0.0625, lit, "glow"]);
// Two rows of lit windows round the shaft, each with a stone sill.
for (const [z, n, off] of [[2.25, 4, 0.4], [3.75, 6, 0]]) ring(n, 0.875, (x, y, a) => {
  const xa = Math.cos(a + off) * 0.875, ya = Math.sin(a + off) * 0.875;
  p.push([xa - 0.09375, ya - 0.09375, z, 0.1875, 0.1875, 0.375, lit, "glow"]);
  p.push([xa - 0.125, ya - 0.125, z - 0.0625, 0.25, 0.25, 0.0625, stone[3]]);
});
// Corbels, then the gallery: a wide ring, a parapet and twelve merlons.
ring(12, 0.9375, (x, y, a) => p.push([x - 0.125, y - 0.125, 4.375, 0.25, 0.25, 0.25, stone[0], "wedge", { rx: 180, rz: (a * 180) / Math.PI }]));
p.push([-1.1875, -1.1875, 4.625, 2.375, 2.375, 0.1875, stone[2], "cyl", "grain"]);
ring(12, 1.0625, (x, y, a, k) => k % 2 || p.push([x - 0.125, y - 0.125, 4.8125, 0.25, 0.25, 0.25, stone[3]]));
// The roof: a dark eave ring, a cone in three bands of slate, a finial and its light.
p.push([-1.0625, -1.0625, 4.8125, 2.125, 2.125, 0.125, slate[0], "cyl"]);
p.push([-1.0, -1.0, 4.9375, 2.0, 2.0, 0.5, slate[1], "cyl"]);
p.push([-1.0, -1.0, 5.4375, 2.0, 2.0, 1.75, slate[2], "cone"]);
p.push([-0.75, -0.75, 5.4375, 1.5, 1.5, 0.125, slate[0], "cyl"]);
p.push([-0.0625, -0.0625, 7.0, 0.125, 0.125, 0.375, "#c9982f", "cyl"]);
p.push([-0.125, -0.125, 7.375, 0.25, 0.25, 0.25, magic, "glow", "dome"]);
// A dormer window in the roof, and a pennant on the finial.
p.push([0.5, -0.1875, 5.5, 0.375, 0.375, 0.375, slate[0]], [0.84375, -0.09375, 5.5625, 0.0625, 0.1875, 0.25, lit, "glow"]);
p.push([0.0625, -0.03125, 7.1875, 0.375, 0.0625, 0.1875, "#b8323e", "wedge"]);
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Mage Tower" });`,
};
