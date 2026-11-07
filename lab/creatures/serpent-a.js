const spell = {
  creatures: [
    { name: "serpent", base: "beast", body: "serpent", color: "#3f5f2e", color2: "#d8c46a", features: ["tail"],
      speed: 1.2, hp: 45, radius: 0.55, behavior: "hunt", prey: ["rabbit"], attack: 14, sense: 14,
      goal: "hunt", weak: ["cold"], scares: ["rabbit", "deer"],
      // It digs a burrow in the bank every so often, and hunts from it when hungry.
      abilities: [{ do: "dig", when: "every so often", every: 30 }] },
  ],
  *cast(w) {
    w.sound("hiss", 0.3);
    w.burst(w.x, w.y, { count: 14, colors: ["#5d8a3a", "#3f5f2e"], speed: 2, up: 1 });
    yield 0.4;
    w.spawn("serpent", w.x, w.y);
  },
};
