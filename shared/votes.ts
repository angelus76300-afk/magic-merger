import { TIERS, type Tier } from "./tiers";

// Player votes on spell programs (3.3), and the rules that turn them into a
// rewrite, a rollback or a place in the example library. Pure functions, so
// `npm test` checks them without a database.

export const DOWN_REASONS = ["nothing", "small", "wrong", "broke", "boring"] as const;
export type DownReason = (typeof DOWN_REASONS)[number];

export const REASON_LABEL: Record<DownReason, string> = {
  nothing: "Nothing happened",
  small: "Too small",
  wrong: "Looked wrong",
  broke: "Broke the island",
  boring: "Boring",
};

// What the rewrite prompt is told about each reason.
export const REASON_PROMPT: Record<DownReason, string> = {
  nothing: "nothing seemed to happen",
  small: "it was too small for its name and tier",
  wrong: "it did not look like what its name promises",
  broke: "it broke the island, far beyond what it should do",
  boring: "it was boring: plain, predictable, no interaction",
};

export function isReason(v: unknown): v is DownReason {
  return typeof v === "string" && (DOWN_REASONS as readonly string[]).includes(v);
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
