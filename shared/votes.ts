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
  // The five first ones.
  nothing: { label: "Nothing happened", prompt: "nothing seemed to happen" },
  small: { label: "Too small", prompt: "it was too small for its name and tier" },
  wrong: { label: "Looked wrong", prompt: "it did not look like what its name promises" },
  broke: { label: "Broke the island", prompt: "it broke the island, far beyond what it should do" },
  boring: { label: "Boring", prompt: "it was boring: plain, predictable, no interaction" },
  // REASONS_BY_FORM_PLACEHOLDER
} as const satisfies Record<string, ReasonDef>;

export type DownReason = keyof typeof REASONS;

// What a player is offered, by the item's form: at most six, the most
// common first. Every id here must be one a rewrite can act on.
export const REASONS_BY_FORM: Record<Form, readonly DownReason[]> = {
  spell: ["nothing", "small", "wrong", "broke", "boring"],
  creature: ["nothing", "small", "wrong", "broke", "boring"],
  object: ["nothing", "small", "wrong", "broke", "boring"],
  building: ["nothing", "small", "wrong", "broke", "boring"],
  settlement: ["nothing", "small", "wrong", "broke", "boring"],
  place: ["nothing", "small", "wrong", "broke", "boring"],
  land: ["nothing", "small", "wrong", "broke", "boring"],
};

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
