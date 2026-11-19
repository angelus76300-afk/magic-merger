// Frames of a spell's look in the Lab at 832 by 1000 (a foldable open), on medium and high, from
// close, mid and the side: for the before and after of turned parts drawn whole (19 November).
// The Lab's 540 square is widened in the browser only. Offline: Vite on 5174, stopped at the end.
//   node scripts/turned-parts-frames.mjs <out dir> <spell file> <tag>
//   node scripts/turned-parts-frames.mjs docs/visual-checks/turned-parts scripts/fixtures/turned-slabs-ring.js after
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const { chromium } = createRequire(join(ROOT, "package.json"))("playwright");
const [out, codeFile, tag, form = "land", tier = "grand"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const code = readFileSync(codeFile, "utf8");
const url = "http://localhost:5174/lab/";
const ok = async () => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
const vite = spawn("npx", ["vite", "--port", "5174", "--strictPort"], { cwd: ROOT, stdio: "ignore", detached: true });
try {
  for (let i = 0; i < 120 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 500));
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 832, height: 1000 } });
  await page.route("**/lab/", async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace(/width: 540px/g, "width: 832px").replace(/height: 540px/g, "height: 1000px");
    await route.fulfill({ response: r, body });
  });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.labReady === true, null, { timeout: 120000 });
  const views = [
    { v: "close", dist: 12, phi: 0.95 },
    { v: "mid", dist: 24, phi: 0.9 },
    { v: "side", dist: 12, phi: 1.3, theta: 1.2 },
  ];
  for (const q of ["medium", "high"])
    for (const v of views) {
      const opts = { tier, kind: "artifact", form, land: true, focusMade: true, quality: q, shots: [4], settle: 1, dist: v.dist, phi: v.phi, time: 40 };
      if (v.theta !== undefined) opts.theta = v.theta;
      const r = await page.evaluate(([c, o]) => window.runSpell(c, o), [code, opts]);
      const f = r.frames[r.frames.length - 1];
      const file = join(out, `${tag}-${q}-${v.v}-832x1000.png`);
      writeFileSync(file, Buffer.from(f.png.replace(/^data:image\/\w+;base64,/, ""), "base64"));
      console.log(file, "errors", JSON.stringify(r.errors ?? []).slice(0, 200));
    }
  await browser.close();
} finally {
  process.kill(-vite.pid);
}
