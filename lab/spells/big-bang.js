// Big Bang: everything goes dark, a point of light swallows the camera, then the
// universe is reborn: a shockwave rolls across the whole world, scorching it and
// raising new mountains, and leaves stardust that slowly crystallizes.
const spell = {
  materials: [
    {
      name: "stardust", layer: "ground", colors: ["#241a40", "#2e2152", "#3a2a63", "#4a3578"], glow: true, becomes: "crystal",
      // Stardust cools into crystal over time.
      tick(cell, w) {
        if (w.chance(0.002)) w.set(cell.x, cell.y, "crystal");
      },
    },
  ],
  *cast(w) {
    const R = Math.max(w.width, w.height);
    w.camera(w.x, w.y, 6, 1.2);
    w.darken(0.97, 7);
    w.sound("drone", 1);
    yield 1.2;
    // The singularity: a tiny star that grows brighter.
    const core = w.body({ x: w.x, y: w.y, z: 2, r: 0.4, look: "star", color: "#ffffff", color2: "#fff3b0" });
    for (let k = 0; k < 40; k++) {
      core.r = 0.4 + k * 0.05;
      w.particle({ x: w.x + w.rand(-12, 12), y: w.y + w.rand(-12, 12), z: 2, vx: 0, vy: 0, life: 0.6, color: "#b48cff", size: 0.6 });
      yield 0.05;
    }
    // Bang.
    core.kill();
    w.flash("#ffffff", 1);
    w.shake(24, 3);
    w.sound("boom", 1);
    w.camera(w.x, w.y, R * 0.75, 2.5);
    w.light(w.x, w.y, R, "#fff3b0", 6);
    w.shockwave(w.x, w.y, R * 1.2, "#fff3b0", 3, 6);
    w.shockwave(w.x, w.y, R, "#b48cff", 4, 3);
    w.burst(w.x, w.y, { count: 1200, colors: ["#ffffff", "#fff3b0", "#b48cff", "#ff8ad8"], speed: 160, up: 20, life: 3, size: 1.5, gravity: 0, drag: 0.6 });
    // The wave of creation crosses the world ring by ring.
    for (let r = 0; r < R; r += 6) {
      w.ring(w.x, w.y, r, r + 6, (x, y) => {
        if (w.chance(0.85)) w.set(x, y, "stardust");
        if (w.chance(0.05)) w.fire(x, y, 1);
      });
      for (const c of w.creatures(w.x, w.y, r + 6)) if (w.chance(0.3)) c.push(w.rand(-20, 20), w.rand(-20, 20), 10);
      if (r % 24 === 0) w.terraform(w.x + w.rand(-r, r), w.y + w.rand(-r, r), w.rand(6, 14), w.rand(4, 12));
      yield 0.05;
    }
    yield 1.5;
    w.cameraBack(2);
  },
};
