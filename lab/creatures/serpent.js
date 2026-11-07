const spell = {
  creatures: [
    // Body: it slithers low on the serpent plan, olive with a pale belly, a little shorter than a villager is tall.
    { name: "serpent", base: "beast", body: "serpent", color: "#3f5f2e", color2: "#d8c46a", features: ["tail"],
      radius: 0.55, speed: 1.6, hp: 45,
      // Life: it hunts small things by day and is slowed by the cold.
      goal: "hunt", behavior: "hunt", prey: ["rabbit", "frog", "rat"], attack: 14, sense: 12, active: "day", weak: ["cold"],
      // Others: rabbits and deer keep away from it.
      scares: ["rabbit", "deer"],
      // Deeds: now and then it digs a burrow in the bank; hurt, it strikes back.
      abilities: [{ do: "dig", when: "every so often", every: 30 }, { do: "freeze", when: "hurt", every: 20 }],
      // Its end: a clutch of eggs hatches one young where it dies.
      onDeath: "spawn:serpent" },
  ],
  *cast(w) {
    w.sound("hiss", 0.3);
    w.burst(w.x, w.y, { count: 10, colors: ["#5d8a3a", "#3f5f2e"], speed: 2, up: 1 });
    yield 0.3;
    w.spawn("serpent", w.x, w.y);
  },
};
