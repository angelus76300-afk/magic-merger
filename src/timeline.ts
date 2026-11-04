// 4.2: how long a new item takes from the drop to its first cast, step by
// step, in this browser. Measured, never used to decide anything: the HUD's
// perf sample carries the last few (`creation`), and the measurement script
// reads `window.__creation`.
//
// Steps, in milliseconds from the drop (or from the first time the program
// was asked for, for items not merged in this page):
//   merged    the merge answered
//   asked     the program was asked for
//   arrived   the program arrived (written, or stored)
//   tested    its test run ended (test: how long it ran)
//   verdict   the Worker answered the test run
//   ready     castable (chips say "ready")
//   cast      the first cast
// server: what the Worker said it spent (merge, describe, intent, spell, total…).

export interface Creation {
  name: string;
  tier?: string;
  kind?: string;
  // When it started, epoch ms.
  at: number;
  steps: Record<string, number>;
  server: Record<string, number>;
  // The test run's own parts (control, cast, protect, acts), in ms.
  phases?: Record<string, number>;
  rounds?: number;
}

const items = new Map<string, Creation>();
const order: string[] = [];

function entry(key: string, name: string): Creation {
  let c = items.get(key);
  if (!c) {
    c = { name, at: Date.now(), steps: {}, server: {} };
    items.set(key, c);
    order.push(key);
    if (order.length > 40) items.delete(order.shift()!);
  }
  return c;
}

export const timeline = {
  // The drop: everything after is counted from here.
  start(key: string, name: string, at = Date.now()): void {
    const c = entry(key, name);
    c.at = at;
    c.steps = {};
    c.server = {};
  },
  describe(key: string, name: string, tier?: string, kind?: string): void {
    const c = entry(key, name);
    if (tier) c.tier = tier;
    if (kind) c.kind = kind;
  },
  // A step, the first time it happens (later rounds of a test run add up).
  step(key: string, name: string, step: string): void {
    const c = entry(key, name);
    if (c.steps[step] === undefined) c.steps[step] = Date.now() - c.at;
  },
  add(key: string, name: string, field: string, ms: number): void {
    const c = entry(key, name);
    c.steps[field] = (c.steps[field] ?? 0) + Math.round(ms);
  },
  server(key: string, name: string, timing: Record<string, number>, prefix = ""): void {
    const c = entry(key, name);
    for (const [k, v] of Object.entries(timing)) c.server[prefix + k] = (c.server[prefix + k] ?? 0) + v;
  },
  phases(key: string, name: string, phases: Record<string, number> | undefined): void {
    if (!phases) return;
    const c = entry(key, name);
    c.rounds = (c.rounds ?? 0) + 1;
    c.phases ??= {};
    for (const [k, v] of Object.entries(phases)) c.phases[k] = (c.phases[k] ?? 0) + v;
  },
  // The last few that became ready, compact, for the perf sample (4 KB at most).
  recent(n = 5): Creation[] {
    return order
      .map((k) => items.get(k)!)
      .filter((c) => c && c.steps.ready !== undefined)
      .slice(-n);
  },
  all(): Creation[] {
    return order.map((k) => items.get(k)!).filter(Boolean);
  },
};

// For scripts/creation-timing.mjs.
(window as unknown as { __creation: typeof timeline }).__creation = timeline;
