const spell = {
  *cast(w) {
    w.sound("rumble", 0.8);
    w.quake(w.x, w.y, w.r, 1);
    yield 0.6;
    w.land(w.x, w.y, { shape: "volcano", r: Math.min(18, w.r) });
    w.gas(w.x, w.y, 3, "smoke", 0.8);
    w.shake(0.6, 1.5);
  },
};
