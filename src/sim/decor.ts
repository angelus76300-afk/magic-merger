// The free standing voxels of a world, keyed by voxelkey.ts, valued by color
// and kind (voxels.ts). At most MAX voxels, so the store is a fixed hash table
// in typed arrays: no objects per voxel, nothing for the garbage collector,
// and every voxel has a slot number the flood fill can mark in a flat array.
//
// It speaks the Map API the rest of the game used (get, set, has, delete,
// size, keys, values, entries, for...of), and also records which keys
// changed, so the view can update only those instances.

const SLOTS = 1 << 16; // 65,536 slots for at most 20,000 voxels: probes stay short
const MASK = SLOTS - 1;
const EMPTY = 0xffffffff; // keys never reach 2^29
const GONE = 0xfffffffe;
// Past this many changes between two looks, the view rebuilds everything.
const MAX_CHANGES = 4096;

export class DecorStore implements Iterable<[number, number]> {
  static readonly MAX = 20000;
  private keyAt = new Uint32Array(SLOTS).fill(EMPTY);
  private valueAt = new Uint32Array(SLOTS);
  private live = 0;
  private gone = 0;
  private changes = new Set<number>();
  private allChanged = true;

  get size(): number {
    return this.live;
  }

  // Slot of a key, or -1.
  slot(key: number): number {
    const keys = this.keyAt;
    for (let i = hash(key); ; i = (i + 1) & MASK) {
      const k = keys[i];
      if (k === key) return i;
      if (k === EMPTY) return -1;
    }
  }

  get(key: number): number | undefined {
    const s = this.slot(key);
    return s < 0 ? undefined : this.valueAt[s];
  }

  has(key: number): boolean {
    return this.slot(key) >= 0;
  }

  set(key: number, value: number): this {
    const s = this.slot(key);
    if (s >= 0) {
      if (this.valueAt[s] !== value) this.changed(key);
      this.valueAt[s] = value;
      return this;
    }
    // Callers keep below MAX; the table could hold three times more.
    if (this.live + this.gone > SLOTS * 0.6) this.compact();
    const keys = this.keyAt;
    let i = hash(key);
    while (keys[i] !== EMPTY && keys[i] !== GONE) i = (i + 1) & MASK;
    if (keys[i] === GONE) this.gone--;
    keys[i] = key;
    this.valueAt[i] = value;
    this.live++;
    this.changed(key);
    return this;
  }

  delete(key: number): boolean {
    const s = this.slot(key);
    if (s < 0) return false;
    this.keyAt[s] = GONE;
    this.live--;
    this.gone++;
    this.changed(key);
    return true;
  }

  clear(): void {
    this.keyAt = new Uint32Array(SLOTS).fill(EMPTY);
    this.live = 0;
    this.gone = 0;
    this.allChanged = true;
    this.changes.clear();
  }

  // Slots, for loops that want no iterator objects: a slot is in use when
  // isLive(slot); then keyOf and valueOf read it.
  get slots(): number {
    return SLOTS;
  }
  isLive(slot: number): boolean {
    return this.keyAt[slot] < GONE;
  }
  keyOf(slot: number): number {
    return this.keyAt[slot];
  }
  valueOf(slot: number): number {
    return this.valueAt[slot];
  }

  // Iteration walks the arrays as they were when it started, so deleting the
  // current voxel is safe, as it is with a Map.
  *entries(): IterableIterator<[number, number]> {
    const keys = this.keyAt;
    const values = this.valueAt;
    for (let i = 0; i < SLOTS; i++) if (keys[i] < GONE) yield [keys[i], values[i]];
  }
  *keys(): IterableIterator<number> {
    const keys = this.keyAt;
    for (let i = 0; i < SLOTS; i++) if (keys[i] < GONE) yield keys[i];
  }
  *values(): IterableIterator<number> {
    const keys = this.keyAt;
    const values = this.valueAt;
    for (let i = 0; i < SLOTS; i++) if (keys[i] < GONE) yield values[i];
  }
  [Symbol.iterator](): IterableIterator<[number, number]> {
    return this.entries();
  }

  // The keys added, removed or recolored since the last call, or "all" when
  // there were too many to list (a big fall, a reset, a loaded save).
  takeChanges(): Set<number> | "all" {
    if (this.allChanged) {
      this.allChanged = false;
      this.changes.clear();
      return "all";
    }
    const out = this.changes;
    this.changes = new Set();
    return out;
  }

  private changed(key: number): void {
    if (this.allChanged) return;
    this.changes.add(key);
    if (this.changes.size > MAX_CHANGES) {
      this.allChanged = true;
      this.changes.clear();
    }
  }

  // Deleted slots lengthen probes: rebuild without them. New arrays, so an
  // iteration in progress keeps reading the old ones.
  private compact(): void {
    const oldKeys = this.keyAt;
    const oldValues = this.valueAt;
    this.keyAt = new Uint32Array(SLOTS).fill(EMPTY);
    this.valueAt = new Uint32Array(SLOTS);
    this.gone = 0;
    for (let s = 0; s < SLOTS; s++) {
      const key = oldKeys[s];
      if (key >= GONE) continue;
      let i = hash(key);
      while (this.keyAt[i] !== EMPTY) i = (i + 1) & MASK;
      this.keyAt[i] = key;
      this.valueAt[i] = oldValues[s];
    }
  }
}

function hash(key: number): number {
  return Math.imul(key, 0x9e3779b1) >>> 16;
}
