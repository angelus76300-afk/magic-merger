// Version 4 (relationships): a material that lures, a landmark that lures and scares. Expect: the landmark stands with its lures, the honey is on the ground.
const spell = {
  materials: [{ name: "honeycomb", layer: "cover", color: "#e8b030", lures: ["bear", "boar"], flammable: 0.6 }],
  *cast(w) {
    w.sound("chime", 0.25);
    w.landmark(w.x, w.y, { name: "Honey Shrine", lures: ["bear"], scares: ["wolf"], radius: 8, color: "#e8b030" });
    w.ring(w.x, w.y, 2, 4, (x, y) => w.set(x, y, "honeycomb"));
    yield 0.5;
  },
};
