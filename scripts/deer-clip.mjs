// A deer by a bear, before and after 4.3, filmed by a fixed camera in the
// real renderer (lab/clip.html): a strip of frames and the deer's trail, for
// the owner to see what changed (docs/visual-checks/deer-before-after.jpg).
//
//   git worktree add /tmp/main-wt main && (cd /tmp/main-wt && ln -s $PWD/node_modules node_modules)
//   cp lab/clip.html lab/clip.ts /tmp/main-wt/lab/
//   (cd /tmp/main-wt && npx vite --port 5175 --strictPort) &
//   node scripts/deer-clip.mjs http://localhost:5175/lab/ [out]
//
// The branch is served by Vite from here on 5174 (started when nothing
// answers). Same island, same deer, same bear, same seconds on both.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const before = process.argv[2] ?? "http://localhost:5175/lab/";
const out = process.argv[3] ?? "docs/visual-checks/deer-before-after.jpg";
const after = (process.env.LAB_URL ?? "http://localhost:5174/lab/").replace(/\/?$/, "/");
const OPTIONS = {
  seed: Number(process.env.SEED ?? 11),
  size: "medium",
  kind: "deer",
  nth: Number(process.env.NTH ?? 0),
  threat: "bear",
  threatAt: 7,
  seconds: 12,
  every: 1.5,
  dist: 20,
  time: 60,
};

async function reachable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}
if (!(await reachable(after))) {
  spawn("npx", ["vite", "--port", "5174", "--strictPort"], { stdio: "ignore", detached: true }).unref();
  for (let i = 0; i < 60 && !(await reachable(after)); i++) await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
page.on("pageerror", (err) => console.error("page error:", err.message));
const runs = {};
for (const [label, base] of [
  ["before", before.replace(/\/?$/, "/")],
  ["after", after],
]) {
  await page.goto(`${base}clip.html`);
  await page.waitForFunction(() => window.clipReady === true);
  runs[label] = await page.evaluate((o) => window.clip(o), OPTIONS);
  if (runs[label].error) throw new Error(`${label}: ${runs[label].error}`);
  console.log(label, "deer", runs[label].id, "frames", runs[label].frames.length);
}

// Reversals of the trail: half seconds in which the heading turned by more than 150 degrees.
function reversals(trail) {
  let n = 0;
  let last = null;
  let shut = -1;
  const heads = [];
  trail.forEach(([x, y], k) => {
    if (last) {
      const d = Math.hypot(x - last[0], y - last[1]);
      if (d > 0.01) {
        const a = Math.atan2(y - last[1], x - last[0]);
        while (heads.length && heads[0][0] < k - 15) heads.shift();
        if (k > shut && heads.some(([, b]) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > (150 * Math.PI) / 180)) {
          n++;
          shut = k + 15;
          heads.length = 0;
        }
        heads.push([k, a]);
      }
    }
    last = [x, y];
  });
  return n;
}

function trailSvg(run, color) {
  const xs = [...run.trail, ...run.threatTrail].map((p) => p[0]);
  const ys = [...run.trail, ...run.threatTrail].map((p) => p[1]);
  const pad = 2;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const span = Math.max(Math.max(...xs) - x0 + pad, Math.max(...ys) - y0 + pad, 8);
  const k = 220 / span;
  const pts = run.trail.map(([x, y]) => `${((x - x0) * k).toFixed(1)},${((y - y0) * k).toFixed(1)}`).join(" ");
  const bear = run.threatTrail.map(([x, y]) => `${((x - x0) * k).toFixed(1)},${((y - y0) * k).toFixed(1)}`).join(" ");
  const [sx, sy] = run.trail[0];
  return `<svg width="220" height="220" viewBox="0 0 220 220" style="background:#1d2a1d"><polyline points="${bear}" fill="none" stroke="#8a7a6a" stroke-width="2" stroke-dasharray="4 3"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/><circle cx="${((sx - x0) * k).toFixed(1)}" cy="${((sy - y0) * k).toFixed(1)}" r="4" fill="#fff"/></svg>`;
}

const row = (label, run, color) => `
  <div class="row"><div class="label">${label}<br><span>${reversals(run.trail)} sharp turns in ${OPTIONS.seconds} s</span></div>
  ${run.frames.map((f) => `<figure><img src="${f.jpg}"><figcaption>${f.t.toFixed(1)} s</figcaption></figure>`).join("")}
  <figure>${trailSvg(run, color)}<figcaption>the deer's trail from the white dot; dashed, the bear</figcaption></figure></div>`;
await page.setViewportSize({ width: 1980, height: 560 });
await page.setContent(`<html><head><style>
  body { margin: 0; background: #0e0e0e; color: #eee; font: 14px sans-serif; }
  .row { display: flex; align-items: center; gap: 4px; padding: 6px; }
  .label { width: 130px; font-size: 18px; font-weight: bold; }
  .label span { font-size: 13px; font-weight: normal; color: #bbb; }
  figure { margin: 0; text-align: center; }
  img { width: 180px; height: 180px; display: block; }
  figcaption { font-size: 12px; color: #aaa; }
</style></head><body>
  ${row("Before 4.3", runs.before, "#ff7a59")}
  ${row("After 4.3", runs.after, "#7ad0ff")}
  <div style="padding:6px 12px;color:#999">The same deer on the same island, a bear set down 7 cells to its east by day, the camera following the deer, a frame every ${OPTIONS.every} s. Sharp turns: heading changed by more than 150 degrees within half a second.</div>
</body></html>`);
await page.waitForTimeout(300);
await page.screenshot({ path: out, type: "jpeg", quality: 85, fullPage: true });
writeFileSync(
  out.replace(/\.jpg$/, ".json"),
  JSON.stringify({
    options: OPTIONS,
    before: { trail: runs.before.trail, reversals: reversals(runs.before.trail) },
    after: { trail: runs.after.trail, reversals: reversals(runs.after.trail) },
  }),
);
console.log("before", reversals(runs.before.trail), "sharp turns; after", reversals(runs.after.trail), "->", out);
await browser.close();
process.exit(0);
