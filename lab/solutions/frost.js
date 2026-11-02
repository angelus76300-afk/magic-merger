// Frost Bridge: freezes the water hard, and keeps it cold for a while.
const spell = {
  *cast(w) {
    w.sound("ping", 0.8);
    for (let k = 0; k < 40; k++) {
      w.temperature(w.x, w.y, w.r, -120);
      yield 0.5;
    }
  },
};
