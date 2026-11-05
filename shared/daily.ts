import type { ElementKind } from "./types";
import type { Tier } from "./tiers";

// 4.5: daily challenges. Each night a new item waits to be found; players see
// what it is, never which two items make it.

export interface DailyChallenge {
  id: number;
  // The day it was set, in Toronto (YYYY-MM-DD).
  day: string;
  name: string;
  emoji: string;
  kind: ElementKind;
  tier: Tier | null;
  description: string;
  // The finder's name once found; null while open, or when the finder's
  // account was deleted ("someone" in the tab).
  foundBy: string | null;
  foundDay: string | null;
  found: boolean;
  // The player asking found it.
  mine: boolean;
}

export interface DailyResponse {
  open: DailyChallenge[];
  // The most recent finds, newest first.
  found: DailyChallenge[];
}

// The game's day is Toronto's, where the owner and the nightly routines live.
export const DAILY_ZONE = "America/Toronto";

export function dayIn(now: number, zone = DAILY_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
