// Where a sound is heard from, and which sounds get to play (4.8, items 1
// and 2). Pure arithmetic, no Web Audio: sound.ts turns its answers into
// nodes, and scripts/sound-test.ts checks them in Node.

// The ear: the point the camera looks at, how wide the view is there, and
// which way is screen right on the ground.
export interface Listener {
  x: number;
  y: number;
  // Distance in cells at which a sound starts to fade. It grows with the
  // view, so zoomed out the whole island is heard and zoomed in the near
  // things stand out.
  ref: number;
  // Screen right on the ground (orbit.ts, pan): (cos theta, -sin theta).
  rx: number;
  ry: number;
}

// What a sound becomes at the listener.
export interface Placement {
  // 0 to 1, times the sound's own level.
  gain: number;
  // -1 (left) to 1 (right).
  pan: number;
  // Low pass cutoff in Hz: far sounds are duller.
  cutoff: number;
}

export const MIN_REF = 15;
const MAX_PAN = 0.8;
const NEAR_CUTOFF = 20000;
// Chimes are 0.5 to 2 kHz: below this floor a far chime is silence, not distance.
const FAR_CUTOFF = 1800;

export function listenerAt(x: number, y: number, visibleRadius: number, theta: number): Listener {
  return { x, y, ref: Math.max(MIN_REF, visibleRadius), rx: Math.cos(theta), ry: -Math.sin(theta) };
}

// An unplaced sound (a sound with no cast to belong to) is heard in the
// middle, a little quieter than one at the camera's own point.
export const UNPLACED: Placement = { gain: 0.6, pan: 0, cutoff: NEAR_CUTOFF };

export function place(l: Listener, x: number, y: number): Placement {
  const dx = x - l.x;
  const dy = y - l.y;
  const d = Math.hypot(dx, dy);
  const gain = l.ref / Math.max(l.ref, d);
  // Straight ahead and close is in the middle; off to the side is to that side.
  const side = d > 0 ? (dx * l.rx + dy * l.ry) / d : 0;
  const pan = Math.max(-MAX_PAN, Math.min(MAX_PAN, side * Math.min(1, d / l.ref) * MAX_PAN));
  const cutoff = Math.max(FAR_CUTOFF, NEAR_CUTOFF * Math.pow(gain, 1.2));
  return { gain, pan, cutoff };
}

// The budget (item 2).
export const MAX_VOICES = 24;
export const MERGE_SECONDS = 0.1;
// A merged sound is louder, up to this many times its first level.
export const MERGE_CAP = 1.8;
const MERGE_STEP = 1.4;
// Two sounds of one name merge, or wait for each other's cooldown, only when
// this close: a chime across the island never swallows the one at hand.
export function sameSpot(ref: number): number {
  return Math.max(4, ref / 4);
}
// A player's cast is answered: its sounds in this window skip the cooldown
// and are never the ones dropped.
export const CAST_PRIORITY_SECONDS = 0.3;

// Shortest time between two starts of the same name at one spot, in seconds.
// Long voices wait longer: two drones a second apart are one blur.
const COOLDOWN: Record<string, number> = {
  boom: 0.25,
  rumble: 0.4,
  drone: 2,
  crackle: 0.3,
  hiss: 0.25,
  whoosh: 0.15,
  chop: 0.6,
  clang: 0.6,
};
export const DEFAULT_COOLDOWN = 0.12;

export function cooldownOf(voice: string): number {
  return COOLDOWN[voice] ?? DEFAULT_COOLDOWN;
}

// Routine work (felling, forging) is heard only near the camera, quietly,
// never twice the same. Zoomed out, a village is ambience (item 3), not
// single tool hits from everywhere: hence the limits in cells, not only in gain.
export const ROUTINE_NEAR = 0.5;
export const ROUTINE_CELLS = 20;
export const ROUTINE_MAX_REF = 40;
export const ROUTINE_LEVEL = 0.3;
export const ROUTINE_PITCH = 0.08;

export function routineHeard(l: Listener | null, x: number | undefined, y: number | undefined): boolean {
  if (!l || x === undefined || y === undefined) return false;
  return l.ref <= ROUTINE_MAX_REF && Math.hypot(x - l.x, y - l.y) <= ROUTINE_CELLS;
}

