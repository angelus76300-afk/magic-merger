// 4.12 step 2: frames of pairs that answer each other (src/sim/reactions.ts), in the Spell
// Lab (lab/), offline, at a phone's sizes. For each pair, A is cast by a village, B on the same
// spot three seconds later, with the reactions off (as on main) and on (the player's island).
// Three frames each: before, one second after B, eight seconds after.
//
//   node scripts/reaction-frames.mjs <out-dir> [width height]...   (default 390 844 344 882)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openLab } from "./lab-browser.mjs";

const [outDir, ...dims] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/reaction-frames.mjs <out-dir> [width height]...");
  process.exit(1);
}
const sizes = [];
for (let k = 0; k + 1 < dims.length; k += 2) sizes.push([Number(dims[k]), Number(dims[k + 1])]);
if (!sizes.length) sizes.push([390, 844], [344, 882]);

const PHOENIX = `const spell = { creatures: [{ name: "phoenix", base: "beast", body: "bird", color: "#d9461f", glow: true, flying: true, fireproof: true, radius: 0.6, speed: 4.5, hp: 120, goal: "spread", leaves: "flowers", behavior: "wander", weak: ["water", "cold"], active: "day" }], *cast(w) { w.spawn("phoenix", w.x, w.y); w.spawn("phoenix", w.x + 2, w.y); } };`;
const NOTHING = "const spell = { *cast(w) { yield 0.1; } };";
// Night falls at 0.72 of the day (daylight.ts, DAY_LENGTH 360).
const NIGHT = 360 * 0.72;
const PAIRS = [
  { slug: "phoenix-over-the-meadow", a: ["Phoenix", PHOENIX], b: null, after: 20 },
  {
    slug: "volcano-then-flood",
    a: ["Volcano", `const spell = { *cast(w) { w.flood(w.x, w.y, 5, "lava", 1); w.gas(w.x, w.y, 3, "smoke", 0.6); } };`],
    b: ["Great Flood", `const spell = { *cast(w) { w.flood(w.x, w.y, 9, "water", 1.2); } };`],
  },
  {
    slug: "lich-then-divine-radiance",
    time: NIGHT,
    a: [
      "Lich",
      `const spell = { creatures: [{ name: "lich", base: "beast", hp: 200, speed: 0.6, behavior: "wander", glow: true, color: "#6a7a6a" }], *cast(w) { for (let k = 0; k < 3; k++) w.spawn("lich", w.x + k * 2, w.y); } };`,
    ],
    b: ["Divine Radiance", `const spell = { *cast(w) { w.light(w.x, w.y, 12, "#fff6c8", 3); for (const c of w.creatures(w.x, w.y, 12)) c.heal(40); } };`],
  },
  {
    slug: "fire-then-blast-wave",
    a: ["Fire", `const spell = { *cast(w) { w.ignite(w.x, w.y, 7, 0.9); } };`],
    b: ["Blast Wave", `const spell = { *cast(w) { w.shockwave(w.x, w.y, 12, "#ffffff", 0.8, 2); } };`],
  },
  {
    slug: "black-ice-then-fire",
    a: ["Black Ice", `const spell = { *cast(w) { w.flood(w.x, w.y, 6, "water", 0.6); w.temperature(w.x, w.y, 8, -80); } };`],
    b: ["Fire", `const spell = { *cast(w) { w.ignite(w.x, w.y, 7, 1); } };`],
  },
];

for (const [W, H] of sizes) {
  const lab = await openLab({ width: W, height: H });
  await lab.page.evaluate(
    ([w, h]) => {
      for (const el of [document.querySelector(".stage"), ...document.querySelectorAll("canvas")]) {
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
      }
    },
    [W, H],
  );
  const shot = async (dir, name) => {
    await lab.page.evaluate(() => window.labEngine.render());
    writeFileSync(join(dir, `${name}.png`), await lab.page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } }));
  };
  const step = (seconds) =>
    lab.page.evaluate(
      (n) => {
        for (let k = 0; k < n; k++) window.labEngine.step();
      },
      Math.round(seconds * 30),
    );
  const cast = ([name, code], t, key) =>
    lab.page.evaluate(([n, c, tt, k]) => window.labEngine.cast({ key: k, name: n, tier: "major", code: c }, tt.x, tt.y), [name, code, t, key]);
  for (const pair of PAIRS)
    for (const on of [false, true]) {
      const dir = join(outDir, `${W}x${H}`, `${pair.slug}-${on ? "on" : "off"}`);
      mkdirSync(dir, { recursive: true });
      const { target } = await lab.cast(NOTHING, { shots: [0], settle: 0, dist: 40, phi: 0.95, time: pair.time ?? 40 });
      await lab.page.evaluate((r) => (window.labEngine.world.reactions = r), on);
      await shot(dir, "1-before");
      await cast(pair.a, target, `${pair.slug}-a`);
      await step(3);
      if (pair.b) await cast(pair.b, target, `${pair.slug}-b`);
      await step(1);
      await shot(dir, "2-cast");
      await step(pair.after ?? 8);
      await shot(dir, "3-after");
      const facts = await lab.page.evaluate((t) => {
        const w = window.labEngine.world;
        let fire = 0,
          steam = 0,
          basalt = 0,
          ash = 0;
        for (let i = 0; i < w.n; i++) {
          if (w.fire[i] > 0) fire++;
          if (w.gasAmt[i] > 0.05 && w.materials.get("gas", w.gas[i]).name === "steam") steam++;
          const g = w.materials.get("ground", w.ground[i]).name;
          if (g === "basalt") basalt++;
          if (g === "ash") ash++;
        }
        const near = w.creatures.filter(
          (c) =>
            !c.dead &&
            Math.hypot(c.x - t.x, c.y - t.y) < 14 &&
            !["villager", "deer", "rabbit", "bird", "fish", "boar", "wolf", "bear"].includes(c.kind.split("#")[0]),
        );
        return { fire, steam, basalt, ash, spellCreatures: near.map((c) => `${c.kind.split("#")[0]} ${Math.round(c.hp)}`).join(", ") };
      }, target);
      writeFileSync(join(dir, "facts.json"), JSON.stringify(facts));
      console.log(`${W}x${H} ${pair.slug} ${on ? "on " : "off"}: ${JSON.stringify(facts)}`);
    }
  await lab.close();
}
