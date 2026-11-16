// How often the World draws (2026-11-07). Before, touch screens drew 30 a
// second at most, one frame per simulation tick: the owner's phone showed a
// flat 33.3 ms with time to spare. Now every device tries 60 and keeps it
// while frames arrive on time; when they do not (a slow GPU, a heavy island),
// it falls back to 30 and tries again later, waiting longer each time it
// fails. Between two ticks the view draws creatures part way from one to the
// next (view.ts), so the extra frames show motion, not the same picture twice.
//
// The browser gives no GPU time, so the only honest signal is the cadence of
// the frames themselves: a frame that comes more than 1.5 vsyncs after the
// last was missed.

export const FAST_MS = 1000 / 60;
export const SLOW_MS = 1000 / 30;
// Frames judged together, and the share of them that may be late at 60.
export const WINDOW = 90;
export const LATE_SHARE = 0.12;
// First wait before trying 60 again, doubled after each failed try.
export const RETRY_MS = 15_000;
export const RETRY_MAX_MS = 240_000;
// A try that holds this long resets the wait.
export const PROVEN_MS = 60_000;

export class FramePacer {
  // Frames a second the loop aims for.
  target: 30 | 60;
  private intervals: number[] = [];
  private retryAt = 0;
  private wait = RETRY_MS;
  private since = 0;

  constructor(
    // false: the old pacing, 30 a second, set by GRAPHICS.smooth.
    readonly enabled: boolean,
    now = 0,
  ) {
    this.target = enabled ? 60 : 30;
    this.since = now;
  }

  // The least time between two draws: a few ms of slack so a frame that
  // arrives a little early is not skipped and drawn one vsync late.
  get minDrawMs(): number {
    return this.target === 60 ? FAST_MS - 4 : SLOW_MS - 4;
  }

  // One drawn frame: `interval` ms since the previous draw.
  push(interval: number, now: number): void {
    if (!this.enabled) return;
    // A frame after a pause (a hidden tab, a stall of a second) says nothing
    // about the steady cadence.
    if (interval > 250) return;
    this.intervals.push(interval);
    if (this.target === 30) {
      if (now >= this.retryAt) this.switchTo(60, now);
      return;
    }
    if (this.intervals.length < WINDOW) return;
    const late = this.intervals.filter((t) => t > FAST_MS * 1.5).length / this.intervals.length;
    this.intervals = [];
    if (late > LATE_SHARE) {
      // Failed: back to 30, and wait longer before the next try.
      this.retryAt = now + this.wait;
      this.wait = Math.min(RETRY_MAX_MS, this.wait * 2);
      this.switchTo(30, now);
    } else if (now - this.since > PROVEN_MS) this.wait = RETRY_MS;
  }

  private switchTo(target: 30 | 60, now: number): void {
    this.target = target;
    this.intervals = [];
    this.since = now;
  }
}

// How many ticks a frame runs, with `acc` seconds of simulation owed. The old
// loop ran every tick owed, up to three. Smooth runs one a frame, and a
// second only when more than one is still owed after it: the simulation stays
// within a tick of real time and a debt is paid over the next frames, not in
// one. On a clean 60 Hz screen the old loop ran two ticks in a frame in under
// 1% of frames; with time stamps a tenth of a millisecond off, a third of
// them, at 23 frames a second (scripts/pacing-test.ts replays both).
export function ticksDue(acc: number, tick: number, smooth: boolean): number {
  let steps = 0;
  while (acc >= tick && steps < 3) {
    acc -= tick;
    steps++;
    if (smooth && acc < tick * 2) break;
  }
  return steps;
}

// How far a frame draws creatures from the last tick to the next (view.ts between), with `acc`
// seconds of simulation owed. ticksDue above leaves up to two ticks owed after a late frame; the
// view used to stop at the last tick (1), so on a hitch a walker stood still a frame and then
// jumped to catch up (the playtest of 15 November). Past 1 it walks on as it was going, up to
// AHEAD: what is drawn stays one tick behind real time, frame after frame.
export const AHEAD = 2;
export function drawBetween(acc: number, tick: number): number {
  return Math.max(0, Math.min(AHEAD, acc / tick));
}

// A frame drawn past its tick (between above 1) guessed that a walker went on as it was going. When
// the next tick says otherwise (it stopped, it turned), the difference between what was drawn and
// where the new tick puts it at that moment is carried as an offset that fades over CARRY_S, so
// it is never drawn a step back at once (the review of 16 November). At a steady pace it is 0.
// `drawn`: drawn last frame, `old` and `next`: the two ticks, `ahead`: last frame's between.
export const CARRY_S = 0.1;
export function carry(drawn: number, old: number, next: number, ahead: number): number {
  return drawn - (old + (next - old) * (ahead - 1));
}
export function carried(offset: number, since: number): number {
  return offset * Math.exp(-Math.max(0, since) / CARRY_S);
}
