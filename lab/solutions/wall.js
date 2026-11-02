// Stone Wall: a long basalt wall across the path of what comes from the north west.
const spell = {
  *cast(w) {
    w.sound("rumble", 0.8);
    for (let h = 0; h < 6; h++) {
      w.line(w.x - w.r, w.y + w.r, w.x + w.r, w.y - w.r, 3, (x, y) => w.build(x, y, 1, "basalt"));
      yield 0.2;
    }
  },
};
