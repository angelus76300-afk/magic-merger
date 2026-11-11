// Seconds from page load to a first cast the player can see (review of
// 10 November, section 7): a fresh profile, touch, the real Worker
// (wrangler dev, a fresh local D1, a stub Claude) and the built game in
// dist/. A cast counts as seen once its spot is on screen, under no card,
// toast or dialog, for two seconds in a row (src/firstcast.ts). The player
// here goes straight to the World, picks the first spell it can cast and
// taps the middle of the island once and watches for ten seconds, as a
// newcomer does; then taps again every four seconds until a cast is seen or
// two minutes pass.
//   npm run build && node scripts/first-cast.mjs [runs] [WxH or WxHt] [frames dir] [prefix]
// Prints one line per run and a JSON summary; exit code 1 when a run's
// first tap is not the cast seen, or a run takes 60 seconds or more.
// The "new on islands this week" list is given eight wonders, as a week on
// production has, so its toast is part of the measure.
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const RUNS = Number(process.argv[2] ?? 3);
const [, W, H, T] = /^(\d+)x(\d+)(t?)$/.exec(process.argv[3] ?? "344x882t") ?? [];
const SIZE = { width: Number(W), height: Number(H), touch: T === "t" };
const FRAMES = process.argv[4] ? resolve(process.argv[4]) : null;
const PREFIX = process.argv[5] ?? "";
if (FRAMES) mkdirSync(FRAMES, { recursive: true });
const LIMIT_S = 120;
const TARGET_S = 60;
const ROOT = resolve(new URL("..", import.meta.url).pathname);
const ADMIN = "admin-first-cast";
const STATE = mkdtempSync(join(tmpdir(), "mm-first-cast-"));
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", WRANGLER_SEND_METRICS: "false", CI: "1" };

