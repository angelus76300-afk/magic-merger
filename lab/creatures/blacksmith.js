const spell = {
  *cast(w) {
    w.sound("chime", 0.25);
    // A villager of the nearest village, in its clothes, living in one of its houses.
    // The calling is the twist from the name: a blacksmith works the village's smithy.
    const p = w.person(w.x, w.y, { calling: "blacksmith", title: "Blacksmith" });
    if (!p) return;
    w.burst(p.x, p.y, { count: 10, colors: ["#ffb040", "#fff1c0"], speed: 2, up: 2 });
  },
};
