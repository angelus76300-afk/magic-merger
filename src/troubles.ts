// The island needs you (src/sim/troubles.ts), on the page's side: the
// player's switch, what their items did for their villages, and the number
// the update is held to. All of it stays on this device; nothing here is
// sent to the Worker except three counts in the perf sample, when the HUD is on.

const ON_KEY = "magic-merger.troubles-on";
const DEEDS_KEY = "magic-merger.deeds";
const COUNT_KEY = "magic-merger.trouble-counts";

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No storage: the switch and the lines last for the visit.
  }
}

/** Troubles start on the player's island unless they turned them off. */
export function troublesOn(): boolean {
  return read<boolean>(ON_KEY, true) !== false;
}
export function setTroublesOn(on: boolean): void {
  write(ON_KEY, on);
}

/** What an item did for a village, newest first, three lines at most: shown on the player's own card of it. */
export function deedsOf(key: string): string[] {
  const all = read<Record<string, string[]>>(DEEDS_KEY, {});
  const list = all[key];
  return Array.isArray(list) ? list.filter((l) => typeof l === "string").slice(0, 3) : [];
}
export function addDeed(key: string, line: string): void {
  const all = read<Record<string, string[]>>(DEEDS_KEY, {});
  all[key] = [line.slice(0, 160), ...deedsOf(key).filter((l) => l !== line)].slice(0, 3);
  write(DEEDS_KEY, all);
}

export interface TroubleCounts {
  // Troubles that ended, those an item answered, and those answered by an item first made after the trouble began.
  troubles: number;
  answered: number;
  fresh: number;
}
export function troubleCounts(): TroubleCounts {
  const c = read<Partial<TroubleCounts>>(COUNT_KEY, {});
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { troubles: n(c.troubles), answered: n(c.answered), fresh: n(c.fresh) };
}

/** A trouble ended. `madeAt` is when the answering item was first discovered, `began` when the trouble started, both in ms. */
export function countTrouble(answered: boolean, madeAt: number | null, began: number): TroubleCounts {
  const c = troubleCounts();
  c.troubles++;
  if (answered) c.answered++;
  if (answered && madeAt !== null && began > 0 && madeAt > began) c.fresh++;
  write(COUNT_KEY, c);
  return c;
}
