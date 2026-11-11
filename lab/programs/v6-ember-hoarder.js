// Version 6 (goals, needs and abilities): a goal of its own and an ability with its own act. Expect: the hoarder has the goal and the ability, and its ability sets its spot alight when hurt.
const spell = {
  goals: [
    {
      name: "keep the embers",
      seek: "anywhere",
      near: 10,
      work: 3,
      carry: "gold",
      act(self, w, x, y) {
        w.light(x, y, 3, "#ff8a2a", 1);
      },
    },
  ],
  creatures: [
    {
      name: "ember hoarder",
      base: "beast",
      body: "four legs",
      color: "#6a3a2a",
      color2: "#ff8a2a",
      features: ["horns", "glowing eyes"],
      speed: 1.8,
      hp: 80,
      radius: 0.6,
      goal: "keep the embers",
      abilities: [
        {
          name: "flare",
          when: "hurt",
          every: 3,
          act(self, w) {
            w.ignite(self.x, self.y, 1.5, 0.6);
            self.data.flared = (self.data.flared || 0) + 1;
          },
        },
      ],
    },
  ],
  *cast(w) {
    w.sound("rumble", 0.3);
    w.spawn("ember hoarder", w.x, w.y);
    yield 0.2;
  },
};
