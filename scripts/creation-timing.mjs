// 4.2: how long a new item takes from the drop to its first cast, step by
// step, in a phone sized headless browser against a deployed Worker (a
// preview version or the live site). Real merges with a throwaway invite
// (capped, revoked at the end), so it costs what a player's merges cost.
//
//   MM_URL=<worker url> MM_TOKEN=<ADMIN_TOKEN> node scripts/creation-timing.mjs plan.json out-dir [cpu=4] [label=before]
//
// plan.json: { "elements": [GameElement…], "pairs": [["A", "B"], …] }. The
// elements are given to the fresh browser as already discovered (the inputs
// of the pairs); each pair is merged on the board by dragging one chip onto
// the other, as a player does, one after the other without waiting. Then the
// World opens; every item the merges gave is selected in turn once it is
// ready, and cast on the island. The page's own timeline (src/timeline.ts)
// says when each step happened; the Worker's Server-Timing says what it spent.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");

const [planPath, out, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => a.split("=")));
const URL_ = process.env.MM_URL;
const TOKEN = process.env.MM_TOKEN;
if (!planPath || !out || !URL_ || !TOKEN) {
  console.error("usage: MM_URL=... MM_TOKEN=... node scripts/creation-timing.mjs plan.json out-dir [cpu=4] [label=x]");
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const cpu = Number(args.cpu ?? 1);
const label = args.label ?? "run";
mkdirSync(out, { recursive: true });
const log = [];
const say = (s) => {
  const line = `[${((Date.now() - T0) / 1000).toFixed(1)} s] ${s}`;
  log.push(line);
  console.log(line);
};
const T0 = Date.now();

async function admin(path, body) {
  const res = await fetch(new URL(path, URL_), {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-access-token": TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${data?.error ?? res.status}`);
  return data;
}

const invite = await admin("/api/admin/invites", { name: `Timing ${label}`, cap: Number(args.cap ?? 1) });
const secret = /invite=([A-Za-z0-9_-]+)/.exec(invite.link)[1];
say(`invite ${invite.id} created, cap $${invite.cap}`);

process.on("uncaughtException", async (err) => {
  console.error(err);
  await admin("/api/admin/invite", { id: invite.id, action: "revoke" }).catch(() => {});
  process.exit(1);
});
process.on("unhandledRejection", async (err) => {
  console.error(err);
  await admin("/api/admin/invite", { id: invite.id, action: "revoke" }).catch(() => {});
  process.exit(1);
});
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const now = Date.now();
const discoveries = Object.fromEntries(
  plan.elements.map((e, i) => [e.name.toLowerCase().trim(), { element: e, discoveredAt: now - 1000 * (plan.elements.length - i), recipe: null }]),
);
await context.addInitScript(
  ([save]) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("magic-merger.welcomed", "1");
    localStorage.setItem("magic-merger.save", save);
  },
  [JSON.stringify({ version: 1, discoveries, descriptions: {}, spells: {}, board: [], nextChipId: 1 })],
);
const page = await context.newPage();
if (cpu > 1) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  say(`CPU throttled ${cpu}x`);
}
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") say(`console ${m.type()}: ${m.text().slice(0, 200)}`);
});
await page.goto(new URL(`/#invite=${secret}`, URL_).toString());
await page.waitForSelector("#inventory-list .chip-inventory");
// A link opens the welcome: start playing, as a player does.
await page
  .locator("dialog.welcome .welcome-start")
  .click({ timeout: 5000 })
  .catch(() => {});
// Then the one time "save your progress" offer: not now.
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
say("page ready");

// A first discovery opens its card; the player closes it and goes on.
const closeDialogs = () => page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));

async function spawn(name) {
  await closeDialogs();
  await page.fill("#search", name);
  const item = page.locator("#inventory-list .chip-inventory", { has: page.locator(".chip-name", { hasText: new RegExp(`^${name}$`) }) }).first();
  await item.click();
  await page.fill("#search", "");
}

