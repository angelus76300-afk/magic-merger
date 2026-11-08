// Procedural sound for spells: no files, a few Web Audio voices. Spells ask
// for them by name (w.sound("rumble", 0.8)); explosions ask for "boom".
// Bigger sizes are louder and lower. Since 4.8 every sound has a place: it
// fades, dulls and pans with where it is from the camera (soundplace.ts),
// and a budget keeps a busy island from turning into noise.

import { BEDS, chooseBeds, type Bed, type BedLevels, type Sampled } from "./ambience";
import { Composer, MoodTracker, hz, type Note } from "./music";
import { readSentSettings, readSoundSettings, type SoundSettings } from "./soundsettings";
import { SoundBudget, ROUTINE_LEVEL, ROUTINE_PITCH, UNPLACED, place, routineHeard, type Ask, type Listener, type Placement, type Playing } from "./soundplace";

const MUTE_KEY = "magic-merger.muted";

// While music plays, pitched spell voices (chime, ping) take the nearest
// note of its key, so a cast sounds part of the music (game designer,
// 2026-11-07). No stored program changes.
let tuning: ((f: number) => number) | null = null;
export function tune(f: number): number {
  return tuning ? tuning(f) : f;
}

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
  // Ambience beds heard now (item 3).
  beds: number;
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
  private ambience: Ambience | null = null;
  private music: MusicPlayer | null = null;
  // The three volumes (item 8): effects, ambience and music each on a bus.
  private fx: GainNode | null = null;
  private ambVol: GainNode | null = null;
  private musicVol: GainNode | null = null;
  settings: SoundSettings = readSoundSettings();

  constructor() {
    if (typeof window === "undefined") return;
    const unlock = () => {
      this.unlocked = true;
      // iOS resumes a context only inside a gesture: make it here.
      this.context();
      for (const type of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(type, unlock, true);
    };
    for (const type of ["pointerdown", "keydown", "touchend"]) window.addEventListener(type, unlock, true);
    // The settings come from the page around the World's frame, which alone
    // can read them (soundbridge.ts): asked for once, then sent on each change.
    // Only the parent window is heard, never the spell code in this frame.
    window.addEventListener("message", (e: MessageEvent<unknown>) => {
      if (e.source !== window.parent || window.parent === window) return;
      const settings = readSentSettings(e.data);
      if (settings) this.applySettings(settings);
    });
    if (window.parent !== window) window.parent.postMessage({ type: "sound-settings?" }, "*");
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
      this.fx = this.ctx.createGain();
      this.fx.connect(this.out);
      this.ambVol = this.ctx.createGain();
      this.ambVol.connect(this.out);
      this.musicVol = this.ctx.createGain();
      this.musicVol.connect(this.out);
      this.noise = whiteNoise(this.ctx);
      this.applySettings(this.settings);
    }
    if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
    return this.ctx;
  }

  applySettings(settings: SoundSettings): void {
    this.settings = settings;
    const ctx = this.ctx;
    if (!ctx || !this.fx || !this.ambVol || !this.musicVol) return;
    const now = ctx.currentTime;
    this.fx.gain.setTargetAtTime(settings.effectsVolume, now, 0.05);
    this.ambVol.gain.setTargetAtTime(settings.ambienceVolume, now, 0.05);
    this.musicVol.gain.setTargetAtTime(settings.musicVolume, now, 0.05);
    ctx.destination.channelCount = settings.mono ? 1 : 2;
    ctx.destination.channelCountMode = "explicit";
    ctx.destination.channelInterpretation = "speakers";
    if (!settings.music) this.stopMusic();
  }

  private stopMusic(): void {
    this.music?.stop();
    this.music = null;
    tuning = null;
  }

  // The island's beds (item 3) and the music's mood (item 6), from the
  // ambience sampler, a few times a second.
  ambient(levels: BedLevels | Sampled): void {
    const ctx = this.ctx;
    if (!ctx || !this.ambVol || !this.musicVol) return;
    if (this.muted || ctx.state !== "running") {
      this.ambience?.stop();
      this.ambience = null;
      this.stopMusic();
      return;
    }
    this.ambience ??= new Ambience(ctx, this.ambVol);
    this.ambience.set(levels, ctx.currentTime);
    if ("seed" in levels && this.settings.music) {
      this.music ??= new MusicPlayer(ctx, this.musicVol, levels.seed);
      this.music.mood(levels.night, levels.tension, ctx.currentTime);
      tuning = this.music.tuning;
    }
  }

  counts(): SoundCounts {
    const now = this.ctx?.currentTime ?? 0;
    this.live = this.live.filter((l) => l.slot.ends > now);
    this.budget.sweep(now);
    const s = this.budget.stats;
    // Voices as the budget counts them; nodes include the ones still fading out.
    return {
      voices: this.budget.playing.length,
      audioNodes: this.live.reduce((n, l) => n + l.nodes, 0) + (this.ambience?.nodes() ?? 0),
      merged: s.merged,
      dropped: s.cooled + s.far + s.full,
      beds: this.ambience?.heard() ?? 0,
    };
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
    bus.connect(dull).connect(pan).connect(this.fx!);
    const pitch = at.routine ? 1 + (Math.random() * 2 - 1) * ROUTINE_PITCH : 1;
    const seconds = VOICES[voice](this.noise)(counting(ctx, counter), bus, now, s, pitch);
    const slot = this.budget.start(voice, level, now, seconds, ask);
    // The beds and the music give way to what happens (items 3 and 6), for
    // sounds of size 0.5 or more; a big one swells the music; the player's
    // own cast gets the island's three notes, once a minute at most.
    if (!at.routine && s >= 0.5) {
      this.ambience?.duck(now);
      this.music?.duck(now);
    }
    if (!at.routine && s >= 0.8) this.music?.swell(now);
    if (at.priority) this.music?.motif(now);
    this.live.push({ slot, bus, nodes: counter.nodes, base });
    // The way is let go once the voice has ended.
    window.setTimeout(() => pan.disconnect(), (seconds + 0.5) * 1000);
  }
}

