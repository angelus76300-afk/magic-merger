// Version 6, water: floods a ring of pools placed by angle and noise, then drains the middle. Expect: water left in the pools, none in the drained middle.
const spell = {
  *cast(w) {
    w.sound("splash", 0.4);
    for (let k = 0; k < 6; k++) {
      const a = w.angle(w.x, w.y, w.x + 1, w.y) + (k * Math.PI) / 3;
      const r = 11 + 2 * w.noise(w.x + k, w.y);
      w.flood(w.x + Math.cos(a) * r, w.y + Math.sin(a) * r, 2.5, "water", 1.5);
    }
    w.flood(w.x, w.y, 6, "water", 1.5);
    yield 0.4;
    w.drain(w.x, w.y, 6);
  },
};
