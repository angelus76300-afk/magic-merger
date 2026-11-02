// Dike: a ring of stone around the target, tall enough to hold back the sea.
const spell = {
  *cast(w) {
    w.sound("rumble", 0.8);
    for (let h = 0; h < 5; h++) {
      w.ring(w.x, w.y, w.r * 0.9, w.r * 0.9 + 2.5, (x, y) => w.build(x, y, 1, "basalt"));
      yield 0.2;
    }
  },
};
