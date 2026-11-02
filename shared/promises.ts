// What a spell promises (3.4.2). Each element gets one or two intents, decided
// from its name and grimoire entry by a call of their own, before any program
// exists, so the model that writes the program never decides what it will be
// tested on. Some intents have a probe in the test run (src/sim/check.ts):
// a protection spell is cast on a village that is then attacked, and must
// keep it far safer than nothing would.

export const INTENTS = ["protect", "heal", "harm", "summon", "create", "transform", "weather", "move", "reveal", "other"] as const;
export type Intent = (typeof INTENTS)[number];

// Intents the test run checks today. The others are recorded, so the next
// probe can be measured on every program already stored before it gates anything.
export const PROBED: readonly Intent[] = ["protect"];

export function isIntent(v: unknown): v is Intent {
  return typeof v === "string" && (INTENTS as readonly string[]).includes(v);
}

// At most two, the first being the main one. Stored as "protect,harm".
export function parseIntents(raw: unknown): Intent[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: Intent[] = [];
  for (const v of list) {
    const s = String(v).trim().toLowerCase();
    if (isIntent(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 2);
}

// What the program's writer is told about the test its promise will face,
// so the test is the specification and not a surprise.
export const PROMISE_TEST: Partial<Record<Intent, string>> = {
  protect:
    "This spell promises protection. Its test run casts it on a village, then three seconds later rains fire on the same spot, pours lava on it, drops a blast on it and sends raiders at its people, one at a time, and checks that the houses and villagers within w.r survive far better than without it. Protect with w.ward over what it guards, raised within two seconds and lasting at least 15. Never build a solid shell over people.",
};
