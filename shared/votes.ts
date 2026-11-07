import type { Form } from "./forms";
import { TIERS, type Tier } from "./tiers";

// Player votes on spell programs (3.3), and the rules that turn them into a
// rewrite, a rollback or a place in the example library. Pure functions, so
// `npm test` checks them without a database.

// The five reasons every item had before reasons by form (2026-11-07). Kept:
// stored votes carry them, and the judge answers with one of them.
export const DOWN_REASONS = ["nothing", "small", "wrong", "broke", "boring"] as const;

// Why a player voted an item down: a label they read, and the line the
// rewrite is told, saying what to fix. Ids are stored in `votes.reason`,
// joined by commas, so an id never changes meaning once players use it.
// Players never type a reason: no player's words reach a prompt.
interface ReasonDef {
  label: string;
  prompt: string;
}

export const REASONS = {
  // The five first ones, every item's before 2026-11-07. Each line now says
  // which way to go: a rewrite "rethought" sees only the old summary.
  nothing: {
    label: "Nothing happened",
    prompt: "nothing seemed to happen when it was cast; make it start at once where it lands, big enough to see across the island",
  },
  small: { label: "Too small", prompt: "it was too small or weak for its name and tier; make its reach, size and power match both" },
  wrong: {
    label: "Looked wrong",
    prompt: "it did not look like what its name promises; make its shapes, colors and light show that thing at a glance",
  },
  broke: {
    label: "Broke the island",
    prompt: "it broke the island, far beyond what it should do; keep it to its own reach and leave the rest of the island as it was",
  },
  boring: {
    label: "Boring",
    prompt: "it was boring: plain, predictable, no interaction; make it surprise, and give people, creatures or the land something to react to",
  },
  // Spells, objects and places.
  effect: {
    label: "Did the wrong thing",
    prompt: "it did something other than its name promises; make what it does to people, creatures and land exactly what the name says",
  },
  // Creatures and people: three about how they behave.
  still: {
    label: "Barely moved",
    prompt: "it barely moved; give it a goal that takes it across the island, at least its kind's speed (a fox 3.6, a horse 5) and an ability every so often",
  },
  aloof: {
    label: "Ignored everyone",
    prompt: "it ignored the villagers and animals near it; make it notice them: hunt, lure, scare, follow or guard as its kind would, with a wider sense",
  },
  nature: {
    label: "Not how it behaves",
    prompt: "what it did did not fit what it is; make its goal, mode, prey, waking hours and speed those of the real thing its name says",
  },
  body: {
    label: "Doesn't look like one",
    prompt: "it did not look like that creature; make its body plan, features, colors and radius those of the real thing, never a blob or a statue",
  },
  // Objects and places.
  idle: {
    label: "Does nothing",
    prompt: "after it appeared it did nothing; give it w.artifact effects on triggers (dawn, night, every so often, enemy) that visibly change what is near it",
  },
  unused: {
    label: "Nobody came for it",
    prompt: "no villager or creature came for it; give it w.artifact grants villagers come to use, or uses creatures act on, that fit what it is",
  },
  big: {
    label: "Too big",
    prompt: "it was far bigger than the thing itself; draw it at its real size in fine boxes (a sword 1 long, a lantern 0.4 tall), never a statue of itself",
  },
  // Buildings, and places that stand on the land.
  plain: {
    label: "Looks like any house",
    prompt: "it looked like any house of the village; add what makes it this building at b.beside, in fine boxes, with voxels for a tall mass like a spire",
  },
  empty: {
    label: "Nobody uses it",
    prompt: "nobody worked in it or used it; choose the job nearest what it is and hire villagers to its own work with w.hire, so people come and go",
  },
  float: {
    label: "Floating or buried",
    prompt: "parts of it floated in the air or sank into the ground; stand every model and structure on the land height of its own cell",
  },
  // Settlements.
  token: {
    label: "Not a real village",
    prompt: "it was not a village; make it with w.village(x, y, {houses}) so houses, fields and villagers come, then add what is special about it",
  },
  same: {
    label: "Like any village",
    prompt:
      "it was like any other village; give it what its name makes special: a building with w.building, a wall, a shrine, or its people's work with w.hire",
  },
  // Land.
  shape: {
    label: "Wrong kind of land",
    prompt: "the land took the wrong form; choose the w.land shape that is what its name says, or terraform and flood until it is that land",
  },
  paint: {
    label: "Only changed color",
    prompt: "it only changed the color of the ground; raise or cut the land itself with w.land or w.terraform, with water or lava where it belongs",
  },
  bare: {
    label: "Bare and empty",
    prompt: "the new land was bare; add what makes it this land: trees, rocks, structures or a landmark that does something",
  },
} as const satisfies Record<string, ReasonDef>;

