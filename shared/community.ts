import type { ElementKind } from "./types";
import type { Tier } from "./tiers";

// 4.5: the Community tab. Who plays, each friend's favorite spell, how many
// items they found and their First Discoveries. Never a recipe, so the tab
// hands nobody an idea (docs/IDEAS.md, "What the owner likes").

export interface FavoriteCard {
  name: string;
  emoji: string;
  kind: ElementKind;
  tier: Tier | null;
}

export interface Friend {
  name: string;
  me: boolean;
  // The last time they played (ms), null if never.
  lastPlayed: number | null;
  // Items in their synced discoveries; null when they play without an account.
  found: number | null;
  firsts: number;
  // Daily challenges they found first (4.5).
  daily: number;
  favorite: FavoriteCard | null;
}

export interface CommunityResponse {
  friends: Friend[];
  // The asking player's own choices, also when hidden from the list.
  me: { favorite: string | null; hidden: boolean };
}

export interface ProfileChange {
  // An element key from the player's own discoveries, or null to clear it.
  favorite?: string | null;
  hidden?: boolean;
}

// "today", "yesterday", "this week", "this month", or "a while ago".
export function lastPlayedLabel(at: number | null, now = Date.now()): string {
  if (!at) return "not yet";
  const day = 86_400_000;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (at >= startOfToday) return "today";
  if (at >= startOfToday - day) return "yesterday";
  if (now - at < 7 * day) return "this week";
  if (now - at < 31 * day) return "this month";
  return "a while ago";
}