// The island's beds (4.8, item 3). Each bed is made when it is first heard
// and let go after 2 s of silence, for battery and nodes. Levels rise over
// about 0.6 s and fall over 1.5 s, so a pan of the camera is smooth. The
// beds sit under every other sound and duck for 1.5 s under each one. Bands
// stay above 300 Hz, which phone speakers barely play.
const AMBIENCE_LEVEL = 0.35;
const DUCKED = 0.4;
const DUCK_SECONDS = 1.5;
const RISE = 0.2;
const FALL = 0.5;
const IDLE_SECONDS = 2;
// Phone speakers are loudest and most tiring up high: leaves and rain 5 dB down.
const BED_GAIN: Record<Bed, number> = { surf: 1, leaves: 0.56, fire: 1, lava: 1, edge: 0.9, rain: 0.56, birds: 1, crickets: 0.5 };

interface BedNodes {
  level: GainNode;
  stop: (at: number) => void;
  // Called each update while heard, for beds made of events (pops, chirps).
  tick?: (now: number, level: number) => void;
  nodes: number;
  silentSince: number;
}

class Ambience {
  private bus: GainNode;
  private beds = new Map<Bed, BedNodes>();
  private heardBeds: Bed[] = [];
  private loop: AudioBuffer;
  private duckUntil = 0;
  private startedAt: number;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
  ) {
    this.bus = ctx.createGain();
    // A 2 s fade in after the first tap.
    this.startedAt = ctx.currentTime;
    this.bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.bus.gain.exponentialRampToValueAtTime(AMBIENCE_LEVEL, ctx.currentTime + 2);
    this.bus.connect(out);
    // 5 s of noise: short loops repeat audibly.
    this.loop = noiseOf(ctx, 5);
  }

  duck(now: number): void {
    if (now < this.startedAt + 2) return;
    // Held, never retriggered: a spell's three sounds are one duck, not three.
    const ducked = this.duckUntil > now;
    this.duckUntil = now + DUCK_SECONDS;
    if (!ducked) this.bus.gain.setTargetAtTime(AMBIENCE_LEVEL * DUCKED, now, 0.05);
  }

  heard(): number {
    return [...this.beds.values()].filter((b) => b.silentSince === Infinity).length;
  }

  nodes(): number {
    let n = 1;
    for (const b of this.beds.values()) n += b.nodes;
    return n;
  }

  set(raw: BedLevels, now: number): void {
    const chosen = chooseBeds(raw, this.heardBeds);
    this.heardBeds = chosen.heard;
    if (this.duckUntil && now >= this.duckUntil) {
      this.duckUntil = 0;
      this.bus.gain.setTargetAtTime(AMBIENCE_LEVEL, now, 0.3);
    }
    for (const bed of BEDS) {
      const level = chosen.levels[bed] * BED_GAIN[bed];
      let b = this.beds.get(bed);
      if (level > 0.02) {
        if (!b) {
          b = this.make(bed, now);
          this.beds.set(bed, b);
        }
        b.silentSince = Infinity;
        b.level.gain.setTargetAtTime(level, now, RISE);
        b.tick?.(now, level);
      } else if (b) {
        if (b.silentSince === Infinity) {
          b.silentSince = now;
          b.level.gain.setTargetAtTime(0.0001, now, FALL);
        } else if (now - b.silentSince > IDLE_SECONDS + 3 * FALL) {
          b.stop(now);
          this.beds.delete(bed);
        }
      }
    }
  }

  stop(): void {
    const now = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(0.0001, now, 0.1);
    for (const b of this.beds.values()) b.stop(now + 0.5);
    this.beds.clear();
    window.setTimeout(() => this.bus.disconnect(), 800);
  }

  private make(bed: Bed, now: number): BedNodes {
    const ctx = this.ctx;
    const level = ctx.createGain();
    level.gain.value = 0.0001;
    level.connect(this.bus);
    const made = BED_MAKERS[bed](ctx, this.loop, level, now);
    // Read live: a bout bed's nodes change as it sings (review of #76).
    return {
      level,
      stop: made.stop,
      tick: made.tick,
      get nodes() {
        return made.nodes + 1;
      },
      silentSince: Infinity,
    };
  }
}

