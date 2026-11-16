import type { Reference } from "./reference";

// An object at its real size, on what bears it: a seeing orb held in claws on a pedestal. 1 across, 1.9 tall.
export const ORB: Reference = {
  name: "Seeing Orb",
  kind: "object",
  note: "a sphere stacked from slices of a cylinder reads round; claws and a ring of runes break its outline; the orb's glow is the accent",
  code: `const stone = ["#3e3a4a", "#524c60", "#686078", "#80789a"];
const brass = ["#8a6a2a", "#b38c38", "#dcb85a"];
const glow = ["#5a2fb8", "#7c4ae0", "#a57cff", "#d3bcff"];
const p = [];
// The pedestal: a stepped square foot, a column with a waist, a round dish.
p.push([-0.5, -0.5, 0, 1, 1, 0.125, stone[0], "grain"]);
p.push([-0.4375, -0.4375, 0.125, 0.875, 0.875, 0.0625, stone[1]]);
p.push([-0.3125, -0.3125, 0.1875, 0.625, 0.625, 0.125, stone[1], "grain"]);
p.push([-0.1875, -0.1875, 0.3125, 0.375, 0.375, 0.5, stone[2], "cyl"]);
p.push([-0.25, -0.25, 0.5, 0.5, 0.5, 0.0625, stone[0], "cyl"]);
p.push([-0.3125, -0.3125, 0.8125, 0.625, 0.625, 0.125, stone[3], "cyl"]);
p.push([-0.375, -0.375, 0.9375, 0.75, 0.75, 0.0625, brass[1], "cyl"]);
// Four brass claws rising round the orb, each a post and an inward hook.
for (let k = 0; k < 4; k++) {
  const a = (k * Math.PI) / 2 + Math.PI / 4;
  const x = Math.cos(a) * 0.3125;
  const y = Math.sin(a) * 0.3125;
  p.push([x - 0.0625, y - 0.0625, 1.0, 0.125, 0.125, 0.25, brass[0]]);
  p.push([x * 0.8 - 0.0625, y * 0.8 - 0.0625, 1.25, 0.125, 0.125, 0.125, brass[2], "cone", { rz: (a * 180) / Math.PI }]);
}
// The orb: seven slices, wide in the middle, dark at the foot and bright at the crown.
const r = 0.3125;
for (let k = 0; k < 7; k++) {
  const z = -r + (k + 0.5) * ((2 * r) / 7);
  const s = Math.sqrt(r * r - z * z) + 0.03;
  p.push([-s, -s, 1.3125 + z - r / 7, 2 * s, 2 * s, (2 * r) / 7, glow[Math.min(3, Math.floor(k / 2))], "cyl", "glow"]);
}
// A white glint, and a ring of eight runes floating round it.
p.push([-0.1875, -0.28125, 1.4375, 0.0625, 0.0625, 0.0625, "#ffffff", "glow"]);
for (let k = 0; k < 8; k++) {
  const a = (k * Math.PI) / 4;
  p.push([Math.cos(a) * 0.5 - 0.03125, Math.sin(a) * 0.5 - 0.03125, 1.25 + (k % 2) * 0.125, 0.0625, 0.0625, 0.0625, glow[3], "glow"]);
}
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Seeing Orb" });`,
};
