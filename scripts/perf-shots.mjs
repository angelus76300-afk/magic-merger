// Dev only (4.4): screenshots of the Perf Lab in a phone sized browser, for
// looking at the land and the sky. Each argument is a query string; the
// picture is saved under its name.
//
//   npx vite --port 5174 &
//   node scripts/perf-shots.mjs out-dir "name:biome=desert&time=250" ...
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const base = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [out, ...shots] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ ...devices["Pixel 7"], deviceScaleFactor: 1 });
for (const shot of shots) {
  const [name, query] = shot.split(":");
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error(name, "page error:", err.message));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 120_000 });
  await page.waitForTimeout(Number(process.env.WAIT ?? 2500));
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.close();
  console.log(name);
}
await browser.close();
