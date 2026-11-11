// 4.5.2: the nightly long session on a random island, at phone size, then folded and unfolded (docs/DAILY.md, "The night").
//
//   MM_TOKEN=... node scripts/nightly-play.mjs <staging url> [--minutes 10] [--seed n] [--out dir]
//
// Plays on the staging copy (never production: as admin it would sync the
// owner's island): a new island from a random seed, one spell cast from the
// spell bar after a minute, then the island left to live. A frame every 30 s
// for the vision check a session does on them (what a person would notice:
// things floating, stuck, overlapping, flickering, invisible, nothing
// happening after a cast), plus what a script can tell alone: page errors,
// frame times in the page, and frames that never change.
//
// 2026-11-10, "folds: yes": the owner plays on a Z Fold, so the same session is
// folded a third of the way through (344 by 882) and unfolded at two thirds
// (700 by 830), as a player opens the phone mid-game (scripts/sizes.mjs). Right
// after each change: a frame, and a finding if the page is wider than the
// screen or the island's stage no longer fills its place. Same length as before.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { FOLD } from "./sizes.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
if (!BASE.startsWith("http")) {
  console.error("usage: node scripts/nightly-play.mjs <url> [--minutes 10] [--seed n] [--out dir]");
  process.exit(2);
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const MINUTES = Number(arg("minutes", 10));
const SEED = Number(arg("seed", Math.floor(Math.random() * 1e6)));
const OUT = arg("out", "nightly-play");
mkdirSync(OUT, { recursive: true });
const TOKEN = process.env.MM_TOKEN ?? "";

const findings = [];
const note = (kind, detail) => {
  findings.push({ kind, detail: String(detail).slice(0, 300) });
  console.log(`finding: ${kind}: ${String(detail).slice(0, 160)}`);
};
// Offers that open on their own (an account, what's new) are closed, as a player would.
const closeDialogs = async (page) => {
  for (let i = 0; i < 4 && (await page.locator("dialog[open]:not(.reset-island)").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
};
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const frames = [];
let cast = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => note("page error", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Unrecognized Content-Security-Policy directive|Failed to load resource/.test(m.text())) note("console error", m.text());
  });
  page.on("response", (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 500) note("server error", `${r.status()} ${r.url().slice(BASE.length)}`);
  });
  await page.addInitScript((t) => {
    try {
      if (t) localStorage.setItem("magic-merger.token", t);
    } catch {
      // the sandboxed frames have no storage
    }
  }, TOKEN);
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".chip-inventory", { timeout: 30000 });
  await page.waitForTimeout(3000);
  await closeDialogs(page);
  await page.click('.tab[data-view="world-view"]');
  await page.waitForTimeout(4000);
  await closeDialogs(page);
  // A new island from the night's seed.
  await page.click("#world-reset");
  await page.waitForSelector("dialog.reset-island[open]");
  await page.fill("dialog.reset-island input[type=text]", String(SEED));
  await page.click("dialog.reset-island .primary");
  await page.waitForTimeout(8000);
  // Frame times as the page sees them.
  await page.evaluate(() => {
    const times = [];
    let last = performance.now();
    const tick = (t) => {
      times.push(t - last);
      last = t;
      if (times.length > 20000) times.shift();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__mmFrames = times;
  });
  const steps = Math.max(1, Math.round((MINUTES * 60) / 30));
  // Fold at a third, unfold at two thirds (at least one frame apart from the cast and from each other).
  const resizeAt = new Map([
    [Math.max(3, Math.round(steps / 3)), FOLD[0]],
    [Math.max(4, Math.round((2 * steps) / 3)), FOLD[1]],
  ]);
  let size = { name: "phone", width: 390, height: 844 };
  for (let i = 0; i <= steps; i++) {
    const next = resizeAt.get(i);
    if (next && i <= steps) {
      await page.setViewportSize({ width: next.width, height: next.height });
      size = next;
      await page.waitForTimeout(1500);
      const look = await page.evaluate(() => {
        const stage = document.querySelector("#world-stage")?.getBoundingClientRect();
        return { wide: document.documentElement.scrollWidth, stage: stage ? { w: Math.round(stage.width), h: Math.round(stage.height) } : null };
      });
      if (look.wide > next.width) note("wider than the screen", `${next.name} ${next.width}x${next.height}: the page is ${look.wide} px wide`);
      if (!look.stage || look.stage.w < next.width * 0.9 || look.stage.h < 200)
        note("island not filling the screen", `${next.name} ${next.width}x${next.height}: stage ${JSON.stringify(look.stage)}`);
      const p = join(OUT, `t${String(i * 30).padStart(4, "0")}s-${next.name}-now.jpg`);
      await page.screenshot({ path: p, type: "jpeg", quality: 70 });
      console.log(`${next.name}: ${next.width}x${next.height}`);
    }
    if (i === 2) {
      // One spell from the spell bar, cast in the middle of the island.
      await closeDialogs(page);
      const spell = page.locator("#spell-list > *").first();
      if (await spell.count()) {
        cast = (await spell.innerText()).trim().split("\n")[0].slice(0, 60);
        await spell.click();
        const box = await page.locator("#world-stage").boundingBox();
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        console.log(`cast: ${cast}`);
      } else note("no spell to cast", "the spell bar is empty");
    }
    const path = join(OUT, `t${String(i * 30).padStart(4, "0")}s.jpg`);
    await page.screenshot({ path, type: "jpeg", quality: 70 });
    frames.push({ path, at: i * 30, size: size.name, hash: createHash("sha1").update(readFileSync(path)).digest("hex") });
    if (i < steps) await page.waitForTimeout(30000);
  }
  const times = await page.evaluate(() => window.__mmFrames ?? []);
  const sorted = [...times].sort((a, b) => a - b);
  const p = (q) => (sorted.length ? Math.round(sorted[Math.floor(q * (sorted.length - 1))] * 10) / 10 : null);
  const frameStats = { frames: sorted.length, p50: p(0.5), p95: p(0.95), over100ms: sorted.filter((t) => t > 100).length };
  if (frameStats.p95 > 50)
    note("slow frames", `frame p95 ${frameStats.p95} ms in a headless browser (software WebGL: compare night to night, not with phones)`);
  // Three identical frames in a row: nothing moved for a minute.
  for (let i = 2; i < frames.length; i++)
    if (frames[i].hash === frames[i - 1].hash && frames[i].hash === frames[i - 2].hash) {
      note("nothing moves", `frames ${frames[i - 2].at}s to ${frames[i].at}s are identical`);
      break;
    }
  writeFileSync(
    join(OUT, "report.json"),
    JSON.stringify({ url: BASE, seed: SEED, minutes: MINUTES, cast, frameStats, frames, findings, at: new Date().toISOString() }, null, 2),
  );
  console.log(`seed ${SEED}, ${frames.length} frames, frame p50 ${frameStats.p50} ms p95 ${frameStats.p95} ms, ${findings.length} findings`);
  await ctx.close();
} finally {
  await browser.close();
}
