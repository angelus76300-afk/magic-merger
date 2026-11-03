import { elementKey } from "../shared/elements";
import { chipElement } from "./craft";
import { lastUsed } from "./filters";
import type { Discovery, Store } from "./store";

// The recipe book (3.7): what this player found, how and when, and what it
// was used for. Memory only: every line is something this player did, read
// from their own discoveries. No hints, nothing they have not made.

export interface BookEntry {
  key: string;
  discovery: Discovery;
  // What made it, for this player; empty for the primal forces.
  from: [string, string] | null;
  // What this player made with it.
  madeInto: string[];
  // When this player last cast or placed it, 0 for never.
  lastCast: number;
}

export function bookEntries(list: Discovery[], used: (key: string) => number): BookEntry[] {
  const into = new Map<string, string[]>();
  for (const d of list)
    for (const input of new Set(d.recipe ?? [])) {
      const k = elementKey(input);
      into.set(k, [...(into.get(k) ?? []), d.element.name]);
    }
  return list
    .map((d) => {
      const key = elementKey(d.element.name);
      return { key, discovery: d, from: d.recipe, madeInto: into.get(key) ?? [], lastCast: used(key) };
    })
    .sort((a, b) => b.discovery.discoveredAt - a.discovery.discoveredAt);
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

let dialog: HTMLDialogElement | null = null;

export function openBook(store: Store): void {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "book";
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog!.close();
    });
    document.body.append(dialog);
  }
  const d = dialog;
  const entries = bookEntries(store.discoveries(), lastUsed);
  const title = document.createElement("h2");
  title.textContent = "Recipe book";
  const intro = document.createElement("p");
  intro.className = "book-intro";
  intro.textContent = `${entries.length} things found, newest first. Only what you made yourself is written here.`;
  const list = document.createElement("div");
  list.className = "book-list";
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "book-entry";
    const lines = document.createElement("div");
    const first = document.createElement("p");
    first.textContent = e.from ? `${e.from[0]} + ${e.from[1]}, found ${day(e.discovery.discoveredAt)}` : "One of the eight forces";
    lines.append(first);
    if (e.madeInto.length) {
      const used = document.createElement("p");
      used.textContent = `Used to make ${e.madeInto.slice(0, 6).join(", ")}${e.madeInto.length > 6 ? ` and ${e.madeInto.length - 6} more` : ""}`;
      lines.append(used);
    }
    if (e.lastCast) {
      const cast = document.createElement("p");
      cast.textContent = `Last ${e.discovery.element.kind === "artifact" ? "placed" : "cast"} ${day(e.lastCast)}`;
      lines.append(cast);
    }
    row.append(chipElement(e.discovery.element), lines);
    list.append(row);
  }
  const close = document.createElement("button");
  close.textContent = "Close";
  close.addEventListener("click", () => d.close());
  d.replaceChildren(title, intro, list, close);
  d.showModal();
}
