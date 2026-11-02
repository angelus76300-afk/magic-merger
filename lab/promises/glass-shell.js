// Glass Shell (major spell, protect): what protection spells looked like
// before wards. A shell of magic blocks over the village: it looks like a
// shield, hides the people under it, and lets fire and lava straight through.
// Kept as the case the protection probe must fail.
const spell = {
  *cast(w) {
    w.circle(w.x, w.y, w.r, "#9fd8ff", "#ffffff", 1.2);
    yield 0.6;
    const r = Math.round(w.r * 0.8);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = 0; dz <= r; dz++) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > r - 1 && d <= r) w.voxel(w.x + dx, w.y + dy, dz, "#9fd8ff", "magic");
        }
    w.sound("chime", 0.5);
  },
};
