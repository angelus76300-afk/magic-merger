// 4.12 step 1: frames of pairs of items in the Spell Lab (lab/), offline.
// Reads the films chosen by scripts/spell-measure.ts (films.json in its --out
// folder): for a pair, A is cast by a village, B on the same spot three
// seconds later; for two near duplicates, each is cast alone. Three frames
// per cast, at 700 by 830: before, one second after the cast, fifteen seconds
// after. The lab's island is the game's medium island on seed 11, not the
// measure's practice island, so the frames show the look, not the numbers.
//
//   node scripts/spell-pair-frames.mjs /tmp/spell-measure/out/films.json /tmp/spell-measure/pairs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openLab } from "./lab-browser.mjs";

const [filmsFile, outDir] = process.argv.slice(2);
if (!filmsFile || !outDir) {
  console.error("usage: node scripts/spell-pair-frames.mjs <films.json> <out-dir>");
  process.exit(1);
}
const films = JSON.parse(readFileSync(filmsFile, "utf8"));
const W = 700;
const H = 830;
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const NOTHING = "const spell = { *cast(w) { yield 0.1; } };";

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
// Steps the lab's engine, drawing the last tick only.
const step = (seconds) =>
  lab.page.evaluate(
    (n) => {
      for (let k = 0; k < n; k++) window.labEngine.step();
    },
    Math.round(seconds * 30),
  );
const cast = (item, target, key) =>
  lab.page.evaluate(
    ([it, t, k]) =>
      window.labEngine.cast(
        { key: k, name: it.name, tier: it.tier, code: it.code, form: it.form, kind: it.kind === "artifact" ? "artifact" : "spell" },
        t.x,
        t.y,
      ),
    [item, target, key],
  );

for (const film of films) {
  const dir = join(outDir, `${film.n}-${slug(film.a.name)}-${slug(film.b.name)}`);
  mkdirSync(dir, { recursive: true });
  const fresh = async () => (await lab.cast(NOTHING, { shots: [0], settle: 0, dist: 64, phi: 0.95, time: 40 })).target;
  const casts = film.mode === "dup" ? [[film.a], [film.b]] : [[film.a, film.b]];
  const notes = [];
  for (const [round, list] of casts.entries()) {
    const target = await fresh();
    const tag = film.mode === "dup" ? `${round ? "b" : "a"}-` : "";
    await shot(dir, `${tag}1-before`);
    const ok = await cast(list[0], target, `film-${film.n}-0`);
    if (list[1]) {
      await step(3);
      notes.push(`${list[0].name} started: ${ok}`);
      const ok2 = await cast(list[1], target, `film-${film.n}-1`);
      notes.push(`${list[1].name} started: ${ok2}`);
    } else notes.push(`${list[0].name} started: ${ok}`);
    await step(1);
    await shot(dir, `${tag}2-cast`);
    await step(15);
    await shot(dir, `${tag}3-after`);
  }
  writeFileSync(join(dir, "about.txt"), `${film.label}\n${film.a.name} then ${film.b.name}\n${film.line ?? ""}\n${notes.join("\n")}\n`);
  console.log(`${dir}: ${notes.join("; ")}`);
}
await lab.close();
