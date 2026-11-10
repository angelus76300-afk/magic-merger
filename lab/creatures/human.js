// Human, as 4.6 part B makes a person: one of the island's own villagers.
const spell = {
  *cast(w) {
    w.sound("chime", 0.2);
    const p = w.person(w.x, w.y, { title: "Human" });
    if (p) w.burst(p.x, p.y, { count: 8, colors: ["#fff1c0", "#ffffff"], speed: 1.5, up: 2 });
  },
};
