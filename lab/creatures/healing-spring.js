const spell = {
  *cast(w) {
    w.sound("chime", 0.3);
    const p = w.wonder(w.x, w.y, "hot spring");
    const x = p ? p.x : w.x, y = p ? p.y : w.y;
    // What is its own: white flowers that crowd the warm banks.
    w.ring(x, y, 3, 6, (cx, cy) => { if (w.chance(0.25)) w.set(cx, cy, "flower"); });
    w.light(x, y, 5, "#bfe8ff", 2);
  },
};
