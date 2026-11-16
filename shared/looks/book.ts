import type { Reference } from "./reference";

// An object at its real size, on what bears it: an open spellbook on a lectern. 1 across, 1.9 tall.
export const BOOK: Reference = {
  name: "Spellbook",
  kind: "object",
  note: "a lectern lifts a small thing to where it reads; a tilted desk and an open book give it slopes; gold corners and a glowing rune are the accent",
  code: `const wood = ["#4a2f1d", "#5e3c25", "#74492d", "#8c5c3a"];
const cover = ["#5c1a26", "#7a2433", "#96304a"];
const page = ["#f2e8cc", "#e0d2ae", "#c9b48c"];
const gold = "#e9b949";
const rune = "#86e6ff";
const p = [];
// A foot of two crossed planks, a stepped block, a turned post with three rings.
p.push([-0.5, -0.125, 0, 1, 0.25, 0.125, wood[0], "grain"], [-0.125, -0.5, 0, 0.25, 1, 0.125, wood[0], "grain"]);
p.push([-0.25, -0.25, 0.125, 0.5, 0.5, 0.125, wood[1], "grain"]);
p.push([-0.125, -0.125, 0.25, 0.25, 0.25, 0.875, wood[2], "cyl"]);
for (const z of [0.375, 0.75, 1.0625]) p.push([-0.1875, -0.1875, z, 0.375, 0.375, 0.0625, wood[0], "cyl"]);
// The desk, tilted toward the reader, with a lip that holds the book.
p.push([-0.3125, -0.25, 1.125, 0.625, 0.5, 0.125, wood[1]]);
p.push([-0.5, -0.375, 1.25, 1, 0.75, 0.0625, wood[3], "grain", { rx: 14 }]);
p.push([-0.5, -0.4375, 1.1875, 1, 0.0625, 0.1875, wood[1], { rx: 14 }]);
// The open book: two covers turned up from the spine, page blocks, page edges.
p.push([-0.4375, -0.3125, 1.3125, 0.4375, 0.625, 0.0625, cover[0], { rx: 14, ry: -6 }]);
p.push([0, -0.3125, 1.3125, 0.4375, 0.625, 0.0625, cover[0], { rx: 14, ry: 6 }]);
p.push([-0.0625, -0.3125, 1.25, 0.125, 0.625, 0.0625, cover[1]]);
p.push([-0.375, -0.25, 1.375, 0.375, 0.5, 0.0625, page[0], { rx: 14, ry: -8 }]);
p.push([0, -0.25, 1.375, 0.375, 0.5, 0.0625, page[0], { rx: 14, ry: 8 }]);
p.push([-0.375, -0.25, 1.34375, 0.375, 0.5, 0.03125, page[2], { rx: 14, ry: -6 }]);
p.push([0, -0.25, 1.34375, 0.375, 0.5, 0.03125, page[2], { rx: 14, ry: 6 }]);
// Lines of writing, a page turning, a ribbon hanging from the spine.
for (let k = 0; k < 3; k++) p.push([-0.3125, -0.1875 + k * 0.125, 1.4375, 0.25, 0.03125, 0.03125, page[1], { rx: 14 }]);
p.push([0.0625, -0.125, 1.5, 0.25, 0.375, 0.0625, page[1], { rx: 14, ry: 32 }]);
p.push([-0.03125, -0.4375, 1.0, 0.0625, 0.0625, 0.3125, cover[2]]);
// Gold corners and a clasp, and the rune that shines off the page.
for (const [x, y] of [[-0.4375, -0.3125], [0.375, -0.3125], [-0.4375, 0.25], [0.375, 0.25]]) p.push([x, y, 1.3125, 0.0625, 0.0625, 0.09375, gold]);
p.push([0.4375, -0.0625, 1.3125, 0.0625, 0.125, 0.125, gold]);
p.push([-0.25, -0.0625, 1.4375, 0.125, 0.125, 0.0625, rune, "glow"]);
for (const [x, y, z] of [[-0.1875, 0, 1.625], [-0.3125, 0.0625, 1.75], [-0.125, -0.0625, 1.875]]) p.push([x, y, z, 0.0625, 0.0625, 0.0625, rune, "glow"]);
// A candle stub at the desk's corner.
p.push([0.3125, 0.25, 1.3125, 0.125, 0.125, 0.1875, page[1], "cyl"], [0.34375, 0.28125, 1.5, 0.0625, 0.0625, 0.125, gold, "cone", "glow"]);
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Spellbook" });`,
};