export type BedMaker = (
  ctx: AudioContext,
  loop: AudioBuffer,
  out: AudioNode,
  now: number,
) => { stop: (at: number) => void; tick?: BedNodes["tick"]; nodes: number };

// A filtered noise loop with a slow swell: the shape of surf, wind and rain.
function washBed(filterType: BiquadFilterType, freq: number, q: number, swellHz: number, swell: number, gain = 1): BedMaker {
  return (ctx, loop, out, now) => {
    const src = ctx.createBufferSource();
    src.buffer = loop;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const wobble = ctx.createGain();
    wobble.gain.value = (1 - swell) * gain;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = swellHz * (0.8 + 0.4 * Math.random());
    const depth = ctx.createGain();
    depth.gain.value = swell * gain;
    lfo.connect(depth).connect(wobble.gain);
    src.connect(filter).connect(wobble).connect(out);
    src.start(now, Math.random() * loop.duration);
    lfo.start(now);
    return {
      stop: (at) => {
        src.stop(at);
        lfo.stop(at);
      },
      nodes: 5,
    };
  };
}

// Short events on one source and one gain, made a little ahead each update:
// fire's pops, lava's bubbles.
function popBed(
  make: (ctx: AudioContext, loop: AudioBuffer, gain: GainNode) => { src: AudioScheduledSourceNode; nodes: number; pop: (at: number) => void },
  perSecondAtFull: number,
): BedMaker {
  return (ctx, loop, out, now) => {
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(out);
    const m = make(ctx, loop, gain);
    m.src.start(now);
    let until = now;
    return {
      stop: (at) => m.src.stop(at),
      tick: (t, level) => {
        // Fill the next 0.3 s with events at a rate that follows the level.
        const end = t + 0.3;
        const rate = perSecondAtFull * Math.max(0.2, level);
        while (until < end) {
          until = Math.max(until, t) + (0.3 + Math.random()) / rate;
          if (until < end + 0.3) m.pop(until);
        }
      },
      nodes: m.nodes + 1,
    };
  };
}

