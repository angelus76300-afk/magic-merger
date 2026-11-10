const spell = {
  creatures: [
    // Body: a small fox of four legs, ember orange with a pale glow, its tail and eyes alight.
    { name: "fox spirit", base: "spirit", body: "four legs", color: "#e8823a", color2: "#cfe8ff", features: ["tail", "glowing eyes"],
      glow: true, flying: false, radius: 0.45, speed: 3.6, hp: 60,
      // Life: it tends the woods, leaving flowers where it runs, and fears nothing but iron and fire.
      goal: "tend", leaves: "flowers", weak: ["fire"],
      // Others: hares come to it; wolves keep their distance.
      lures: ["hare", "rabbit"], scares: ["wolf"],
      // Deeds: it mends the hurt around it, and blinks away when struck.
      abilities: [{ do: "heal", when: "every so often", every: 20 }, { do: "teleport", when: "hurt", every: 12 }],
      // Its end: a spirit fades after a few days, leaving seeds.
      lifespan: 1800, onDeath: "seeds" },
  ],
  *cast(w) {
    w.sound("chime", 0.25);
    w.burst(w.x, w.y, { count: 12, colors: ["#ffb070", "#cfe8ff"], speed: 2, up: 2 });
    yield 0.3;
    w.spawn("fox spirit", w.x, w.y);
  },
};
