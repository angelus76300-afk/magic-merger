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
  if (depth <= 6) return "legendary";
  return "legendary";
}
