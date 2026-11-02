// A Well (minor artifact, 3.7): waters the dry fields around it each
// morning, and villagers come to draw water for their own fields.
const spell = {
  artifacts: [
    { name: "Well", radius: 8, color: "#6aa8e0", charges: 4, recharge: 40, effects: [{ when: "dawn", do: "water", radius: 9 }], grants: [{ what: "water" }] },
  ],
  *cast(w) {
    w.box(w.x - 1, w.y - 1, 0, 3, 3, 1, ["#8a8a92", "#9a9aa0"], "stone");
    w.voxel(w.x, w.y, 0, "#3a78c8", "magic");
    w.box(w.x - 1, w.y - 1, 2, 3, 1, 1, ["#7a5230"], "wood");
    w.artifact(w.x, w.y, "Well");
    w.sound("chime", 0.3);
  },
};
