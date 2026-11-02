// World Tree, as shown to the spell designer in worker/prompts.ts.
const spell = {
  materials: [
    { name: "worldwood", layer: "ground", colors: ["#6b4a2b", "#7a5532"], becomes: "dirt" },
  ],
  *cast(w) {
    w.camera(w.x, w.y, w.r * 1.3, 1);
    w.sound("rumble", 0.7);
    const trunk = Math.max(2, w.r * 0.1);
    for (let k = 1; k <= 12; k++) {
      w.disc(w.x, w.y, trunk, (x, y) => w.build(x, y, 2, "worldwood"));
      yield 0.12;
    }
    // The crown: leaf spheres in a ring around the trunk (z counts from the ground under each).
    const crown = w.r * 0.3;
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05, d = trunk + crown * 0.5;
      w.sphere(w.x + Math.cos(a) * d, w.y + Math.sin(a) * d, 22 + w.rand(0, 4), crown * 0.6, ["#2f7a2a", "#3f8f36", "#57a24a"], 0.85);
    }
    w.grow(w.x, w.y, w.r, 0.7);
    w.light(w.x, w.y, w.r, "#80ed99", 4);
  },
};
