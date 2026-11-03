// A Phoenix Feather (minor artifact, 3.7): near a corpse it brings the dead
// back to life, once.
const spell = {
  artifacts: [{ name: "Phoenix Feather", radius: 4, color: "#ff9a3a", pairs: [{ with: "corpse", within: 4, do: "revive", once: true }] }],
  *cast(w) {
    w.voxel(w.x, w.y, 0, "#ff9a3a", "glow");
    w.voxel(w.x, w.y, 1, "#ffd36a", "glow");
    w.artifact(w.x, w.y, "Phoenix Feather");
  },
};
