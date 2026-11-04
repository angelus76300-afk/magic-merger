// Accounts (4.0) end to end, in a phone sized headless browser with a virtual
// authenticator (CDP WebAuthn), against the real Worker under wrangler dev
// with a fresh local D1 and a stub Claude. What no Node test can check:
//   A. a friend opens their link, reads the welcome, makes a passkey: the
//      account is created, the link dies, progress goes up;
//   B. the same passkey on a second device signs in with no link: the
//      discoveries come down and the island from the first device loads;
//   C. one invite opened on two devices at once makes one account;
//   D. deleting the account from one device signs every device out.
// 4.4.6, reproduced first (the owner played as the admin on a computer and a
// phone and the progress was not kept):
//   E. the owner on a computer (the admin token) and a phone: one account,
//      the admin powers on both with no token, the same discoveries, a sync
//      status and "Sync now" in the ? menu, the newer island offered;
//   F. account B signs in on a phone that held account A's progress: B gets
//      nothing of A's, A's copy is set aside and comes back when A returns.
//
//   npm run build && node scripts/account-verify.mjs
import { createRequire } from "node:module";

// require, not import: it also finds a Playwright installed globally (NODE_PATH), as lab-browser.mjs does.
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN = "admin-account-verify";
const STATE = mkdtempSync(join(tmpdir(), "mm-accounts-"));
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
const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "magic-merger", "--local", "--persist-to", STATE], { env, encoding: "utf8" });
if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
const port = 9100 + Math.floor(Math.random() * 90);
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
  { env, stdio: ["ignore", "inherit", "inherit"], detached: true },
);
// Passkeys need a proper host name: localhost, not 127.0.0.1.
const BASE = `http://localhost:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {
    // not up yet
  }
  if (i > 120) throw new Error("wrangler dev did not start");
  await new Promise((r) => setTimeout(r, 500));
}

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}
async function admin(path, body) {
  const r = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-access-token": ADMIN },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
const secretOf = (link) => new URL(link).hash.replace("#invite=", "");

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

// A device: a context, its page and a virtual authenticator that always says yes.
async function device(kind = "iPhone 14") {
  const ctx = await browser.newContext({ ...devices[kind] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  page.on("pageerror", (e) => console.log(`  page error: ${e.message}`));
  const state = () =>
    page.evaluate(() => ({
      session: !!localStorage.getItem("magic-merger.session"),
      invite: !!localStorage.getItem("magic-merger.invite"),
      world: !!localStorage.getItem("magic-merger.world2"),
    }));
  const toasts = () =>
    page
      .locator("#toasts")
      .innerText()
      .then((t) => t.replace(/\s+/g, " "));
  const health = async () => {
    const token = await page.evaluate(() => localStorage.getItem("magic-merger.session"));
    return (await fetch(`${BASE}/api/health`, { headers: token ? { "x-session": token } : {} })).json();
  };
  return { ctx, page, cdp, authenticatorId, state, toasts, health };
}
async function closeDialogs(page) {
  for (let i = 0; i < 4 && (await page.locator("dialog[open]").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}
async function mergeFireWater(page) {
  await mergePair(page, "Fire", "Water");
}
async function mergePair(page, x, y) {
  await page.locator(".chip-inventory", { hasText: x }).first().click();
  await page.locator(".chip-inventory", { hasText: y }).first().click();
  const chips = page.locator(".chip-board");
  const a = await chips.nth(1).boundingBox();
  const b = await chips.nth(0).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 6, a.y + a.height / 2 + ((b.y - a.y) * i) / 6);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll(".chip-board.merging").length === 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await closeDialogs(page);
}

try {
  const inv = await admin("/api/admin/invites", { name: "Fay", cap: 5 });
  const link = inv.link;

  // A. The first device: the link, the welcome, the offer, a passkey.
  const A = await device();
  await A.page.goto(`${BASE}/#invite=${secretOf(link)}`);
  await A.page.waitForSelector("dialog.welcome[open]", { timeout: 20000 });
  await A.page.click("dialog.welcome .welcome-start");
  await A.page.waitForSelector("dialog.account-offer[open]", { timeout: 10000 });
  check("A: the welcome closes into the one time account offer", true);
  await A.page.click("dialog.account-offer .account-create");
  await A.page.waitForFunction(() => !!localStorage.getItem("magic-merger.session"), null, { timeout: 20000 });
  await A.page.waitForTimeout(2500);
  const sA = await A.state();
  const hA = await A.health();
  check(
    "A: a passkey made the account and replaced the link on this device",
    sA.session && !sA.invite && hA.account?.signedIn === true && hA.invite?.name === "Fay",
    JSON.stringify({ sA, account: hA.account }),
  );
  const linkDead = await fetch(`${BASE}/api/health`, { headers: { "x-invite": secretOf(link) } }).then((r) => r.json());
  check("A: the link stops working for anyone else", linkDead.invited === false && !linkDead.account, JSON.stringify(linkDead));
  await A.page.waitForSelector(".chip-inventory", { timeout: 20000 });
  await mergeFireWater(A.page);
  await A.page.waitForTimeout(7000);
  const tokenA = await A.page.evaluate(() => localStorage.getItem("magic-merger.session"));
  const progressA = await fetch(`${BASE}/api/progress`, { headers: { "x-session": tokenA } }).then((r) => r.json());
  const discA = progressA.progress.find((p) => p.kind === "discoveries");
  check(
    "A: the discoveries went up, the new one among them",
    discA && discA.data.length === 9 && discA.data.some((d) => d.key === "answer 1"),
    JSON.stringify(discA?.data?.map((d) => d.key)),
  );
  // The World, so an island exists; it goes up a minute after its first save.
  await A.page.click('.tab[data-view="world-view"]');
  await A.page.waitForTimeout(12000);
  await A.page.click('.tab[data-view="craft-view"]');
  await A.page.waitForTimeout(65000);
  const progressA2 = await fetch(`${BASE}/api/progress`, { headers: { "x-session": tokenA } }).then((r) => r.json());
  const islandA = progressA2.progress.find((p) => p.kind === "island");
  check(
    "A: the island went up, packed",
    !!islandA && typeof islandA.data.gz === "string" && islandA.data.size === "small",
    `${islandA?.data?.gz?.length ?? 0} chars of gzip`,
  );

  // B. A second device with the same passkey (the credential copied over,
  // as a synced passkey would be), no link: sign in from the gate.
  const B = await device();
  const { credentials } = await A.cdp.send("WebAuthn.getCredentials", { authenticatorId: A.authenticatorId });
  await B.cdp.send("WebAuthn.addCredential", { authenticatorId: B.authenticatorId, credential: credentials[0] });
  await B.page.goto(`${BASE}/`);
  await B.page.waitForSelector("#gate .gate-passkey", { timeout: 20000 });
  check("B: without a link, the gate offers a passkey sign in", true);
  await B.page.click("#gate .gate-passkey");
  await B.page.waitForFunction(() => !!localStorage.getItem("magic-merger.session"), null, { timeout: 20000 });
  await B.page.waitForTimeout(3000);
  await B.page.waitForSelector(".chip-inventory", { timeout: 20000 });
  const sB = await B.state();
  const invB = await B.page.locator(".chip-inventory").count();
  check("B: signed in, the discoveries and the island came down", sB.session && sB.world && invB === 9, JSON.stringify({ sB, invB }));
  const hB = await B.health();
  check("B: plays as the same account", hB.invite?.name === "Fay" && hB.account?.signedIn === true);
  const infoB = await fetch(`${BASE}/api/account`, {
    headers: { "x-session": await B.page.evaluate(() => localStorage.getItem("magic-merger.session")) },
  }).then((r) => r.json());
  check(
    "B: the account page lists two devices and one passkey",
    infoB.devices.length === 2 && infoB.passkeys.length === 1,
    JSON.stringify({ devices: infoB.devices.length, passkeys: infoB.passkeys.length }),
  );

  // C. One invite, two devices at once: one account.
  const inv2 = await admin("/api/admin/invites", { name: "Gus", cap: 5 });
  const C1 = await device();
  const C2 = await device();
  for (const C of [C1, C2]) {
    await C.page.goto(`${BASE}/#invite=${secretOf(inv2.link)}`);
    await C.page.waitForSelector("dialog.welcome[open]", { timeout: 20000 });
    await C.page.click("dialog.welcome .welcome-start");
    await C.page.waitForSelector("dialog.account-offer[open]", { timeout: 10000 });
  }
  await Promise.all([C1, C2].map((C) => C.page.click("dialog.account-offer .account-create")));
  await C1.page.waitForTimeout(6000);
  const states = await Promise.all([C1.state(), C2.state()]);
  const toastsC = await Promise.all([C1.toasts(), C2.toasts()]);
  const signed = states.filter((s) => s.session).length;
  const left = states.filter((s) => !s.session && s.invite).length;
  check("C: the same link opened on two devices at once makes one account", signed === 1 && left === 1, JSON.stringify({ states, toastsC }));

  // D. Deleting the account from B signs A out too, and the data is gone.
  await closeDialogs(B.page);
  await B.page.click("#help");
  await B.page.waitForSelector("dialog.welcome[open]");
  await B.page.click("dialog.welcome .welcome-account");
  await B.page.waitForSelector("dialog.account[open]", { timeout: 10000 });
  B.page.once("dialog", (d) => d.accept("Fay"));
  await B.page.click("dialog.account .account-delete");
  await B.page.waitForTimeout(3000);
  const hA2 = await A.health();
  const hB2 = await B.health();
  const tokenAfter = await fetch(`${BASE}/api/progress`, { headers: { "x-session": tokenA } });
  check(
    "D: after deletion no device is signed in and the progress is gone",
    hA2.invited === false && hB2.invited === false && tokenAfter.status === 401,
    JSON.stringify({ a: hA2.invited, b: hB2.invited, progress: tokenAfter.status }),
  );
  const people = await admin("/api/admin/people");
  check(
    "D: the admin sees the account as deleted, with its spend kept",
    people.people.find((p) => p.id === inv.id)?.deletedAt > 0 && people.people.find((p) => p.id === inv.id)?.spent > 0,
  );

  // 4.4.6. Helpers that use the new ? menu when it exists, and the 4.0 way
  // otherwise, so that on the code before the fix each check fails on what
  // it checks, not on a missing button.
  const progressOf = async (token) => (await fetch(`${BASE}/api/progress`, { headers: { "x-session": token } }).then((r) => r.json())).progress ?? [];
  const keysOf = (docs) => (docs.find((p) => p.kind === "discoveries")?.data ?? []).map((d) => d.key);
  const tokenOf = (D) => D.page.evaluate(() => localStorage.getItem("magic-merger.session"));
  const inventory = async (D) => {
    await D.page.waitForSelector(".chip-inventory", { timeout: 20000 });
    return D.page.locator(".chip-inventory").count();
  };
  async function openMenu(D) {
    await closeDialogs(D.page);
    await D.page.click("#help");
    await D.page.waitForSelector("dialog[open]", { timeout: 5000 });
    return (await D.page.locator("dialog.menu[open]").count()) > 0;
  }
  async function menuText(D) {
    if (!(await openMenu(D))) return "";
    return (await D.page.locator("dialog.menu[open]").innerText()).replace(/\s+/g, " ");
  }
  async function syncNow(D) {
    if (!(await openMenu(D))) return false;
    await D.page.click("dialog.menu .menu-syncnow");
    await D.page.waitForTimeout(3000);
    return true;
  }
  async function signOut(D, choice) {
    if (await openMenu(D)) {
      await D.page.click("dialog.menu .menu-signout");
      await D.page.waitForSelector("dialog.signout[open]", { timeout: 5000 });
      const focused = await D.page.evaluate(() => document.activeElement?.className ?? "");
      await D.page.click(`dialog.signout .signout-${choice}`);
      await D.page.waitForTimeout(3000);
      return { asked: true, focused };
    }
    // 4.0: the account page's "Sign out here", which keeps everything.
    await D.page.click("dialog.welcome .welcome-account");
    await D.page.waitForSelector("dialog.account[open]", { timeout: 10000 });
    await D.page.click("dialog.account .account-logout");
    await D.page.waitForTimeout(3000);
    return { asked: false, focused: "" };
  }
  async function signInAs(D, credential) {
    await D.cdp.send("WebAuthn.clearCredentials", { authenticatorId: D.authenticatorId });
    await D.cdp.send("WebAuthn.addCredential", { authenticatorId: D.authenticatorId, credential });
    await D.page.waitForSelector("#gate .gate-passkey", { timeout: 20000 });
    await D.page.click("#gate .gate-passkey");
    await D.page.waitForFunction(() => !!localStorage.getItem("magic-merger.session"), null, { timeout: 20000 });
    await D.page.waitForTimeout(4000);
    // A save from before any account is offered once; these devices have none.
    await closeDialogs(D.page);
  }
  async function makeAccount(name) {
    const made = await admin("/api/admin/invites", { name, cap: 5 });
    const D = await device();
    await D.page.goto(`${BASE}/#invite=${secretOf(made.link)}`);
    await D.page.waitForSelector("dialog.welcome[open]", { timeout: 20000 });
    await D.page.click("dialog.welcome .welcome-start");
    await D.page.waitForSelector("dialog.account-offer[open]", { timeout: 10000 });
    await D.page.click("dialog.account-offer .account-create");
    await D.page.waitForFunction(() => !!localStorage.getItem("magic-merger.session"), null, { timeout: 20000 });
    await D.page.waitForTimeout(2500);
    const { credentials } = await D.cdp.send("WebAuthn.getCredentials", { authenticatorId: D.authenticatorId });
    return { D, id: made.id, link: made.link, credential: credentials[0] };
  }

  // E. The owner on a computer and a phone.
  const PC = await device("Desktop Chrome");
  await PC.page.goto(`${BASE}/`);
  await PC.page.waitForSelector("#gate .gate-passkey", { timeout: 20000 });
  // Five taps on the title, and the token, as the owner does today.
  PC.page.once("dialog", (d) => d.accept(ADMIN));
  for (let i = 0; i < 5; i++) await PC.page.click(".title");
  await PC.page.waitForTimeout(2500);
  const offered = await PC.page
    .waitForSelector("dialog.account-offer[open]", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check("E: the admin token is offered the owner's account", offered);
  if (offered) {
    await PC.page.click("dialog.account-offer .account-create");
    await PC.page.waitForFunction(() => !!localStorage.getItem("magic-merger.session"), null, { timeout: 20000 });
    await PC.page.waitForTimeout(4000);
  }
  const pcToken = await tokenOf(PC);
  const hPC = await PC.health();
  check(
    "E: the computer is signed in to the owner's account, admin with no token kept",
    !!pcToken && hPC.admin === true && hPC.account?.id === "admin" && !(await PC.page.evaluate(() => localStorage.getItem("magic-merger.token"))),
    JSON.stringify({ session: !!pcToken, admin: hPC.admin, account: hPC.account }),
  );
  await closeDialogs(PC.page);
  await mergeFireWater(PC.page);
  await PC.page.click('.tab[data-view="world-view"]');
  await PC.page.waitForTimeout(12000);
  await PC.page.click('.tab[data-view="craft-view"]');
  const syncedPC = await syncNow(PC);
  await PC.page.waitForTimeout(6000);
  const PH = await device();
  const { credentials: ownerCreds } = await PC.cdp.send("WebAuthn.getCredentials", { authenticatorId: PC.authenticatorId });
  await PH.page.goto(`${BASE}/`);
  if (ownerCreds[0]) await signInAs(PH, ownerCreds[0]);
  else {
    // The bug as the owner met it: the token typed again on the phone.
    PH.page.once("dialog", (d) => d.accept(ADMIN));
    await PH.page.waitForSelector(".title");
    for (let i = 0; i < 5; i++) await PH.page.click(".title");
    await PH.page.waitForTimeout(3000);
    await closeDialogs(PH.page);
  }
  const hPH = await PH.health();
  const phoneHas = await inventory(PH);
  check(
    "E: the phone signs in with the passkey: admin, no token, the computer's discoveries",
    hPH.admin === true && phoneHas === 9 && (await PH.page.locator("#admin-badge").isVisible()),
    JSON.stringify({ admin: hPH.admin, inventory: phoneHas }),
  );
  check("E: and the computer's island", await PH.page.evaluate(() => !!localStorage.getItem("magic-merger.world2")));
  // The phone finds something; "Sync now" on the computer brings it.
  await mergePair(PH.page, "Earth", "Air");
  await PH.page.waitForTimeout(7000);
  const shownSync = await syncNow(PC);
  const pcHas = await inventory(PC);
  check('E: "Sync now" on the computer brings what the phone found', shownSync && syncedPC && pcHas === 10, `${pcHas} items on the computer`);
  const text = await menuText(PC);
  check(
    "E: the ? menu says who is signed in and when the account was last saved",
    /Signed in as admin/i.test(text) && /Saved to your account/i.test(text),
    text.slice(0, 200),
  );
  // The newer island from another device is offered, never lost.
  await closeDialogs(PC.page);
  await PC.page.click('.tab[data-view="world-view"]');
  await PH.page.click('.tab[data-view="world-view"]');
  await PH.page.waitForTimeout(12000);
  await PC.page.waitForTimeout(1000);
  await PC.page.click('.tab[data-view="craft-view"]');
  await PH.page.click('.tab[data-view="craft-view"]');
  await syncNow(PC);
  await PC.page.waitForTimeout(3000);
  let choice = false;
  if (await openMenu(PH)) {
    await PH.page.click("dialog.menu .menu-syncnow");
    choice = await PH.page
      .waitForSelector("dialog.island-choice[open]", { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
  }
  const choiceText = choice ? (await PH.page.locator("dialog.island-choice[open]").innerText()).replace(/\s+/g, " ") : "";
  if (choice) {
    await PH.page.click("dialog.island-choice .choice-this");
    await PH.page.waitForTimeout(4000);
  }
  const prevIsland = await fetch(`${BASE}/api/progress?kind=island_previous`, { headers: { "x-session": await tokenOf(PH) } })
    .then((r) => r.json())
    .catch(() => ({}));
  const nowIsland = (await progressOf(await tokenOf(PH))).find((p) => p.kind === "island");
  check(
    "E: a newer island from the computer is offered next to the phone's, and the one not kept stays on the account",
    choice &&
      /Windows/.test(choiceText) &&
      nowIsland?.device === "iPhone" &&
      prevIsland.progress?.some((p) => p.kind === "island_previous" && p.device?.startsWith("Windows")),
    JSON.stringify({ choice, choiceText: choiceText.slice(0, 120), now: nowIsland?.device, prev: prevIsland.progress?.map((p) => p.device) }),
  );

  // F. Account B signs in on a phone that held account A's progress.
  const ann = await makeAccount("Ann");
  const ben = await makeAccount("Ben");
  await closeDialogs(ann.D.page);
  await mergeFireWater(ann.D.page);
  await ann.D.page.click('.tab[data-view="world-view"]');
  await ann.D.page.waitForTimeout(12000);
  await ann.D.page.click('.tab[data-view="craft-view"]');
  await syncNow(ann.D);
  await ann.D.page.waitForTimeout(7000);
  const annToken = await tokenOf(ann.D);
  const annKeys = keysOf(await progressOf(annToken));
  const PRIMAL = ["fire", "water", "earth", "air", "light", "shadow", "life", "arcane"];
  const annFound = annKeys.filter((k) => !PRIMAL.includes(k));
  const out1 = await signOut(ann.D, "keep");
  check("F: signing out asks to keep a copy or remove it, remove by default", out1.asked && /signout-remove/.test(out1.focused), JSON.stringify(out1));
  await signInAs(ann.D, ben.credential);
  const benToken = await tokenOf(ann.D);
  const benDocs = await progressOf(benToken);
  const benOnAnnPhone = await inventory(ann.D);
  check(
    "F: B signed in on A's phone gets nothing of A's, here or on B's account",
    annFound.length > 0 && !keysOf(benDocs).some((k) => annFound.includes(k)) && !benDocs.some((p) => p.kind === "island") && benOnAnnPhone === 8,
    JSON.stringify({ ann: annKeys, ben: keysOf(benDocs), benIsland: benDocs.some((p) => p.kind === "island"), inventory: benOnAnnPhone }),
  );
  // Switch back to A from the menu: B's copy is removed (the default), A's comes back.
  let switched = false;
  if (await openMenu(ann.D)) {
    await ann.D.cdp.send("WebAuthn.clearCredentials", { authenticatorId: ann.D.authenticatorId });
    await ann.D.cdp.send("WebAuthn.addCredential", { authenticatorId: ann.D.authenticatorId, credential: ann.credential });
    await ann.D.page.click("dialog.menu .menu-switch");
    await ann.D.page.waitForSelector("dialog.signout[open]", { timeout: 5000 });
    await ann.D.page.click("dialog.signout .signout-remove");
    await ann.D.page.waitForFunction(() => !!localStorage.getItem("magic-merger.session"), null, { timeout: 20000 }).catch(() => undefined);
    await ann.D.page.waitForTimeout(5000);
    await closeDialogs(ann.D.page);
    switched = true;
  }
  const hBack = await ann.D.health();
  const backHas = switched ? await inventory(ann.D) : 0;
  const island = await ann.D.page.evaluate(() => !!localStorage.getItem("magic-merger.world2"));
  check(
    "F: \"Switch account\" back to A brings A's copy back, island included, and B's is gone",
    switched && hBack.invite?.name === "Ann" && backHas === 9 && island,
    JSON.stringify({ switched, who: hBack.invite?.name, inventory: backHas, island }),
  );
  // Sign out with the default: nothing of A's stays on the phone.
  const out2 = await signOut(ann.D, "remove");
  const trace = await ann.D.page.evaluate(() => ({
    save: localStorage.getItem("magic-merger.save"),
    world: !!localStorage.getItem("magic-merger.world2"),
  }));
  const traceKeys = trace.save ? Object.keys(JSON.parse(trace.save).discoveries ?? {}) : [];
  check(
    "F: signing out with the default leaves no trace of A on the phone",
    out2.asked && !trace.world && traceKeys.length <= 8,
    JSON.stringify({ asked: out2.asked, world: trace.world, keys: traceKeys.length }),
  );
  // A device with a link still offers "Sign in" from the ? menu.
  const withLink = await device();
  const carl = await admin("/api/admin/invites", { name: "Carl", cap: 5 });
  await withLink.page.goto(`${BASE}/#invite=${secretOf(carl.link)}`);
  await withLink.page.waitForSelector("dialog.welcome[open]", { timeout: 20000 });
  await withLink.page.click("dialog.welcome .welcome-start");
  await closeDialogs(withLink.page);
  const linkMenu = (await openMenu(withLink)) && (await withLink.page.locator("dialog.menu .menu-signin").isVisible());
  check('F: on a device with a link, "Sign in" is in the ? menu', linkMenu);
} catch (err) {
  failed++;
  console.log(`FAIL ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
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
console.log(failed ? `${failed} account checks failed` : "all account checks passed");
process.exit(failed ? 1 : 0);
