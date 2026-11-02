import * as api from "./api";
import { challengeById, liveAhead, starsFor, strongEnough, type ChallengeDef } from "../shared/challenges";
import { elementKey } from "../shared/elements";
import { chipElement } from "./craft";
import type { Store } from "./store";
import { toast } from "./toast";
import type { WorldHost } from "./worldhost";

// The Challenges tab (3.7): hazard islands to save from nothing. Each starts
// from a few primitives on its own board; every merge counts, known pairs
// are free and new ones come out of the player's allowance like any merge,
// and what is found joins the main inventory. Cast what you made, and the
// fewer merges the more stars: three at par, two within two merges of it,
// one for any win. No hints.

interface Attempt {
  id: string;
  items: string[];
  merges: number;
  started: number;
}

const KEY = "mm-challenge-attempt";

function loadAttempt(): Attempt | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? "null") as Attempt | null;
    return a && typeof a.id === "string" && Array.isArray(a.items) ? a : null;
  } catch {
    return null;
  }
}
function saveAttempt(a: Attempt | null): void {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {
    // kept for this page
  }
}

const el = (tag: string, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const stars = (n: number) => "★".repeat(n) + "☆".repeat(3 - n);

export class Challenges {
  private cards: api.ChallengeCard[] = [];
  private attempt: Attempt | null = loadAttempt();
  private picked: string | null = null;
  private busy = false;
  onDiscovered: (key: string) => void = () => {};
  showWorld: () => void = () => {};
  showSelf: () => void = () => {};

  constructor(
    private root: HTMLElement,
    private store: Store,
    private world: WorldHost,
  ) {}

  async show(): Promise<void> {
    if (this.attempt && challengeById(this.attempt.id)) return this.renderAttempt();
    this.root.replaceChildren(el("p", "challenges-loading", "Looking for challenges…"));
    try {
      this.cards = (await api.challenges()).challenges;
    } catch (err) {
      this.root.replaceChildren(el("p", "challenges-empty", err instanceof Error ? err.message : "The challenges could not be loaded"));
      return;
    }
    this.renderList();
  }

  private renderList(): void {
    const head = el("div", "challenges-head");
    head.append(
      el("h2", "", "Challenges"),
      el(
        "p",
        "",
        "Save each island starting from a few forces. Every merge counts: the fewer, the more stars. Three at par, two within two merges, one for any win.",
      ),
    );
    const list = el("div", "challenge-cards");
    if (!this.cards.length) list.append(el("p", "challenges-empty", "No challenge has a known solution yet. Check again soon."));
    this.cards.forEach((c, n) => {
      const card = el("div", "challenge-card");
      // In order of difficulty: the next one opens with a win on the one before.
      const open = n === 0 || this.cards[n - 1].stars > 0 || c.stars > 0;
      card.dataset.open = String(open);
      const title = el("h3", "", c.title);
      title.append(el("span", "challenge-stars", stars(c.stars)));
      const facts = [`Par ${c.par ?? "?"}`];
      if (c.best) facts.push(`fewest: ${c.best.merges} by ${c.best.name}`);
      if (c.mine !== null) facts.push(`yours: ${c.mine}`);
      const start = el("div", "challenge-start");
      for (const name of c.start) {
        const d = this.store.get(elementKey(name));
        if (d) start.append(chipElement(d.element));
      }
      const tags: string[] = [];
      if (c.minTier) tags.push(`${c.minTier} magic or stronger`);
      if (c.live) tags.push("the hazard runs while you merge");
      const go = el("button", "challenge-go", open ? (c.stars ? "Play again" : "Play") : "Win the one before") as HTMLButtonElement;
      go.disabled = !open;
      go.addEventListener("click", () => this.begin(c.id));
      card.append(title, el("p", "", c.brief), start, el("p", "challenge-facts", [...tags, ...facts].join(" · ")), go);
      list.append(card);
    });
    this.root.replaceChildren(head, list);
  }

  private begin(id: string): void {
    const def = challengeById(id);
    if (!def) return;
    this.attempt = { id, items: def.start.map(elementKey), merges: 0, started: Date.now() };
    saveAttempt(this.attempt);
    this.picked = null;
    this.renderAttempt();
  }

  private card(): api.ChallengeCard | undefined {
    return this.cards.find((c) => c.id === this.attempt?.id);
  }

  private renderAttempt(): void {
    const a = this.attempt!;
    const def = challengeById(a.id)!;
    const card = this.card();
    const head = el("div", "attempt-head");
    const back = el("button", "attempt-back", "← Challenges");
    back.addEventListener("click", () => {
      this.attempt = null;
      saveAttempt(null);
      void this.show();
    });
    head.append(back, el("h2", "", def.title), el("p", "", def.brief));
    const par = card?.par ?? null;
    const count = el(
      "p",
      "attempt-count",
      `Merges: ${a.merges}${par !== null ? ` · par ${par}` : ""}${def.live ? ` · the hazard has run ${this.elapsed(def)} s` : ""}`,
    );
    const items = el("div", "attempt-items");
    for (const key of a.items) {
      const d = this.store.get(key);
      if (!d) continue;
      const chip = chipElement(d.element, "button");
      if (key === this.picked) chip.classList.add("picked");
      chip.addEventListener("click", () => void this.tap(key));
      items.append(chip);
    }
    const actions = el("div", "attempt-actions");
    const picked = this.picked ? this.store.get(this.picked) : null;
    if (picked) {
      actions.append(el("span", "", `Tap another item to merge it with ${picked.element.name}, or`));
      const cast = el(
        "button",
        "attempt-cast",
        `${picked.element.kind === "artifact" ? "Place" : "Cast"} ${picked.element.name} on the island`,
      ) as HTMLButtonElement;
      cast.addEventListener("click", () => this.cast(def, picked.element.name));
      actions.append(cast);
    } else actions.append(el("span", "", "Tap two items to merge them, then cast what you made on the island."));
    this.root.replaceChildren(head, count, items, actions);
  }

  private elapsed(def: ChallengeDef): number {
    return this.attempt ? Math.round(liveAhead(def, (Date.now() - this.attempt.started) / 1000) * 10) / 10 : 0;
  }

  private async tap(key: string): Promise<void> {
    if (this.busy) return;
    if (!this.picked || this.picked === key) {
      this.picked = this.picked === key ? null : key;
      return this.renderAttempt();
    }
    const a = this.attempt!;
    const first = this.store.get(this.picked)!.element;
    const second = this.store.get(key)!.element;
    this.busy = true;
    try {
      const result = await api.merge(first.name, second.name);
      const made = elementKey(result.element.name);
      const newForMe = this.store.discover(result.element, [first.name, second.name]);
      a.merges++;
      if (!a.items.includes(made)) a.items.push(made);
      saveAttempt(a);
      this.picked = made;
      const label = `${result.element.emoji} ${result.element.name}`;
      if (result.firstDiscovery) toast(`First discovery: ${label}`, "special");
      else toast(newForMe ? `New: ${label}` : label);
      if (newForMe) this.onDiscovered(made);
    } catch (err) {
      toast(err instanceof Error ? err.message : "The merge failed", "error");
    } finally {
      this.busy = false;
      this.renderAttempt();
    }
  }

  private cast(def: ChallengeDef, name: string): void {
    const key = elementKey(name);
    const d = this.store.get(key);
    if (!d) return;
    if (!strongEnough(def, d.element.tier)) {
      toast(`${name} is too weak: this challenge needs ${def.minTier} magic or stronger`, "error");
      return;
    }
    const a = this.attempt!;
    this.showWorld();
    this.world.playAttempt(
      {
        id: def.id,
        title: def.title,
        brief: def.brief,
        scenario: def.scenario,
        items: new Set(a.items),
        onEnd: (status, spell) => void this.ended(def, status, spell),
      },
      key,
      this.elapsed(def),
    );
  }

  private async ended(def: ChallengeDef, status: "won" | "lost", spell: string | null): Promise<void> {
    const a = this.attempt;
    if (!a || a.id !== def.id) return;
    if (status === "lost") {
      toast("Not this time. Retry, or go back to the challenge's board and merge something else.");
      return;
    }
    if (!spell) {
      toast("Won, but with a spell that was not made on the challenge's board: not counted.", "error");
      return;
    }
    const merges = a.merges;
    this.attempt = null;
    saveAttempt(null);
    try {
      const r = await api.challengeWin(def.id, merges, this.store.get(spell)?.element.name ?? spell);
      toast(`${def.title}: won in ${merges} merges ${stars(r.stars)}${r.best ? ", the fewest of anyone" : ""}`, "special");
    } catch (err) {
      toast(err instanceof Error ? err.message : "The win could not be recorded", "error");
      toast(`${def.title}: won in ${merges} merges ${stars(starsFor(merges, this.card()?.par ?? null))}`, "special");
    }
  }
}
