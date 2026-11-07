// Procedural sound for spells: no files, a few Web Audio voices. Spells ask
// for them by name (w.sound("rumble", 0.8)); explosions ask for "boom".
// Bigger sizes are louder and lower. Since 4.8 every sound has a place: it
// fades, dulls and pans with where it is from the camera (soundplace.ts),
// and a budget keeps a busy island from turning into noise.

import { SoundBudget, ROUTINE_LEVEL, ROUTINE_PITCH, UNPLACED, place, routineHeard, type Ask, type Listener, type Placement, type Playing } from "./soundplace";

const MUTE_KEY = "magic-merger.muted";

// The part of an audio context a voice uses. A real AudioContext is one; so
// is the offline renderer of scripts/sound-test.ts.
export type Synth = Pick<BaseAudioContext, "createOscillator" | "createGain" | "createBiquadFilter" | "createBufferSource" | "currentTime" | "sampleRate">;

// Plays at `at` into `out` and returns how long it lasts, in seconds.
export type Voice = (ctx: Synth, out: AudioNode, at: number, size: number, pitch: number) => number;

// What the HUD shows: voices and audio nodes alive now, and what the budget held back.
export interface SoundCounts {
  voices: number;
  audioNodes: number;
  merged: number;
  dropped: number;
}

// Where a sound is (in cells), whether it is routine work (only near the
// camera, quietly, varied) and whether it answers the player's cast just now.
export type SoundAt = Omit<Ask, "ref">;

interface Live {
  slot: Playing;
  bus: GainNode;
  nodes: number;
  base: number;
}

export class SpellSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private budget = new SoundBudget();
  private live: Live[] = [];
  // No sound before the player's first tap or key (browsers forbid it, and
  // it should not surprise anyone).
  private unlocked = false;
  muted = readMuted();
  // The ear, set by the engine from the camera before each batch of events.
  listener: Listener | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    const unlock = () => {
      this.unlocked = true;
      // iOS resumes a context only inside a gesture: make it here.
      this.context();
      for (const type of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(type, unlock, true);
    };
    for (const type of ["pointerdown", "keydown", "touchend"]) window.addEventListener(type, unlock, true);
    // A hidden tab makes no sound and spends no battery on it.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.hidden = true;
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (!this.muted) void this.ctx.resume();
    });
  }

  private hidden = false;

  // True once after the tab was hidden: events that piled up meanwhile are dropped.
  wasHidden(): boolean {
    const was = this.hidden;
    this.hidden = document.hidden;
    return was;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts for this page.
    }
  }

  private context(): AudioContext | null {
    if (this.muted || !this.unlocked) return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;
      this.out.connect(this.ctx.destination);
      this.noise = whiteNoise(this.ctx);
    }
    if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
    return this.ctx;
  }

  counts(): SoundCounts {
    const now = this.ctx?.currentTime ?? 0;
    this.live = this.live.filter((l) => l.slot.ends > now);
    this.budget.sweep(now);
    const s = this.budget.stats;
    // Voices as the budget counts them; nodes include the ones still fading out.
    return { voices: this.budget.playing.length, audioNodes: this.live.reduce((n, l) => n + l.nodes, 0), merged: s.merged, dropped: s.cooled + s.far + s.full };
  }

  play(name: string, size: number, at: SoundAt = {}): void {
    const ctx = this.context();
    if (!ctx || !this.out || !this.noise) return;
    const voice = voiceFor(name);
    if (!voice) return;
    if (at.routine && !routineHeard(this.listener, at.x, at.y)) return;
    const placed = at.x !== undefined && at.y !== undefined && this.listener !== null;
    const where: Placement = placed ? place(this.listener!, at.x!, at.y!) : UNPLACED;
    const ask: Ask = placed ? { ...at, ref: this.listener!.ref } : { routine: at.routine, priority: at.priority };
    const s = Math.max(0, Math.min(1, size));
    const level = (0.4 + 0.6 * s) * where.gain * (at.routine ? ROUTINE_LEVEL : 1);
    const now = ctx.currentTime;
    const ok = this.budget.admit(voice, level, now, ask);
    if (!ok.play) {
      const into = ok.merge && this.live.find((l) => l.slot === ok.merge);
      if (into) into.bus.gain.setTargetAtTime(into.base * into.slot.boost, now, 0.02);
      return;
    }
    if (ok.drop) {
      const gone = this.live.find((l) => l.slot === ok.drop);
      if (gone) {
        gone.bus.gain.setTargetAtTime(0, now, 0.015);
        gone.slot.ends = Math.min(gone.slot.ends, now + 0.1);
      }
    }
    // The way to the ear: level, a duller sound far away, left or right.
    const counter = { nodes: 3 };
    const bus = ctx.createGain();
    const base = where.gain * (at.routine ? ROUTINE_LEVEL : 1);
    bus.gain.value = base;
    const dull = ctx.createBiquadFilter();
    dull.type = "lowpass";
    dull.frequency.value = where.cutoff;
    const pan = ctx.createStereoPanner();
    pan.pan.value = where.pan;
    bus.connect(dull).connect(pan).connect(this.out);
    const pitch = at.routine ? 1 + (Math.random() * 2 - 1) * ROUTINE_PITCH : 1;
    const seconds = VOICES[voice](this.noise)(counting(ctx, counter), bus, now, s, pitch);
    const slot = this.budget.start(voice, level, now, seconds, ask);
    this.live.push({ slot, bus, nodes: counter.nodes, base });
    // The way is let go once the voice has ended.
    window.setTimeout(() => pan.disconnect(), (seconds + 0.5) * 1000);
  }
}

