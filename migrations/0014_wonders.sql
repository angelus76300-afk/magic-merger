-- 4.4.5 part C: a library of nature that keeps growing (docs/DESIGN.md).
-- Wonders written as programs: one a day from the API (source daily), or a
-- player's discovery grown into the world (source player, key the element,
-- by_name who found it first). pending while its batch runs, trial until the
-- nightly Action tests it in Node (scripts/wonder-runner.ts), then live (in
-- the pool islands draw from) or rejected; the owner can retire any.
CREATE TABLE wonders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('daily', 'player')),
  key TEXT,
  kind TEXT NOT NULL,
  rarity TEXT NOT NULL,
  lands TEXT NOT NULL DEFAULT '',
  spot TEXT NOT NULL DEFAULT 'flat',
  reach INTEGER NOT NULL DEFAULT 6,
  does TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  missing TEXT NOT NULL DEFAULT '',
  change TEXT,
  by_name TEXT,
  status TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  batch TEXT,
  reservation INTEGER,
  estimate REAL NOT NULL DEFAULT 0,
  usd REAL NOT NULL DEFAULT 0,
  checked TEXT,
  judged TEXT,
  created_at INTEGER NOT NULL,
  live_at INTEGER
);
CREATE INDEX wonders_by_status ON wonders (status, live_at);
CREATE UNIQUE INDEX wonders_by_key ON wonders (key) WHERE key IS NOT NULL;

