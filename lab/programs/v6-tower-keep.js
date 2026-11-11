// Version 6, the structure kit: a tower, a wall and a floating island sized by the tier, one corner cleared. Expect: voxels stand round the spot, the cleared corner is empty.
const spell = {
  *cast(w) {
    w.sound("thump", 0.4);
    const size = w.tier === "grand" ? 3 : 2;
    w.tower(w.x, w.y, { height: 8 * size, radius: size, roof: "#7a3b5a", windows: "#ffd36a" });
    w.wall(w.x - 8, w.y + 6, w.x + 8, w.y + 6, { height: 4, thick: 1, colors: ["#9a9aa0"], kind: "stone" });
    w.island(w.x + 12, w.y - 10, { z: 18, r: 4, top: ["#5d9c3a"], rock: ["#8a6a44"] });
    // A whole number of frames: w.dt is one tick.
    for (let t = 0; t < 0.5; t += w.dt) yield 0;
    w.unvoxel(w.x - 8, w.y + 6, 2);
  },
};
