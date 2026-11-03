// A Rain Totem (major artifact, 3.7): in a drought it casts Rain, a spell
// from the shared library, and it heals the land around it.
const spell = {
  artifacts: [
    {
      name: "Rain Totem",
      radius: 12,
      color: "#7ab0ff",
      effects: [
        { when: "drought", do: "cast:Rain", every: 60 },
        { when: "every", do: "grow", every: 30 },
      ],
    },
  ],
  *cast(w) {
    w.spire(w.x, w.y, { height: 5, radius: 1, colors: ["#7a5230", "#5a3a20"], kind: "wood" });
    w.voxel(w.x, w.y, 5, "#7ab0ff", "magic");
    w.artifact(w.x, w.y, "Rain Totem");
  },
};
