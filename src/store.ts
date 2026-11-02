import { PRIMITIVES, elementKey } from "../shared/elements";
import { PROGRAM_VERSION, type SpellProgram } from "../shared/spellcode";
import type { GameElement } from "../shared/types";

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

interface SaveData {
  version: 1;
  discoveries: Record<string, Discovery>;
  descriptions: Record<string, string>;
  // Spell programs by element key. Older saves hold v1 specs here: they are
  // ignored (see spell()) and replaced the first time the spell is cast.
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

  description(key: string): string | undefined {
    return this.data.descriptions[key];
  }

  setDescription(key: string, text: string): void {
    this.data.descriptions[key] = text;
    this.save();
  }

  spell(key: string): SpellProgram | undefined {
    const program = this.data.spells?.[key];
    return program?.version === PROGRAM_VERSION && typeof program.code === "string" ? program : undefined;
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

  // Writes are batched: dragging calls moveChip far more often than needed.
  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch {
        // Private mode or full storage: the game still works for this session.
      }
    }, 200);
  }
}

function fresh(): SaveData {
  return { version: 1, discoveries: {}, descriptions: {}, spells: {}, board: [], nextChipId: 1 };
}

function load(): SaveData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    return data.version === 1 ? data : null;
  } catch {
    return null;
  }
}
