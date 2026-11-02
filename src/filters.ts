import { TIERS, type Tier } from "../shared/tiers";
import type { Discovery } from "./store";

// A small bar to narrow and order a list of discoveries: by kind, by tier,
// by name, and in a few orders. Used by the Craft inventory and the World's
// spell bar. Choices are remembered per place, in this browser only.

export type KindFilter = "all" | "spell" | "artifact";
export type SortOrder = "newest" | "oldest" | "name" | "power" | "used";

export interface FilterState {
  kind: KindFilter;
  tier: Tier | "any";
  sort: SortOrder;
  query: string;
}

const SORT_LABELS: Record<SortOrder, string> = {
  newest: "Newest",
  oldest: "Oldest",
  name: "A to Z",
  power: "Most powerful",
  used: "Last used",
};

export function applyFilters(list: Discovery[], f: FilterState, lastUsed: (key: string) => number, keyOf: (d: Discovery) => string): Discovery[] {
  const q = f.query.trim().toLowerCase();
  const shown = list.filter(
    (d) =>
      (f.kind === "all" || d.element.kind === f.kind) &&
      (f.tier === "any" || (d.element.tier ?? "minor") === f.tier) &&
      (!q || d.element.name.toLowerCase().includes(q)),
  );
  const power = (d: Discovery) => TIERS.indexOf(d.element.tier ?? "minor");
  const sorters: Record<SortOrder, (a: Discovery, b: Discovery) => number> = {
    newest: (a, b) => b.discoveredAt - a.discoveredAt,
    oldest: (a, b) => a.discoveredAt - b.discoveredAt,
    name: (a, b) => a.element.name.localeCompare(b.element.name),
    power: (a, b) => power(b) - power(a) || b.discoveredAt - a.discoveredAt,
    used: (a, b) => lastUsed(keyOf(b)) - lastUsed(keyOf(a)) || b.discoveredAt - a.discoveredAt,
  };
  return shown.sort(sorters[f.sort]);
}

export class FilterBar {
  readonly el: HTMLElement;
  state: FilterState;
  private search: HTMLInputElement | null = null;

  constructor(
    private storageKey: string,
    defaults: FilterState,
    options: { search: boolean; sorts: SortOrder[] },
    private onChange: () => void,
  ) {
    this.state = { ...defaults, ...load(storageKey), query: "" };
    if (!options.sorts.includes(this.state.sort)) this.state.sort = defaults.sort;
    this.el = document.createElement("div");
    this.el.className = "filterbar";

    if (options.search) {
      const search = document.createElement("input");
      search.type = "search";
      search.placeholder = "Find";
      search.autocomplete = "off";
      search.className = "filter-search";
      search.setAttribute("aria-label", "Find by name");
      search.addEventListener("input", () => this.set({ query: search.value }));
      this.search = search;
      this.el.append(search);
    }

    const kinds = document.createElement("div");
    kinds.className = "filter-kinds";
    kinds.setAttribute("role", "group");
    kinds.setAttribute("aria-label", "Kind");
    for (const [value, label] of [
      ["all", "All"],
      ["spell", "Spells"],
      ["artifact", "Artifacts"],
    ] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.dataset.kind = value;
      b.addEventListener("click", () => this.set({ kind: value }));
      kinds.append(b);
    }
    this.el.append(kinds);

    const tier = document.createElement("select");
    tier.className = "filter-tier";
    tier.setAttribute("aria-label", "Tier");
    tier.append(new Option("Any tier", "any"));
    for (const t of TIERS) tier.append(new Option(t[0].toUpperCase() + t.slice(1), t));
    tier.addEventListener("change", () => this.set({ tier: tier.value as Tier | "any" }));
    this.el.append(tier);

    const sort = document.createElement("select");
    sort.className = "filter-sort";
    sort.setAttribute("aria-label", "Order");
    for (const s of options.sorts) sort.append(new Option(SORT_LABELS[s], s));
    sort.addEventListener("change", () => this.set({ sort: sort.value as SortOrder }));
    this.el.append(sort);
    this.sync();
  }

  set(change: Partial<FilterState>): void {
    this.state = { ...this.state, ...change };
    save(this.storageKey, this.state);
    this.sync();
    this.onChange();
  }

  // Whether anything narrows the list (the order does not count).
  narrowing(): boolean {
    return this.state.kind !== "all" || this.state.tier !== "any" || this.state.query.trim() !== "";
  }

  reset(): void {
    if (this.search) this.search.value = "";
    this.set({ kind: "all", tier: "any", query: "" });
  }

  private sync(): void {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>(".filter-kinds button"))
      b.setAttribute("aria-pressed", String(b.dataset.kind === this.state.kind));
    (this.el.querySelector(".filter-tier") as HTMLSelectElement).value = this.state.tier;
    (this.el.querySelector(".filter-sort") as HTMLSelectElement).value = this.state.sort;
  }
}

function load(key: string): Partial<FilterState> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<FilterState>) : {};
  } catch {
    return {};
  }
}

function save(key: string, state: FilterState): void {
  try {
    const { query: _query, ...rest } = state;
    localStorage.setItem(key, JSON.stringify(rest));
  } catch {
    // Private windows may refuse storage; filters still work for the session.
  }
}

// When each spell was last cast or placed, remembered in this browser.
const USED_KEY = "mm-last-used";
let used: Record<string, number> | null = null;

export function lastUsed(key: string): number {
  if (!used) {
    try {
      used = JSON.parse(localStorage.getItem(USED_KEY) ?? "{}") as Record<string, number>;
    } catch {
      used = {};
    }
  }
  return used[key] ?? 0;
}

export function markUsed(key: string): void {
  lastUsed(key);
  used![key] = Date.now();
  try {
    localStorage.setItem(USED_KEY, JSON.stringify(used));
  } catch {
    // See above.
  }
}
