// Frames of every screen players see around the island, for a before and
// after of an interface change: the real Worker (wrangler dev, a fresh local
// D1, a stub Claude) and the built game in dist/, at a phone (390 by 844) and
// the owner's foldable (806 by 968).
//   npm run build && node scripts/ui-frames.mjs <out dir> [prefix]
// It fails (exit code 1) when a visible control is under 44 by 44 px, when the
// tabs are not at the bottom on a phone or foldable, or when the vote after a
// cast sits over the island.
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OUT = resolve(process.argv[2] ?? "frames");
const PREFIX = process.argv[3] ?? "";
mkdirSync(OUT, { recursive: true });
const ROOT = resolve(new URL("..", import.meta.url).pathname);
const ADMIN = "admin-ui-frames";
const STATE = mkdtempSync(join(tmpdir(), "mm-frames-"));
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", WRANGLER_SEND_METRICS: "false", CI: "1" };
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
        code: "const spell = { *cast(w) { w.flash('#fff', 0.2); w.paint(w.x, w.y, 2, 'sand', 1); } };",
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
const stubUrl = `http://127.0.0.1:${stub.address().port}`;
const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "magic-merger", "--local", "--persist-to", STATE], {
  env,
  encoding: "utf8",
  cwd: ROOT,
});
if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
const port = 8970 + Math.floor(Math.random() * 9);
const vars = { ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: stubUrl, ADMIN_TOKEN: ADMIN, BUDGET_USD: "50", INVITE_CAP_USD: "5" };
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

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
const failures = [];

// Every visible control a thumb can reach, smaller than 44 by 44 CSS px (the
// size the interface promises since 2026-11-07). A checkbox counts by its
// label's row. The admin badge is the owner's alone and is left out.
async function smallTargets(page) {
  return page.evaluate(() => {
    const out = [];
    const sel = 'button, [role="button"], [role="tab"], select, input:not([type="hidden"]), textarea, .chip-inventory, .chip-board';
    for (const el of document.querySelectorAll(sel)) {
      if (el.id === "admin-badge") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      const dialog = document.querySelector("dialog[open]");
      if (dialog && !dialog.contains(el)) continue;
      let w = r.width;
      let h = r.height;
      if (el.type === "checkbox" || el.type === "radio") {
        const row = el.closest("label")?.getBoundingClientRect();
        if (row) h = Math.max(h, row.height);
        if (row) w = Math.max(w, row.width);
      }
      // A chip or a field in a row that scrolls sideways is measured by its height only.
      if (Math.round(h) < 44 || Math.round(w) < 44) {
        const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 24);
        out.push(`${name} ${Math.round(w)}x${Math.round(h)}`);
      }
    }
    return out;
  });
}

async function drag(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 8, a.y + a.height / 2 + ((b.y - a.y) * i) / 8);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll(".chip-board.merging").length === 0, null, { timeout: 30000 });
}

