// The World's frame pacing (2026-11-07, src/sim/voxel/pacing.ts): a 60 Hz
// screen replayed in Node with the engine's own rules, no browser needed.
import { FramePacer, RETRY_MS, SLOW_MS, FAST_MS, ticksDue } from "../src/sim/voxel/pacing";
import { TICK } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

// A screen refreshing every `vsync` ms with a little jitter; the loop draws
// when at least `minDraw` ms passed (Engine.frame). Returns the ticks run
// since the frame before, for each drawn frame: what the HUD's sim time adds up.
export function replay(smooth: boolean, minDraw: number, seconds: number, vsync = 1000 / 60, spread = 0.2): number[] {
  let seed = 7;
  const jitter = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * spread;
  };
  let acc = 0;
  let last = 0;
  let lastDraw = -1e9;
  const perFrame: number[] = [];
  let pending = 0;
  for (let now = vsync; now < seconds * 1000; now += vsync) {
    const t = now + jitter();
    acc += Math.max(0, Math.min(0.1, (t - last) / 1000));
    last = t;
    const steps = ticksDue(acc, TICK, smooth);
    acc -= steps * TICK;
    if (acc > TICK * 3) acc = 0;
    pending += steps;
    if ((!smooth && steps === 0) || t - lastDraw < minDraw) continue;
    lastDraw = t;
    perFrame.push(pending);
    pending = 0;
  }
  return perFrame;
}

export function pacingChecks(check: Check): void {
  // The old loop: 30 a second on a 60 Hz screen, every tick owed at once.
  const old = replay(false, SLOW_MS - 4, 60);
  const oldDouble = old.filter((n) => n >= 2).length;
  // Smooth at 60: one tick every other frame, never two.
  const fast = replay(true, FAST_MS - 4, 60);
  const fastDouble = fast.filter((n) => n >= 2).length;
  const ticks = (a: number[]) => a.reduce((s, n) => s + n, 0);
  check("the old pacing, with frame times a tenth of a ms off, ran two ticks in a third of its frames", oldDouble > 0, `${oldDouble} of ${old.length} frames`);
  check(
    "smooth pacing draws 60 a second, never runs two ticks in one frame, and keeps 30 ticks a second",
    fastDouble === 0 && Math.abs(fast.length / 60 - 60) < 1.5 && Math.abs(ticks(fast) / 60 - 30) < 0.5,
    `${fast.length} frames, ${fastDouble} doubles, ${ticks(fast)} ticks in 60 s (old: ${ticks(old)})`,
  );
  // Behind by more than one tick (a stall): paid two at a time, at most three.
  check(
    "a frame owing several ticks runs one when it keeps up, more only when behind",
    ticksDue(TICK * 1.5, TICK, true) === 1 &&
      ticksDue(TICK * 2.5, TICK, true) === 1 &&
      ticksDue(TICK * 3.5, TICK, true) === 2 &&
      ticksDue(TICK * 9, TICK, true) === 3 &&
      ticksDue(TICK * 2.5, TICK, false) === 2,
  );

  // The pacer: on time stays at 60; late falls back to 30 and tries again later, waiting longer.
  const p = new FramePacer(true, 0);
  let now = 0;
  for (let i = 0; i < 4 * 90; i++) p.push(FAST_MS, (now += FAST_MS));
  const held = p.target === 60;
  for (let i = 0; i < 90; i++) p.push(i % 3 === 0 ? FAST_MS * 2 : FAST_MS, (now += FAST_MS));
  const fell = p.target === 30;
  const fellAt = now;
  for (; now < fellAt + RETRY_MS - 100; ) p.push(SLOW_MS, (now += SLOW_MS));
  const waited = p.target === 30;
  p.push(SLOW_MS, (now += SLOW_MS + 200));
  const retried = p.target === 60;
  for (let i = 0; i < 90; i++) p.push(FAST_MS * 2, (now += FAST_MS * 2));
  const second = now;
  const fellAgain = p.target === 30;
  for (; now < second + RETRY_MS * 1.5; ) p.push(SLOW_MS, (now += SLOW_MS));
  check(
    "the pacer holds 60 while frames are on time, falls back to 30 when a third are late, and tries again later, waiting longer each time",
    held && fell && waited && retried && fellAgain && p.target === 30,
    JSON.stringify({ held, fell, waited, retried, fellAgain, after: p.target }),
  );
  const off = new FramePacer(false, 0);
  for (let i = 0; i < 400; i++) off.push(FAST_MS, i * FAST_MS);
  check("with GRAPHICS.smooth off the pacer stays at 30, as before", off.target === 30 && off.minDrawMs === SLOW_MS - 4);
}
