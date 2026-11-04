import "./style.css";
import * as api from "./api";
import { setCardActions } from "./card";
import { Craft } from "./craft";
import { session } from "./session";
import { Store } from "./store";
import { toast } from "./toast";
import { WorldHost } from "./worldhost";
import { openPeople } from "./people";
import { showFeedback } from "./feedback";
import { Challenges } from "./challenges";
import { openBook } from "./book";
import { hideGate, showGate, showWelcome, welcomedBefore } from "./welcome";
import { claimLink, offerAccount, offeredBefore, openAccount, setSignedIn, signIn } from "./account";
import { Sync } from "./sync";

// An invite link (/#invite=...) is kept by this browser before anything else;
// a sign in link by email (/#signin=...) is used once, below.
const fromLink = api.captureInvite();
const signInToken = api.captureSignIn();
api.setLockedOut(showGate);

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const store = new Store();
const craft = new Craft(store, $("#board"), $("#inventory"), $("#inventory-list"), $<HTMLInputElement>("#search"), $("#count"), $("#inventory-filters"));
craft.init();
$("#clear").addEventListener("click", () => craft.clearBoard());
$("#book").addEventListener("click", () => openBook(store));

const world = new WorldHost(store, {
  stage: $("#world-stage"),
  banner: $("#world-banner"),
  challenges: $<HTMLButtonElement>("#world-challenges"),
  chronicle: $<HTMLButtonElement>("#world-chronicle"),
  status: $("#world-status"),
  list: $("#spell-list"),
  bar: $(".spellbar"),
  tools: $("#spell-tools"),
  add: $<HTMLButtonElement>("#world-add"),
  reset: $<HTMLButtonElement>("#world-reset"),
  size: $<HTMLSelectElement>("#world-size"),
  sound: $<HTMLButtonElement>("#world-sound"),
});

const challenges = new Challenges($("#challenges-view"), store, world);
// Another tab of this browser found something (4.0 review M6): shown here too.
store.listen(() => {
  craft.refresh();
  world.renderSpells();
});
// 4.0: the account's progress follows this device while signed in.
const sync = new Sync(store);
world.onSaved = () => sync.islandSaved();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) sync.flush();
});

function showTab(view: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === view));
  }
  for (const section of document.querySelectorAll<HTMLElement>(".view")) {
    section.hidden = section.id !== view;
  }
  // The world only runs while it is on screen, to spare phone batteries.
  if (view === "world-view") world.show();
  else world.hide();
  if (view === "feedback-view") showFeedback();
  if (view === "challenges-view") void challenges.show();
}

world.onChallenges = () => showTab("challenges-view");
challenges.showWorld = () => showTab("world-view");

// The admin badge opens the people view: invites, spend per person, the month.
$("#admin-badge").addEventListener("click", () => {
  const badge = $("#admin-badge");
  openPeople(badge.title);
  void showSpend(badge);
});

// The ? button: the welcome again, with the privacy note and this month's
// magic; signed in, the account page is one tap further.
$("#help").addEventListener("click", () => void api.health().then((h) => showWelcome(h, h?.account?.signedIn ? openAccount : null)));

for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  tab.addEventListener("click", () => showTab(tab.dataset.view!));
}

world.init();
// New discoveries: the Worker writes their program from the merge (4.2);
// this page asks for it at once, and tests it as soon as it arrives.
craft.onNewElement = (key, writing) => world.ahead(key, writing);
// What a challenge's board finds joins the main inventory (3.7).
challenges.onDiscovered = (key, writing) => {
  craft.refresh();
  world.ahead(key, writing);
};

setCardActions({
  cast: (key) => {
    showTab("world-view");
    world.selectSpell(key);
  },
  regenerateSpell: async (key) => {
    await world.prepare(key, true);
  },
});

// Signed in (a passkey, a link): the server's progress joins this device's,
// and the page starts again from what it holds now.
setSignedIn(async () => {
  const got = await sync.start();
  if (got.discoveries) toast(`${got.discoveries} discoveries came from your other devices`);
  if (got.island === "replaced") toast("Your island from another device is loading…");
  window.setTimeout(() => location.reload(), 900);
});

async function refreshSession(): Promise<void> {
  // A sign in link by email, or an admin's new link for an account that
  // exists: used once, then this device is signed in.
  if (signInToken) {
    if (await claimLink("email", signInToken)) return;
  }
  const status = await api.health();
  session.mock = status?.mock ?? false;
  session.admin = status?.admin ?? false;
  $("#mock-badge").hidden = !session.mock;
  const badge = $("#admin-badge");
  badge.hidden = !session.admin;
  if (session.admin) void showSpend(badge);
  if (!status) return;
  if (status.account?.claimed && !status.account.signedIn && !status.invited) {
    if (await claimLink("link")) return;
  }
  if (!status.invited) {
    showGate("invite", "", { signIn, emailLink: status.email ? (email) => api.account.emailLink(email) : null });
    return;
  }
  if (document.getElementById("gate") && !document.getElementById("gate")!.hidden) {
    hideGate();
    showTab("craft-view");
  }
  if (status.account?.signedIn) {
    const got = await sync.start();
    if (got.discoveries) toast(`${got.discoveries} discoveries came from your other devices`);
    if (got.island === "replaced") {
      toast("Your island from another device is loading…");
      window.setTimeout(() => location.reload(), 900);
      return;
    }
  }
  // A friend playing with a link is offered an account, once: after the
  // welcome for a new player, at once for one who has played before.
  const offer = status.account && !status.account.claimed && !status.account.signedIn && !offeredBefore() ? () => offerAccount(status) : null;
  // A new player, or anyone opening a fresh link, reads what the game is first.
  if (!session.admin && (fromLink || !welcomedBefore())) {
    const welcome = showWelcome(status, status.account?.signedIn ? openAccount : null);
    if (offer) welcome.addEventListener("close", offer, { once: true });
  } else offer?.();
}

// The admin badge shows what Claude cost this month, and the detail on tap.
async function showSpend(badge: HTMLElement): Promise<void> {
  const spend = await api.spend();
  if (!spend) return;
  badge.textContent = `admin $${spend.month.toFixed(2)}`;
  badge.title = spend.calls.map((c) => `${c.call} ${c.model.replace("claude-", "")}: ${c.n} calls, $${c.usd.toFixed(3)}`).join("\n");
}
void refreshSession();

// A long press on the title shows the frame HUD in the World (and sends its
// numbers to the Worker every 30 seconds while it is on).
let pressTimer = 0;
let longPressed = false;
const title = $(".title");
title.addEventListener("pointerdown", () => {
  longPressed = false;
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    longPressed = true;
    const on = world.toggleHud();
    toast(on ? "Frame HUD on: open the World tab" : "Frame HUD off");
  }, 700);
});
for (const type of ["pointerup", "pointercancel", "pointerleave"]) title.addEventListener(type, () => clearTimeout(pressTimer));
title.addEventListener("contextmenu", (e) => e.preventDefault());

// Five quick taps on the title ask for a token: the way in for the admin.
let taps: number[] = [];
title.addEventListener("click", () => {
  if (longPressed) return;
  const now = Date.now();
  taps = [...taps.filter((t) => now - t < 3000), now];
  if (taps.length < 5) return;
  taps = [];
  const token = window.prompt("Admin token:");
  if (!token) return;
  api.setToken(token);
  void refreshSession().then(() => toast(session.admin ? "Admin mode on" : "That is not the admin token"));
});