async function closeDialogs(page) {
  for (let i = 0; i < 4 && (await page.locator("dialog[open]").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

async function run(width, height) {
  const tag = `${width}x${height}`;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: false });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  await page.addInitScript((t) => localStorage.setItem("magic-merger.token", t), ADMIN);
  const shot = async (name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${PREFIX}${tag}-${name}.png`) });
    const small = await smallTargets(page);
    if (small.length) failures.push(`${tag} ${name}: under 44 px: ${small.join(", ")}`);
    // Nothing in the top bar runs past the screen's right edge.
    const past = await page.evaluate(() =>
      [...document.querySelectorAll(".topbar > *:not([hidden]):not(.tabs)")]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5)
        .map((el) => `${(el.id || el.className).toString().slice(0, 20)} at x ${Math.round(el.getBoundingClientRect().right)}`),
    );
    if (past.length) failures.push(`${tag} ${name}: past the right edge: ${past.join(", ")}`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    if (wide > width) failures.push(`${tag} ${name}: the page is ${wide} px wide`);
    // A select shows its chosen label in full ("Old..." for Oldest is a miss,
    // 2026-11-07): the label's width, measured in the select's own font,
    // fits inside it beside the arrow. Selects scrolled out of a sideways
    // row are measured too: they keep their full width there.
    const cut = await page.evaluate(() => {
      const ctx = document.createElement("canvas").getContext("2d");
      const out = [];
      for (const el of document.querySelectorAll("select")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const dialog = document.querySelector("dialog[open]");
        if (dialog && !dialog.contains(el)) continue;
        const cs = getComputedStyle(el);
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const label = el.selectedOptions[0]?.textContent ?? "";
        const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20;
        if (ctx.measureText(label).width > room) out.push(`"${label}" in ${Math.round(room)} px`);
      }
      return out;
    });
    if (cut.length) failures.push(`${tag} ${name}: select labels cut: ${cut.join(", ")}`);
  };
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".chip-inventory", { timeout: 20000 });
  await page.waitForTimeout(600);
  if (await page.locator("dialog[open]").count()) await shot("00-welcome");
  await closeDialogs(page);
  await shot("01-craft-start");

  // Two merges: the board with items, a toast.
  for (const [x, y] of [
    ["Fire", "Water"],
    ["Earth", "Air"],
  ]) {
    await page.locator(".chip-inventory", { hasText: x }).first().click();
    await page.locator(".chip-inventory", { hasText: y }).first().click();
    const chips = page.locator(".chip-board");
    const count = await chips.count();
    await drag(page, chips.nth(count - 1), chips.nth(count - 2));
    await page.waitForTimeout(1800);
    await closeDialogs(page);
  }
  await page.locator(".chip-inventory").first().click();
  await page.waitForTimeout(1200);
  await closeDialogs(page);
  await shot("02-craft-board");

  // A card.
  await page.locator(".chip-board").first().click();
  await page.waitForTimeout(600);
  await shot("03-card");
  await closeDialogs(page);

  // The search with a filter.
  await page.fill("#search", "st");
  await shot("04-craft-search");
  await page.fill("#search", "");

  await closeDialogs(page);
  // World: the drawer, a selected spell, a cast and its vote.
  await page.click('.tab[data-view="world-view"]');
  await page.waitForTimeout(3500);
  await shot("05-world");
  const castable = page.locator(".chip-castable").first();
  if (await castable.count()) {
    await castable.click();
    for (let i = 0; i < 60; i++) {
      const s = await page.locator("#world-status").innerText();
      if (/Tap the island to cast/.test(s)) break;
      await page.waitForTimeout(500);
    }
    await shot("06-world-selected");
    const stage = await page.locator("#world-stage").boundingBox();
    // On its side the island's first look panel fills the middle: tap beside it.
    const [fx, fy] = width > height ? [0.15, 0.8] : [0.5, 0.45];
    await page.mouse.click(stage.x + stage.width * fx, stage.y + stage.height * fy);
    await page.waitForTimeout(500);
    await page.mouse.click(stage.x + stage.width * fx, stage.y + stage.height * fy);
    for (let i = 0; i < 30 && !(await page.locator(".vote").count()); i++) await page.waitForTimeout(500);
    await shot("07-world-vote");
    // The vote is answered from the drawer, never over the island.
    const voteOnIsland = await page.evaluate(() => {
      const vote = document.querySelector(".vote");
      return !vote || !!vote.closest(".world-stage");
    });
    if (voteOnIsland) failures.push(`${tag}: the vote is missing or over the island`);
    // "Not good" shows five reasons: they wrap, the page does not grow sideways.
    const down = page.locator(".vote .vote-down");
    if (await down.count()) {
      await down.click();
      await shot("07b-world-reasons");
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      if (wide > width) failures.push(`${tag}: the vote's reasons make the page ${wide} px wide`);
      await page.locator(".vote .vote-close").click();
    }
  }

  for (const [view, name] of [
    ["challenges-view", "08-challenges"],
    ["daily-view", "09-daily"],
    ["community-view", "10-community"],
    ["feedback-view", "11-ideas"],
  ]) {
    await page.click(`.tab[data-view="${view}"]`);
    // Tabs under the thumb below 1024 px: the bar touches the bottom edge
    // (on a phone on its side, a rail down the left edge, top to bottom).
    const tabsBottom = await page.evaluate(() => document.querySelector(".tabs").getBoundingClientRect().bottom);
    if (width < 1024 && Math.abs(tabsBottom - height) > 1) failures.push(`${tag}: the tabs end at y ${Math.round(tabsBottom)}, not at the bottom (${height})`);
    await page.waitForTimeout(1200);
    await shot(name);
  }
  await page.click("#help");
  await page.waitForTimeout(600);
  await shot("12-menu");
  await closeDialogs(page);

  // The owner on a preview: both badges, and a month's spend in two digits.
  await page.evaluate(() => {
    document.getElementById("staging-badge").hidden = false;
    const admin = document.getElementById("admin-badge");
    admin.hidden = false;
    admin.textContent = "admin $10.50";
  });
  await page.click('.tab[data-view="craft-view"]');
  await shot("13-topbar-preview");
  await ctx.close();
}

try {
  await run(390, 844);
  await run(806, 968);
  await run(844, 390);
  console.log(`frames in ${OUT}`);
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  console.log(
    failures.length ? `FAIL:\n${failures.join("\n")}` : "PASS: every control is at least 44 px, the tabs sit at the bottom, the vote is on the drawer",
  );
  process.exitCode = failures.length ? 1 : 0;
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
