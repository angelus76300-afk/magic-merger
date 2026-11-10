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

// How many days a challenge waited between the night it was set and the day
// it was found, both Toronto days (YYYY-MM-DD, a forced second one carries
// "#2" after the date). Null when either day cannot be read.
export function waitedDays(day: string, foundDay: string | null): number | null {
  const at = (d: string | null) => {
    const m = d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null;
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const set = at(day);
  const found = at(foundDay);
  if (set === null || found === null) return null;
  return Math.max(0, Math.round((found - set) / 86_400_000));
}

// How long a find waited, as the end of "Set 4 Nov, found 6 Nov, ...".
export function waitedLabel(day: string, foundDay: string | null): string {
  const n = waitedDays(day, foundDay);
  if (n === null) return "";
  if (n === 0) return "the same day";
  return n === 1 ? "after 1 day" : `after ${n} days`;
}

// "5 Nov", from the YYYY-MM-DD the Worker sends (a forced second one reads "5 Nov #2").
export function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(day);
  if (!m) return day;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const extra = m[4].trim();
  return `${date.getDate()} ${date.toLocaleString("en", { month: "short" })}${extra ? ` ${extra}` : ""}`;
}
