// Aegis (major spell, protect): the reference protection. A circle, a clear
// dome that rises over the village, and the world's threats stop at its edge.
const spell = {
  *cast(w) {
    w.circle(w.x, w.y, w.r, "#9fd8ff", "#ffffff", 1.2);
    w.sound("chime", 0.5);
    yield 0.6;
    w.ward(w.x, w.y, w.r, { seconds: 30, color: "#9fd8ff" });
    w.shockwave(w.x, w.y, w.r, "#cfeaff", 0.8, 1);
    w.light(w.x, w.y, w.r, "#cfeaff", 2);
  },
};
