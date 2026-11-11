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
    "This spell promises protection. Its test run casts it on a village, then three seconds later rains fire on the same spot, pours lava on it, drops a blast on it and sends raiders at its people, one at a time, and checks that the houses and villagers within w.r survive far better than without it. Protect with w.ward over what it guards, raised within two seconds and lasting at least 15. Never build a solid shell over people. The ward is nearly invisible: it is how the item protects, not what it looks like. Keep the item's own look beside it (a sword planted in the square, a tome glowing on a lectern, a dungeon's stone gate, a wall of runes): two items that protect must not look alike.",
  heal: "This spell promises healing. Its test run casts it where a villager stands wounded (35 of 100 health) one cell away and another lies dead beside it, and fails it when neither is better for it, nothing grows back and no fire goes out. Heal everyone wounded in reach with c.heal(n) on w.creatures(x, y, r), whatever their health; raise the dead with revive() on w.corpses(x, y, r) when it does that; mend the land with w.grow.",
  summon:
    "This spell promises to bring a creature. Its test run casts it by day and fails it when nothing it brought is alive once the cast is over. Declare the creature in spell.creatures and bring it with w.spawn (a human with w.person), with a goal of its own, no lifespan of a few seconds, and nothing that kills it in daylight.",
};
