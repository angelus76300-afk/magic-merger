import { PRIMITIVES, elementKey } from "../shared/elements";
import type { SpellProgram } from "../shared/spellcode";
import { FIRST_PROGRAM_VERSION } from "../shared/version";
import type { GameElement } from "../shared/types";
import { isQuotaError, warnStorageFull } from "./quota";
import { isFrozen } from "./device-save";
import { isPlaceholderDescription } from "../shared/refusal";

export interface Discovery {
  element: GameElement;
  discoveredAt: number;
  // The first pair that made it for this player. Primitives have none.
  recipe: [string, string] | null;
}

export interface BoardChip {
  id: number;
  key: string;
  x: number;
  y: number;
}

export interface SaveData {
  version: 1;
  discoveries: Record<string, Discovery>;
  descriptions: Record<string, string>;
  // Spell programs by element key. Older saves hold v1 specs here: they are
  // ignored (see spell()) and replaced the first time the spell is cast.
  // Programs of every later version are kept and cast as they are.
  spells?: Record<string, SpellProgram>;
  board: BoardChip[];
  nextChipId: number;
  // Challenges won, by id.
  solved?: string[];
}

const STORAGE_KEY = "magic-merger.save";

// Everything the player owns lives in this browser. The Worker only holds the
// shared recipe book, so clearing site data never loses a recipe.
export class Store {
  private data: SaveData;
  private saveTimer: number | undefined;
  // Told after every write (4.0: the account's progress follows).
  onChange: (() => void) | null = null;

  constructor() {
    this.data = load() ?? fresh();
    for (const p of PRIMITIVES) {
      const key = elementKey(p.name);
      this.data.discoveries[key] ??= { element: p, discoveredAt: 0, recipe: null };
    }
  }

  discoveries(): Discovery[] {
    return Object.values(this.data.discoveries);
  }

  get(key: string): Discovery | undefined {
    return this.data.discoveries[key];
  }

  // Returns true when the player had never made this element before.
  discover(element: GameElement, recipe: [string, string]): boolean {
    const key = elementKey(element.name);
    const known = this.data.discoveries[key];
    if (known) {
      known.element = element;
      this.save();
      return false;
    }
    this.data.discoveries[key] = { element, discoveredAt: Date.now(), recipe };
    this.save();
    return true;
  }

  // 4.5.1 (audit, B3): a refusal cached before the fix, or the "no
  // description yet" stand in, is no description: the card asks again.
  description(key: string): string | undefined {
    const text = this.data.descriptions[key];
    return text && !isPlaceholderDescription(text, key) ? text : undefined;
  }

  setDescription(key: string, text: string): void {
    if (isPlaceholderDescription(text, key)) return;
    this.data.descriptions[key] = text;
    this.save();
  }

  spell(key: string): SpellProgram | undefined {
    const program = this.data.spells?.[key];
    // Any program is kept, whatever version it was written for: only the admin
    // rewrites a spell, one at a time.
    return program && program.version >= FIRST_PROGRAM_VERSION && typeof program.code === "string" ? program : undefined;
  }

  setSpell(key: string, program: SpellProgram): void {
    (this.data.spells ??= {})[key] = program;
    this.save();
  }

  isSolved(id: string): boolean {
    return this.data.solved?.includes(id) ?? false;
  }

  markSolved(id: string): void {
    if (this.isSolved(id)) return;
    (this.data.solved ??= []).push(id);
    this.save();
  }

  board(): BoardChip[] {
    return this.data.board;
  }

  addChip(key: string, x: number, y: number): BoardChip {
    const chip = { id: this.data.nextChipId++, key, x, y };
    this.data.board.push(chip);
    this.save();
    return chip;
  }

  moveChip(id: number, x: number, y: number): void {
    const chip = this.data.board.find((c) => c.id === id);
    if (!chip) return;
    chip.x = x;
    chip.y = y;
    this.save();
  }

  removeChip(id: number): void {
    this.data.board = this.data.board.filter((c) => c.id !== id);
    this.save();
  }

  clearBoard(): void {
    this.data.board = [];
    this.save();
  }

  // 4.0: what the account keeps of the discoveries, and what another device
  // found. Imported ones join as a union by key; the earliest time wins.
  exportDiscoveries(): { key: string; at: number; recipe: [string, string] | null; element: GameElement }[] {
    return Object.entries(this.data.discoveries).map(([key, d]) => ({ key, at: d.discoveredAt, recipe: d.recipe, element: d.element }));
  }

