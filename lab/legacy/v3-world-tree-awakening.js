// World Tree Awakening, written for World API v3 by claude-opus-5-5 (cosmic). Kept to check old programs still run.
const spell = {
  materials: [
    { name: "root vein", layer: "ground", colors: ["#3dff8a", "#7dffb0", "#2ad66e"], glow: true, decays: 15, becomes: "grass", reacts: { fire: "ash", lava: "basalt" } },
    { name: "glowleaf", layer: "ground", colors: ["#7be08a", "#b6ff9e", "#ffd6f0", "#fff2a8"], glow: true, decays: 120, becomes: "grass", reacts: { fire: "ash", lava: "basalt", acid: "dirt" } },
  ],
  *cast(w) {
    const cx = w.x, cy = w.y, R = Math.max(w.width, w.height) * 0.55;
    w.camera(cx, cy, R * 1.1, 1.5);
    w.darken(0.35, 14);
    w.circle(cx, cy, 12, "#3dff8a", "#c9ffb0", 4);
    w.light(cx, cy, 20, "#7dffb0", 4);
    w.sound("drone", 0.8);
    w.sound("rise", 0.6);
    yield 1.5;
    const veins = [];
    for (let i = 0; i < 12; i++) veins.push({ x: cx, y: cy, a: i * Math.PI / 6 + w.rand(-0.2, 0.2) });
    for (let s = 0; s < 8; s++) {
      for (const v of veins) {
        v.a += w.rand(-0.4, 0.4);
        const d = R / 8, nx = v.x + Math.cos(v.a) * d, ny = v.y + Math.sin(v.a) * d;
        w.line(v.x, v.y, nx, ny, 1.3, (x, y) => w.set(x, y, "root vein"));
        if (s % 2 === 1) w.arch(v.x, v.y, nx, ny, { height: w.rand(4, 10), thick: 1.5, colors: ["#5a3a22", "#6e4a2a", "#3f8a3a"], kind: "wood", grow: 1 });
        w.burst(nx, ny, { count: 6, colors: ["#7dffb0", "#c9ffb0"], speed: 3, up: 6, life: 1, glow: true });
        v.x = nx; v.y = ny;
      }
      w.quake(cx, cy, R, 0.3);
      w.sound("thump", 0.5);
      yield 0.4;
    }
    w.sound("rumble", 1);
    w.shake(0.6, 4);
    w.beam(cx, cy, 0, cx, cy, 120, { color: "#9dffb8", width: 3, seconds: 2 });
    w.tree(cx, cy, { style: "giant", height: 78, trunk: ["#5a3a22", "#6e4a2a", "#4a2e1a"], leaves: ["#3fae4a", "#5ccf5a", "#7be08a"], accent: ["#ffc8e8", "#fff2a8"], accentShare: 0.2, glow: true, grow: 6 });
    yield 3;
    w.sound("chime", 0.9);
    w.shockwave(cx, cy, R, "#b6ff9e", 3, 4);
    for (const c of w.creatures(cx, cy, R * 1.5)) {
      c.status("levitate", 6);
      c.status("calm", 30);
      c.heal(999);
      c.push(0, 0, 4);
      w.burst(c.x, c.y, { count: 10, colors: ["#ffc8e8", "#b6ff9e", "#fff2a8"], speed: 2, up: 3, life: 2, glow: true });
    }
    w.paint(cx, cy, R, "glowleaf", 0.25);
    w.grow(cx, cy, R, 0.25);
    for (let t = 0; t < 40; t++) {
      const a = w.rand(0, 6.28), d = w.rand(0, 30);
      w.particle({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, z: w.rand(45, 75), vx: w.rand(-3, 3), vy: w.rand(-3, 3), vz: -3, life: 8, color: w.pick(["#b6ff9e", "#ffc8e8", "#7be08a"]), size: 1, glow: true, gravity: 0.2, drag: 0.5 });
      if (t % 8 === 0) w.sound("ping", 0.3);
      yield 0.15;
    }
    yield 2;
    w.cameraBack(2);
  },
};
