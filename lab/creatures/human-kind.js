// Human as the live program made it before 4.6 part B (DESIGN.md, part A's
// reading): a creature kind of its own, a villager's body with glowing eyes.
const spell = {
  creatures: [{ name: "human", base: "villager", body: "two legs", color: "#c9a27a", color2: "#9fe8ff", features: ["glowing eyes"], speed: 2.6, goal: "explore" }],
  *cast(w) {
    w.spawn("human", w.x, w.y);
  },
};
