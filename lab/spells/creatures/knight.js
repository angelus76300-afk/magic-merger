// Knight: a villager in armor who guards the village and wards it when an enemy comes.
const spell = {
  *cast(w) {
    w.sound("chime", 0.25);
    const p = w.person(w.x, w.y, { calling: "knight", title: "Knight" });
    if (p) w.burst(p.x, p.y, { count: 10, colors: ["#d8dde6", "#ffe08a"], speed: 1.5, up: 2 });
  },
};
