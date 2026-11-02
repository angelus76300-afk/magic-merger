// A Statue that only stands there: the five minute test must fail it (3.7).
const spell = {
  *cast(w) {
    w.box(w.x, w.y, 0, 1, 1, 3, ["#9a9aa0"], "stone");
  },
};