// Counts the nodes a voice makes, for the HUD.
function counting(ctx: Synth, counter: { nodes: number }): Synth {
  return {
    get currentTime() {
      return ctx.currentTime;
    },
    sampleRate: ctx.sampleRate,
    createOscillator: () => (counter.nodes++, ctx.createOscillator()),
    createGain: () => (counter.nodes++, ctx.createGain()),
    createBiquadFilter: () => (counter.nodes++, ctx.createBiquadFilter()),
    createBufferSource: () => (counter.nodes++, ctx.createBufferSource()),
  };
}

// A name the spell prompt does not offer (live programs ask for "hum") is
// played by the nearest voice in meaning, or not at all: it used to fall back
// to the thump, a drum under every unknown word (4.1).
const NEAREST: Record<string, string> = {
  hum: "drone",
  buzz: "drone",
  choir: "drone",
  ambient: "drone",
  bell: "chime",
  ring: "chime",
  sparkle: "chime",
  twinkle: "chime",
  shimmer: "chime",
  chirp: "ping",
  tick: "ping",
  bang: "boom",
  blast: "boom",
  explosion: "boom",
  explode: "boom",
  thunder: "rumble",
  quake: "rumble",
  roar: "rumble",
  growl: "rumble",
  wind: "whoosh",
  swoosh: "whoosh",
  gust: "whoosh",
  sizzle: "hiss",
  steam: "hiss",
  splash: "hiss",
  fire: "crackle",
  burn: "crackle",
  spark: "zap",
  lightning: "zap",
  shock: "zap",
  thud: "thump",
  stomp: "thump",
  impact: "thump",
  ascend: "rise",
  descend: "fall",
};

// The voice a spell's sound name plays, or null for silence.
export function voiceFor(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (Object.hasOwn(VOICES, n)) return n;
  return Object.hasOwn(NEAREST, n) ? NEAREST[n] : null;
}

const VOICES: Record<string, (noise: AudioBuffer) => Voice> = {
  boom: (n) => boom(n),
  thump: (n) => impact(n),
  crackle: (n) => crackle(n),
  hiss: (n) => hiss(n, 1.5),
  whoosh: (n) => whoosh(n),
  rumble: () => rumble(),
  rise: () => sweep(220, 1100),
  fall: () => sweep(1100, 160),
  chime: () => chime([523, 659, 784, 1046]),
  ping: () => ping(1500),
  drone: () => drone(),
  zap: () => zap(),
  // Routine work (4.8), heard only near the camera.
  chop: (n) => chop(n),
  clang: () => clang(),
};

// Every voice by name, for the offline checks of scripts/sound-test.ts.
export const VOICE_NAMES = Object.keys(VOICES);

export function makeVoice(name: string, noise: AudioBuffer): Voice | null {
  const v = voiceFor(name);
  return v ? VOICES[v](noise) : null;
}

// A big low explosion: thump, rumble and a long noise tail.
function boom(noise: AudioBuffer): Voice {
  return (ctx, out, t, size, pitch) => {
    // Three voices stacked were six times louder than a chime: held to 0.7.
    const level = ctx.createGain();
    level.gain.value = 0.7;
    level.connect(out);
    return Math.max(
      impact(noise)(ctx, level, t, Math.min(1, size + 0.3), pitch),
      rumble()(ctx, level, t, size, pitch),
      hiss(noise, 1 + 2 * size)(ctx, level, t, size, pitch),
    );
  };
}

// A low, slowly beating chord, for vast and eerie things.
function drone(): Voice {
  return (ctx, out, t, size, pitch) => {
    for (const f of [55, 82.4, 110.5]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = f * (1 - size * 0.3) * pitch;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 400;
      envelope(gain, t, 0.8, 3 + 3 * size, 0.08);
      osc.connect(filter).connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 7);
    }
    return 7;
  };
}

// An electric crack.
function zap(): Voice {
  return (ctx, out, t, _size, pitch) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1800 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(120 * pitch, t + 0.25);
    envelope(gain, t, 0.002, 0.25, 0.15);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.3);
    return 0.3;
  };
}

