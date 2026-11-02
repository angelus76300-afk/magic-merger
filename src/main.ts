import "./style.css";
import * as api from "./api";
import { setCardActions } from "./card";
import { Craft } from "./craft";
import { session } from "./session";
import { Store } from "./store";
import { toast } from "./toast";
import { WorldHost } from "./worldhost";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const store = new Store();
const craft = new Craft(
  store,
  $("#board"),
  $("#inventory"),
  $("#inventory-list"),
  $<HTMLInputElement>("#search"),
  $("#count"),
);
craft.init();
$("#clear").addEventListener("click", () => craft.clearBoard());

const world = new WorldHost(store, {
  stage: $("#world-stage"),
  banner: $("#world-banner"),
  challenges: $<HTMLButtonElement>("#world-challenges"),
  status: $("#world-status"),
  list: $("#spell-list"),
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
}

for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  tab.addEventListener("click", () => showTab(tab.dataset.view!));
}

world.init();


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
  $("#admin-badge").hidden = !session.admin;
}
void refreshSession();

// Five quick taps on the title ask for a token: the way in for the admin.
let taps: number[] = [];
$(".title").addEventListener("click", () => {
  const now = Date.now();
  taps = [...taps.filter((t) => now - t < 3000), now];
  if (taps.length < 5) return;
  taps = [];
  const token = window.prompt("Admin or access token:");
  if (!token) return;
  api.setToken(token);
  void refreshSession().then(() => toast(session.admin ? "Admin mode on" : "Token saved"));
});
