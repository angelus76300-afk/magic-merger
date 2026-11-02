// The Fireball example from the spell prompt, kept here so npm test runs it.
const spell = {
  *cast(w) {
    w.circle(w.x, w.y, w.r * 0.5, "#ff7a1a", "#ffd166", 0.8);
    w.sound("rise", 0.3);
    yield 0.8;
    w.body({
      x: w.x - w.r * 2, y: w.y - w.r, z: 50, vx: w.r * 2.4, vy: w.r * 1.2, vz: -50,
      r: 1.2, look: "flame", color: "#ff6a1a", color2: "#fff2b0", trail: "#ffb03a",
      land(b, w) {
        w.explode(b.x, b.y, w.r * 0.5, 0.8);
        w.ignite(b.x, b.y, w.r * 0.8, 0.4);
        b.kill();
      },
    });
  },
};
