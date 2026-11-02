// Blizzard: a storm cloud drifts across the land with the wind, burying it in
// snow, freezing rivers and creatures in its path.
const spell = {
  *cast(w) {
    const dir = w.rand(0, Math.PI * 2);
    w.wind(Math.cos(dir) * 3, Math.sin(dir) * 3);
    w.sound("whoosh", 0.8);
    w.body({
      x: w.x, y: w.y, z: 20, r: w.r * 0.6, look: "cloud", color: "#c9d6e3", color2: "#eef4fa", glow: false,
      vx: Math.cos(dir) * w.r * 0.25, vy: Math.sin(dir) * w.r * 0.25, life: 8,
      tick(b, w, dt) {
        w.temperature(b.x, b.y, b.r, -60 * dt * 10);
        w.paint(b.x, b.y, b.r, "snow", 0.06);
        for (let k = 0; k < 6; k++) w.particle({ x: b.x + w.rand(-b.r, b.r), y: b.y + w.rand(-b.r, b.r), z: 18, vz: -12, vx: b.vx, vy: b.vy, life: 1.4, color: "#ffffff", size: 0.6, glow: false });
        for (const c of w.creatures(b.x, b.y, b.r)) c.status("freeze", 3);
      },
    });
    w.tint("#bfe3f5", 0.15, 8);
    yield 8;
  },
};
