// Star Seed, written for World API v3 by claude-opus-5-5 (cosmic). Kept to check old programs still run.
const spell = {
  materials: [
    { name: "star vine", layer: "cover", colors: ["#c8d4e0", "#e6eef7", "#a9b8c9", "#f4f8ff"], glow: true, flammable: 0.3,
      spreads: { into: ["grass", "field", "flower", "bush"], rate: 0.03 }, reacts: { fire: "ash", acid: "none", cold: "star vine" } },
  ],
  creatures: [
    { name: "dream moth", base: "spirit", color: "#dfe8ff", glow: true, speed: 0.6, hp: 20, flying: true,
      behavior: "follow", leader: ["villager"], aura: "heal", auraRadius: 4, auraPower: 1,
      weak: ["fire"], lifespan: 240, onDeath: "seeds" },
  ],
  *cast(w) {
    const x = w.x, y = w.y, R = Math.min(w.r, 7);
    w.sound("chime", 0.4);
    w.body({
      x: x + 6, y: y - 4, z: 40, vx: -9, vy: 6, vz: -40, r: 0.5, look: "star",
      color: "#f4f8ff", color2: "#b8c8ff", trail: "#dfe8ff", glow: true, gravity: 1,
      land(b, w) {
        w.sphere(x, y, 0.6, 0.9, ["#eef3fa", "#d0d8e4", "#9aa6b8"], 1, "magic");
        w.burst(x, y, { count: 30, colors: ["#ffffff", "#cfe0ff"], speed: 5, up: 4, life: 1, size: 1 });
        w.light(x, y, 4, "#dfe8ff", 3);
        w.sound("ping", 0.5);
        b.kill();
      },
    });
    yield 1;
    w.darken(0.6, 5);
    w.circle(x, y, R, "#cfe0ff", "#ffffff", 4);
    w.sound("drone", 0.4);
    w.paint(x, y, R * 0.5, "star vine", 0.9);
    w.disc(x, y, R * 0.5, (cx, cy) => { const c = w.cell(cx, cy); if (c.ground === "rock" || c.ground === "sand") w.set(cx, cy, "grass"); });
    yield 1;
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + 0.4, d = R * w.rand(0.5, 0.9);
      w.tree(x + Math.cos(a) * d, y + Math.sin(a) * d, { style: w.pick(["willow", "birch"]), height: w.rand(7, 11),
        trunk: ["#8a94a3", "#a7b0bd"], leaves: ["#c8d4e0", "#e1e9f3"], accent: ["#ffffff", "#bcd0ff"], accentShare: 0.25, glow: true, grow: 3 });
    }
    w.paint(x, y, R, "star vine", 0.5);
    for (let i = 0; i < 40; i++) {
      w.particle({ x: x + w.rand(-R, R), y: y + w.rand(-R, R), z: w.rand(0, 2), vz: w.rand(2, 5), life: 2, color: "#f4f8ff", size: 0.6, glow: true, drag: 0.5 });
    }
    yield 2;
    for (let k = 0; k < 3; k++) w.spawn("dream moth", x + w.rand(-2, 2), y + w.rand(-2, 2));
    w.disc(x, y, R * 2, (cx, cy) => {});
    for (const c of w.creatures(x, y, R * 2)) if (c.kind === "villager") { c.heal(30); c.status("calm", 6); }
    w.sound("chime", 0.3);
  },
};
