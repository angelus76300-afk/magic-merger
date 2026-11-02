// World Tree Guardian, written for World API v2 by claude-opus-5-5 (cosmic). Kept to check old programs still run.
let lastWall = -99;
const spell = {
  materials: [
    { name: "heartwood", layer: "ground", colors: ["#c9ced6", "#b7bdc6", "#dfe3ea"], glow: 0.25, becomes: "dirt",
      tick(c, w) {
        if (!w.chance(c.dt * 0.6)) return;
        let burning = false;
        for (let i = 0; i < 14 && !burning; i++) {
          const a = w.rand(0, 6.283), d = w.rand(2, 14);
          const s = w.cell(Math.round(c.x + Math.cos(a) * d), Math.round(c.y + Math.sin(a) * d));
          if (s && s.fire > 0) burning = true;
        }
        if (burning && w.time - lastWall > 15) {
          lastWall = w.time;
          w.ring(c.x, c.y, 6, 7.2, (x, y) => w.build(x, y, 3, "rootwall"));
          w.disc(c.x, c.y, 8, (x, y) => { const s = w.cell(x, y); if (s && s.fire > 0) w.clear(x, y, "fire"); });
          w.light(c.x, c.y, 9, "#80ed99", 1.5);
          w.sound("rumble", 0.3);
        } else if (w.chance(0.08)) {
          w.grow(c.x, c.y, 9, 0.15);
          w.particle({ x: c.x, y: c.y, z: 18, vz: 2, life: 1.5, color: "#9ef01a", size: 1, glow: 1 });
        }
      } },
    { name: "rootwall", layer: "ground", colors: ["#5a3d22", "#6b4a2b", "#4d6b2a"], flammable: 0.05, becomes: "dirt" },
  ],
  *cast(w) {
    const x = Math.round(w.x), y = Math.round(w.y);
    w.flash("#d8f3dc", 0.4);
    w.sound("chime", 0.5);
    w.circle(x, y, 3, "#80ed99", "#e0e6ee", 0.8);
    w.clear(x, y, "cover");
    w.build(x, y, 8, "heartwood");
    // green veins winding up the silver bark
    for (let z = 1; z < 8; z++) {
      const a = z * 1.3;
      w.voxel(x + Math.round(Math.cos(a) * 0.9), y + Math.round(Math.sin(a) * 0.9), z, "#57cc99");
    }
    // leafy crown
    w.sphere(x, y, 10, 1.8, ["#2f7a2a", "#57a24a", "#80ed99"], 0.75);
    // the dryad's pale face in the knots near the crown
    w.voxel(x + 1, y, 8, "#ece6d6");
    w.voxel(x + 1, y, 9, "#ece6d6");
    w.voxel(x + 1, y + 1, 9, "#2d4a3a");
    w.voxel(x + 1, y - 1, 9, "#2d4a3a");
    w.burst(x, y, { count: 30, colors: ["#80ed99", "#d8f3dc", "#c9ced6"], speed: 4, up: 6, life: 1, size: 1 });
    w.light(x, y, 6, "#80ed99", 2);
    yield 0.4;
    w.grow(x, y, 4, 0.5);
    w.paint(x, y, 2, "flower", 0.4);
  },
};
