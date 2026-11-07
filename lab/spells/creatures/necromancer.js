// Necromancer: a villager whose calling is to raise the dead at night.
const spell = {
  *cast(w) {
    w.sound("whoosh", 0.25);
    const p = w.person(w.x, w.y, { calling: "necromancer", title: "Necromancer" });
    if (p) w.burst(p.x, p.y, { count: 10, colors: ["#9a7aff", "#2a1f36"], speed: 1.5, up: 2 });
  },
};