// Birds and crickets come in bouts with quiet between: an unbroken chorus is
// the first thing a player mutes (game designer, 2026-11-07).
function boutBed(
  make: (ctx: AudioContext, out: AudioNode, at: number) => number,
  boutSeconds: [number, number],
  quietSeconds: [number, number],
  gapSeconds: [number, number],
): BedMaker {
  return (ctx, _loop, out, now) => {
    let boutEnds = now + rand(boutSeconds);
    let next = now + 0.5;
    let made = 0;
    return {
      stop: () => {},
      tick: (t) => {
        const end = t + 0.3;
        while (next < end) {
          if (next > boutEnds) {
            next = boutEnds + rand(quietSeconds);
            boutEnds = next + rand(boutSeconds);
            continue;
          }
          make(ctx, out, Math.max(next, t));
          made++;
          next += rand(gapSeconds);
        }
      },
      get nodes() {
        return Math.min(made, 4) * 2;
      },
    };
  };
}

function rand([a, b]: [number, number]): number {
  return a + Math.random() * (b - a);
}

// For the offline checks of scripts/sound-test.ts.
export function bedMaker(bed: Bed): BedMaker {
  return BED_MAKERS[bed];
}

const BED_MAKERS: Record<Bed, BedMaker> = {
  // Surf: 300 to 1200 Hz, swelling every 6 to 9 s.
  surf: washBed("bandpass", 650, 0.6, 0.13, 0.6, 0.6),
  leaves: washBed("bandpass", 2500, 1.2, 0.3, 0.5, 0.6),
  edge: washBed("bandpass", 420, 0.8, 0.07, 0.5, 0.8),
  // A high pass lets most of white noise through: held to 0.25.
  rain: washBed("highpass", 3000, 0.7, 0.05, 0.15, 0.25),
  fire: popBed((ctx, loop, gain) => {
    const src = ctx.createBufferSource();
    src.buffer = loop;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1600;
    src.connect(filter).connect(gain);
    return {
      src,
      nodes: 2,
      pop: (at) => {
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(1 + Math.random() * 0.6, at + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      },
    };
  }, 14),
  // Lava: pitched bubbles at 300 to 900 Hz, not a rumble a phone cannot play.
  lava: popBed((ctx, _loop, gain) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.connect(gain);
    return {
      src: osc,
      nodes: 1,
      pop: (at) => {
        const f = 300 + Math.random() * 600;
        osc.frequency.setValueAtTime(f, at);
        osc.frequency.exponentialRampToValueAtTime(f * 1.6, at + 0.08);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.35, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
      },
    };
  }, 5),
  birds: boutBed(
    (ctx, out, at) => VOICES.chirp(null as unknown as AudioBuffer)(ctx, out, at, 0.5, 0.85 + Math.random() * 0.3),
    [1.5, 2.5],
    [8, 20],
    [0.3, 0.6],
  ),
  crickets: boutBed(
    (ctx, out, at) => {
      // A trill: a 3.8 kHz tone pulsed fast for a short while.
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 3800 + Math.random() * 300;
      gain.gain.setValueAtTime(0.0001, at);
      for (let k = 0; k < 6; k++) {
        const p = at + k * 0.035;
        gain.gain.setValueAtTime(0.0001, p);
        gain.gain.exponentialRampToValueAtTime(0.08, p + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, p + 0.025);
      }
      osc.connect(gain).connect(out);
      osc.start(at);
      osc.stop(at + 0.25);
      return 0.25;
    },
    [4, 10],
    [5, 12],
    [0.5, 0.9],
  ),
};

