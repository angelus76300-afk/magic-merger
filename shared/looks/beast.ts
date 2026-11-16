import type { Reference } from "./reference";

// A creature's figure (a statue, a mount, a beast in a scene), facing east: a grey wolf, 1.6 long,
// 1 tall, about a villager's height at the head. A creature that moves is a w.creature with its own
// model (48 parts at most); this is the level of detail either way.
export const BEAST: Reference = {
  name: "Grey Wolf",
  kind: "creature",
  note: "head, ears, tail and legs at the outline make the animal; a pale belly and dark back give the fur three tones; the eyes are the accent",
  code: `const fur = ["#4d4a4a", "#66615e", "#7f7a75", "#a19b93"];
const pale = "#cfc8bb";
const dark = "#2c2828";
const eye = "#ffd23a";
const p = [];
// The body: ribcage, haunch and a dark saddle along the back, a pale belly under.
p.push([-0.375, -0.25, 0.5, 0.75, 0.5, 0.375, fur[2], "grain"]);
p.push([0.25, -0.28125, 0.4375, 0.375, 0.5625, 0.4375, fur[2], "grain"]);
p.push([-0.5625, -0.25, 0.5, 0.25, 0.5, 0.375, fur[1], "grain"]);
p.push([-0.4375, -0.1875, 0.8125, 0.875, 0.375, 0.0625, fur[0]]);
p.push([-0.3125, -0.1875, 0.4375, 0.625, 0.375, 0.0625, pale]);
// A ruff of fur round the neck, the neck reaching up and forward.
p.push([0.5, -0.3125, 0.625, 0.25, 0.625, 0.3125, fur[3], "grain"]);
p.push([0.625, -0.1875, 0.75, 0.25, 0.375, 0.25, fur[2], { ry: -30 }]);
// The head: skull, brow, muzzle, nose, jaw, cheeks; ears as wedges; eyes that shine.
p.push([0.75, -0.1875, 0.875, 0.3125, 0.375, 0.3125, fur[2], "grain"]);
p.push([0.75, -0.1875, 1.125, 0.25, 0.375, 0.0625, fur[1]]);
p.push([1.0625, -0.125, 0.9375, 0.25, 0.25, 0.1875, fur[3]]);
p.push([1.25, -0.0625, 1.0, 0.0625, 0.125, 0.0625, dark]);
p.push([1.0, -0.09375, 0.875, 0.25, 0.1875, 0.0625, pale]);
p.push([0.75, -0.25, 0.875, 0.125, 0.0625, 0.1875, fur[3]], [0.75, 0.1875, 0.875, 0.125, 0.0625, 0.1875, fur[3]]);
p.push([0.8125, -0.1875, 1.1875, 0.125, 0.125, 0.1875, fur[1], "wedge", { rz: 180 }]);
p.push([0.8125, 0.0625, 1.1875, 0.125, 0.125, 0.1875, fur[1], "wedge", { rz: 180 }]);
p.push([0.84375, -0.15625, 1.21875, 0.0625, 0.0625, 0.0625, "#c99b8f"], [0.84375, 0.09375, 1.21875, 0.0625, 0.0625, 0.0625, "#c99b8f"]);
p.push([1.0, -0.1875, 1.0625, 0.0625, 0.03125, 0.0625, eye, "glow"], [1.0, 0.15625, 1.0625, 0.0625, 0.03125, 0.0625, eye, "glow"]);
// Four legs: thigh, shin and a paw each; the hind legs bent back.
for (const [x, y, back] of [[0.375, -0.25, 0], [0.375, 0.125, 0], [-0.4375, -0.25, 1], [-0.4375, 0.125, 1]]) {
  p.push([x, y, 0.25, 0.125, 0.125, 0.3125, fur[1], "cyl", back ? { ry: -14 } : {}]);
  p.push([x + (back ? 0.0625 : 0), y, 0.0625, 0.125, 0.125, 0.25, fur[0]]);
  p.push([x + (back ? 0.0625 : 0.0625), y - 0.015625, 0, 0.1875, 0.15625, 0.0625, dark]);
}
// Hackles: tufts of fur standing along the back.
for (let k = 0; k < 4; k++) p.push([0.375 - k * 0.25, -0.0625, 0.875, 0.1875, 0.125, 0.125 - k * 0.015625, fur[0], "wedge", { rz: 180 }]);
// The tail in three turned pieces, raised in a curve and bushy, pale at the tip.
p.push([-0.8125, -0.0625, 0.75, 0.3125, 0.125, 0.125, fur[1], { ry: -25 }]);
p.push([-1.0625, -0.078125, 0.9375, 0.25, 0.15625, 0.15625, fur[2], { ry: -55 }]);
p.push([-1.1875, -0.0625, 1.125, 0.1875, 0.125, 0.25, pale, "cone", { ry: -20 }]);
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Grey Wolf" });`,
};
