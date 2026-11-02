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
import { hideGate, showGate, showWelcome, welcomedBefore } from "./welcome";

// An invite link (/#invite=...) is kept by this browser before anything else.
const fromLink = api.captureInvite();
api.setLockedOut(showGate);

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const store = new Store();
const craft = new Craft(store, $("#board"), $("#inventory"), $("#inventory-list"), $<HTMLInputElement>("#search"), $("#count"), $("#inventory-filters"));
craft.init();
$("#clear").addEventListener("click", () => craft.clearBoard());

const world = new WorldHost(store, {
  stage: $("#world-stage"),
  banner: $("#world-banner"),
  challenges: $<HTMLButtonElement>("#world-challenges"),
  status: $("#world-status"),
  list: $("#spell-list"),
  bar: $(".spellbar"),
  tools: $("#spell-tools"),
  add: $<HTMLButtonElement>("#world-add"),
  reset: $<HTMLButtonElement>("#world-reset"),
  size: $<HTMLSelectElement>("#world-size"),
  sound: $<HTMLButtonElement>("#world-sound"),
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
}

// The admin badge opens the people view: invites, spend per person, the month.
$("#admin-badge").addEventListener("click", () => {
  const badge = $("#admin-badge");
  openPeople(badge.title);
  void showSpend(badge);
});

// The ? button: the welcome again, with the privacy note and this month's magic.
$("#help").addEventListener("click", () => void api.health().then(showWelcome));

for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  tab.addEventListener("click", () => showTab(tab.dataset.view!));
}

world.init();
// New discoveries get their program written in the background (cheap tiers only).
craft.onNewElement = (key) => world.ahead(key);

setCardActions({
  cast: (key) => {
    showTab("world-view");
    world.selectSpell(key);
  },
  regenerateSpell: async (key) => {
    await world.prepare(key, true);
  },
});

async function refreshSession(): Promise<void> {
  const status = await api.health();
  session.mock = status?.mock ?? false;
  session.admin = status?.admin ?? false;
  $("#mock-badge").hidden = !session.mock;
  const badge = $("#admin-badge");
  badge.hidden = !session.admin;
  if (session.admin) void showSpend(badge);
  if (!status) return;
  if (!status.invited) {
    showGate("invite", "");
    return;
  }
  if (document.getElementById("gate") && !document.getElementById("gate")!.hidden) {
    hideGate();
    showTab("craft-view");
  }
  // A new player, or anyone opening a fresh link, reads what the game is first.
  if (!session.admin && (fromLink || !welcomedBefore())) showWelcome(status);
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
