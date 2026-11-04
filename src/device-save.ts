import { PRIMITIVES, elementKey } from "../shared/elements";
import { WORLD_AT_KEY, WORLD_KEY } from "./island-store";

// 4.4.6: the progress on this device belongs to one account. The save is
// tagged with the id of the account it belongs to (or of the invite link it
// was played with, before that link became an account). A save tagged with
// X is only ever sent to X; a save tagged with someone else is set aside
// when another person signs in or plays a link here, never merged and never
// sent; an untagged save (from before 4.4.6, or a device someone left
// without an account) is offered once to whoever signs in.
//
// What belongs to the account moves with it; settings stay with the device
// (docs/DESIGN.md, "What syncs").

export const OWNER_KEY = "magic-merger.owner";

// The account's own: discoveries, board, descriptions, spells and wins (the
// save), the island, what the server held when this device last looked, and
// the wonders of the last islands (so a new island never repeats them).
const PROGRESS_KEYS = ["magic-merger.save", WORLD_KEY, WORLD_AT_KEY, "magic-merger.sync", "magic-merger.wonder-sets"];

// Where a save set aside waits: IndexedDB, which has room for an island
// beside the one in localStorage (a giant one is 0.6M characters).
const DB_NAME = "magic-merger-aside";
const STORE = "saves";
// The key of a save that had no account when it was set aside.
export const BEFORE_ACCOUNT = "before-account";

interface Aside {
  owner: string;
  at: number;
  items: Record<string, string>;
}

// While a save is moved, nothing of this page may write it again (the
// discoveries' writer merges with what is stored, the World saves on hide):
// the page reloads right after.
let frozen = false;
export function isFrozen(): boolean {
  return frozen;
}
export function freeze(): void {
  frozen = true;
}

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function owner(): string | null {
  return get(OWNER_KEY);
}

export function setOwner(id: string): void {
  try {
    localStorage.setItem(OWNER_KEY, id);
  } catch {
    // a blocked storage keeps nothing anyway
  }
}

// What the save holds beyond the eight primal forces, for the offer.
export function summary(): { discoveries: number; island: boolean } {
  let discoveries = 0;
  try {
    const save = JSON.parse(get("magic-merger.save") ?? "null") as { discoveries?: Record<string, unknown> } | null;
    const primal = new Set(PRIMITIVES.map((p) => elementKey(p.name)));
    discoveries = Object.keys(save?.discoveries ?? {}).filter((k) => !primal.has(k)).length;
  } catch {
    discoveries = 0;
  }
  return { discoveries, island: !!get(WORLD_KEY) };
}

export function hasProgress(): boolean {
  const s = summary();
  return s.discoveries > 0 || s.island;
}

// Removes the account's progress from this device (settings stay).
export function clearProgress(): void {
  freeze();
  for (const key of [...PROGRESS_KEYS, OWNER_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing to remove
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? new Error("IndexedDB"));
      t.onabort = () => reject(t.error ?? new Error("IndexedDB"));
    });
  } finally {
    db.close();
  }
}

// Sets this device's save aside under the account it belongs to, then
// removes it from play. False when it could not be kept (no IndexedDB, a
// full disk): it is then removed all the same, since the account it
// belongs to holds what it synced. With nothing to keep, it is just removed.
export async function setAside(): Promise<boolean> {
  freeze();
  const items: Record<string, string> = {};
  for (const key of PROGRESS_KEYS) {
    const v = get(key);
    if (v !== null) items[key] = v;
  }
  let kept = true;
  if (hasProgress()) {
    const who = owner() ?? BEFORE_ACCOUNT;
    const aside: Aside = { owner: who, at: Date.now(), items };
    kept = await tx("readwrite", (s) => s.put(aside, who)).then(
      () => true,
      () => false,
    );
  }
  clearProgress();
  return kept;
}

// The save an account left set aside on this device, back in play. True
// when there was one.
export async function restore(id: string): Promise<boolean> {
  const aside = await tx<Aside | undefined>("readonly", (s) => s.get(id) as IDBRequest<Aside | undefined>).catch(() => undefined);
  if (!aside?.items) return false;
  freeze();
  try {
    for (const [key, value] of Object.entries(aside.items)) {
      if (PROGRESS_KEYS.includes(key)) localStorage.setItem(key, value);
    }
    localStorage.setItem(OWNER_KEY, id);
  } catch {
    // A full storage: the account's own copy on the server comes down instead.
    clearProgress();
    return false;
  }
  await tx("readwrite", (s) => s.delete(id)).catch(() => undefined);
  return true;
}

// Another tab signed in, out or switched: this one starts again from what is
// stored, so it never writes the previous account's save back.
export function followOtherTabs(): void {
  window.addEventListener("storage", (e) => {
    if (e.key !== OWNER_KEY && e.key !== "magic-merger.session") return;
    if (e.oldValue === e.newValue) return;
    freeze();
    location.reload();
  });
}