const made = [];
for (const [a, b] of plan.pairs) {
  await page.click("#clear").catch(() => {});
  await spawn(a);
  await spawn(b);
  const chips = page.locator("#board .chip-board");
  const first = await chips.nth(0).boundingBox();
  const second = await chips.nth(1).boundingBox();
  const t = Date.now();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 30, first.y + 30, { steps: 4 });
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll("#board .chip-board.merging").length === 0, null, { timeout: 60_000 });
  const result = await page.locator("#board .chip-board .chip-name").last().textContent();
  say(`merge ${a} + ${b} = ${result} in ${Date.now() - t} ms`);
  made.push(result);
}

await page.waitForTimeout(900);
await closeDialogs();
await page.click('.tab[data-view="world-view"]');
say("World opened");
const opened = Date.now();
const wanted = [...new Set(made)];
const readyAt = {};
const chipsOverTime = [];
// Every item made, selected once it is ready (or at once if it is never
// written ahead), then cast on the middle of the island.
const deadline = Date.now() + Number(args.wait ?? 300) * 1000;
const pending = new Set(wanted);
let selected = null;
while (pending.size && Date.now() < deadline) {
  const state = await page.evaluate(() =>
    [...document.querySelectorAll("#spell-list .chip")].map((c) => ({
      name: c.querySelector(".chip-name")?.textContent,
      ready: c.dataset.ready,
      state: c.dataset.state ?? null,
    })),
  );
  chipsOverTime.push({ s: Math.round((Date.now() - opened) / 1000), ready: state.filter((c) => c.ready === "1").length, of: state.length });
  for (const c of state) if (c.ready === "1" && readyAt[c.name] === undefined) readyAt[c.name] = Date.now() - opened;
  // A big item is only written once picked (before 4.2): pick the first not ready one.
  const next = wanted.find((n) => pending.has(n));
  if (next && selected !== next) {
    const found = await page.evaluate((n) => {
      const chip = [...document.querySelectorAll("#spell-list .chip")].find((c) => c.querySelector(".chip-name")?.textContent === n);
      chip?.scrollIntoView();
      chip?.click();
      return !!chip;
    }, next);
    if (!found) {
      say(`${next} is not in the spell bar: ${state.map((c) => c.name).join(", ")}`);
      pending.delete(next);
      continue;
    }
    selected = next;
  }
  if (selected && state.find((c) => c.name === selected)?.ready === "1") {
    const box = await page.locator(".world-frame").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    say(`cast ${selected}`);
    pending.delete(selected);
    selected = null;
    continue;
  }
  await page.waitForTimeout(500);
}
if (pending.size) say(`never ready: ${[...pending].join(", ")}`);
await page.waitForTimeout(1500);

const creation = await page.evaluate(() => window.__creation?.all() ?? []);
for (const c of creation) {
  const s = c.steps;
  say(
    `${c.name} [${c.kind} ${c.tier}]: ${["merged", "asked", "arrived", "tested", "verdict", "ready", "cast"].map((k) => `${k} ${s[k] ?? "-"}`).join(", ")}; test ${s.test ?? "-"} ms; server ${JSON.stringify(c.server)}; phases ${JSON.stringify(c.phases ?? {})}`,
  );
}
const spent = await admin("/api/admin/people")
  .then((p) => p.people?.find((x) => x.id === invite.id)?.spent ?? null)
  .catch(() => null);
say(`spent by the invite: ${spent}`);
await admin("/api/admin/invite", { id: invite.id, action: "revoke" }).catch((e) => say(`revoke failed: ${e.message}`));
say(`invite ${invite.id} revoked`);
await page.screenshot({ path: join(out, `${label}-world.jpg`), quality: 70, type: "jpeg" });
writeFileSync(join(out, `${label}.json`), JSON.stringify({ label, cpu, made, readyAt, chipsOverTime, creation, spent, invite: invite.id }, null, 1));
writeFileSync(join(out, `${label}.log`), log.join("\n") + "\n");
await browser.close();
