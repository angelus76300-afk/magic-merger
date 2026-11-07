// The Spell Lab in a headless browser, for scripts: opens the lab page (and
// starts Vite for it when nothing answers at LAB_URL), casts programs, returns
// what they did with their frames. Used by spell-lab.mjs, judge-runner.mjs
// and eval-spells.mjs. Dev only; needs Playwright with a Chromium it can launch.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// require, not import: it also finds a Playwright installed globally (NODE_PATH).
const { chromium } = createRequire(import.meta.url)("playwright");

async function reachable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

export async function openLab(viewport = { width: 540, height: 540 }) {
  const url = process.env.LAB_URL ?? "http://localhost:5174/lab/";
  let vite = null;
  if (!(await reachable(url))) {
    vite = spawn("npx", ["vite", "--port", "5174", "--strictPort"], { stdio: "ignore", detached: true });
    for (let i = 0; i < 60 && !(await reachable(url)); i++) await new Promise((r) => setTimeout(r, 500));
  }
  // Software WebGL in headless Chromium: slow, but renders the real thing.
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(url);
  await page.waitForFunction(() => window.labReady === true);
  return {
    page,
    // Casts one program near a village on the lab's seeded island.
    cast: (code, options) => page.evaluate(([c, o]) => window.runSpell(c, o), [code, options]),
    close: async () => {
      await browser.close();
      if (vite) process.kill(-vite.pid);
    },
  };
}

// What changed, in a sentence, for the judge.
export function factsOf(result) {
  const t = Object.entries(result.terrain ?? {})
    .filter(([k]) => k !== "burning")
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 6)
    .map(([k, v]) => `${k.split(":")[1]} ${v > 0 ? "+" : ""}${v}`)
    .join(", ");
  const c = result.creatures ?? { before: {}, after: {} };
  const died = (c.after.dead ?? 0) - (c.before.dead ?? 0);
  const parts = [t ? `cells: ${t}` : "no cell changed"];
  if (result.terrain?.burning) parts.push(`${result.terrain.burning > 0 ? "+" : ""}${result.terrain.burning} burning`);
  parts.push(
    `${died} creatures died, ${c.after.afraid ?? 0} afraid, ${c.after.frozen ?? 0} frozen, ${c.after.burning ?? 0} burning, kinds now ${c.after.kinds || "none"}`,
  );
  if (result.errors?.length) parts.push(`errors: ${result.errors.join("; ").slice(0, 200)}`);
  return parts.join("; ");
}
