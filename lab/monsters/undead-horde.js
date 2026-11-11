// Undead Horde: the live program, from the staging copy of the library (2026-11-11).
const spell = { creatures: [{ name: 'undead', base: 'villager', body: 'two legs', color: '#7d857c', color2: '#c9f0b0', features: ['glowing eyes', 'sword'], behavior: 'guard', goal: 'guard', weak: ['light'], hp: 30, radius: 1.2 }], artifacts: [{ name: 'Undead Horde', radius: 8, color: '#b9e8a8', lures: ['villager'], charges: 6, recharge: 60, health: 400, effects: [{ when: 'night', every: 45, do: 'summon:undead', radius: 5, cost: 1 }, { when: 'every', every: 15, do: 'act', act(self, w) { w.burst(self.x, self.y, { count: 10, colors: ['#c9f0b0', '#9be38a'], speed: 0.5, up: 1, life: 2, size: 0.4, gravity: 0 }); } }], grants: [{ what: 'arms', cost: 1 }], uses: [{ do: 'guard', by: ['villager'] }] }], *cast(w) { w.flash('#b9e8a8', 0.2); w.sound('drone', 0.5); w.sound('rise', 0.3); lib.lastingWard(w, w.x, w.y, w.r * 0.9, { seconds: 3600, color: '#b9e8a8' }); for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, d = w.r * 0.35; w.box(w.x + Math.cos(a) * d, w.y + Math.sin(a) * d, 0, 1, 1, 6, ['#c8c4b4', '#9a9686'], 'stone'); } w.circle(w.x, w.y, w.r * 0.35, '#9be38a', '#e8ffd0', 6); yield 1; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3, d = w.r * 0.25; w.spawn('undead', w.x + Math.cos(a) * d, w.y + Math.sin(a) * d); } w.sound('chime', 0.4); w.artifact(w.x, w.y, 'Undead Horde'); } };
;const lib = {
lastingWard: function (w, x, y, r, o) {
  o = o || {};
  const total = o.seconds == null ? 3600 : o.seconds;
  const base = {};
  for (const k of ["against", "color", "keepOut", "allow"]) if (o[k] !== undefined) base[k] = o[k];
  const color = o.color || "#bfe3ff";
  const raise = (ww, left) => {
    const opts = Object.assign({}, base);
    opts.seconds = Math.max(1, Math.min(600, left));
    ww.ward(x, y, r, opts);
  };
  raise(w, total);
  if (o.light) w.light(x, y, r * 1.2, color, 6);
  let t = 0, next = 590, glowNext = 5;
  return w.body({
    x: x, y: y, z: 0, r: 0.5, look: "none", gravity: 0, vx: 0, vy: 0, vz: 0,
    life: isFinite(total) ? total + 2 : 1e9,
    tick(b, ww, dt) {
      t += dt;
      if (t >= total) { b.kill(); return; }
      if (t >= next) { raise(ww, total - t); next += 590; }
      if (o.light && t >= glowNext) { ww.light(x, y, r * 1.2, color, 6); glowNext += 5; }
    },
  });
},
};
