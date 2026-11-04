// Screenshots of the bestiary page (lab/bestiary.html) in a headless browser:
// every body plan, feature, wild animal and villager look, walking and dead.
//
//   node scripts/bestiary.mjs [out-dir]     (default docs/visual-checks)
//
// Vite serves the page; it is started when nothing answers at LAB_URL.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const outDir = process.argv[2] ?? "docs/visual-checks";
const base = (process.env.LAB_URL ?? "http://localhost:5174/lab/").replace(/\/?$/, "/");

async function reachable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

let vite = null;
if (!(await reachable(base))) {
  vite = spawn("npx", ["vite", "--port", "5174", "--strictPort"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60 && !(await reachable(base)); i++) await new Promise((r) => setTimeout(r, 500));
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1700 } });
page.on("pageerror", (err) => console.error("page error:", err.message));
// GAITS=1 also shoots the gaits and idles of 4.3: a run, grazing, lying down.
const shots = [
  ["bestiary", "pose=walk&t=0.42"],
  ["bestiary-dead", "pose=dead&t=0.42"],
];
if (process.env.GAITS) shots.push(["bestiary-run", "pose=run&t=0.42"], ["bestiary-graze", "pose=graze&t=0.42"], ["bestiary-lie", "pose=lie&t=0.42"]);
for (const [name, query] of shots) {
  await page.goto(`${base}bestiary.html?${query}`);
  await page.waitForFunction(() => window.bestiaryReady === true);
  await page.waitForTimeout(300);
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path });
  console.log(path, await page.textContent("#stats"));
}
await browser.close();
if (vite) process.kill(-vite.pid);
