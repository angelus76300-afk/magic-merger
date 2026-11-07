// 4.8 items 1, 2 and 9, in Node: every voice rendered offline (no NaN, a
// bounded length, peak and loudness in a range), sounds placed by the camera,
// and a busy island's events through the budget. Run by `npm test`.
//
// Node has no Web Audio, so this file carries a small one: oscillators,
// gains, biquad filters (the formulas of the Web Audio spec), buffer sources
// and the automation the voices use, rendered sample by sample.

import { VOICE_NAMES, makeVoice, voiceFor, whiteNoise, type Synth } from "../src/sim/sound";
import {
  MAX_VOICES,
  MERGE_CAP,
  ROUTINE_CELLS,
  SoundBudget,
  castOwns,
  cooldownOf,
  listenerAt,
  place,
  routineHeard,
  sameSpot,
  type Listener,
} from "../src/sim/soundplace";
import { generateWorld } from "../src/sim/world";
import { populate } from "../src/sim/creatures";
import { stepWorld } from "../src/sim/tick";
import { Runtime } from "../src/sim/runtime";
import { TICK } from "../src/sim/world";

const RATE = 22050;

type Ev = { kind: "set" | "lin" | "exp" | "target"; t: number; v: number; tc?: number };

class Param {
  private evs: Ev[] = [];
  readonly inputs: Node[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) {
    this.evs.push({ kind: "set", t, v });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.evs.push({ kind: "lin", t, v });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v === 0) throw new Error("exponential ramp to 0 is an error in Web Audio");
    this.evs.push({ kind: "exp", t, v });
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.evs.push({ kind: "target", t, v, tc });
    return this;
  }
  // The value at time t, as the Web Audio spec computes it, plus modulation.
  at(t: number, i: number): number {
    let v = this.value;
    let prevT = 0;
    let prevV = this.value;
    for (const e of this.evs) {
      if (e.kind === "set" || e.kind === "target") {
        if (e.t > t) break;
        if (e.kind === "set") v = e.v;
        else v = e.v + (prevV - e.v) * Math.exp(-(t - e.t) / (e.tc ?? 1));
        prevT = e.t;
        prevV = e.kind === "set" ? e.v : v;
        continue;
      }
      // A ramp runs from the previous event to its own time.
      if (t >= e.t) {
        v = e.v;
        prevT = e.t;
        prevV = e.v;
        continue;
      }
      const k = (t - prevT) / Math.max(1e-9, e.t - prevT);
      if (e.kind === "lin") v = prevV + (e.v - prevV) * k;
      else v = prevV > 0 && e.v > 0 ? prevV * Math.pow(e.v / prevV, k) : prevV;
      break;
    }
    for (const n of this.inputs) v += n.out(i);
    return v;
  }
}

abstract class Node {
  readonly inputs: Node[] = [];
  private cacheI = -1;
  private cacheV = 0;
  connect<T extends Node | Param>(to: T): T {
    if (to instanceof Param) to.inputs.push(this);
    else (to as Node).inputs.push(this);
    return to;
  }
  disconnect() {}
  protected sum(i: number): number {
    let v = 0;
    for (const n of this.inputs) v += n.out(i);
    return v;
  }
  out(i: number): number {
    if (i !== this.cacheI) {
      this.cacheI = i;
      this.cacheV = this.compute(i, i / RATE);
    }
    return this.cacheV;
  }
  protected abstract compute(i: number, t: number): number;
}

class Gain extends Node {
  readonly gain = new Param(1);
  protected compute(i: number, t: number) {
    return this.sum(i) * this.gain.at(t, i);
  }
}

class Scheduled extends Node {
  protected startT = Infinity;
  protected stopT = Infinity;
  started = 0;
  start(t = 0) {
    this.startT = t;
    this.started++;
  }
  stop(t = 0) {
    this.stopT = t;
  }
  protected live(t: number) {
    return t >= this.startT && t < this.stopT;
  }
  protected compute(_i: number, _t: number) {
    return 0;
  }
}

class Osc extends Scheduled {
  type: OscillatorType = "sine";
  readonly frequency = new Param(440);
  readonly detune = new Param(0);
  private phase = 0;
  protected compute(i: number, t: number) {
    if (!this.live(t)) return 0;
    const f = this.frequency.at(t, i) * Math.pow(2, this.detune.at(t, i) / 1200);
    this.phase = (this.phase + f / RATE) % 1;
    const p = this.phase < 0 ? this.phase + 1 : this.phase;
    switch (this.type) {
      case "square":
        return p < 0.5 ? 1 : -1;
      case "sawtooth":
        return 2 * p - 1;
      case "triangle":
        return 1 - 4 * Math.abs(p - 0.5);
      default:
        return Math.sin(2 * Math.PI * p);
    }
  }
}

