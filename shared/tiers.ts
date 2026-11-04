// How powerful an element is. Chosen once by the merge model, from meaning,
// and frozen with the element. A spell's reach is a share of the world.
export const TIERS = ["cantrip", "minor", "major", "grand", "legendary", "cosmic"] as const;
export type Tier = (typeof TIERS)[number];

// Radius of a spell as a fraction of the world's smaller side.
export const TIER_REACH: Record<Tier, number> = {
  cantrip: 0.035,
  minor: 0.06,
  major: 0.1,
  grand: 0.17,
  legendary: 0.3,
  cosmic: 0.65,
};

export const TIER_LABEL: Record<Tier, string> = {
  cantrip: "Cantrip",
  minor: "Minor",
  major: "Major",
  grand: "Grand",
  legendary: "Legendary",
  cosmic: "Cosmic",
};

export function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (TIERS as readonly string[]).includes(v);
}

// A result may be at most two tiers above its strongest input, so power has to
// be built up, but a meaningful leap (Void + Light = Big Bang) is still possible.
export function capTier(tier: Tier, inputs: Tier[]): Tier {
  const best = Math.max(...inputs.map((t) => TIERS.indexOf(t)));
  return TIERS[Math.min(TIERS.indexOf(tier), best + 2)];
}

// Elements made before tiers existed: a rough guess from their depth.
export function tierFromDepth(depth: number): Tier {
  if (depth <= 0) return "minor";
  if (depth <= 1) return "major";
  if (depth <= 3) return "grand";
  return "legendary";
}

// How strong a result can be for how deep it is in the recipe tree (3.7):
// one tier above what its depth implies, so power is built up over merges
// (a cosmic spell needs seven merges or more, a legendary one three) and a
// new player cannot make a world-ending spell in two. Only upward: a deep
// result may still be humble (a Candle stays a cantrip at depth twelve).
// Measured on 2026-11-02: 14 cosmic elements sat at depth 6 or less, three
// at depth 2.
export function depthTier(depth: number): Tier {
  if (depth <= 0) return "minor";
  if (depth <= 2) return "major";
  if (depth <= 6) return "grand";
  return "legendary";
}

export function capByDepth(tier: Tier, depth: number): Tier {
  return TIERS[Math.min(TIERS.indexOf(tier), TIERS.indexOf(depthTier(depth)) + 1)];
}
