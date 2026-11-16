import type { Reference } from "./reference";

// A place: an old spirit tree, 6 across, 7 tall, with roots, a split trunk, a crown of overlapping
// domes and a living layer at its foot. A place reads from the whole island.
export const TREE: Reference = {
  name: "Spirit Tree",
  kind: "place",
  note: "a wide crown of many overlapping domes over a twisted trunk and spreading roots; bark in four tones, leaves in four; glowing fruit and motes the accent",
  code: `const bark = ["#3d2a1d", "#523826", "#6a4a32", "#82603f"];
const leaf = ["#2c5a2e", "#3a7036", "#4e8a40", "#6aa84e"];
const grass = ["#4f7a33", "#679440"];
const fruit = "#9ff0ff";
const p = [];
// Roots: eight wedges spreading from the trunk, sloping down to the ground.
for (let k = 0; k < 8; k++) {
  const a = (k * Math.PI) / 4 + 0.2;
  const r = 0.9 + (k % 3) * 0.2;
  p.push([Math.cos(a) * r - 0.5, Math.sin(a) * r - 0.1875, 0, 1.0, 0.375, 0.5 + (k % 2) * 0.25, bark[k % 2], "wedge", "grain", { rz: (a * 180) / Math.PI + 180 }]);
}
// The trunk: four drums narrowing as they rise, turned a little each, bark grain on each.
for (let k = 0; k < 4; k++) {
  const s = 1.375 - k * 0.1875;
  p.push([-s / 2, -s / 2, k * 0.875, s, s, 0.9375, bark[1 + (k % 3)], "cyl", "grain", { rz: k * 11 }]);
}
// A hollow at the foot, glowing within, and a knot.
p.push([-0.25, -0.75, 0.25, 0.5, 0.125, 0.625, bark[0]], [-0.1875, -0.78125, 0.3125, 0.375, 0.0625, 0.4375, fruit, "glow"]);
p.push([0.5, 0.25, 1.75, 0.25, 0.25, 0.25, bark[0], "dome"]);
// Six boughs reaching out and up, tilted, each ending in its own cluster.
const boughs = [];
for (let k = 0; k < 6; k++) {
  const a = (k * Math.PI) / 3;
  const cx = Math.cos(a) * 1.25, cy = Math.sin(a) * 1.25;
  p.push([cx / 2 - 0.875, cy / 2 - 0.1875, 3.25 + (k % 2) * 0.375, 1.75, 0.375, 0.375, bark[2], "cyl", { rz: (a * 180) / Math.PI, ry: -18 }]);
  boughs.push([cx * 1.6, cy * 1.6, 4.0 + (k % 2) * 0.5]);
}
// The crown: a core and a dome at each bough's end, in alternating tones, then a top.
p.push([-2.0, -2.0, 4.0, 4.0, 4.0, 2.25, leaf[1], "dome", "grain"]);
p.push([-1.5, -1.5, 5.25, 3.0, 3.0, 1.75, leaf[2], "dome", "grain"]);
p.push([-0.875, -0.875, 6.25, 1.75, 1.75, 1.0, leaf[3], "dome"]);
for (const [k, [x, y, z]] of boughs.entries()) {
  p.push([x - 1.0, y - 1.0, z, 2.0, 2.0, 1.25, leaf[k % 2 ? 0 : 2], "dome", "grain"]);
  p.push([x - 0.625, y - 0.625, z + 0.75, 1.25, 1.25, 0.75, leaf[3], "dome"]);
  p.push([x - 0.875, y - 0.875, z - 0.25, 1.75, 1.75, 0.25, leaf[0], "cyl"]);
}
// Vines hanging from the crown's rim, and glowing fruit among the leaves.
for (let k = 0; k < 10; k++) {
  const a = (k * Math.PI) / 5 + 0.3;
  const r = 2.5 + (k % 2) * 0.375;
  p.push([Math.cos(a) * r - 0.0625, Math.sin(a) * r - 0.0625, 3.25 - (k % 3) * 0.375, 0.125, 0.125, 0.875 + (k % 3) * 0.375, leaf[0]]);
  p.push([Math.cos(a + 0.3) * (r - 0.5) - 0.09375, Math.sin(a + 0.3) * (r - 0.5) - 0.09375, 4.125 + (k % 4) * 0.4, 0.1875, 0.1875, 0.1875, fruit, "glow", "dome"]);
}
// The living layer: grass tufts, stones and mushrooms round the foot, motes in the air.
for (let k = 0; k < 12; k++) {
  const a = k * 0.53 + 0.1;
  const r = 2.0 + (k % 4) * 0.375;
  const x = Math.cos(a) * r, y = Math.sin(a) * r;
  if (k % 3 === 0) p.push([x - 0.1875, y - 0.125, 0, 0.375, 0.25, 0.1875, "#8d8a83", "grain"]);
  else if (k % 3 === 1) p.push([x - 0.125, y - 0.125, 0, 0.25, 0.25, 0.25, grass[k % 2], "cone"]);
  else p.push([x - 0.03125, y - 0.03125, 0, 0.0625, 0.0625, 0.1875, "#e6dcc4"], [x - 0.125, y - 0.125, 0.1875, 0.25, 0.25, 0.125, "#c0453a", "dome"]);
}
for (const [x, y, z] of [[1.5, -1.0, 2.5], [-1.25, 1.5, 3.0], [0.75, 1.75, 2.0], [-1.75, -0.75, 2.25]]) p.push([x, y, z, 0.0625, 0.0625, 0.0625, fruit, "glow"]);
// Every edge on the grid of eighths the island draws looks in, nothing thinner than one eighth:
// a part that falls between cubes is drawn whole, not lost.
const eighths = (b) => {
  const e = (a, s) => { const lo = Math.round(a * 8), hi = Math.max(lo + 1, Math.round((a + s) * 8)); return [lo / 8, (hi - lo) / 8]; };
  const [x, w] = e(b[0], b[3]), [y, d] = e(b[1], b[4]), [z, h] = e(b[2], b[5]);
  return [x, y, z, w, d, h, ...b.slice(6)];
};
w.model(w.x, w.y, p.map(eighths), { name: "Spirit Tree" });`,
};