  // Returns how many were new to this browser.
  importDiscoveries(list: { key: string; at: number; recipe: [string, string] | null; element?: Record<string, unknown> }[]): number {
    let added = 0;
    for (const d of list) {
      const e = d.element as Partial<GameElement> | undefined;
      if (!e || typeof e.name !== "string" || typeof e.emoji !== "string" || (e.kind !== "spell" && e.kind !== "artifact")) continue;
      const element: GameElement = {
        name: e.name,
        emoji: e.emoji,
        kind: e.kind,
        depth: typeof e.depth === "number" ? e.depth : 1,
        ...(e.tier ? { tier: e.tier } : {}),
      };
      const known = this.data.discoveries[d.key];
      if (!known) {
        this.data.discoveries[d.key] = { element, discoveredAt: d.at, recipe: d.recipe };
        added++;
      } else if (d.at > 0 && (known.discoveredAt === 0 || d.at < known.discoveredAt)) {
        known.discoveredAt = d.at;
        known.recipe ??= d.recipe;
      }
    }
    if (added) this.save();
    return added;
  }

  exportBoard(): { chips: BoardChip[]; next: number } {
    return { chips: this.data.board, next: this.data.nextChipId };
  }

  importBoard(board: { chips: BoardChip[]; next: number }): void {
    this.data.board = board.chips.filter((c) => this.data.discoveries[c.key]);
    this.data.nextChipId = Math.max(this.data.nextChipId, board.next);
    this.save();
  }

  // Another tab of this browser wrote its save (4.0 review M6): what it found
  // joins this tab's, so this tab's next write cannot erase it.
  listen(onExternal: () => void): void {
    window.addEventListener("storage", (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      const other = parse(e.newValue);
      if (!other) return;
      const before = Object.keys(this.data.discoveries).length;
      this.data = mergeSaves(this.data, other);
      if (Object.keys(this.data.discoveries).length !== before) onExternal();
    });
  }

  // Writes are batched: dragging calls moveChip far more often than needed.
  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.write(), 200);
  }

  // The stored save is read again first and merged by key (M6): another tab
  // may have found something since this one loaded.
  write(): void {
    // 4.4.6: the save is being moved to another account's place; the page reloads.
    if (isFrozen()) return;
    try {
      const stored = load();
      if (stored) this.data = mergeSaves(this.data, stored);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (err) {
      // Private mode: the game still works for this session. A full storage
      // is said once (M13).
      if (isQuotaError(err)) warnStorageFull();
    }
    this.onChange?.();
  }
}

// Two saves of this browser as one (M6): discoveries are a union by key with
// the earliest time, descriptions and solved challenges a union, the newest
// program of each spell (by id) is kept; the board is this tab's own.
export function mergeSaves(mine: SaveData, theirs: SaveData): SaveData {
  const discoveries: Record<string, Discovery> = { ...theirs.discoveries, ...mine.discoveries };
  for (const [key, d] of Object.entries(theirs.discoveries)) {
    const m = mine.discoveries[key];
    if (m && d.discoveredAt > 0 && (m.discoveredAt === 0 || d.discoveredAt < m.discoveredAt))
      discoveries[key] = { ...m, discoveredAt: d.discoveredAt, recipe: d.recipe ?? m.recipe };
  }
  const spells: Record<string, SpellProgram> = { ...(theirs.spells ?? {}) };
  for (const [key, p] of Object.entries(mine.spells ?? {})) {
    const t = spells[key];
    if (!t || (p.id ?? 0) >= (t.id ?? 0)) spells[key] = p;
  }
  const solved = [...new Set([...(theirs.solved ?? []), ...(mine.solved ?? [])])];
  return {
    version: 1,
    discoveries,
    descriptions: { ...theirs.descriptions, ...mine.descriptions },
    spells,
    board: mine.board,
    nextChipId: Math.max(mine.nextChipId, theirs.nextChipId),
    ...(solved.length ? { solved } : {}),
  };
}

function fresh(): SaveData {
  return { version: 1, discoveries: {}, descriptions: {}, spells: {}, board: [], nextChipId: 1 };
}

function load(): SaveData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parse(raw) : null;
  } catch {
    return null;
  }
}

function parse(raw: string): SaveData | null {
  try {
    const data = JSON.parse(raw) as Partial<SaveData>;
    return wellFormed(data) ? data : null;
  } catch {
    return null;
  }
}

// A save this code can read: a crash here would be a blank page at startup,
// before any UI exists, and no way for the player to recover.
function wellFormed(data: Partial<SaveData>): data is SaveData {
  const obj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  return data.version === 1 && obj(data.discoveries) && obj(data.descriptions) && Array.isArray(data.board) && typeof data.nextChipId === "number";
}
