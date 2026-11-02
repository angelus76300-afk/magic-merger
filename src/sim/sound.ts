// Procedural sound for spells: no files, a few Web Audio voices. Spells ask
// for them by name (w.sound("rumble", 0.8)); explosions ask for "boom".
// Bigger sizes are louder and lower.

const MUTE_KEY = "magic-merger.muted";

type Voice = (ctx: AudioContext, out: AudioNode, at: number, size: number) => void;

export class SpellSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = readMuted();

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts for this page.
    }
  }

  // Browsers only allow audio after a user gesture; the cast tap is one.
  private context(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;
      this.out.connect(this.ctx.destination);
      this.noise = whiteNoise(this.ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  play(name: string, size: number): void {
    const ctx = this.context();
    if (!ctx || !this.out || !this.noise) return;
    const make = VOICES[name] ?? VOICES.thump;
    make(this.noise)(ctx, this.out, ctx.currentTime, Math.max(0, Math.min(1, size)));
  }
}

export const SOUND_NAMES = ["boom", "thump", "crackle", "hiss", "whoosh", "rumble", "rise", "fall", "chime", "ping", "drone", "zap"] as const;

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
};

// A big low explosion: thump, rumble and a long noise tail.
function boom(noise: AudioBuffer): Voice {
  return (ctx, out, t, size) => {
    impact(noise)(ctx, out, t, Math.min(1, size + 0.3));
    rumble()(ctx, out, t, size);
    hiss(noise, 1 + 2 * size)(ctx, out, t, size);
  };
}

// A low, slowly beating chord, for vast and eerie things.
function drone(): Voice {
  return (ctx, out, t, size) => {
    for (const f of [55, 82.4, 110.5]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = f * (1 - size * 0.3);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 400;
      envelope(gain, t, 0.8, 3 + 3 * size, 0.08);
      osc.connect(filter).connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 7);
    }
  };
}

// An electric crack.
function zap(): Voice {
  return (ctx, out, t) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1800, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.25);
    envelope(gain, t, 0.002, 0.25, 0.15);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.3);
  };
}

// A dull thump under every release, so each cast lands.
function impact(noise: AudioBuffer): Voice {
  return (ctx, out, t, size) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140 - 70 * size, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.3 + 0.4 * size);
    envelope(gain, t, 0.005, 0.3 + 0.5 * size, 0.5 + 0.4 * size);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 1.2);
    hiss(noise, 0.25 + 0.3 * size)(ctx, out, t, size);
  };
}

function crackle(noise: AudioBuffer): Voice {
  return (ctx, out, t, size) => {
    // Many tiny noise pops at random moments.
    const pops = 12 + Math.round(20 * size);
    for (let i = 0; i < pops; i++) {
      const at = t + Math.random() * (1 + size);
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1500 + Math.random() * 2500;
      const gain = ctx.createGain();
      envelope(gain, at, 0.002, 0.04, 0.15);
      src.connect(filter).connect(gain).connect(out);
      src.start(at, Math.random());
      src.stop(at + 0.06);
    }
  };
}

function hiss(noise: AudioBuffer, seconds: number): Voice {
  return (ctx, out, t, size) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(600, t + seconds);
    const gain = ctx.createGain();
    envelope(gain, t, 0.05, seconds, 0.12 + 0.1 * size);
    src.connect(filter).connect(gain).connect(out);
    src.start(t);
    src.stop(t + seconds + 0.1);
  };
}

function whoosh(noise: AudioBuffer): Voice {
  return (ctx, out, t, size) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(2500, t + 0.25);
    filter.frequency.exponentialRampToValueAtTime(400, t + 0.6);
    const gain = ctx.createGain();
    envelope(gain, t, 0.02, 0.6, 0.3 + 0.2 * size);
    src.connect(filter).connect(gain).connect(out);
    src.start(t);
    src.stop(t + 0.7);
  };
}

function rumble(): Voice {
  return (ctx, out, t, size) => {
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 38;
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
  };
}

function sweep(from: number, to: number): Voice {
  return (ctx, out, t) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + 0.7);
    envelope(gain, t, 0.03, 0.8, 0.12);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 1);
  };
}

function chime(notes: number[]): Voice {
  return (ctx, out, t) => {
    notes.forEach((f, i) => {
      const at = t + i * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f * 2;
      envelope(gain, at, 0.005, 0.9, 0.1);
      osc.connect(gain).connect(out);
      osc.start(at);
      osc.stop(at + 1);
    });
  };
}

function ping(f: number): Voice {
  return (ctx, out, t) => {
    for (const [ratio, level] of [[1, 0.12], [2.76, 0.05]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f * ratio;
      envelope(gain, t, 0.002, 0.6, level);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.8);
    }
  };
}

// Quick attack, then an exponential fade: the shape of almost every hit.
function envelope(gain: GainNode, t: number, attack: number, decay: number, peak: number): void {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
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