class Source extends Scheduled {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = new Param(1);
  private offset = 0;
  start(t = 0, offset = 0) {
    super.start(t);
    this.offset = offset;
  }
  protected compute(i: number, t: number) {
    if (!this.live(t) || !this.buffer) return 0;
    const data = this.buffer.data;
    let k = Math.floor((t - this.startT + this.offset) * RATE * this.playbackRate.at(t, i));
    if (this.loop) k %= data.length;
    return k >= 0 && k < data.length ? data[k] : 0;
  }
}

class Biquad extends Node {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new Param(350);
  readonly Q = new Param(1);
  readonly gain = new Param(0);
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  protected compute(i: number, t: number) {
    const x = this.sum(i);
    const f = Math.max(10, Math.min(RATE / 2 - 1, this.frequency.at(t, i)));
    const q = Math.max(0.0001, this.Q.at(t, i));
    const w = (2 * Math.PI * f) / RATE;
    const cos = Math.cos(w);
    const sin = Math.sin(w);
    let b0: number, b1: number, b2: number;
    let alpha: number;
    if (this.type === "bandpass") {
      alpha = sin / (2 * q);
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    } else if (this.type === "highpass") {
      alpha = sin / (2 * Math.pow(10, q / 20));
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
    } else {
      // Web Audio's lowpass reads Q in dB.
      alpha = sin / (2 * Math.pow(10, q / 20));
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
    }
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    const y = (b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2) / a0;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class Sink extends Node {
  protected compute(i: number) {
    return this.sum(i);
  }
}

class FakeBuffer {
  readonly data: Float32Array;
  constructor(length: number) {
    this.data = new Float32Array(length);
  }
  getChannelData() {
    return this.data;
  }
}

class Offline {
  readonly sampleRate = RATE;
  currentTime = 0;
  readonly nodes: Node[] = [];
  private add<T extends Node>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  createOscillator() {
    return this.add(new Osc());
  }
  createGain() {
    return this.add(new Gain());
  }
  createBiquadFilter() {
    return this.add(new Biquad());
  }
  createBufferSource() {
    return this.add(new Source());
  }
  createBuffer(_channels: number, length: number) {
    return new FakeBuffer(length);
  }
}

let failures = 0;
let passes = 0;
function check(ok: boolean, what: string): void {
  if (ok) passes++;
  else {
    failures++;
    console.error(`FAIL ${what}`);
  }
}

interface Render {
  seconds: number;
  peak: number;
  // Loudest 50 ms window, as RMS.
  loud: number;
  nan: boolean;
  tail: number;
  nodes: number;
}

// Voices draw on Math.random (a crackle's pops, the noise). Each render runs
// on a seeded stream instead, so a run of this file is the same every time:
// unseeded, the loudness ratio below landed between 8.2 and 10.6 and failed
// about one run in three.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function render(name: string, size: number, pitch = 1, seed = 1): Render {
  const shared = Math.random;
  Math.random = seeded(seed);
  try {
    return renderNow(name, size, pitch);
  } finally {
    Math.random = shared;
  }
}

// A voice's usual loudness: the mean of several renders, so one quiet draw
// of a crackle's pops does not stand for the voice.
const LOUDNESS_RENDERS = 8;

function renderNow(name: string, size: number, pitch: number): Render {
  const ctx = new Offline();
  const noise = whiteNoise(ctx as unknown as BaseAudioContext);
  const sink = new Sink();
  const voice = makeVoice(name, noise)!;
  const seconds = voice(ctx as unknown as Synth, sink as unknown as AudioNode, 0, size, pitch);
  const n = Math.ceil((seconds + 0.25) * RATE);
  const win = Math.round(0.05 * RATE);
  let peak = 0;
  let nan = false;
  let acc = 0;
  let loud = 0;
  const sq = new Float32Array(n);
  let tail = 0;
  for (let i = 0; i < n; i++) {
    const v = sink.out(i);
    if (!Number.isFinite(v)) nan = true;
    peak = Math.max(peak, Math.abs(v));
    sq[i] = v * v;
    acc += sq[i];
    if (i >= win) acc -= sq[i - win];
    if (i >= win - 1) loud = Math.max(loud, Math.sqrt(Math.max(0, acc) / win));
    // Anything after the voice says it ended.
    if (i / RATE > seconds + 0.05) tail = Math.max(tail, Math.abs(v));
  }
  return { seconds, peak, loud, nan, tail, nodes: ctx.nodes.length };
}

// 1. Every voice, offline.
const loudness: Record<string, number> = {};
for (const name of VOICE_NAMES) {
  for (const size of [0, 0.5, 1]) {
    const r = render(name, size, size === 0.5 ? 1.08 : 1);
    check(!r.nan, `voice ${name} at size ${size}: no NaN`);
    check(r.seconds > 0 && r.seconds <= 8, `voice ${name} at size ${size}: length ${r.seconds.toFixed(2)} s is within 8 s`);
    check(r.peak > 0.01, `voice ${name} at size ${size}: it sounds (peak ${r.peak.toFixed(3)})`);
    check(r.peak <= 1.2, `voice ${name} at size ${size}: peak ${r.peak.toFixed(3)} under 1.2`);
    check(r.tail < 0.01, `voice ${name} at size ${size}: silent after the length it reports (${r.tail.toFixed(4)})`);
    check(r.nodes <= 24, `voice ${name} at size ${size}: ${r.nodes} nodes, at most 24`);
    if (size === 0.5) {
      let sum = r.loud;
      for (let seed = 2; seed <= LOUDNESS_RENDERS; seed++) sum += render(name, size, 1.08, seed).loud;
      loudness[name] = sum / LOUDNESS_RENDERS;
    }
  }
}
const louds = Object.values(loudness);
const loudest = Math.max(...louds);
const quietest = Math.min(...louds);
check(
  loudest / quietest <= 10,
  `no voice is ten times louder than another: ${Object.entries(loudness)
    .map(([k, v]) => `${k} ${v.toFixed(3)}`)
    .join(", ")}`,
);

console.log(
  `voice loudness (loudest 50 ms, RMS, size 0.5): ${Object.entries(loudness)
    .map(([k, v]) => `${k} ${v.toFixed(3)}`)
    .join(", ")}; ratio ${(loudest / quietest).toFixed(1)}`,
);

// Names spells use map to a voice or to silence, as before.
check(voiceFor("chime") === "chime" && voiceFor("Thunder") === "rumble" && voiceFor("nonsense") === null, "names map to voices as before 4.8");

// 2. Placement.
const ear: Listener = listenerAt(100, 100, 20, 0);
const here = place(ear, 100, 100);
const far = place(ear, 220, 100);
check(here.gain === 1 && here.pan === 0, "a sound at the camera's point is full and centered");
check(far.gain < 0.25 && far.cutoff < here.cutoff, `a sound 120 cells away is quieter (${far.gain.toFixed(2)}) and duller (${Math.round(far.cutoff)} Hz)`);
check(far.cutoff >= 1800, "a far chime is dulled, never filtered away: cutoff at least 1.8 kHz");
// theta 0: screen right on the ground is +x.
check(place(ear, 130, 100).pan > 0.5 && place(ear, 70, 100).pan < -0.5, "east is right and west is left at theta 0");
const turned = listenerAt(100, 100, 20, Math.PI);
check(place(turned, 130, 100).pan < -0.5, "turning the camera half round swaps left and right");
const zoomedOut = listenerAt(100, 100, 120, 0);
check(place(zoomedOut, 180, 160).gain === 1 && place(zoomedOut, 200, 100).gain > 0.8, "zoomed out the island is heard as a whole");
check(Math.abs(place(ear, 101, 100).pan) < 0.05, "a sound right under the camera is not thrown to one side");
check(routineHeard(ear, 110, 100) && !routineHeard(ear, 100 + ROUTINE_CELLS + 5, 100), "routine work is heard only near the camera");
check(!routineHeard(zoomedOut, 101, 100), "zoomed out, single tool hits are not heard");

// A sound with no place belongs to the player's cast only while one runs.
check(castOwns(2, true), "a spell's own sound, 2 s into its running cast, takes the cast's place");
check(!castOwns(2, false), "once no cast runs, a sound with no place (a creature's explosion) is not put at the old cast");
check(!castOwns(120, true), "two minutes on, a sound with no place is never put at the old cast, even while something runs");

// 3. The budget, by hand.
{
  const b = new SoundBudget();
  const a1 = b.admit("chime", 0.8, 0, { x: 10, y: 10, ref: 20 });
  check(a1.play, "a first chime plays");
  b.start("chime", 0.8, 0, 1, { x: 10, y: 10, ref: 20 });
  const merged = b.admit("chime", 0.8, 0.05, { x: 11, y: 10, ref: 20 });
  check(!merged.play && merged.why === "merged" && merged.merge?.boost === 1.4, "a second chime at the same spot within 100 ms merges and is louder");
  for (let i = 0; i < 5; i++) b.admit("chime", 0.8, 0.06, { x: 11, y: 10, ref: 20 });
  check(b.playing[0].boost <= MERGE_CAP, "merging is capped");
  check(!b.admit("chime", 0.8, 0.11, { x: 10, y: 10, ref: 20 }).play, "a chime inside its cooldown at the same spot waits");
  check(b.admit("chime", 0.8, 0.05, { x: 100, y: 10, ref: 20 }).play, "a chime far away is its own sound, not merged into the first");
  const own = new SoundBudget();
  own.start("chime", 0.2, 0, 1, { x: 10, y: 10, ref: 20 });
  const answer = own.admit("chime", 0.8, 0.105, { x: 10, y: 10, ref: 20, priority: true });
  check(answer.play, "the player's own cast skips the cooldown");
  const full = new SoundBudget(3);
  for (let i = 0; i < 3; i++) full.start(`v${i}`, 0.2 + i * 0.1, 0, 5, { x: i * 50, y: 0 });
  check(!full.admit("boom", 0.1, 0.5, { x: 0, y: 0 }).play, "when full, a sound quieter than all playing does not start");
  const loudNew = full.admit("boom", 0.9, 0.5, { x: 0, y: 0 });
  check(loudNew.play && loudNew.drop?.voice === "v0", "when full, a louder sound drops the quietest");
}

// 4. A busy island: every sound it makes through the budget, at the camera's
// point over a village, with spells landing. No name starts again at one
// spot faster than its cooldown, and never more than MAX_VOICES at once.
{
  const world = generateWorld(128, 128, 4242);
  populate(world);
  const rt = new Runtime(world, (key, _name, message) => console.error(`spell ${key}: ${message}`));
  const village = world.creatures.find((c) => c.kind === "villager") ?? { x: 64, y: 64 };
  const ear = listenerAt(village.x, village.y, 18, 0.7);
  const spell = {
    key: "test:storm",
    name: "Storm",
    tier: "major" as const,
    code: `const spell = { *cast(w) { for (let i = 0; i < 40; i++) { w.sound("chime", 0.6); w.sound("boom", 0.8); w.sound("crackle", 0.5); yield 0.05; } } };`,
  };
  const b = new SoundBudget();
  const starts: { voice: string; t: number; x: number; y: number }[] = [];
  let events = 0;
  let maxLive = 0;
  for (let tick = 0; tick < 30 * 60; tick++) {
    if (tick % 150 === 0) rt.cast(spell, village.x + (tick % 300 ? 8 : -6), village.y);
    stepWorld(world, rt);
    const now = tick * TICK;
    for (const e of world.events.splice(0)) {
      if (e.kind !== "sound") continue;
      events++;
      const voice = voiceFor(e.name);
      if (!voice) continue;
      const x = e.x ?? village.x;
      const y = e.y ?? village.y;
      if (e.routine && !routineHeard(ear, x, y)) continue;
      const level = (0.4 + 0.6 * e.size) * place(ear, x, y).gain * (e.routine ? 0.3 : 1);
      const ask = { x, y, routine: e.routine, ref: ear.ref };
      const ok = b.admit(voice, level, now, ask);
      if (!ok.play) continue;
      b.start(voice, level, now, 1, ask);
      starts.push({ voice, t: now, x, y });
      maxLive = Math.max(maxLive, b.playing.length);
    }
  }
  check(events > 200, `the busy island made sounds: ${events} events in a minute`);
  let tooSoon = "";
  for (let i = 0; i < starts.length && !tooSoon; i++)
    for (let j = i + 1; j < starts.length; j++) {
      const a = starts[i];
      const c = starts[j];
      if (c.t - a.t >= 2) break;
      if (c.voice === a.voice && Math.hypot(c.x - a.x, c.y - a.y) <= sameSpot(ear.ref) && c.t - a.t < cooldownOf(a.voice) - 1e-9) {
        tooSoon = `${a.voice} at ${a.t.toFixed(2)} s and again at ${c.t.toFixed(2)} s`;
        break;
      }
    }
  check(!tooSoon, `no name repeats at one spot faster than its cooldown${tooSoon ? `: ${tooSoon}` : ""}`);
  check(maxLive <= MAX_VOICES, `at most ${MAX_VOICES} voices at once (${maxLive})`);
  const s = b.stats;
  check(s.merged + s.cooled > 0, `the budget held back repeats: ${s.played} played, ${s.merged} merged, ${s.cooled} in cooldown, ${s.full} over the budget`);
  console.log(
    `busy island, one minute: ${events} sound events, ${s.played} played, ${s.merged} merged, ${s.cooled} in cooldown, ${s.far} too far, ${s.full} over budget, at most ${maxLive} voices`,
  );
}

console.log(`sound: ${passes} checks passed${failures ? `, ${failures} failed` : ""}`);
if (failures) process.exit(1);
