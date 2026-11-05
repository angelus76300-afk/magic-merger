import * as api from "./api";
import { toast } from "./toast";

// 4.5: what's new in the game. public/changelog.json holds one line per
// merged update (newest first); the page keeps when this player last read
// it, puts a dot on the ? button while something is newer, and lists what
// came since. A player whose idea was built is told so, by its title.

import { entryId, whatIsNew, type ChangelogEntry } from "../shared/changelog";

export type { ChangelogEntry };

const SEEN_KEY = "mm-whatsnew-seen";

export interface News {
  entries: ChangelogEntry[];
  fresh: ChangelogEntry[];
  ideas: { title: string; at: number }[];
}

let news: News | null = null;
const listeners: (() => void)[] = [];

function seenAt(): number | null {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

// The entries this player had when they last looked (4.5.1).
const READ_KEY = "mm-whatsnew-read";

function readIds(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(READ_KEY) ?? "null") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function markSeen(entries: ChangelogEntry[]): void {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
    localStorage.setItem(READ_KEY, JSON.stringify(entries.slice(0, 200).map(entryId)));
  } catch {
    // shown again next visit
  }
}

export async function loadNews(): Promise<News | null> {
  let entries: ChangelogEntry[] = [];
  try {
    const res = await fetch("/changelog.json", { cache: "no-cache" });
    const data = (await res.json()) as { entries?: ChangelogEntry[] };
    entries = Array.isArray(data.entries) ? data.entries.filter((e) => typeof e?.date === "string" && typeof e.text === "string") : [];
  } catch {
    return null;
  }
  const seen = seenAt();
  const read = readIds();
  // A new player starts here: the game's history is not news to them.
  if (seen === null) markSeen(entries);
  const feedback = await api.feedback();
  const shipped = (feedback?.suggestions ?? []).filter((s) => s.mine && s.status === "shipped").map((s) => ({ title: s.title, at: s.updatedAt }));
  news = { entries, ...whatIsNew(entries, shipped, seen, read) };
  for (const l of listeners) l();
  return news;
}

export function unread(): number {
  return news ? news.fresh.length + news.ideas.length : 0;
}

export function onNews(fn: () => void): void {
  listeners.push(fn);
}

// Said once a visit when something is new.
export function announce(): void {
  const n = unread();
  if (!n) return;
  if (news!.ideas.length) toast(`Your idea was built: ${news!.ideas[0].title}. Tap ? to see what's new.`, "special");
  else toast(`${n} new in the game since your last visit: tap ? to see.`);
}

export function openNews(): void {
  const d = document.createElement("dialog");
  d.className = "card whatsnew";
  d.innerHTML = `
    <div class="card-head">
      <span class="card-emoji">📜</span>
      <div><h2 class="card-name">What's new</h2><div class="card-meta whatsnew-since"></div></div>
      <button class="card-close" aria-label="Close">×</button>
    </div>
    <div class="whatsnew-ideas"></div>
    <ul class="whatsnew-fresh"></ul>
    <details class="whatsnew-all"><summary>Every update</summary><ul></ul></details>
  `;
  const n = news ?? { entries: [], fresh: [], ideas: [] };
  d.querySelector(".whatsnew-since")!.textContent = n.fresh.length ? "Since your last visit" : "Nothing new since your last visit";
  const ideas = d.querySelector<HTMLElement>(".whatsnew-ideas")!;
  for (const i of n.ideas) {
    const p = document.createElement("p");
    p.className = "whatsnew-idea";
    p.textContent = `Your idea was built: ${i.title}`;
    ideas.append(p);
  }
  const line = (e: ChangelogEntry) => {
    const li = document.createElement("li");
    const date = document.createElement("span");
    date.className = "whatsnew-date";
    date.textContent = new Date(`${e.date}T12:00:00`).toLocaleDateString("en", { day: "numeric", month: "short" });
    li.append(date, document.createTextNode(` ${e.text}`));
    return li;
  };
  d.querySelector(".whatsnew-fresh")!.append(...n.fresh.map(line));
  d.querySelector(".whatsnew-all ul")!.append(...n.entries.map(line));
  if (!n.fresh.length) d.querySelector<HTMLDetailsElement>(".whatsnew-all")!.open = true;
  const close = () => {
    d.close();
    d.remove();
  };
  d.querySelector(".card-close")!.addEventListener("click", close);
  d.addEventListener("cancel", close);
  document.body.append(d);
  d.showModal();
  markSeen(n.entries);
  if (news) {
    news.fresh = [];
    news.ideas = [];
    for (const l of listeners) l();
  }
}
