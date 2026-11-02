// World Tree: a seed of light sinks into the ground, the earth heaves into a
// hill, a colossal tree rises from it and a young forest spreads around. The
// tree is a new material: its trunk blocks the way and it slowly heals the land.
const spell = {
  materials: [
    {
      name: "worldwood", layer: "cover", colors: ["#6b4a2b", "#7a5532", "#5e4026"], solid: true, flammable: 0.05, fuel: 60, becomes: "tree",
      // The great tree keeps its surroundings green and alive.
      tick(cell, w) {
        if (w.chance(0.01)) w.grow(cell.x + w.rand(-10, 10), cell.y + w.rand(-10, 10), 2, 0.3);
      },
    },
  ],
  *cast(w) {
    const { x, y } = w;
    w.camera(x, y, w.r * 1.3, 1);
    w.circle(x, y, w.r * 0.5, "#80ed99", "#fff3b0", 2.5);
    const seed = w.body({ x, y, z: 30, vz: -12, r: 0.8, look: "orb", color: "#80ed99", color2: "#ffffff", land: (b) => b.kill() });
    w.sound("chime", 0.6);
    yield 2.6;
    w.sound("rumble", 0.7);
    w.terraform(x, y, w.r * 0.6, 6);
    w.quake(x, y, w.r * 0.8, 0.4);
    // The trunk grows in rings.
    const trunk = Math.max(2, w.r * 0.12);
    for (let k = 1; k <= 10; k++) {
      w.disc(x, y, trunk * (k / 10), (cx, cy) => w.set(cx, cy, "worldwood"));
      w.burst(x, y, { count: 30, colors: ["#80ed99", "#fff3b0"], speed: 6, up: 8, life: 1, size: 0.8 });
      yield 0.15;
    }
    // A canopy drawn over the world, swaying slightly, for good.
    const canopy = w.r * 0.9;
    w.draw((ctx, t) => {
      const grow = Math.min(1, t / 2);
      const sway = Math.sin(t * 0.7) * 0.4;
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const rr = canopy * grow * (0.55 + 0.15 * Math.sin(k * 3.1));
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = k % 2 ? "#2f6b2a" : "#3f8636";
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * rr * 0.7 + sway, y - trunk + Math.sin(a) * rr * 0.6, rr * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#57a24a";
      ctx.beginPath();
      ctx.arc(x + sway, y - trunk * 1.5, canopy * grow * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }, 600);
    w.grow(x, y, w.r, 0.7);
    w.light(x, y, w.r, "#80ed99", 4);
    for (let k = 0; k < 4; k++) w.spawn("spirit", x + w.rand(-w.r, w.r), y + w.rand(-w.r, w.r));
    w.sound("chime", 0.9);
    void seed;
  },
};
