// Music that follows the island (4.8, item 6). Pure: from the island's seed,
// a key, a mode, a tempo and a few chord progressions; bar by bar, the notes
// of a pad, a bass and a sparse melody, by the mood of what the camera sees.
// sound.ts plays them on a timer, ahead of time; scripts/sound-test.ts checks
// that they stay in key, rest often and follow the mood.

export const MODES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const;
export type Mode = keyof typeof MODES;
const MODE_NAMES = Object.keys(MODES) as Mode[];

export interface Score {
  // MIDI note of the key's root, in the bass octave (36 to 47).
  root: number;
  mode: Mode;
  bpm: number;
  // Chords as scale degrees (0 to 6), four to a progression.
  progressions: number[][];
}

export type Layer = "pad" | "bass" | "melody";

export interface Note {
  layer: Layer;
  // Beats from the start of the bar (4 beats to a bar).
  beat: number;
  beats: number;
  midi: number;
  level: number;
}

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Progressions that sound settled in any of the four modes.
const PROGRESSIONS = [
  [0, 3, 4, 0],
  [0, 5, 3, 4],
  [0, 2, 3, 0],
  [0, 6, 5, 4],
  [0, 3, 0, 4],
  [5, 3, 0, 4],
];
// Tension: darker, unresolved.
const TENSE = [0, 5, 1, 5];

export function scoreOf(seed: number): Score {
  const rng = seeded(seed * 2654435761);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
  const progressions: number[][] = [];
  const pool = [...PROGRESSIONS];
  for (let k = 0; k < 3; k++) progressions.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return { root: 36 + Math.floor(rng() * 12), mode: pick(MODE_NAMES), bpm: Math.round(58 + rng() * 18), progressions };
}

// The key and tempo of the moment: at night the relative minor, 10% slower.
export function keyOf(score: Score, night: boolean): { root: number; mode: Mode; bpm: number } {
  if (!night) return { root: score.root, mode: score.mode, bpm: score.bpm };
  return { root: score.root - 3 < 36 ? score.root + 9 : score.root - 3, mode: "aeolian", bpm: Math.round(score.bpm * 0.9) };
}

// The MIDI note of a scale degree (any integer, octaves wrap) above a root.
export function degree(root: number, mode: Mode, d: number): number {
  const s = MODES[mode];
  const oct = Math.floor(d / 7);
  return root + 12 * oct + s[((d % 7) + 7) % 7];
}

// Every pitch class the key allows.
export function inKey(root: number, mode: Mode, midi: number): boolean {
  return (MODES[mode] as readonly number[]).includes((((midi - root) % 12) + 12) % 12);
}

// Plays 16 bars, then rests 8 to 24 (the pad alone at 30%, or nothing):
// about half the time on, as ambient game music does (game designer,
// 2026-11-07). Key and tempo change only at a phrase's start.
export const PHRASE_BARS = 16;
export const REST_BARS: [number, number] = [8, 24];

// Tension needs 3 s of threat to come and 12 s without to go, or the mood
// flips with every spark.
export const TENSION_IN = 3;
export const TENSION_OUT = 12;

export class MoodTracker {
  private threatFor = 0;
  private calmFor = 0;
  tense = false;

  // `threat` 0 to 1 from the sampler, `seconds` since the last update.
  update(threat: number, seconds: number): boolean {
    if (threat > 0.5) {
      this.threatFor += seconds;
      this.calmFor = 0;
    } else {
      this.calmFor += seconds;
      this.threatFor = 0;
    }
    if (!this.tense && this.threatFor >= TENSION_IN) this.tense = true;
    if (this.tense && this.calmFor >= TENSION_OUT) this.tense = false;
    return this.tense;
  }
}

// Writes the music bar by bar. One per island.
export class Composer {
  readonly score: Score;
  // Two short motifs per island (scale steps), so a returning player
  // recognises their island; phrases vary them and end on a chord tone.
  readonly motifs: number[][];
  private rng: () => number;
  private bar = 0;
  private phraseLeft = PHRASE_BARS;
  private resting = 0;
  private restPad = true;
  private progression = 0;
  private key: { root: number; mode: Mode; bpm: number };
  private keyNight = false;
  private keyTense = false;

  constructor(seed: number) {
    this.score = scoreOf(seed);
    this.rng = seeded(seed ^ 0x5bd1e995);
    const m = seeded(seed * 31 + 7);
    const motif = () => {
      const len = 4 + Math.floor(m() * 3);
      const steps = [0];
      for (let k = 1; k < len; k++) steps.push(steps[k - 1] + [-2, -1, 1, 1, 2][Math.floor(m() * 5)]);
      return steps;
    };
    this.motifs = [motif(), motif()];
    this.key = keyOf(this.score, false);
  }