function noiseOf(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Music that follows the island (4.8, item 6). The notes come from
// music.ts's Composer, bar by bar, scheduled 250 ms ahead on a 100 ms timer,
// never from the drawing frame. Layers fade with the mood over about 6 s.
const MUSIC_LEVEL = 0.25;
const MUSIC_DUCK = 0.63;
const MOTIF_GAP = 60;

export class MusicPlayer {
  readonly composer: Composer;
  private tracker = new MoodTracker();
  private bus: GainNode;
  private layers: Record<"pad" | "bass" | "melody", GainNode>;
  private timer = 0;
  private nextBar: number;
  private night = 0;
  private tense = false;
  private moodAt = -1;
  private duckUntil = 0;
  private motifAt = -Infinity;
  private beat = 60 / 66;
  readonly tuning: (f: number) => number;
  // For the offline checks: every note scheduled, with its time.
  readonly played: { at: number; layer: string; midi: number }[] = [];
  keep = false;

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    seed: number,
    timers = true,
  ) {
    this.composer = new Composer(seed);
    this.tuning = (f) => this.composer.snap(f);
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.bus.gain.exponentialRampToValueAtTime(MUSIC_LEVEL, ctx.currentTime + 4);
    this.bus.connect(out);
    const layer = () => {
      const g = ctx.createGain();
      g.connect(this.bus);
      return g;
    };
    this.layers = { pad: layer(), bass: layer(), melody: layer() };
    this.nextBar = ctx.currentTime + 0.5;
    if (timers && typeof window !== "undefined") this.timer = window.setInterval(() => this.schedule(this.ctx.currentTime), 100);
  }

  mood(night: number, threat: number, now: number): void {
    const seconds = this.moodAt < 0 ? 0 : Math.min(1, now - this.moodAt);
    this.moodAt = now;
    this.night = night;
    this.tense = this.tracker.update(threat, seconds);
  }

  // Fills the next 250 ms with notes.
  schedule(now: number): void {
    if (this.nextBar < now) this.nextBar = now + 0.05;
    while (this.nextBar < now + 0.25) {
      const bar = this.composer.next({ night: this.night, tense: this.tense });
      this.beat = 60 / bar.bpm;
      for (const n of bar.notes) this.play(n, this.nextBar + n.beat * this.beat);
      this.nextBar += 4 * this.beat;
    }
  }

  private play(n: Note, at: number): void {
    const ctx = this.ctx;
    const f = hz(n.midi);
    const seconds = n.beats * this.beat;
    const out = this.layers[n.layer];
    const gain = ctx.createGain();
    gain.connect(out);
    if (this.keep) this.played.push({ at, layer: n.layer, midi: n.midi });
    if (n.layer === "pad") {
      // Two detuned triangles, soft: a slow swell in, a long fade out.
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1200;
      filter.connect(gain);
      for (const cents of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f;
        osc.detune.value = cents;
        osc.connect(filter);
        osc.start(at);
        osc.stop(at + seconds + 2.2);
      }
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.05 * n.level, at + 1.5);
      gain.gain.setValueAtTime(0.05 * n.level, at + Math.max(1.6, seconds));
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 2);
    } else if (n.layer === "bass") {
      for (const [type, level] of [
        ["sine", 1],
        ["triangle", 0.3],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(gain);
        osc.start(at);
        osc.stop(at + seconds + 0.3);
      }
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12 * n.level, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 0.25);
    } else {
      // A bell: a sine and a quiet partial a little above the octave.
      for (const [ratio, level] of [
        [1, 1],
        [2.01, 0.3],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.frequency.value = f * ratio;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(gain);
        osc.start(at);
        osc.stop(at + seconds + 1.6);
      }
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.07 * n.level, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 1.5);
    }
  }

  // Under a sound of size 0.5 or more: -4 dB, held, never retriggered.
  duck(now: number): void {
    const ducked = this.duckUntil > now;
    this.duckUntil = now + 1.5;
    if (ducked) return;
    this.bus.gain.setTargetAtTime(MUSIC_LEVEL * MUSIC_DUCK, now, 0.05);
    this.bus.gain.setTargetAtTime(MUSIC_LEVEL, now + 1.5, 0.5);
  }

  // A big spell: the pad swells for 3 s.
  swell(now: number): void {
    const pad = this.layers.pad.gain;
    pad.setTargetAtTime(1.6, now, 0.3);
    pad.setTargetAtTime(1, now + 3, 0.8);
  }

  // The island's three notes on the next beat, once a minute at most.
  motif(now: number): void {
    if (now - this.motifAt < MOTIF_GAP) return;
    this.motifAt = now;
    const at = this.nextBar - Math.floor((this.nextBar - now) / this.beat) * this.beat;
    this.composer.motif().forEach((midi, k) => this.play({ layer: "melody", beat: 0, beats: 0.75, midi, level: 1 }, at + k * this.beat * 0.5));
  }

  stop(): void {
    window.clearInterval(this.timer);
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(0.0001, now, 0.5);
    window.setTimeout(() => this.bus.disconnect(), 3000);
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
  // Creature calls (4.8, item 4), by body plan (ambience.ts, CALLS).
  chirp: () => chirp(),
  grunt: (n) => grunt(n),
  howl: () => howl(),
  roar: (n) => roar(n),
  squelch: (n) => squelch(n),
  buzz: () => buzz(),
  click: (n) => click(n),
  grind: (n) => grind(n),
  whisper: (n) => whisper(n),
  creak: () => creak(),
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
      osc.frequency.value = tune(f * 2 * pitch);
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
      osc.frequency.value = tune(f * ratio * pitch);
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

// A small bird: two or three quick rising whistles.
function chirp(): Voice {
  return (ctx, out, t, _size, pitch) => {
    const notes = 2 + Math.floor(Math.random() * 2);
    const base = (2600 + Math.random() * 1400) * pitch;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < notes; i++) {
      const at = t + i * 0.11;
      osc.frequency.setValueAtTime(base, at);
      osc.frequency.exponentialRampToValueAtTime(base * 1.5, at + 0.06);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    }
    osc.connect(gain).connect(out);
    osc.start(t);
    const end = t + notes * 0.11 + 0.05;
    osc.stop(end);
    return end - t;
  };
}

