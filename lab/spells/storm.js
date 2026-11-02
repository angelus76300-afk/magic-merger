const spell = {
  *cast(w) {
    w.tree(w.x + 4, w.y + 3, { style: "oak", height: 16 });
    w.tree(w.x - 6, w.y - 2, { style: "pine", height: 14 });
    yield 0.5;
    const looks = ["orb", "flame", "meteor", "shard", "star", "vortex", "ring", "swarm", "cloud"];
    looks.forEach((look, k) => w.body({ x: w.x - 16 + k * 4, y: w.y + 10, z: 6, r: 1.4, look, color: k % 2 ? "#ff7a2a" : "#7ab8ff", color2: "#fff3b0", life: 6 }));
    w.body({ x: w.x - 30, y: w.y - 30, z: 40, vx: 12, vy: 12, vz: -12, r: 2, look: "meteor", color: "#4a3a30", color2: "#ff8a2a", land(b, w) { w.explode(b.x, b.y, 5, 1); } });
    yield 1;
    w.lightning(w.x + 4, w.y + 3, { power: 1.5 });
    yield 0.6;
    w.lightning(w.x - 10, w.y + 2);
    w.beam(w.x - 20, w.y - 10, 20, w.x + 20, w.y - 10, 2, { color: "#b48cff", width: 1.5, seconds: 2 });
    yield 3;
  },
};
