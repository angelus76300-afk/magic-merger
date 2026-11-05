import * as api from "./api";
import type { DailyChallenge, DailyResponse } from "../shared/daily";
import { TIER_LABEL } from "../shared/tiers";

// 4.5, the Daily tab: every challenge nobody has found yet, then the last
// finds with their finder. A challenge is an item made ahead from two items
// of the shared pool; what it is shows here, what makes it never does.

const el = (tag: string, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

// "5 Nov", from the YYYY-MM-DD the Worker sends (a forced second one reads "5 Nov #2").
export function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(day);
  if (!m) return day;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${date.getDate()} ${date.toLocaleString("en", { month: "short" })}${m[4]}`;
}

export class Daily {
  private loaded: DailyResponse | null = null;
  // Told how many are open, for the dot on the tab.
  onCount: (open: number) => void = () => undefined;

  constructor(private root: HTMLElement) {}

  async show(): Promise<void> {
    if (!this.loaded) this.root.innerHTML = `<p class="daily-loading">Loading the daily challenges...</p>`;
    try {
      this.loaded = await api.daily();
      this.render(this.loaded);
      this.onCount(this.loaded.open.length);
    } catch (err) {
      if (!this.loaded) this.root.innerHTML = `<p class="daily-empty">${err instanceof Error ? err.message : "The daily challenges could not be loaded."}</p>`;
    }
  }

  // Read once at start for the tab's count, without drawing.
  async count(): Promise<void> {
    try {
      this.loaded = await api.daily();
      this.onCount(this.loaded.open.length);
    } catch {
      // the tab says nothing
    }
  }

  private render(data: DailyResponse): void {
    this.root.textContent = "";
    const head = el("div", "daily-head");
    head.append(
      el("h2", "", "Daily challenges"),
      el(
        "p",
        "",
        "Each night a new item waits to be found, made from two items of the shared pool that nobody had merged together. Here is what it is; how to make it is yours to find. The first to make it has their name on it, for good.",
      ),
    );
    this.root.append(head);
    const open = el("section", "daily-group");
    open.append(el("h3", "", data.open.length ? `Waiting to be found (${data.open.length})` : "Waiting to be found"));
    if (!data.open.length)
      open.append(
        el("p", "daily-empty", data.found.length ? "Every challenge has been found. A new one comes tonight." : "The first challenge comes tonight."),
      );
    for (const c of data.open) open.append(card(c));
    this.root.append(open);
    if (data.found.length) {
      const found = el("section", "daily-group");
      found.append(el("h3", "", "Found"));
      for (const c of data.found) found.append(card(c));
      this.root.append(found);
    }
  }
}

function card(c: DailyChallenge): HTMLElement {
  const box = el("article", `daily-card${c.found ? " daily-found" : ""}${c.mine ? " daily-mine" : ""}`);
  const title = el("h4", "daily-title");
  title.append(el("span", "daily-emoji", c.emoji), el("span", "daily-name", c.name));
  const facts = el("p", "daily-facts");
  const kind = el("span", "daily-kind", c.kind);
  kind.dataset.kind = c.kind;
  facts.append(kind);
  if (c.tier) facts.append(el("span", "daily-tier", TIER_LABEL[c.tier]));
  facts.append(el("span", "daily-day", `set ${shortDay(c.day)}`));
  box.append(title, facts);
  if (c.description) box.append(el("p", "daily-description", c.description));
  if (c.found) {
    const who = c.mine ? "you" : (c.foundBy ?? "someone");
    box.append(el("p", "daily-finder", `Found first by ${who} on ${shortDay(c.foundDay ?? c.day)}`));
  }
  return box;
}
