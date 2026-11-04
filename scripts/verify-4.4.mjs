// 4.4 in the real game (wrangler dev, a fresh local D1, a stub Claude), in a
// phone sized browser: the reset dialog, a desert island of lakes from a
// seed, saved and loaded again; no huge or giant island without headroom;
// with it, a giant island kept gzipped and loaded again. Screenshots go to
// docs/visual-checks (needs dist/: npm run build).
import { createRequire } from "node:module";

// require, not import: it also finds a Playwright installed globally (NODE_PATH), as lab-browser.mjs does.
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN = "admin-verify-44";
const STATE = mkdtempSync(join(tmpdir(), "mm-verify-"));
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", WRANGLER_SEND_METRICS: "false", CI: "1" };
let calls = 0;
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const n = ++calls;
    const body = JSON.parse(raw || "{}");
    const system = (body.system ?? []).map((b) => b.text).join("");
    let text;
    if (system.startsWith("You write the grimoire")) text = "A small bright spell.";
    else if (system.includes("Say what this item promises")) text = JSON.stringify({ intents: ["other"] });
    else if (system.startsWith("You write the spells"))
      text = JSON.stringify({
        summary: "A flash.",
        code: "const spell = { *cast(w) { w.flash('#fff', 0.2); w.paint(w.x, w.y, 2, 'sand', 1); } };",
        missing: "",
      });
    else text = JSON.stringify({ name: `Answer ${n}`, emoji: "✨", kind: "spell", tier: "minor" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `m${n}`,
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
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
  cwd: "/home/user/magic-merger",
});
if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
const port = 8990 + Math.floor(Math.random() * 9);
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
  { env, stdio: ["ignore", "inherit", "inherit"], detached: true, cwd: "/home/user/magic-merger" },
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
const log = (s) => console.log(s);
const OUT = "docs/visual-checks";
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const failures = [];
const check = (name, ok, detail = "") => {
  log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
  if (!ok) failures.push(name);
};
const save = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("magic-merger.world2") ?? "";
    if (!raw.startsWith("gz:")) {
      const s = raw ? JSON.parse(raw) : null;
      return s ? { gz: false, w: s.w, seed: s.seed, land: s.land, chars: raw.length } : null;
    }
    return { gz: true, chars: raw.length };
  });
// The JSON inside a gzipped save, unpacked in the page.
const unpacked = (page) =>
  page.evaluate(async () => {
    const raw = localStorage.getItem("magic-merger.world2") ?? "";
    const bytes = Uint8Array.from(atob(raw.slice(3)), (c) => c.charCodeAt(0));
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    const s = JSON.parse(text);
    return { w: s.w, seed: s.seed, land: s.land, chars: text.length };
  });
async function openWorld(page) {
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".chip-inventory", { timeout: 20000 });
  for (let i = 0; i < 3 && (await page.locator("dialog[open]").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await page.click('.tab[data-view="world-view"]');
  await page.waitForTimeout(4000);
}
async function waitSave(page, test, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const s = await save(page);
    if (s && test(s)) return s;
    if (Date.now() - t0 > ms) return s;
    await page.waitForTimeout(1000);
  }
}
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => log(`page error: ${err.message}`));
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("magic-merger.token", t);
    } catch {
      // the sandboxed frames have no storage
    }
  }, ADMIN);
  await openWorld(page);
  // 1. The dialog: no huge or giant island without headroom.
  await page.click("#world-reset");
  await page.waitForSelector("dialog.reset-island[open]");
  const disabled = await page.$$eval("dialog.reset-island select:first-of-type option", (o) => o.filter((x) => x.disabled).map((x) => x.value));
  check("no huge or giant island without headroom", disabled.join() === "huge,giant", `disabled: ${disabled.join(", ")}`);
  await page.screenshot({ path: `${OUT}/reset-dialog.jpg` });
  // 2. A desert island of lakes from seed 42.
  const selects = page.locator("dialog.reset-island select");
  await selects.nth(1).selectOption("desert");
  await selects.nth(2).selectOption("lakes");
  await page.fill("dialog.reset-island input[type=text]", "42");
  await page.click("dialog.reset-island .primary");
  const s1 = await waitSave(page, (s) => s.land?.biome === "desert");
  check("the new island is a desert of lakes from seed 42", s1?.land?.biome === "desert" && s1?.land?.shape === "lakes" && s1?.seed === 42, JSON.stringify(s1));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/desert-lakes-phone.jpg` });
  // 3. Loaded again.
  await openWorld(page);
  const s2 = await waitSave(page, (s) => s.seed === 42, 20000);
  check("the desert island comes back after a reload", s2?.seed === 42 && s2?.land?.biome === "desert", JSON.stringify(s2));
  // 4. Headroom as a fast computer would report it: giant is offered, kept gzipped, loaded again.
  await page.evaluate(() => localStorage.setItem("magic-merger.headroom", JSON.stringify({ w: 208, simP95: 3, frameP95: 20, frames: 600 })));
  await page.click("#world-reset");
  await page.waitForSelector("dialog.reset-island[open]");
  const disabled2 = await page.$$eval("dialog.reset-island select:first-of-type option", (o) => o.filter((x) => x.disabled).map((x) => x.value));
  const chosen = await page.$eval("dialog.reset-island select", (s) => s.value);
  check("with headroom every size is offered, none chosen by default", disabled2.length === 0 && chosen !== "huge" && chosen !== "giant", `default ${chosen}`);
  await page.locator("dialog.reset-island select").first().selectOption("giant");
  await page.locator("dialog.reset-island select").nth(1).selectOption("tundra");
  await page.click("dialog.reset-island .primary");
  const s3 = await waitSave(page, (s) => s.gz === true, 60000);
  const inside = s3?.gz ? await unpacked(page) : null;
  check(
    "a giant island is kept gzipped",
    !!inside && inside.w === 384 && inside.land?.biome === "tundra",
    `${s3?.chars} characters stored for ${inside?.chars} of JSON`,
  );
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/giant-tundra-phone.jpg` });
  await openWorld(page);
  await page.waitForTimeout(6000);
  const s4 = await save(page);
  const back = s4?.gz ? await unpacked(page) : null;
  check("the giant island comes back after a reload", back?.w === 384 && back?.seed === inside?.seed, JSON.stringify(back));
  await ctx.close();
} finally {
  await browser.close();
  stub.close();
  try {
    process.kill(-dev.pid);
  } catch {
    // gone
  }
  rmSync(STATE, { recursive: true, force: true });
}
log(failures.length ? `${failures.length} failed` : "all checks passed");
process.exit(failures.length ? 1 : 0);
