// Meteor Shower, written for World API v3 by claude-opus-5-5 (legendary). Kept to check old programs still run.
const spell = {
  materials: [
    { name: "stardust", layer: "ground", colors: ["#cfd8ff", "#eef2ff", "#a9b8ff"], glow: true, flammable: 0, decays: 150, becomes: "grass", reacts: { water: "grass", lava: "basalt" } },
  ],
  *cast(w) {
    const R = w.r * 0.9;
    w.darken(0.65, 13);
    w.camera(w.x, w.y, R * 1.6, 1.2);
    w.circle(w.x, w.y, R * 0.4, "#dfe6ff", "#8fa4ff", 1.2);
    w.sound("rise", 0.4);
    yield 1.2;
    w.sound("drone", 0.3);
    const dirX = 0.8, dirY = 0.45;
    for (let t = 0; t < 10; t += 0.1) {
      const n = w.chance(0.5) ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const a = w.rand(0, Math.PI * 2), d = R * Math.sqrt(w.rand(0, 1));
        const tx = w.x + Math.cos(a) * d, ty = w.y + Math.sin(a) * d;
        const fall = w.rand(0.8, 1.2), h = w.rand(70, 95);
        const sx = tx - dirX * h * 0.7, sy = ty - dirY * h * 0.7;
        w.body({
          x: sx, y: sy, z: h, vx: (tx - sx) / fall, vy: (ty - sy) / fall, vz: -h / fall,
          r: w.rand(0.4, 0.8), look: "star", color: "#ffffff", color2: "#bcd0ff", glow: true, trail: "#e6ecff", gravity: 0.1,
          land(b, w) {
            w.light(b.x, b.y, 5, "#eef2ff", 0.5);
            w.burst(b.x, b.y, { count: 14, colors: ["#ffffff", "#cfd8ff", "#9fb4ff"], speed: 6, up: 5, life: 1.2, size: 1, glow: true, gravity: 0.3 });
            w.disc(b.x, b.y, 2.2, (x, y, k) => {
              if (w.cell(x, y).ground === "grass" && w.chance(0.4 + k * 0.5)) w.set(x, y, "stardust");
            });
            for (const c of w.creatures(b.x, b.y, 4)) { c.tint("#dfe8ff"); c.status("calm", 120); }
            if (w.chance(0.25)) w.sound("ping", 0.2);
            b.kill();
          },
        });
      }
      if (w.chance(0.05)) w.sound("whoosh", 0.2);
      yield 0.1;
    }
    yield 1.5;
    w.sound("chime", 0.4);
    w.cameraBack(1.5);
  },
};
