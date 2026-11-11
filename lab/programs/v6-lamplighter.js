// Version 6, artifacts: places two lamps, finds them again with w.artifacts and fills their charges, and draws a ring for a moment. Expect: two lamps with 5 charges each, a drawing that draws.
const spell = {
  artifacts: [{ name: "Road Lamp", radius: 6, color: "#ffd36a", charges: 1, recharge: 60, effects: [{ when: "night", do: "light" }] }],
  *cast(w) {
    w.sound("chime", 0.25);
    w.artifact(w.x - 3, w.y, "Road Lamp");
    w.artifact(w.x + 3, w.y, "Road Lamp");
    yield 0.2;
    for (const lamp of w.artifacts(w.x, w.y, 6)) lamp.charges = 5;
    w.draw((ctx, t) => {
      ctx.strokeStyle = "#ffd36a";
      ctx.beginPath();
      ctx.arc(w.x, w.y, 3 + t, 0, Math.PI * 2);
      ctx.stroke();
    }, 1.5);
  },
};