-- What each artifact is (place, material, creature, object, person), asked
-- once, for players' discoveries grown into the world.
CREATE TABLE wonder_sorts (
  key TEXT PRIMARY KEY,
  sort TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- The three wonders the owner saw on 4 November, written from the wonder
-- prompt by Haiku (dew towers) and Opus (the other two), tested in Node
-- (lab/wonders, npm test). The moon mire's moonbeam waits for the full moon
-- trigger that came with them.
INSERT INTO wonders (id, source, kind, rarity, lands, spot, reach, does, summary, code, missing, change, status, model, checked, created_at, live_at) VALUES (2, 'daily', 'aurora ice spires', 'rare', 'tundra', 'flat', 8, 'at night its ice spires shine green and violet, healing deer and keeping wolves away', 'A ring of seven tall leaning ice spires around a small frozen tarn of pale ice that glows at night; after dark the spires cast aurora light into the sky, drive off night hunters, heal whatever shelters there and draw deer and rabbits in, and fire or heat melts its ice to water.', 'const spell = {
  materials: [
    { name: ''aurora ice'', layer: ''fluid'', colors: [''#bff6f0'', ''#a6ecff'', ''#d6c8ff''], flow: 0, glow: true, heat: -6,
      reacts: { fire: ''water'', heat: ''water'', lava: ''steam'' } },
  ],
  artifacts: [{
    name: ''Aurora Spires'', radius: 8, color: ''#7dffc8'', lures: [''deer'', ''rabbit''], scares: [''wolf''],
    effects: [
      { when: ''night'', every: 15, do: ''light'', radius: 8 },
      { when: ''night'', every: 30, do: ''heal'', radius: 8 },
      { when: ''night'', every: 6, act(self, w) {
        const cols = [''#7dffc8'', ''#b48cff'', ''#5ad1ff''];
        for (let k = 0; k < 7; k++) {
          const a = k * 0.8976, h = 12 + (k % 3) * 4;
          const x = self.x + Math.cos(a) * 5, y = self.y + Math.sin(a) * 5;
          w.beam(x, y, h, x + Math.cos(a) * 3 + w.rand(-1, 1), y + Math.sin(a) * 3 + w.rand(-1, 1), h + 30,
            { color: w.pick(cols), width: 0.6, seconds: 5 });
        }
        return true;
      } },
    ],
    grants: [{ what: ''heal'' }],
  }],
  *cast(w) {
    const x = w.x, y = w.y;
    w.terraform(x, y, 4, -1);
    w.paint(x, y, w.r, ''snow'', 0.9);
    w.disc(x, y, 3.5, (cx, cy) => w.set(cx, cy, ''aurora ice'', 1));
    w.ring(x, y, 4.5, 6.5, (cx, cy) => { if (w.chance(0.3)) w.set(cx, cy, ''crystal''); });
    const cols = [[''#bff6ff'', ''#8fe3ff'', ''#e8fdff''], [''#c9b8ff'', ''#a8e9ff'', ''#effcff'']];
    for (let k = 0; k < 7; k++) {
      const a = k * 0.8976, h = 12 + (k % 3) * 4;
      w.spire(x + Math.cos(a) * 5, y + Math.sin(a) * 5,
        { height: h, radius: 1.4, colors: cols[k % 2], kind: ''glow'', lean: 0.12, angle: a });
    }
    w.artifact(x, y, ''Aurora Spires'');
  },
};
', 'lures and scares that hold only at night; a sky-wide aurora curtain', 'at night', 'live', 'claude-opus-5-5', '{"ok":true,"detail":"aurora ice spires passed on 3 islands (tundra 3, 17, 41): 187 to 195 voxels, +0.04 to +0.10 ms a tick, 13 to 15 deeds (light, aurora), villagers and animals as without it.","at":1793793600000}', 1793793600000, 1793793600000);
INSERT INTO wonders (id, source, kind, rarity, lands, spot, reach, does, summary, code, missing, change, status, model, checked, created_at, live_at) VALUES (3, 'daily', 'moon mire', 'legendary', 'swamp', 'low', 12, 'on a full moon its drowned moon rises from the pool, and its silver light heals all around', 'A round black pool sunk in the bog, ringed by pale tusk-like spires leaning inward over a low silver orb of drowned moonlight on glowing moonmoss; at night it lights the marsh against hunters, at dawn it waters the fields, and on a full moon a moonbeam rises from it that heals every creature near, frightens off wolves and bears, greens the swamp and brings fish into the pool.', 'const spell = {
  materials: [
    { name: ''moonmoss'', layer: ''ground'', colors: [''#9fb8c8'', ''#b9cfe0'', ''#8aa6b8''], glow: true,
      flammable: 0.2, reacts: { fire: ''ash'', lava: ''basalt'' } },
  ],
  artifacts: [
    { name: ''Moon Mire'', radius: 12, color: ''#dfe8ff'', lures: [''deer'', ''rabbit'', ''bird''],
      effects: [
        { when: ''night'', every: 30, do: ''light'', radius: 12 },
        { when: ''every'', every: 60, do: ''heal'', radius: 10 },
        { when: ''dawn'', do: ''water'', radius: 12 },
        { when: ''full moon'', every: 300, radius: 14, act(self, w, target) {
          const x = self.x, y = self.y;
          w.beam(x, y, 0, x, y, 70, { color: ''#dfe8ff'', width: 2, seconds: 10 });
          w.circle(x, y, 10, ''#cfdcff'', ''#ffffff'', 10);
          w.light(x, y, 14, ''#cfdcff'', 40);
          for (const c of w.creatures(x, y, 14)) {
            if (!c.alive) continue;
            c.heal(60);
            if (c.kind === ''wolf'' || c.kind === ''bear'') c.status(''fear'', 20, x, y);
          }
          w.grow(x, y, 12, 0.3);
          for (let k = 0; k < 2; k++) w.spawn(''fish'', x + w.rand(-3, 3), y + w.rand(-3, 3));
          return true;
        } },
      ],
      grants: [{ what: ''heal'' }],
      uses: [{ do: ''worship'', by: [''villager''] }] },
  ],
  *cast(w) {
    const x = w.x, y = w.y, r = w.r;
    w.terraform(x, y, r * 0.9, -3);
    w.paint(x, y, r * 0.85, ''mud'', 0.5);
    w.paint(x, y, r * 0.8, ''moonmoss'', 0.6);
    w.flood(x, y, r * 0.45, ''water'', 2);
    for (let k = 0; k < 7; k++) {
      const a = k * Math.PI * 2 / 7 + w.rand(-0.15, 0.15), d = r * 0.62;
      w.spire(x + Math.cos(a) * d, y + Math.sin(a) * d, { height: w.rand(16, 24), radius: 1.5,
        colors: [''#e8e4d8'', ''#d2cdbd'', ''#f4f1e8''], kind: ''stone'', lean: 0.35, angle: a + Math.PI });
    }
    w.sphere(x, y, 9, 3, [''#eef3ff'', ''#d6e2ff'', ''#ffffff''], 1, ''magic'');
    w.landmark(x, y, { name: ''Moon Mire'', scares: [''wolf''], aura: ''fear'', radius: r * 0.6, power: 1 });
    w.artifact(x, y, ''Moon Mire'');
    yield 0;
  },
};
', '', 'on a full moon', 'live', 'claude-opus-5-5', '{"ok":true,"detail":"moon mire passed on 3 islands (swamp 3, 17, 41): 419 to 425 voxels, +0.06 to +0.08 ms a tick, 2 to 8 deeds (light, healing, watering, its moss), villagers and animals as without it.","at":1793793600000}', 1793793600000, 1793793600000);
INSERT INTO wonders (id, source, kind, rarity, lands, spot, reach, does, summary, code, missing, change, status, model, checked, created_at, live_at) VALUES (1, 'daily', 'dew towers', 'uncommon', 'desert', 'flat', 6, 'in a drought its towers sweat dew, and the fields around them turn green', 'A curved ring of five pale stone spires, each capped with a silver-white bowl, standing on a low rise in the desert; in a drought the bowls gather dew that waters the fields nearby, and villagers carry the water home.', 'const spell = {
  artifacts: [
    {
      name: ''dew towers'',
      radius: 8,
      color: ''#e8f4ff'',
      grants: [{ what: ''water'' }],
      effects: [{ when: ''drought'', do: ''water'', every: 20, radius: 6 }],
    },
  ],
  *cast(w) {
    w.terraform(w.x, w.y, w.r * 0.5, 1.5);
    const n = 5;
    for (let k = 0; k < n; k++) {
      const a = -0.6 + (k / (n - 1)) * 1.2;
      const d = w.r * 0.4;
      const x = Math.round(w.x + Math.cos(a) * d);
      const y = Math.round(w.y + Math.sin(a) * d);
      const h = 16 + (k % 2) * 4;
      w.spire(x, y, { height: h, radius: 2, colors: [''#e9dcc0'', ''#cdb89a''], kind: ''stone'' });
      w.sphere(x, y, h - 1, 2, [''#e8f4ff'', ''#b9d7ea''], 0.9, ''stone'');
    }
    w.artifact(w.x, w.y, ''dew towers'');
  },
};
', 'a true dew effect that pulls water out of dry air; the water effect stands in for it', 'in a drought', 'rejected', 'claude-haiku-5-5', '{"ok":false,"problem":"idle","detail":"It did nothing in a whole day and night on island 41 (desert): no field within its reach and no villager came for water. It passed on islands 3 and 17.","at":1793793600000}', 1793793600000, NULL);
