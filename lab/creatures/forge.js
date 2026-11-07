const spell = {
  artifacts: [{ name: "Forge", radius: 6, health: 200, grants: [{ what: "arms" }], uses: [{ do: "steal", by: ["goblin"] }] }],
  *cast(w) {
    w.sound("thump", 0.4);
    const b = w.building(w.x, w.y, { job: "smithy" });
    if (!b) return;
    // What makes it this forge, beside the smithy: a chimney of brick courses
    // with the fire's glow at its mouth, and an anvil in front.
    const c = b.beside, parts = [];
    for (let k = 0; k < 8; k++) parts.push([-0.4, -0.4, k * 0.45, 0.8, 0.8, 0.45, k % 2 ? "#6a5a52" : "#7a685e"]);
    parts.push([-0.5, -0.5, 3.6, 1, 1, 0.15, "#4a4446"], [-0.25, -0.46, 0.3, 0.5, 0.06, 0.4, "#ff8a2a", "glow"]);
    parts.push([0.6, -0.15, 0, 0.3, 0.3, 0.35, "#3a3a40"], [0.45, -0.22, 0.35, 0.6, 0.44, 0.16, "#4a4a52"]);
    w.model(c.x, c.y, parts, { name: "Forge" });
    w.artifact(b.x, b.y, "Forge");
  },
};
