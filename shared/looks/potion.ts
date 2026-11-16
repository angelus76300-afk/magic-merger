import type { Reference } from "./reference";

// An object at its real size: a round potion on a little tray. 0.75 across, 1.2 tall.
export const POTION: Reference = {
  name: "Potion",
  kind: "object",
  note: "a round body under a thin neck is the silhouette; the liquid's line shows through the glass; the glowing bubbles are the accent",
  code: `const glass = ["#9fc9d6", "#bfe0e8", "#e2f4f7"];
const brew = ["#7a1f6e", "#a02c8c", "#c845ac", "#e86ccc"];
const wood = ["#5a3a24", "#6f4a2f", "#86603d"];
const cork = "#b08a5a";
const p = [];
// A round tray with a rim, then three feet under the flask.
p.push([-0.375, -0.375, 0, 0.75, 0.75, 0.0625, wood[0], "cyl", "grain"]);
p.push([-0.4375, -0.4375, 0.0625, 0.875, 0.875, 0.0625, wood[1], "cyl"]);
p.push([-0.375, -0.375, 0.0625, 0.75, 0.75, 0.0625, wood[2], "cyl"]);
for (let k = 0; k < 3; k++) {
  const a = (k * 2 * Math.PI) / 3;
  p.push([Math.cos(a) * 0.1875 - 0.03125, Math.sin(a) * 0.1875 - 0.03125, 0.125, 0.0625, 0.0625, 0.0625, wood[0]]);
}
// The flask: a bowl of brew under a dome of clear glass, banded where the liquid ends.
p.push([-0.25, -0.25, 0.1875, 0.5, 0.5, 0.125, brew[0], "dome", { rx: 180 }]);
p.push([-0.3125, -0.3125, 0.3125, 0.625, 0.625, 0.1875, brew[1], "cyl"]);
p.push([-0.3125, -0.3125, 0.5, 0.625, 0.625, 0.0625, brew[2], "cyl"]);
p.push([-0.3125, -0.3125, 0.5625, 0.625, 0.625, 0.25, glass[0], "dome"]);
// A paper label and a white highlight on the glass.
p.push([-0.1875, -0.34375, 0.3125, 0.375, 0.03125, 0.1875, "#efe3c2"]);
p.push([-0.125, -0.375, 0.375, 0.25, 0.03125, 0.0625, brew[0]]);
p.push([0.125, -0.28125, 0.5625, 0.0625, 0.03125, 0.125, glass[2]]);
// The neck, its lip, the cork and a wax seal running down.
p.push([-0.09375, -0.09375, 0.75, 0.1875, 0.1875, 0.1875, glass[1], "cyl"]);
p.push([-0.125, -0.125, 0.9375, 0.25, 0.25, 0.0625, glass[0], "cyl"]);
p.push([-0.0625, -0.0625, 0.9375, 0.125, 0.125, 0.125, cork, "cyl"]);
p.push([-0.09375, -0.09375, 1.0, 0.1875, 0.1875, 0.0625, brew[0], "cyl"]);
p.push([0.0625, -0.03125, 0.875, 0.0625, 0.0625, 0.125, brew[0]]);
// A string tied round the neck with a small tag, and a drop run down the glass.
p.push([-0.109375, -0.109375, 0.8125, 0.21875, 0.21875, 0.03125, "#c9b48c", "cyl"]);
p.push([0.09375, -0.125, 0.6875, 0.0625, 0.03125, 0.125, "#c9b48c"], [0.125, -0.15625, 0.5625, 0.125, 0.03125, 0.125, "#efe3c2"]);
p.push([-0.28125, -0.15625, 0.4375, 0.03125, 0.0625, 0.125, brew[2]]);
// Bubbles rising from the cork: the accent.
for (const [x, y, z, s] of [[0, 0, 1.125, 0.0625], [-0.0625, 0.0625, 1.25, 0.09375], [0.0625, -0.03125, 1.4, 0.0625]])
  p.push([x - s / 2, y - s / 2, z, s, s, s, brew[3], "glow", "dome"]);
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Potion" });`,
};
