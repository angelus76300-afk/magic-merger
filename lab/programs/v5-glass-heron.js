// Version 5 (bodies): a creature with a body plan, features, a second color and a model. Expect: two herons alive, drawn as birds with wings.
const spell = {
  creatures: [
    {
      name: "glass heron",
      base: "bird",
      body: "bird",
      color: "#bfe8ff",
      color2: "#5a8ab0",
      features: ["wings", "tail"],
      flying: true,
      speed: 4,
      hp: 30,
      radius: 0.5,
      behavior: "wander",
      lures: ["fish"],
    },
  ],
  *cast(w) {
    w.sound("whoosh", 0.3);
    w.burst(w.x, w.y, { count: 12, colors: ["#bfe8ff", "#ffffff"], speed: 2, up: 3 });
    yield 0.3;
    w.spawn("glass heron", w.x - 2, w.y);
    w.spawn("glass heron", w.x + 2, w.y);
  },
};
