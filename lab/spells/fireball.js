// Fireball: a burning orb falls from the sky, bursts, and the fire spreads on its own.
const spell = {
  *cast(w) {
    w.circle(w.x, w.y, w.r * 0.6, "#ff7a1a", "#ffd166", 1);
    w.sound("rise", 0.3);
    yield 0.8;
    w.body({
      x: w.x - w.r * 2, y: w.y - w.r, z: 60, vx: w.r * 2, vy: w.r, vz: -60,
      r: 1.5, look: "flame", color: "#ff6a1a", color2: "#fff2b0",
      tick(b, w) {
        w.particle({ x: b.x, y: b.y, z: b.z, vz: 2, life: 0.5, color: w.pick(["#ffb03a", "#ff6a1a", "#5c5c5c"]), size: 1.2 });
      },
      land(b, w) {
        w.explode(b.x, b.y, w.r * 0.5, 0.8);
        w.ignite(b.x, b.y, w.r, 0.5);
        w.light(b.x, b.y, w.r * 2, "#ffb03a", 2);
        b.kill();
      },
    });
  },
};
