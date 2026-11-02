const spell = {
  *cast(w) {
    const styles = ["oak", "pine", "birch", "willow", "palm", "dead", "mushroom", "crystal"];
    styles.forEach((s, k) => {
      const a = (k / styles.length) * Math.PI * 2;
      w.tree(w.x + Math.cos(a) * 16, w.y + Math.sin(a) * 16, { style: s, height: 10 + (k % 3) * 4, accent: s === "oak" ? ["#f4a7c8"] : undefined });
    });
    w.tree(w.x, w.y, { style: "giant", height: 36, grow: 2.5, accent: ["#f4a7c8", "#ffd1e3"], accentShare: 0.3 });
    w.tower(w.x + 26, w.y - 6, { height: 18, radius: 3 });
    w.spire(w.x - 26, w.y + 4, { height: 20 });
    w.island(w.x - 6, w.y - 24, { z: 16, r: 6 });
    w.tree(w.x - 6, w.y - 24, { z: 17, height: 8 });
    yield 3.5;
    w.ignite(w.x, w.y, 3);
  },
};
