// The Haunted Grove example from the spell prompt, kept here so npm test runs it.
const spell = {
  materials: [
    { name: "gloom moss", layer: "ground", colors: ["#3b2f4a", "#4a3a5c"], glow: true, becomes: "grass",
      spreads: { into: ["grass"], rate: 0.05 }, reacts: { fire: "ash", water: "grass" } },
  ],
  creatures: [
    { name: "wisp", base: "spirit", color: "#b8a0ff", behavior: "follow", leader: ["villager"],
      aura: "sleep", auraRadius: 3, weak: ["fire"], onDeath: "seeds" },
  ],
  *cast(w) {
    w.flash("#b8a0ff", 0.3);
    w.sound("drone", 0.5);
    for (let k = 0; k < 5; k++) {
      const a = k * 1.26, d = w.r * 0.5;
      w.tree(w.x + Math.cos(a) * d, w.y + Math.sin(a) * d, { style: "willow", height: w.rand(10, 16),
        leaves: ["#5a4a7a", "#6b5a8f"], accent: ["#c9b8ff"], grow: 2 });
    }
    w.paint(w.x, w.y, w.r * 0.6, "gloom moss", 0.8);
    for (let k = 0; k < 3; k++) w.spawn("wisp", w.x + w.rand(-3, 3), w.y + w.rand(-3, 3));
  },
};
