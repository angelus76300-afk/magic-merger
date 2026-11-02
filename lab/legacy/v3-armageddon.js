// Armageddon, written for World API v3 by claude-opus-5-5 (cosmic). Kept to check old programs still run.
const spell = {
  materials: [
    { name: "glassed earth", layer: "ground", colors: ["#1f2a24", "#2c3b33", "#3a2a26"], glow: true, reacts: { acid: "dirt" } },
    { name: "smoldering ground", layer: "ground", colors: ["#3a1a10", "#5a2410", "#8a3a14"], glow: true, heat: 70,
      decays: 150, becomes: "ash", reacts: { water: "ash", cold: "ash" } },
  ],
  *cast(w) {
    const W = w.width, H = w.height, cx = W / 2, cy = H / 2;
    w.circle(w.x, w.y, 4, "#c01818", "#ff6a2a", 2.5);
    w.light(w.x, w.y, 8, "#ff2a1a", 2.5);
    w.sound("rise", 0.8);
    w.camera(cx, cy, Math.max(W, H) * 0.65, 1.5);
    yield 1.5;
    const ax = cx - W * 0.38, ay = cy - H * 0.12, bx = cx + W * 0.38, by = cy + H * 0.12;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      w.body({ x: w.lerp(ax, bx, t), y: w.lerp(ay, by, t) + w.rand(-4, 4), z: 75, vx: 0, vy: 0, vz: 0, gravity: 0,
        r: 4 + Math.sin(t * Math.PI) * 4, look: "cloud", color: "#7a0a0a", color2: "#ff5a1a", glow: true, life: 22 });
    }
    w.flash("#ff3a1a", 0.6);
    w.sound("boom", 1);
    w.shake(0.6, 1);
    w.tint("#8a1010", 0.35, 90);
    w.darken(0.45, 60);
    w.wind(0.6, 0.3);
    yield 1;
    const meteor = (tx, ty, big) => {
      const t = w.rand(0, 1), ox = w.lerp(ax, bx, t), oy = w.lerp(ay, by, t);
      w.body({ x: ox, y: oy, z: 72, vx: (tx - ox) / 1.4, vy: (ty - oy) / 1.4, vz: -50,
        r: big ? 3 : w.rand(0.8, 1.8), look: "meteor", color: "#3a1a10", color2: "#ffb03a", trail: "#ff5a1a", glow: true,
        land(b, w) {
          const rr = big ? 14 : w.rand(3, 6);
          w.explode(b.x, b.y, rr, big ? 4 : 1.6);
          w.disc(b.x, b.y, rr * 1.4, (x, y, k) => {
            const g = w.cell(x, y).ground;
            if (k > 0.5 && (g === "field" || g === "sand" || g === "grass")) w.set(x, y, "glassed earth");
            else if (w.chance(0.6 * k + 0.2)) w.set(x, y, "smoldering ground");
          });
          w.ignite(b.x, b.y, rr * 2, 0.45);
          w.gas(b.x, b.y, rr, "smoke", 0.6);
          for (const c of w.creatures(b.x, b.y, rr * 3)) c.status("fear", 6, b.x, b.y);
          w.burst(b.x, b.y, { count: big ? 80 : 20, colors: ["#ff6a1a", "#ffd166", "#3a2a20"], speed: 14, up: 18, life: 1.2, gravity: 1 });
          w.sound("boom", big ? 1 : 0.4);
          w.shake(big ? 1.2 : 0.25, big ? 1.5 : 0.3);
          b.kill();
        } });
    };
    for (let f = 0; f < 90; f++) {
      const n = f < 15 ? 1 : w.pick([1, 2, 2, 3]);
      for (let i = 0; i < n; i++) meteor(w.rand(W * 0.08, W * 0.92), w.rand(H * 0.08, H * 0.92), false);
      if (f % 10 === 0) w.sound("whoosh", 0.5);
      yield 0.2;
    }
    w.sound("rumble", 1);
    meteor(cx + w.rand(-10, 10), cy + w.rand(-10, 10), true);
    yield 2.5;
    w.flash("#ff2a1a", 0.4);
    w.cameraBack(2);
  },
};