// A beast on four legs: a short low grunt, voiced and breathy.
function grunt(noise: AudioBuffer): Voice {
  return (ctx, out, t, size, pitch) => {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime((140 - 40 * size) * pitch, t);
    osc.frequency.exponentialRampToValueAtTime((95 - 25 * size) * pitch, t + 0.3);
    filter.type = "lowpass";
    filter.frequency.value = 600 * pitch;
    envelope(gain, t, 0.03, 0.3, 0.3);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.4);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const g2 = ctx.createGain();
    envelope(g2, t, 0.02, 0.25, 0.05);
    src.connect(g2).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.35);
    return 0.4;
  };
}

// A wolf at night: a long rising then falling tone with a slow vibrato.
function howl(): Voice {
  return (ctx, out, t, _size, pitch) => {
    const osc = ctx.createOscillator();
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = "triangle";
    const f = (380 + Math.random() * 80) * pitch;
    osc.frequency.setValueAtTime(f * 0.75, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.5);
    osc.frequency.setValueAtTime(f, t + 1.4);
    osc.frequency.exponentialRampToValueAtTime(f * 0.6, t + 2.2);
    vib.frequency.value = 5;
    vibGain.gain.value = f * 0.015;
    vib.connect(vibGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.4);
    gain.gain.setValueAtTime(0.14, t + 1.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    osc.connect(gain).connect(out);
    osc.start(t);
    vib.start(t);
    osc.stop(t + 2.4);
    vib.stop(t + 2.4);
    return 2.4;
  };
}

// A dragon: a growl of low saw and rough noise, swelling then falling.
function roar(noise: AudioBuffer): Voice {
  return (ctx, out, t, size, pitch) => {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(70 * pitch, t);
    osc.frequency.linearRampToValueAtTime(95 * pitch, t + 0.5);
    osc.frequency.exponentialRampToValueAtTime(50 * pitch, t + 1.4);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.linearRampToValueAtTime(1200, t + 0.4);
    filter.frequency.exponentialRampToValueAtTime(300, t + 1.4);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3 + 0.1 * size, t + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 1.6);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 700 * pitch;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.2, t + 0.25);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    src.connect(nf).connect(g2).connect(out);
    src.start(t, Math.random());
    src.stop(t + 1.6);
    return 1.6;
  };
}

