import type { GameElement } from "./types";

export const PRIMITIVES: readonly GameElement[] = [
  { name: "Fire", emoji: "🔥", kind: "spell", depth: 0, tier: "minor" },
  { name: "Water", emoji: "💧", kind: "spell", depth: 0, tier: "minor" },
  { name: "Earth", emoji: "🪨", kind: "spell", depth: 0, tier: "minor" },
  { name: "Air", emoji: "💨", kind: "spell", depth: 0, tier: "minor" },
  { name: "Light", emoji: "☀️", kind: "spell", depth: 0, tier: "minor" },
  { name: "Shadow", emoji: "🌑", kind: "spell", depth: 0, tier: "minor" },
  { name: "Life", emoji: "🌱", kind: "spell", depth: 0, tier: "minor" },
  { name: "Arcane", emoji: "🔮", kind: "spell", depth: 0, tier: "minor" },
];

// One identity per name: "fire ball", "Fire  Ball" and "Fire Ball" are the same element.
export function elementKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Merging is commutative, so the pair key sorts its two sides.
export function pairKey(a: string, b: string): string {
  const [x, y] = [elementKey(a), elementKey(b)].sort();
  return `${x}+${y}`;
}
