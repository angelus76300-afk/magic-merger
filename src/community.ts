import * as api from "./api";
import { lastPlayedLabel, type CommunityResponse, type Friend } from "../shared/community";
import { elementKey } from "../shared/elements";
import { TIER_LABEL, TIERS } from "../shared/tiers";
import type { Store } from "./store";
import { toast } from "./toast";

// 4.5, the Community tab: who plays, when they last played, how many items
// they found, their First Discoveries and daily finds, and the favorite
// spell each one picked. No recipe anywhere, so nobody is handed an idea.
// The player's own favorite and the switch that hides them are here and on
// the account page (the same controls).

const el = (tag: string, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

let shared: Store | null = null;

export class Community {
  private data: CommunityResponse | null = null;

  constructor(
    private root: HTMLElement,
    store: Store,
  ) {
    shared = store;
  }

  async show(): Promise<void> {
    if (!this.data) this.root.innerHTML = `<p class="community-empty">Loading who plays...</p>`;
    try {
      this.data = await api.community();
      this.render(this.data);
    } catch (err) {
      if (!this.data) this.root.innerHTML = `<p class="community-empty">${err instanceof Error ? err.message : "The community could not be loaded."}</p>`;
    }
  }

  private render(data: CommunityResponse): void {
    this.root.textContent = "";
    const head = el("div", "community-head");
    head.append(
      el("h2", "", "Community"),
      el("p", "", "Who plays Magic Merger, and the spell each one loves most. Recipes stay secret: what they found is theirs to tell."),
    );
    this.root.append(head);
    const list = el("div", "community-list");
    for (const f of data.friends) list.append(friendCard(f));
    if (!data.friends.length) list.append(el("p", "community-empty", "Nobody here yet."));
    this.root.append(list);
    const mine = el("section", "community-mine");
    mine.append(el("h3", "", "You"));
    mine.append(profileControls(data.me, () => void this.show()));
    this.root.append(mine);
  }
}

function friendCard(f: Friend): HTMLElement {
  const card = el("article", `friend${f.me ? " friend-me" : ""}`);
  const head = el("div", "friend-head");
  head.append(el("h4", "friend-name", f.me ? `${f.name} (you)` : f.name));
  // The owner's play with the admin token is not counted (shared/community.ts):
  // "played not yet" beside their finds would be false, so the card says why.
  if (f.unrecorded) {
    if (f.me) head.append(el("span", "friend-seen", "admin play not counted"));
  } else head.append(el("span", "friend-seen", `played ${lastPlayedLabel(f.lastPlayed)}`));
  card.append(head);
  const facts = el("p", "friend-facts");
  const parts = [
    f.found !== null ? `${f.found} items found` : null,
    `${f.firsts} First Discover${f.firsts === 1 ? "y" : "ies"}`,
    f.daily ? `${f.daily} daily found first` : null,
  ];
  facts.textContent = parts.filter(Boolean).join(" · ");
  card.append(facts);
  if (f.favorite) {
    const fav = el("div", "friend-favorite");
    fav.append(el("span", "friend-favorite-emoji", f.favorite.emoji));
    const text = el("div", "friend-favorite-text");
    text.append(el("span", "friend-favorite-label", "Favorite spell"), el("strong", "", f.favorite.name));
    if (f.favorite.tier) text.append(el("span", "friend-favorite-tier", TIER_LABEL[f.favorite.tier]));
    fav.append(text);
    card.append(fav);
  } else card.append(el("p", "friend-nofavorite", "No favorite spell picked yet"));
  return card;
}

// The player's favorite spell (one of their own spells, strongest first) and
// the switch that hides them from the tab. Used here and on the account page.
export function profileControls(me: CommunityResponse["me"], changed: () => void = () => undefined): HTMLElement {
  const box = el("div", "profile-controls");
  const label = el("label", "profile-favorite");
  label.append(el("span", "", "Favorite spell"));
  const select = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "None";
  select.append(none);
  const spells = (shared?.discoveries() ?? [])
    .filter((d) => d.element.kind === "spell")
    .sort((a, b) => TIERS.indexOf(b.element.tier ?? "minor") - TIERS.indexOf(a.element.tier ?? "minor") || a.element.name.localeCompare(b.element.name));
  for (const d of spells) {
    const o = document.createElement("option");
    o.value = elementKey(d.element.name);
    o.textContent = `${d.element.emoji} ${d.element.name}`;
    select.append(o);
  }
  // A favorite picked on another device, or by the owner's token on a copy
  // of the library, may not be in this browser's discoveries: shown anyway,
  // so the picker says what the card above it says.
  if (me.favorite && !spells.some((d) => elementKey(d.element.name) === me.favorite)) {
    const o = document.createElement("option");
    o.value = me.favorite;
    o.textContent = me.card ? `${me.card.emoji} ${me.card.name}` : me.favorite;
    none.after(o);
  }
  select.value = me.favorite ?? "";
  select.onchange = () => {
    select.disabled = true;
    void api
      .setProfile({ favorite: select.value || null })
      .then((r) => {
        me.favorite = r.favorite;
        toast(r.favorite ? "Your favorite spell is set" : "No favorite spell");
        changed();
      })
      .catch((err: unknown) => {
        select.value = me.favorite ?? "";
        toast(err instanceof Error ? err.message : "Could not save your favorite", "error");
      })
      .finally(() => (select.disabled = false));
  };
  label.append(select);
  const hide = el("label", "profile-hide");
  const box2 = document.createElement("input");
  box2.type = "checkbox";
  box2.checked = me.hidden;
  box2.onchange = () => {
    box2.disabled = true;
    void api
      .setProfile({ hidden: box2.checked })
      .then((r) => {
        me.hidden = r.hidden;
        toast(r.hidden ? "You are hidden from the Community tab" : "You are back in the Community tab");
        changed();
      })
      .catch((err: unknown) => {
        box2.checked = me.hidden;
        toast(err instanceof Error ? err.message : "Could not save that", "error");
      })
      .finally(() => (box2.disabled = false));
  };
  hide.append(box2, el("span", "", "Hide me from the Community tab"));
  box.append(label, hide);
  return box;
}