export type DownReason = keyof typeof REASONS;

// What a player is offered, by the item's form: at most six, chosen by the
// game designer so each maps to something a rewrite can change. People
// (w.person) are creatures here: body, size and calling are theirs too.
export const REASONS_BY_FORM: Record<Form, readonly DownReason[]> = {
  spell: ["nothing", "small", "effect", "wrong", "broke", "boring"],
  creature: ["still", "aloof", "nature", "body", "small", "broke"],
  object: ["idle", "unused", "big", "wrong", "effect", "broke"],
  building: ["plain", "small", "empty", "float", "broke"],
  settlement: ["token", "small", "same", "broke"],
  place: ["small", "wrong", "idle", "unused", "float", "broke"],
  land: ["small", "shape", "paint", "bare", "broke"],
};

// The same reason, said as a player of that form would: a spell is weak
// rather than small. Same id, same fix.
const FORM_LABEL: Partial<Record<Form, Partial<Record<DownReason, string>>>> = {
  spell: { small: "Too weak" },
};

export function reasonLabel(reason: DownReason, form?: Form): string {
  return (form && FORM_LABEL[form]?.[reason]) ?? REASONS[reason].label;
}

// A player picks one to three.
export const MAX_REASONS = 3;

export const REASON_LABEL = Object.fromEntries(Object.entries(REASONS).map(([k, v]) => [k, v.label])) as Record<DownReason, string>;

// What the rewrite prompt is told about each reason.
export const REASON_PROMPT = Object.fromEntries(Object.entries(REASONS).map(([k, v]) => [k, v.prompt])) as Record<DownReason, string>;

export function isReason(v: unknown): v is DownReason {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(REASONS, v);
}

export function reasonsFor(form: Form): readonly DownReason[] {
  return REASONS_BY_FORM[form];
}

// The reasons of a down vote as sent (`reasons`, or the one `reason` of a
// client from before reasons by form): one to three known ids, each once.
// Null when there is none, too many, or one the game does not know.
export function voteReasons(body: { reason?: unknown; reasons?: unknown }): DownReason[] | null {
  const list: unknown[] = Array.isArray(body.reasons) ? body.reasons : body.reason !== undefined ? [body.reason] : [];
  if (!list.length || list.length > MAX_REASONS || !list.every(isReason)) return null;
  const unique = [...new Set(list as DownReason[])];
  return unique.length === list.length ? unique : null;
}

// The reasons stored on a vote: "boring" (one, as before) or "still,size".
// Unknown parts are dropped, so a stored value always reads.
export function storedReasons(stored: string | null | undefined): DownReason[] {
  return [...new Set((stored ?? "").split(",").filter(isReason))];
}

// Only players who cast that version of the spell this recently may vote on it.
export const VOTE_WINDOW_MS = 48 * 3600_000;
// A rewrite needs this share of down votes.
export const DOWN_SHARE = 0.6;
// At most one rewrite per spell in this time.
export const REWRITE_COOLDOWN_MS = 3 * 86400_000;
// Votes needed are a tenth of the average daily players over this many days.
export const ACTIVE_DAYS = 7;
export const MAX_VOTES_NEEDED = 25;

// N = max(1, 10% of the average daily active players over seven days), at most 25.
// With one player, one vote is enough.
export function votesNeeded(averageDaily: number): number {
  const n = Math.round(0.1 * (Number.isFinite(averageDaily) ? averageDaily : 0));
  return Math.min(MAX_VOTES_NEEDED, Math.max(1, n));
}

export interface Tally {
  up: number;
  down: number;
}

export function downShare(t: Tally): number {
  const total = t.up + t.down;
  return total ? t.down / total : 0;
}

// Enough votes, and at least 60% of them down.
export function votedDown(t: Tally, needed: number): boolean {
  return t.up + t.down >= needed && downShare(t) >= DOWN_SHARE;
}

// Enough votes, and at least 60% of them up: the program joins the library.
export function votedUp(t: Tally, needed: number): boolean {
  return t.up + t.down >= needed && t.up / (t.up + t.down) >= DOWN_SHARE;
}

// A rewritten program goes back to its parent when it has enough votes of its
// own and a larger share of them is down than the parent had when it was
// replaced.
export function votedWorse(child: Tally, parent: Tally, needed: number): boolean {
  return child.up + child.down >= needed && downShare(child) > downShare(parent);
}

// Written now by the small model, or drafted now and written by the big one
// through the Batch API (half price, within a day, usually minutes).
export function isBig(tier: Tier, smallUpTo: Tier = "grand"): boolean {
  return TIERS.indexOf(tier) > TIERS.indexOf(smallUpTo);
}
