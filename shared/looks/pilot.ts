import { mayGainModel, modelCalls, ownLookCall, readLiteral } from "./splice";

// The looks pilot's items, picked by the runner (scripts/looks-runner.ts start --pilot) from the
// library's live programs (the Worker's read-only looks-pool route), with no file of phase 0:
// the plainest of those that draw a model, and those with none that may gain one, most cast first.
// Wonders are counted by the Worker (the pool's oldest not redrawn).

export interface PoolItem {
  key: string;
  name: string;
  form: string;
  tier: string;
  casts: number;
  code: string;
}

// A call whose parts are not written out (made in a loop, a variable) is counted as this many: it
// is drawn by code, rarely the plainest.
const UNREAD_PARTS = 24;

// The parts a program's models draw, as written; null when it has no w.model call (or cannot be read).
export function modelParts(code: string): number | null {
  const calls = modelCalls(code);
  if (!calls?.length) return null;
  let parts = 0;
  for (const c of calls) {
    const arg = c.args[2];
    const lit = arg ? readLiteral(code.slice(arg.start, arg.end)) : null;
    parts += lit && "value" in lit && Array.isArray(lit.value) ? lit.value.length : UNREAD_PARTS;
  }
  return parts;
}

export interface Pilot {
  // The plainest that draw a model, fewest parts first.
  redraw: { key: string; name: string; parts: number }[];
  // Those with no model that may gain one, most cast first.
  gain: { key: string; name: string; casts: number }[];
}

export function pickPilot(pool: PoolItem[], o: { redraw?: number; gain?: number; spells?: boolean } = {}): Pilot {
  const withModel: Pilot["redraw"] = [];
  const without: Pilot["gain"] = [];
  for (const p of pool) {
    if (!p.code) continue;
    const parts = modelParts(p.code);
    if (parts !== null) withModel.push({ key: p.key, name: p.name, parts });
    else if (modelCalls(p.code) && !(mayGainModel(p.form, o.spells === true) ?? ownLookCall(p.code)))
      without.push({ key: p.key, name: p.name, casts: p.casts });
  }
  withModel.sort((a, b) => a.parts - b.parts || a.key.localeCompare(b.key));
  without.sort((a, b) => b.casts - a.casts || a.key.localeCompare(b.key));
  return { redraw: withModel.slice(0, o.redraw ?? 10), gain: without.slice(0, o.gain ?? 10) };
}
