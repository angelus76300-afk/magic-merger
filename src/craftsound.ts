// The Craft view's sounds (4.8, item 7). A small audio context of the page's
// own, made on the first tap, silent when the World's sound button is off,
// scaled by the Effects volume of the ? menu. The game designer agent shaped
// it (2026-11-08) for a player who merges 30 to 100 times a session:
//
// - the drop of a chip on another answers at once (a clink), and a slow
//   answer gets a quiet swell, so the core action is never met by silence;
// - what is heard most is quietest: picking up, a known result, a loop;
// - a known result plays a short motif made from its name, so each item has
//   its own and the ear learns them;
// - new things rise in a pentatonic arpeggio whose root and length follow the
//   tier; a First Discovery adds a sparkle and a chord that peaks as its card
//   opens (700 ms);
// - a refusal or a failure is two soft falling notes, never a buzzer.

import { TIERS, type Tier } from "../shared/tiers";
import { readSoundSettings } from "./sim/soundsettings";

const MUTE_KEY = "magic-merger.muted";

export type Synth = Pick<
  BaseAudioContext,
  "createOscillator" | "createGain" | "createBiquadFilter" | "createBufferSource" | "createBuffer" | "currentTime" | "sampleRate"
>;
// Plays at `t` into `out`; returns its length in seconds.
export type CraftVoice = (ctx: Synth, out: AudioNode, t: number) => number;

// Major pentatonic: repeated merges never clash.
const PENTA = [0, 2, 4, 7, 9];
function note(root: number, step: number): number {
  const oct = Math.floor(step / 5);
  return root + 12 * oct + PENTA[((step % 5) + 5) % 5];
}
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// Higher tiers sit lower and run longer: a cantrip is light, a cosmic thing wide.
export function tierRoot(tier: Tier): number {
  return 79 - 2 * Math.max(0, TIERS.indexOf(tier));
}
export function tierNotes(tier: Tier): number {
  return 2 + Math.max(0, TIERS.indexOf(tier)) * 0.8;
}

// A name's own motif: two notes from a hash of it.
export function nameMotif(name: string): [number, number] {
  let h = 2166136261;
  for (const ch of name.trim().toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const a = (h >>> 0) % 7;
  const b = ((h >>> 8) % 5) + 1;
  return [a, a + b];
}

function tone(ctx: Synth, out: AudioNode, t: number, f: number, seconds: number, level: number, type: OscillatorType = "sine"): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + seconds + 0.02);
}

function noiseBurst(ctx: Synth, out: AudioNode, t: number, seconds: number, level: number, filter: BiquadFilterType, freq: number): void {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

// The levels, loudest first: First Discovery 0.12, new 0.1, clink 0.08,
// known 0.04 (8 dB under new), refusal 0.035, place 0.03, loop 0.025,
// puff 0.025, pick up 0.012 (18 dB under the results).
export const CRAFT_VOICES = {
  pickUp: (): CraftVoice => (ctx, out, t) => {
    tone(ctx, out, t, 900 * (0.96 + Math.random() * 0.08), 0.04, 0.012);
    return 0.06;
  },
  place: (): CraftVoice => (ctx, out, t) => {
    tone(ctx, out, t, 620, 0.06, 0.03, "triangle");
    noiseBurst(ctx, out, t, 0.02, 0.02, "highpass", 2500);
    return 0.08;
  },
  clink: (): CraftVoice => (ctx, out, t) => {
    tone(ctx, out, t, 1800, 0.07, 0.08);
    tone(ctx, out, t + 0.012, 2710, 0.06, 0.05);
    return 0.09;
  },
  known:
    (name: string): CraftVoice =>
    (ctx, out, t) => {
      const [a, b] = nameMotif(name);
      tone(ctx, out, t, hz(note(72, a)), 0.12, 0.04);
      tone(ctx, out, t + 0.07, hz(note(72, b)), 0.14, 0.04);
      return 0.23;
    },
  loop: (): CraftVoice => (ctx, out, t) => {
    tone(ctx, out, t, hz(note(72, 2)), 0.12, 0.025);
    return 0.14;
  },
  fresh:
    (tier: Tier): CraftVoice =>
    (ctx, out, t) => {
      const root = tierRoot(tier);
      const n = Math.round(tierNotes(tier));
      for (let k = 0; k < n; k++) tone(ctx, out, t + k * 0.08, hz(note(root, k * 2)), 0.35, 0.1, k === n - 1 ? "triangle" : "sine");
      return (n - 1) * 0.08 + 0.37;
    },
  first:
    (tier: Tier): CraftVoice =>
    (ctx, out, t) => {
      const root = tierRoot(tier);
      const n = Math.round(tierNotes(tier)) + 1;
      for (let k = 0; k < n; k++) tone(ctx, out, t + k * 0.07, hz(note(root, k * 2)), 0.4, 0.1);
      // A sparkle: quick high notes.
      for (let k = 0; k < 5; k++) tone(ctx, out, t + 0.35 + k * 0.045, hz(note(root + 24, k)), 0.15, 0.04);
      // A chord that peaks as the card opens (700 ms) and fades by 1.8 s.
      for (const step of [0, 2, 4]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = hz(note(root - 12, step));
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12 / 3, t + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 1.85);
      }
      return 1.85;
    },
  refuse: (): CraftVoice => (ctx, out, t) => {
    tone(ctx, out, t, hz(76), 0.18, 0.035);
    tone(ctx, out, t + 0.12, hz(72), 0.25, 0.035);
    return 0.4;
  },
  puff: (): CraftVoice => (ctx, out, t) => {
    noiseBurst(ctx, out, t, 0.12, 0.025, "lowpass", 1400);
    return 0.13;
  },
};

