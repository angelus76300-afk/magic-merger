import type { Reference } from "./reference";

// A place or a wonder: a ruined temple of a fallen age, 8 across, 5.5 tall. Columns broken at
// different heights, an arch of cut stones round a glowing gate, fallen drums, ivy, rubble.
export const RUIN: Reference = {
  name: "Sunken Temple",
  kind: "place",
  note: "broken columns at uneven heights and an arch of single cut stones make the ruin; fallen drums and rubble tell what happened; sandstone in five tones, ivy in two, the gate's light the accent",
  code: `const sand = ["#8a7655", "#a08a64", "#b5a077", "#c9b68c", "#d9c9a2"];
const ivy = ["#3c6a2c", "#558a3a"];
const gate = ["#4de0c8", "#9ff7e6"];
const p = [];
// A broken platform: three steps, a corner missing, cracked slabs.
p.push([-4.0, -2.5, 0, 8.0, 5.0, 0.25, sand[0], "grain"]);
p.push([-3.5, -2.0, 0.25, 7.0, 4.0, 0.25, sand[1], "grain"]);
p.push([-3.0, -1.5, 0.5, 5.5, 3.0, 0.25, sand[2], "grain"]);
for (let k = 0; k < 6; k++) p.push([-2.75 + k * 0.9375, -1.25 + (k % 2) * 0.125, 0.75, 0.875, 2.5, 0.0625, sand[3 + (k % 2)]]);
// Two rows of columns: base, drums of alternating tone up to each one's broken height, a capital on the whole ones.
const heights = [6, 6, 3, 2, 5, 4];
for (let k = 0; k < 6; k++) {
  const x = -2.625 + (k % 3) * 1.0 + (k < 3 ? 0 : 3.25), y = k < 3 ? -1.0 : 0.625;
  p.push([x - 0.375, y - 0.375, 0.8125, 0.75, 0.75, 0.1875, sand[0]]);
  for (let d = 0; d < heights[k]; d++) p.push([x - 0.25, y - 0.25, 1.0 + d * 0.5, 0.5, 0.5, 0.5, sand[2 + (d % 2)], "cyl", "grain", { rz: d * 17 }]);
  if (heights[k] === 6) p.push([x - 0.375, y - 0.375, 4.0, 0.75, 0.75, 0.25, sand[4]], [x - 0.3125, y - 0.3125, 4.25, 0.625, 0.625, 0.125, sand[1]]);
  else p.push([x - 0.25, y - 0.25, 1.0 + heights[k] * 0.5, 0.5, 0.5, 0.25, sand[1], "wedge", { rz: k * 60 }]);
}
// A lintel still lying across two whole columns.
p.push([-3.0, -1.25, 4.375, 1.75, 0.5, 0.375, sand[3], "grain"]);
// The arch at the back: two piers, eleven cut stones round a half circle, a keystone.
p.push([-0.375 + 0.4, 1.125, 0.75, 0.5, 0.75, 2.0, sand[1], "grain"], [1.875 - 0.4, 1.125, 0.75, 0.5, 0.75, 2.0, sand[1], "grain"]);
for (let k = 0; k <= 10; k++) {
  const a = (k * Math.PI) / 10;
  const x = 0.9375 + Math.cos(a) * 0.875, z = 2.75 + Math.sin(a) * 0.875;
  p.push([x - 0.1875, 1.125, z - 0.1875, 0.375, 0.75, 0.375, k === 5 ? sand[4] : sand[2 + (k % 2)], { ry: (a * 180) / Math.PI - 90 }]);
}
// The gate's light filling the arch, and motes rising off it.
p.push([0.3125 + 0.125, 1.375, 0.75, 1.0, 0.125, 2.0, gate[0], "glow"]);
p.push([0.5625, 1.375, 2.75, 0.75, 0.125, 0.5, gate[0], "glow", "dome", { rx: 90 }]);
for (const [x, z] of [[0.75, 3.125], [1.125, 3.5], [0.9375, 3.875]]) p.push([x, 1.4375, z, 0.0625, 0.0625, 0.0625, gate[1], "glow"]);
// Fallen drums on their sides, a broken capital, rubble.
p.push([2.5, -2.25, 0.25, 0.5, 0.5, 0.5, sand[2], "cyl", "grain", { ry: 90, rz: 20 }]);
p.push([3.125, -2.0, 0.25, 0.5, 0.5, 0.5, sand[3], "cyl", "grain", { ry: 90, rz: 35 }]);
p.push([-3.75, 1.5, 0.25, 0.75, 0.75, 0.25, sand[4], { rz: 25 }]);
for (let k = 0; k < 10; k++) {
  const x = -3.5 + ((k * 2.3) % 7), y = k % 2 ? -2.25 : 2.0;
  p.push([x, y, 0.25, 0.25 + (k % 3) * 0.125, 0.25, 0.125 + (k % 2) * 0.125, sand[k % 4]]);
}
// Ivy over the stones: a sheet down a pier, tufts on the broken tops and the steps.
p.push([-0.0625 + 0.4, 1.0625, 1.0, 0.0625, 0.375, 1.5, ivy[0]], [1.875 - 0.4, 1.0625, 0.875, 0.5, 0.0625, 1.0, ivy[1]]);
for (const [x, y, z] of [[-1.875, -1.25, 2.0], [-0.875, -1.25, 3.0], [1.375, 0.375, 2.5], [-3.0, -1.5, 0.75], [2.0, -1.5, 0.75], [3.375, 0.875, 0.75]])
  p.push([x, y, z, 0.5, 0.5, 0.125, ivy[(x > 0) + 0], "grain"]);
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Sunken Temple" });`,
};
