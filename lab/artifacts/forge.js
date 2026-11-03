// A Forge (major artifact, 3.7): villagers come to arm themselves and become
// guards; goblins come to steal from it; fire wears it down.
const spell = {
  artifacts: [
    {
      name: "Forge",
      radius: 6,
      color: "#ff8a3a",
      charges: 3,
      recharge: 60,
      health: 200,
      onBreak: "burn",
      grants: [{ what: "arms" }],
      uses: [{ do: "steal", by: ["goblin"] }],
    },
  ],
  *cast(w) {
    w.box(w.x - 1, w.y - 1, 0, 3, 2, 2, ["#5a5a62", "#4a4a52"], "stone");
    w.voxel(w.x, w.y, 2, "#ff8a3a", "glow");
    w.artifact(w.x, w.y, "Forge");
  },
};