// A stub Claude: names for merges, a small visible spell for every program.
const NAMES = ["Steam", "Ember Tide", "Mist Veil", "Storm Seed", "Glass Rain", "Ash Lantern"];
let calls = 0;
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const n = ++calls;
    const body = JSON.parse(raw || "{}");
    const system = (body.system ?? []).map((b) => b.text).join("");
    let text;
    if (system.startsWith("You write the grimoire")) text = "Warm water rises as a soft white cloud and drifts over the island.";
    else if (system.includes("Say what this item promises")) text = JSON.stringify({ intents: ["other"] });
    else if (system.startsWith("You write the spells"))
      text = JSON.stringify({
        summary: "A flash.",
        code: "const spell = { *cast(w) { w.flash('#fff', 0.2); w.paint(w.x, w.y, 3, 'sand', 1); } };",
        missing: "",
      });
    else text = JSON.stringify({ name: NAMES[n % NAMES.length] + (n > NAMES.length ? ` ${n}` : ""), emoji: "✨", kind: "spell", tier: "minor" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `m${n}`,
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 100 },
      }),
    );
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "magic-merger", "--local", "--persist-to", STATE], {
  env,
  encoding: "utf8",
  cwd: ROOT,
});
if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
const port = 8980 + Math.floor(Math.random() * 9);
const vars = {
  ANTHROPIC_API_KEY: "sk-test",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${stub.address().port}`,
  ADMIN_TOKEN: ADMIN,
  BUDGET_USD: "50",
  INVITE_CAP_USD: "5",
};
const dev = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--port",
    String(port),
    "--ip",
    "127.0.0.1",
    "--persist-to",
    STATE,
    "--show-interactive-dev-session=false",
    "--log-level",
    "error",
    ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
  ],
  { env, stdio: ["ignore", "inherit", "inherit"], detached: true, cwd: ROOT },
);
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {
    // not up yet
  }
  if (i > 120) throw new Error("wrangler dev did not start");
  await new Promise((r) => setTimeout(r, 500));
}

const WEEK = ["world tree", "floating rock", "crystal spire", "geyser", "stone arch", "cave mouth", "bones", "hot spring"].map((kind, i) => ({
  id: 9000 + i,
  kind,
  rarity: i % 3 ? "uncommon" : "rare",
  lands: [],
  spot: "any",
  reach: 4,
  does: "",
  code: "",
  source: "player",
  by: `player ${i + 1}`,
  at: Date.now() - i * 3600_000,
}));

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const tag = `${SIZE.width}x${SIZE.height}${SIZE.touch ? "-touch" : ""}`;

async function tap(page, x, y) {
  if (SIZE.touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
async function tapEl(page, loc) {
  const b = await loc.boundingBox();
  await tap(page, b.x + b.width / 2, b.y + b.height / 2);
}

async function once(run) {
  const ctx = await browser.newContext({
    viewport: { width: SIZE.width, height: SIZE.height },
    deviceScaleFactor: 1,
    hasTouch: SIZE.touch,
    isMobile: SIZE.touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.includes(e.message) || errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("magic-merger.token", t), ADMIN);
  await page.route("**/api/wonders", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ wonders: [], week: WEEK }) }));
  const shot = async (name) => FRAMES && run === 1 && page.screenshot({ path: join(FRAMES, `${PREFIX}${tag}-${name}.png`) });
  await page.goto(`${BASE}/`);
  const since = () => page.evaluate(() => performance.now() / 1000);
  await page.waitForSelector(".chip-inventory", { timeout: 20000 });
  for (let i = 0; i < 4 && (await page.locator("dialog[open]").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
  await shot("01-craft");
  await tapEl(page, page.locator('.tab[data-view="world-view"]'));
  await page.waitForTimeout(1500);
  await shot("02-world-open");
  const spell = page.locator(".chip-castable").first();
  await spell.waitFor({ timeout: 30000 });
  await tapEl(page, spell);
  for (let i = 0; i < 60; i++) {
    if (/Tap the island to (cast|place)/.test(await page.locator("#world-status").innerText())) break;
    await page.waitForTimeout(500);
  }
  const taps = [];
  let seen = null;
  while ((await since()) < LIMIT_S) {
    const stage = await page.locator("#world-stage").boundingBox();
    const [fx, fy] = SIZE.width > SIZE.height ? [0.3, 0.6] : [0.5, 0.45];
    taps.push(Number((await since()).toFixed(1)));
    await tap(page, stage.x + stage.width * fx, stage.y + stage.height * fy);
    if (taps.length === 1) {
      await page.waitForTimeout(1000);
      await shot("03-first-cast-1s");
      await page.waitForTimeout(1500);
      await shot("04-first-cast-2.5s");
    }
    for (let i = 0; i < (taps.length === 1 ? 30 : 16) && seen === null; i++) {
      await page.waitForTimeout(250);
      seen = await page.evaluate(() => document.documentElement.dataset.firstCastSeen ?? null);
    }
    if (seen !== null) break;
  }
  await page.waitForTimeout(2500);
  await shot("05-after");
  await ctx.close();
  // The tap whose cast was seen: the last one at least two seconds before.
  const at = seen === null ? null : Number(seen);
  const tap = at === null ? null : taps.filter((t) => t <= at - 1.9).length;
  return { run, seen: at, tap, taps, errors };
}

const results = [];
try {
  for (let r = 1; r <= RUNS; r++) {
    const res = await once(r);
    results.push(res);
    console.log(
      `${tag} run ${r}: ${res.seen === null ? `never in ${LIMIT_S} s` : `seen at ${res.seen} s, from tap ${res.tap}`}, taps at ${res.taps.join(", ")} s${res.errors.length ? `, errors: ${res.errors.join(" | ")}` : ""}`,
    );
  }
} finally {
  await browser.close();
  try {
    process.kill(-dev.pid);
  } catch {
    // already gone
  }
  stub.close();
  rmSync(STATE, { recursive: true, force: true });
}
console.log(JSON.stringify({ size: tag, target: TARGET_S, results }));
process.exit(results.every((r) => r.seen !== null && r.seen < TARGET_S && r.tap === 1) ? 0 : 1);