// A dull thump under every release, so each cast lands.
function impact(noise: AudioBuffer): Voice {
  return (ctx, out, t, size, pitch) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime((140 - 70 * size) * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(40 * pitch, t + 0.3 + 0.4 * size);
    envelope(gain, t, 0.005, 0.3 + 0.5 * size, 0.5 + 0.4 * size);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 1.2);
    return Math.max(1.2, hiss(noise, 0.25 + 0.3 * size)(ctx, out, t, size, pitch));
  };
}

// Many tiny noise pops at random moments, on one noise source: one node
// per pop made a crackle 96 nodes (4.8, item 9), now it is 3.
function crackle(noise: AudioBuffer): Voice {
  return (ctx, out, t, size, pitch) => {
    const pops = 12 + Math.round(20 * size);
    const length = 1 + size;
    const times: number[] = [];
    for (let i = 0; i < pops; i++) times.push(t + Math.random() * length);
    times.sort((a, b) => a - b);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    let free = t;
    for (const at of times) {
      // Pops closer than their own length would overlap on one gain: skipped.
      if (at < free) continue;
      filter.frequency.setValueAtTime((1500 + Math.random() * 2500) * pitch, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.45, at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.042);
      free = at + 0.045;
    }
    src.connect(filter).connect(gain).connect(out);
    src.start(t, Math.random());
    src.stop(t + length + 0.1);
    return length + 0.1;
  };
}

function hiss(noise: AudioBuffer, seconds: number): Voice {
  return (ctx, out, t, size, pitch) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(4000 * pitch, t);
    filter.frequency.exponentialRampToValueAtTime(600 * pitch, t + seconds);
    const gain = ctx.createGain();
    envelope(gain, t, 0.05, seconds, 0.12 + 0.1 * size);
    src.connect(filter).connect(gain).connect(out);
    src.start(t);
    src.stop(t + seconds + 0.1);
    return seconds + 0.1;
  };
}

function whoosh(noise: AudioBuffer): Voice {
  return (ctx, out, t, size, pitch) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(300 * pitch, t);
    filter.frequency.exponentialRampToValueAtTime(2500 * pitch, t + 0.25);
    filter.frequency.exponentialRampToValueAtTime(400 * pitch, t + 0.6);
    const gain = ctx.createGain();
    envelope(gain, t, 0.02, 0.6, 0.6 + 0.3 * size);
    src.connect(filter).connect(gain).connect(out);
    src.start(t);
    src.stop(t + 0.7);
    return 0.7;
  };
}

function rumble(): Voice {
  return (ctx, out, t, size, pitch) => {
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 38 * pitch;
    lfo.frequency.value = 9;
    lfoGain.gain.value = 12;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 160;
    envelope(gain, t, 0.1, 1 + 1.5 * size, 0.35 + 0.2 * size);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 3);
    lfo.stop(t + 3);
    return 3;
  };
}

function sweep(from: number, to: number): Voice {
  return (ctx, out, t, _size, pitch) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(to * pitch, t + 0.7);
    envelope(gain, t, 0.03, 0.8, 0.12);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 1);
    return 1;
  };
}

function chime(notes: number[]): Voice {
  return (ctx, out, t, _size, pitch) => {
    notes.forEach((f, i) => {
      const at = t + i * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f * 2 * pitch;
      envelope(gain, at, 0.005, 0.9, 0.1);
      osc.connect(gain).connect(out);
      osc.start(at);
      osc.stop(at + 1);
    });
    return (notes.length - 1) * 0.09 + 1;
  };
}

function ping(f: number): Voice {
  return (ctx, out, t, _size, pitch) => {
    for (const [ratio, level] of [
      [1, 0.12],
      [2.76, 0.05],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f * ratio * pitch;
      envelope(gain, t, 0.002, 0.6, level);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.8);
    }
    return 0.8;
  };
}

// An axe in wood: a short knock with a woody body and a splinter of noise.
function chop(noise: AudioBuffer): Voice {
  return (ctx, out, t, _size, pitch) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(320 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(140 * pitch, t + 0.08);
    envelope(gain, t, 0.002, 0.12, 0.35);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800 * pitch;
    filter.Q.value = 1.5;
    const g2 = ctx.createGain();
    envelope(g2, t, 0.001, 0.05, 0.25);
    src.connect(filter).connect(g2).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.1);
    return 0.25;
  };
}

// A hammer on an anvil: two bright partials that ring a little.
function clang(): Voice {
  return (ctx, out, t, _size, pitch) => {
    for (const [f, level] of [
      [880, 0.1],
      [2390, 0.06],
      [3710, 0.03],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f * pitch;
      envelope(gain, t, 0.001, 0.5, level);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.6);
    }
    return 0.6;
  };
}

// Quick attack, then an exponential fade: the shape of almost every hit.
function envelope(gain: GainNode, t: number, attack: number, decay: number, peak: number): void {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export function whiteNoise(ctx: Pick<BaseAudioContext, "createBuffer" | "sampleRate">): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
