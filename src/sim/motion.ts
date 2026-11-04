import type { Creature } from "./creatures";

// How creatures move, measured (4.3). Off unless a test turns it on: the
// simulation calls the hooks below behind one null check, so playing costs
// nothing.
//
// A sharp turn is a change of heading of more than 150 degrees within half a
// second, read from where the creature actually went (its step this tick),
// and separately from where its mind wanted to go (the intent). A turn is
// natural when the creature had just finished something in that half
// second: a task done, a target reached, a catch, a load delivered. Any other
// sharp turn is a flip-flop: a decision taken back.
//
// The action at a turn is the branch of updateCreature that drove the step
// ("pursue:graze", "flee", "social:fear", "plan" and so on), and "a>b" when
// the drive changed within the half second, which says which two decisions
// fought.

export const TURN_DEGREES = 150;
export const TURN_WINDOW = 0.5;

interface Track {
  x: number;
  y: number;
  // Headings of the last half second: time, angle (radians), for the step
  // and the intent.
  steps: Window;
  intents: Window;
  natural: number;
  drive: string;
  drives: [number, string][];
}

export interface KindMotion {
  // Creature seconds alive and awake (not frozen, asleep or dead).
  seconds: number;
  turns: number;
  natural: number;
  // Turns of the intent, and those not explained by something finished.
  intentTurns: number;
  intentFlips: number;
  stuck: number;
  actionChanges: number;
  // Steps of more than half a cell in one tick: a hop out of a hollow, seen
  // as a jump (unstick and life.free).
  hops: number;
  // Flip-flops (turns of the step) by drive.
  flips: Record<string, number>;
  // Natural turns by what was finished.
  naturalBy: Record<string, number>;
}

export class MotionMeter {
  kinds: Record<string, KindMotion> = {};
  private tracks = new Map<number, Track>();
  private time = 0;
  private why = new Map<number, string>();
  // Dev only: told of every flip-flop (scripts/motion-run.ts, TRACE=deer).
  log: ((c: Creature, key: string, time: number) => void) | null = null;

  private kind(name: string): KindMotion {
    return (this.kinds[name] ??= {
      seconds: 0,
      turns: 0,
      natural: 0,
      intentTurns: 0,
      intentFlips: 0,
      stuck: 0,
      actionChanges: 0,
      hops: 0,
      flips: {},
      naturalBy: {},
    });
  }

  // Something finished: the next sharp turn is natural.
  done(c: Creature, what: string): void {
    const t = this.tracks.get(c.id);
    if (t) t.natural = this.time;
    this.why.set(c.id, what);
  }

  // After a creature's tick: where it wanted to go and where it went.
  after(c: Creature, time: number, dt: number, drive: string, wantX: number, wantY: number, wanted: number): void {
    this.time = time;
    if (c.dead) {
      this.tracks.delete(c.id);
      return;
    }
    const name = c.kind.split("#")[0];
    let t = this.tracks.get(c.id);
    if (!t) {
      t = { x: c.x, y: c.y, steps: { h: [], shut: 0 }, intents: { h: [], shut: 0 }, natural: -1, drive, drives: [] };
      this.tracks.set(c.id, t);
      return;
    }
    const k = this.kind(name);
    const awake = c.frozen <= 0 && c.sleep <= 0 && c.stun <= 0 && drive !== "asleep";
    if (awake) k.seconds += dt;
    const dx = c.x - t.x;
    const dy = c.y - t.y;
    t.x = c.x;
    t.y = c.y;
    const moved = Math.hypot(dx, dy);
    if (moved > 0.5 && moved < 4) k.hops++;
    if (drive !== t.drive) {
      if (awake) k.actionChanges++;
      t.drives.push([time, t.drive]);
      t.drive = drive;
    }
    while (t.drives.length && t.drives[0][0] < time - TURN_WINDOW) t.drives.shift();
    // Wanted to walk and got less than a quarter of the way: stuck.
    if (wanted > 0 && moved < wanted * 0.25) k.stuck += dt;
    const recent = t.natural >= time - TURN_WINDOW - 0.05;
    if (moved > 0.01 && moved < 1.5 && turned(t.steps, time, Math.atan2(dy, dx))) {
      k.turns++;
      if (recent) {
        k.natural++;
        const why = this.why.get(c.id) ?? "?";
        k.naturalBy[why] = (k.naturalBy[why] ?? 0) + 1;
      } else {
        const from = t.drives.length ? t.drives[0][1] : drive;
        const key = from === drive ? drive : `${from}>${drive}`;
        k.flips[key] = (k.flips[key] ?? 0) + 1;
        this.log?.(c, key, time);
      }
    }
    if (wanted > 0 && (wantX || wantY) && turned(t.intents, time, Math.atan2(wantY, wantX))) {
      k.intentTurns++;
      if (!recent) k.intentFlips++;
    }
  }
}

