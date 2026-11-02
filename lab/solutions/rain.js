// Downpour: water and cold over the whole area. Solves the wildfire.
const spell = {
  *cast(w) {
    w.sound("hiss", 0.8);
    for (let k = 0; k < 6; k++) {
      w.flood(w.x, w.y, w.r, "water", 0.25);
      w.temperature(w.x, w.y, w.r, -40);
      yield 0.5;
    }
  },
};
