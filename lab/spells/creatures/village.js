const spell = {
  *cast(w) {
    w.sound("chime", 0.4);
    const v = w.village(w.x, w.y, { houses: 8 });
    if (!v) return;
    w.camera(v.x, v.y, 20, 3);
    w.burst(v.x, v.y, { count: 30, colors: ["#ffe9a8", "#ffffff"], speed: 3, up: 3 });
  },
};
