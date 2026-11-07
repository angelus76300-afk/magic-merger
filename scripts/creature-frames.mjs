// 4.6 part B frames at phone size (390 by 844): Serpent and Human before and
// after, and a strip of ten items written to the new sections, one of each
// kind and the people's callings. Dev only, like spell-lab.mjs.
//
//   node scripts/creature-frames.mjs <out-dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openLab } from "./lab-browser.mjs";

const [outDir = "docs/visual-checks"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const program = (name) => readFileSync(join("lab/creatures", `${name}.js`), "utf8");

// Each: label, program file, lab options.
const pairs = [
  ["Serpent, part A", "serpent-a", { tier: "minor", follow: true, shots: [10] }],
  ["Serpent, part B", "serpent", { tier: "minor", follow: true, shots: [10] }],
  ["Human, a creature kind", "human-kind", { tier: "minor", follow: true, shots: [10] }],
  ["Human, a villager", "human", { tier: "minor", follow: true, shots: [10] }],
];
const strip = [
  ["Fireball (spell)", "fireball", { tier: "major", shots: [0.8], dist: 22 }],
  ["Fox Spirit (creature)", "fox-spirit", { tier: "minor", follow: true, shots: [10] }],
  ["Blacksmith (person)", "blacksmith", { tier: "minor", follow: true, shots: [40] }],
  ["Necromancer (person, night)", "necromancer", { tier: "minor", follow: true, shots: [55], nightIn: 8, dist: 14 }],
  ["Knight (person)", "knight", { tier: "minor", follow: true, shots: [10] }],
  ["Storm Lantern (object)", "storm-lantern", { tier: "minor", shots: [3], dist: 9, focusMade: true }],
  ["Forge (building)", "forge", { tier: "minor", shots: [3], dist: 14, focusMade: true }],
  ["Village (settlement)", "village", { tier: "major", shots: [4], dist: 40, focusMade: true }],
  ["Healing Spring (place)", "healing-spring", { tier: "minor", shots: [3], dist: 18, focusMade: true }],
  ["Volcano (land)", "volcano", { tier: "grand", shots: [6], dist: 45 }],
];

const lab = await openLab({ width: 390, height: 844 });
await lab.page.addStyleTag({ content: ".stage, canvas { width: 390px !important; height: 844px !important; }" });

async function shoot(list) {
  const out = [];
  for (const [label, file, options] of list) {
    const result = await lab.cast(program(file), { land: true, dist: 11, ...options });
    if (!result.ok || result.errors.length) console.error(label, result.errors);
    const png = result.frames[result.frames.length - 1].png;
    writeFileSync(join(outDir, `creatures-4.6b-${file}.png`), Buffer.from(png.split(",")[1], "base64"));
    out.push({ label, png });
    console.log(label, "ok");
  }
  return out;
}

// A strip of labelled frames, drawn in the page and captured.
async function compose(frames, scale, perRow, file) {
  const w = Math.round(390 * scale);
  const h = Math.round(844 * scale);
  const html = `<body style="margin:0;background:#14121c;font:600 ${Math.round(15 * Math.max(scale, 0.7))}px system-ui;color:#f1ead8">
<div style="display:grid;grid-template-columns:repeat(${perRow},${w}px)">${frames
    .map(
      (f) =>
        `<div style="position:relative"><img src="${f.png}" width="${w}" height="${h}" style="display:block"><div style="position:absolute;top:0;left:0;right:0;padding:6px 8px;background:#14121ccc">${f.label}</div></div>`,
    )
    .join("")}</div></body>`;
  await lab.page.setViewportSize({ width: w * perRow, height: h * Math.ceil(frames.length / perRow) });
  await lab.page.setContent(html);
  await lab.page.screenshot({ path: join(outDir, file) });
}

const a = await shoot(pairs);
const b = await shoot(strip);
await compose(a, 0.75, 4, "creatures-4.6b-serpent-human.png");
await compose(b, 0.5, 5, "creatures-4.6b-ten-items.png");
await lab.close();