// A slime: a wet low blip, falling fast, with a smack of filtered noise.
function squelch(noise: AudioBuffer): Voice {
  return (ctx, out, t, _size, pitch) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(320 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(90 * pitch, t + 0.15);
    envelope(gain, t, 0.005, 0.18, 0.3);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.25);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const g2 = ctx.createGain();
    envelope(g2, t, 0.003, 0.08, 0.15);
    src.connect(filter).connect(g2).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.15);
    return 0.25;
  };
}

// An insect: a short buzz, a square wave wobbling quickly.
function buzz(): Voice {
  return (ctx, out, t, _size, pitch) => {
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = (210 + Math.random() * 40) * pitch;
    lfo.frequency.value = 28;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(osc.frequency);
    filter.type = "lowpass";
    filter.frequency.value = 1600;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.05);
    gain.gain.setValueAtTime(0.08, t + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.65);
    lfo.stop(t + 0.65);
    return 0.65;
  };
}

// A spider: a few dry clicks.
function click(noise: AudioBuffer): Voice {
  return (ctx, out, t, _size, pitch) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 3500 * pitch;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    const clicks = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < clicks; i++) {
      const at = t + i * 0.07;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(2.5, at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);
    }
    src.connect(filter).connect(gain).connect(out);
    src.start(t, Math.random());
    const end = t + clicks * 0.07 + 0.05;
    src.stop(end);
    return end - t;
  };
}

// A golem: stone grinding on stone, low rough noise rising and falling.
function grind(noise: AudioBuffer): Voice {
  return (ctx, out, t, _size, pitch) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(180 * pitch, t);
    filter.frequency.linearRampToValueAtTime(320 * pitch, t + 0.5);
    filter.frequency.linearRampToValueAtTime(150 * pitch, t + 1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    src.connect(filter).connect(gain).connect(out);
    src.start(t, Math.random());
    src.stop(t + 1.05);
    return 1.05;
  };
}

// A spirit: a breathy whisper, noise through a narrow sweeping band.
function whisper(noise: AudioBuffer): Voice {
  return (ctx, out, t, _size, pitch) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(1800 * pitch, t);
    filter.frequency.exponentialRampToValueAtTime(3200 * pitch, t + 0.4);
    filter.frequency.exponentialRampToValueAtTime(1400 * pitch, t + 0.9);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.7, t + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(filter).connect(gain).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.95);
    return 0.95;
  };
}

// Tree folk: wood bending, a slow low creak.
function creak(): Voice {
  return (ctx, out, t, _size, pitch) => {
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(90 * pitch, t);
    osc.frequency.linearRampToValueAtTime(130 * pitch, t + 0.7);
    lfo.type = "square";
    lfo.frequency.value = 22;
    lfoGain.gain.value = 0.5;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    lfo.connect(lfoGain).connect(am.gain);
    filter.type = "bandpass";
    filter.frequency.value = 500;
    filter.Q.value = 2;
    envelope(gain, t, 0.08, 0.7, 0.9);
    osc.connect(am).connect(filter).connect(gain).connect(out);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.85);
    lfo.stop(t + 0.85);
    return 0.85;
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