// Adds a heading to a half second window; true when it differs from one in
// the window by more than TURN_DEGREES. The window is then emptied and stays
// shut for half a second, so a creature shaking on the spot (a reversal
// every tick) counts once per half second, not thirty times: the count is
// of half seconds with a reversal in them, at most 120 a minute.
function turned(w: Window, time: number, a: number): boolean {
  let n = 0;
  while (n < w.h.length && w.h[n] < time - TURN_WINDOW) n += 2;
  if (n) w.h.splice(0, n);
  if (time < w.shut) return false;
  const limit = (TURN_DEGREES * Math.PI) / 180;
  for (let j = 0; j < w.h.length; j += 2) {
    let d = Math.abs(a - w.h[j + 1]);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d > limit) {
      w.h.length = 0;
      w.shut = time + TURN_WINDOW;
      w.h.push(time, a);
      return true;
    }
  }
  w.h.push(time, a);
  return false;
}

interface Window {
  h: number[];
  shut: number;
}

// The meter the simulation reports to, or null (always, outside tests).
export let meter: MotionMeter | null = null;
export function setMeter(m: MotionMeter | null): void {
  meter = m;
}

// A short report, per minute of creature life.
export function motionLines(kinds: Record<string, KindMotion>): string[] {
  const out: string[] = [];
  const top = (r: Record<string, number>, minutes: number, n = 4) =>
    Object.entries(r)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${k} ${(v / minutes).toFixed(1)}`)
      .join(", ");
  for (const [name, k] of Object.entries(kinds).sort((a, b) => b[1].turns / b[1].seconds - a[1].turns / a[1].seconds)) {
    const min = k.seconds / 60;
    if (min < 0.5) continue;
    const per = (v: number) => (v / min).toFixed(1);
    out.push(
      `${name.padEnd(9)} turns ${per(k.turns).padStart(5)}/min (natural ${per(k.natural)}, flip-flops ${per(k.turns - k.natural)}), intent flips ${per(k.intentFlips)}, stuck ${per(k.stuck)} s/min, hops ${per(k.hops)}/min, action changes ${per(k.actionChanges)}/min, ${min.toFixed(0)} creature-min`,
    );
    if (k.turns > k.natural) out.push(`          flip-flops from: ${top(k.flips, min)}`);
    if (k.natural) out.push(`          natural after: ${top(k.naturalBy, min, 3)}`);
  }
  return out;
}

export function mergeMotion(into: Record<string, KindMotion>, from: Record<string, KindMotion>): void {
  for (const [name, k] of Object.entries(from)) {
    const t = (into[name] ??= {
      seconds: 0,
      turns: 0,
      natural: 0,
      intentTurns: 0,
      intentFlips: 0,
      stuck: 0,
      actionChanges: 0,
      hops: 0,
      flips: {},
      naturalBy: {},
    });
    for (const f of ["seconds", "turns", "natural", "intentTurns", "intentFlips", "stuck", "actionChanges", "hops"] as const) t[f] += k[f];
    for (const [a, v] of Object.entries(k.flips)) t.flips[a] = (t.flips[a] ?? 0) + v;
    for (const [a, v] of Object.entries(k.naturalBy)) t.naturalBy[a] = (t.naturalBy[a] ?? 0) + v;
  }
}
