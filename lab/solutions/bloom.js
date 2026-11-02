// Spring Rain: soaks the land and makes it grow.
const spell = {
  *cast(w) {
    w.sound("chime", 0.8);
    w.flood(w.x, w.y, w.r, "water", 0.35);
    yield 2;
    w.grow(w.x, w.y, w.r, 0.4);
  },
};
