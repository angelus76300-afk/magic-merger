const spell = {
  artifacts: [{ name: "Storm Lantern", radius: 8, color: "#ffd36a", fuel: 900,
    effects: [{ when: "night", do: "light" }, { when: "enemy", do: "light", every: 15 }],
    grants: [{ what: "heal", cost: 1 }], charges: 3, recharge: 60 }],
  *cast(w) {
    w.sound("chime", 0.25);
    // A post with an arm, and the lantern hanging from it: a frame of iron round a glowing glass.
    const iron = "#2b2b30", parts = [
      [-0.3, -0.3, 0, 0.6, 0.6, 0.15, "#5a4030"], [-0.12, -0.12, 0, 0.24, 0.24, 2.5, "#4a3324"],
      [-0.06, -0.06, 2.4, 0.75, 0.12, 0.12, "#3a2a20"], [0.52, -0.02, 2.05, 0.04, 0.04, 0.35, iron],
      [0.36, -0.16, 1.62, 0.36, 0.36, 0.06, iron], [0.36, -0.16, 2.0, 0.36, 0.36, 0.06, iron], [0.44, -0.08, 2.06, 0.2, 0.2, 0.06, iron],
      [0.41, -0.11, 1.68, 0.26, 0.26, 0.32, "#ffd36a", "glow"],
    ];
    for (const [x, y] of [[0.36, -0.16], [0.67, -0.16], [0.36, 0.15], [0.67, 0.15]]) parts.push([x, y, 1.68, 0.05, 0.05, 0.32, iron]);
    w.model(w.x, w.y, parts, { name: "Storm Lantern" });
    w.light(w.x, w.y, 6, "#ffd36a", 2);
    w.artifact(w.x, w.y, "Storm Lantern");
  },
};
