// Starbloom, written for World API v2 by claude-opus-5-5 (legendary). Kept to check old programs still run.
const spell = {
  materials: [
    { name: "starbloom", layer: "cover", colors: ["#dff0ff", "#a8d8ff", "#f4fbff"], flammable: 0, glow: 1, solid: false, becomes: "flower",
      tick(c, w) {
        if (w.chance(0.03)) w.particle({ x: c.x + w.rand(-1.2, 1.2), y: c.y + w.rand(-1.2, 1.2), z: w.rand(2, 4), vx: w.rand(-0.3, 0.3), vy: w.rand(-0.3, 0.3), vz: w.rand(0.2, 0.6), life: w.rand(2, 4), color: w.pick(["#ffffff", "#bfe3ff", "#fff6c8"]), size: w.rand(0.3, 0.6), glow: 1, gravity: 0, drag: 0.2 });
        if (w.chance(0.004)) { const k = w.cell(c.x, c.y); if (k.fluid !== "water" || k.depth < 1) w.set(c.x, c.y, "water", 1); }
        if (w.chance(0.002)) w.light(c.x, c.y, 4, "#9fd3ff", 1.5);
      } },
  ],
  *cast(w) {
    const x = Math.round(w.x), y = Math.round(w.y);
    w.flash("#cfe8ff", 0.4);
    w.sound("chime", 0.6);
    w.terraform(x, y, 3.5, -1);
    w.flood(x, y, 3, "water", 1.5);
    w.disc(x, y, 1, (cx, cy) => w.set(cx, cy, "starbloom"));
    // stem pad and petals floating on the water
    w.sphere(x, y, 1, 2.2, ["#2f7a5a", "#3f9a6a"], 0.5);
    const petal = ["#e8f4ff", "#bfe0ff", "#8fc8ff", "#ffffff"];
    for (let p = 0; p < 7; p++) {
      const a = p * Math.PI * 2 / 7;
      for (let d = 0.6; d <= 2.6; d += 0.5) {
        const z = 2 + Math.round((d - 0.6) * 0.8);
        w.voxel(x + Math.cos(a) * d, y + Math.sin(a) * d, z, w.pick(petal));
        if (d > 1 && d < 2.4) {
          w.voxel(x + Math.cos(a + 0.25) * d, y + Math.sin(a + 0.25) * d, z, w.pick(petal));
          w.voxel(x + Math.cos(a - 0.25) * d, y + Math.sin(a - 0.25) * d, z, w.pick(petal));
        }
      }
    }
    // glowing heart with caught stars
    w.sphere(x, y, 3, 0.9, ["#fffbe0", "#ffffff", "#fff2a8"], 1);
    for (let i = 0; i < 6; i++) w.voxel(x + w.rand(-1.5, 1.5), y + w.rand(-1.5, 1.5), 3 + Math.round(w.rand(0, 2)), "#ffffff");
    w.burst(x, y, { count: 40, colors: ["#ffffff", "#bfe3ff", "#fff6c8"], speed: 3, up: 3, life: 1.5, size: 0.5, gravity: -0.2, drag: 0.5 });
    w.light(x, y, 6, "#a8d8ff", 3);
    w.sound("ping", 0.4);
    yield 0.5;
  },
};