export interface Playing {
  id: number;
  voice: string;
  started: number;
  ends: number;
  // Where it plays (NaN when unplaced), and its level at the listener when it
  // started (size times gain), for dropping the quietest.
  x: number;
  y: number;
  level: number;
  boost: number;
  priority: boolean;
}

export interface Ask {
  x?: number;
  y?: number;
  routine?: boolean;
  // The player's own cast, just now.
  priority?: boolean;
  // The listener's reference distance, for what counts as the same spot.
  ref?: number;
}

export type Admit = { play: true; drop: Playing | null } | { play: false; merge: Playing | null; why: "merged" | "cooldown" | "far" | "full" | "silent" };

// Counts since the page opened, for the HUD.
export interface BudgetStats {
  played: number;
  merged: number;
  cooled: number;
  far: number;
  full: number;
}

interface Start {
  voice: string;
  t: number;
  x: number;
  y: number;
}

export class SoundBudget {
  readonly playing: Playing[] = [];
  private starts: Start[] = [];
  private nextId = 1;
  readonly stats: BudgetStats = { played: 0, merged: 0, cooled: 0, far: 0, full: 0 };

  constructor(readonly max = MAX_VOICES) {}

  // Forgets what has ended by `now`.
  sweep(now: number): void {
    for (let i = this.playing.length - 1; i >= 0; i--) if (this.playing[i].ends <= now) this.playing.splice(i, 1);
    if (this.starts.length > 64 || (this.starts.length && now - this.starts[0].t > 2)) this.starts = this.starts.filter((s) => now - s.t <= 2);
  }

  // Whether a sound may start now. `level` is what it would be at the
  // listener. On `play`, call start() with its length.
  admit(voice: string, level: number, now: number, ask: Ask = {}): Admit {
    this.sweep(now);
    if (level <= 0.001) return { play: false, merge: null, why: "silent" };
    if (ask.routine && level < ROUTINE_NEAR * ROUTINE_LEVEL) {
      this.stats.far++;
      return { play: false, merge: null, why: "far" };
    }
    const x = ask.x ?? NaN;
    const y = ask.y ?? NaN;
    const spot = sameSpot(ask.ref ?? 15);
    const near = (sx: number, sy: number) => (Number.isNaN(x) ? Number.isNaN(sx) : Math.hypot(sx - x, sy - y) <= spot);
    let last: Start | null = null;
    for (let i = this.starts.length - 1; i >= 0; i--) {
      const s = this.starts[i];
      if (s.voice === voice && near(s.x, s.y)) {
        last = s;
        break;
      }
    }
    if (last && now - last.t < MERGE_SECONDS) {
      const into = this.playing.find((p) => p.voice === voice && p.started === last.t && near(p.x, p.y)) ?? null;
      if (into) {
        into.boost = Math.min(MERGE_CAP, into.boost * MERGE_STEP);
        into.priority ||= !!ask.priority;
      }
      this.stats.merged++;
      return { play: false, merge: into, why: "merged" };
    }
    if (last && !ask.priority && now - last.t < cooldownOf(voice)) {
      this.stats.cooled++;
      return { play: false, merge: null, why: "cooldown" };
    }
    let drop: Playing | null = null;
    if (this.playing.length >= this.max) {
      for (const p of this.playing) if (!p.priority && (!drop || p.level * p.boost < drop.level * drop.boost)) drop = p;
      if (!drop || (!ask.priority && drop.level * drop.boost >= level)) {
        this.stats.full++;
        return { play: false, merge: null, why: "full" };
      }
      this.playing.splice(this.playing.indexOf(drop), 1);
    }
    return { play: true, drop };
  }

  start(voice: string, level: number, now: number, seconds: number, ask: Ask = {}): Playing {
    const p: Playing = {
      id: this.nextId++,
      voice,
      started: now,
      ends: now + seconds,
      x: ask.x ?? NaN,
      y: ask.y ?? NaN,
      level,
      boost: 1,
      priority: !!ask.priority,
    };
    this.playing.push(p);
    this.starts.push({ voice, t: now, x: p.x, y: p.y });
    this.stats.played++;
    return p;
  }
}