  get inRest(): boolean {
    return this.resting > 0;
  }

  // The key now (it only changes when a phrase starts).
  get current(): { root: number; mode: Mode; bpm: number } {
    return this.key;
  }

  // The key, tempo and notes of the next bar. `tense` comes from a MoodTracker.
  next(mood: { night: number; tense: boolean }): { root: number; mode: Mode; bpm: number; notes: Note[]; rest: boolean } {
    const rng = this.rng;
    const notes: Note[] = [];
    if (this.phraseLeft <= 0 && this.resting <= 0) {
      this.resting = REST_BARS[0] + Math.floor(rng() * (REST_BARS[1] - REST_BARS[0] + 1));
      this.restPad = rng() < 0.5;
      this.progression = Math.floor(rng() * this.score.progressions.length);
    }
    // A new phrase: the key and mood it plays in are taken now.
    if (this.phraseLeft === PHRASE_BARS && this.resting <= 0) {
      this.keyNight = mood.night > 0.5;
      this.key = keyOf(this.score, this.keyNight);
    }
    // Tension may start mid phrase (a monster does not wait), but not the key.
    this.keyTense = mood.tense;
    const key = this.key;
    const night = this.keyNight;
    const tense = this.keyTense;
    const rest = this.resting > 0;
    const prog = tense ? TENSE : this.score.progressions[this.progression];
    const chordDeg = prog[Math.floor(this.bar / 2) % prog.length];
    if (this.bar % 2 === 0 && (!rest || this.restPad)) {
      for (const step of [0, 2, 4])
        notes.push({ layer: "pad", beat: 0, beats: 8, midi: degree(key.root + 12, key.mode, chordDeg + step), level: rest ? 0.3 : 1 });
    }
    if (!rest) {
      if (!night || tense) {
        const root = degree(key.root, key.mode, chordDeg);
        if (tense) for (let b = 0; b < 4; b += 0.5) notes.push({ layer: "bass", beat: b, beats: 0.4, midi: root, level: b % 1 ? 0.6 : 0.9 });
        else {
          notes.push({ layer: "bass", beat: 0, beats: 2, midi: root, level: 1 });
          if (rng() < 0.4) notes.push({ layer: "bass", beat: 2, beats: 2, midi: degree(key.root, key.mode, chordDeg + 4), level: 0.7 });
        }
      }
      // Melody: a phrase from one of the island's motifs on the first bar of
      // every 4 (every 8 at night), none in tension; it ends on a chord tone.
      const every = night ? 8 : 4;
      const played = PHRASE_BARS - this.phraseLeft;
      if (!tense && played % every === 0) {
        const motif = this.motifs[Math.floor(rng() * 2)];
        const shift = rng() < 0.5 ? 0 : 2 * (rng() < 0.5 ? -1 : 1);
        const start = chordDeg + 7 + shift;
        motif.forEach((step, k) => {
          const last = k === motif.length - 1;
          // The last note lands on the chord's root, third or fifth.
          const d = last
            ? chordDeg +
              7 +
              [0, 2, 4].reduce((best, c) => (Math.abs(start + step - (chordDeg + 7 + c)) < Math.abs(start + step - (chordDeg + 7 + best)) ? c : best), 0)
            : start + step;
          notes.push({
            layer: "melody",
            beat: k * 0.5 + (k > 1 ? 0.5 : 0),
            beats: last ? 2 : 0.75,
            midi: degree(key.root + 12, key.mode, d),
            level: last ? 0.9 : 0.75,
          });
        });
      }
      this.phraseLeft--;
    } else {
      this.resting--;
      if (this.resting === 0) this.phraseLeft = PHRASE_BARS;
    }
    this.bar++;
    return { ...key, notes, rest };
  }

  // Three rising notes for the player's cast: root, third and fifth of the key.
  motif(): number[] {
    return [0, 2, 4].map((d) => degree(this.key.root + 24, this.key.mode, d));
  }

  // The nearest note of the key to a frequency, so a spell's chime or ping
  // sounds part of the music (game designer, 2026-11-07).
  snap(f: number): number {
    const midi = 69 + 12 * Math.log2(f / 440);
    let best = Math.round(midi);
    for (let d = 0; d <= 6; d++) {
      for (const sign of [1, -1]) {
        const m = Math.round(midi) + sign * d;
        if (inKey(this.key.root, this.key.mode, m)) {
          best = m;
          return hz(best);
        }
      }
    }
    return hz(best);
  }
}

export function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