// A quiet swell while a merge's answer is slow: starts after 600 ms, gone by 6 s.
export const WAIT_AFTER = 0.6;
export const WAIT_MAX = 6;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export class CraftSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private unlocked = false;
  private last = new Map<string, number>();
  private wait: { gain: GainNode | null; osc: OscillatorNode | null; timer: number } | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    const unlock = () => {
      this.unlocked = true;
      this.context();
      for (const type of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(type, unlock, true);
    };
    for (const type of ["pointerdown", "keydown", "touchend"]) window.addEventListener(type, unlock, true);
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private context(): AudioContext | null {
    if (!this.unlocked || readMuted()) return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
    // Read each time: the menu or the World's button may have changed them.
    const settings = readSoundSettings();
    this.out!.gain.value = settings.effectsVolume;
    this.ctx.destination.channelCount = settings.mono ? 1 : 2;
    return this.ctx;
  }

  // At most one of a name every 80 ms: a fast hand is not a machine gun.
  play(name: string, voice: CraftVoice): void {
    const ctx = this.context();
    if (!ctx || !this.out) return;
    const now = ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < 0.08) return;
    this.last.set(name, now);
    voice(ctx, this.out, now);
  }

  // The swell while merges' answers are on their way: one swell however many
  // are in flight, stopped when the last one answers (review of #87: with one
  // slot, the first answer cut the second merge's swell).
  private inFlight = 0;

  startWait(): void {
    this.inFlight++;
    if (this.wait) return;
    const timer = window.setTimeout(() => {
      const ctx = this.context();
      if (!ctx || !this.out || !this.wait) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(hz(64), now);
      osc.frequency.linearRampToValueAtTime(hz(71), now + WAIT_MAX - WAIT_AFTER);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.015, now + 0.8);
      gain.gain.setValueAtTime(0.015, now + WAIT_MAX - WAIT_AFTER - 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + WAIT_MAX - WAIT_AFTER);
      osc.connect(gain).connect(this.out);
      osc.start(now);
      osc.stop(now + WAIT_MAX - WAIT_AFTER + 0.05);
      this.wait.gain = gain;
      this.wait.osc = osc;
    }, WAIT_AFTER * 1000);
    this.wait = { gain: null, osc: null, timer };
  }

  stopWait(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.inFlight > 0 || !this.wait) return;
    window.clearTimeout(this.wait.timer);
    const { gain, osc } = this.wait;
    this.wait = null;
    if (gain && osc && this.ctx) {
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.05);
      osc.stop(now + 0.2);
    }
  }

  // How many merges wait for an answer (for the checks).
  get waiting(): number {
    return this.inFlight;
  }
}
