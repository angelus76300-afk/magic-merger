import type { GameElement } from "./types";

export const PRIMITIVES: readonly GameElement[] = [
  { name: "Fire", emoji: "🔥", kind: "spell", depth: 0 },
  { name: "Water", emoji: "💧", kind: "spell", depth: 0 },
  { name: "Earth", emoji: "🪨", kind: "spell", depth: 0 },
  { name: "Air", emoji: "💨", kind: "spell", depth: 0 },
  { name: "Light", emoji: "☀️", kind: "spell", depth: 0 },
  { name: "Shadow", emoji: "🌑", kind: "spell", depth: 0 },
  { name: "Life", emoji: "🌱", kind: "spell", depth: 0 },
  { name: "Arcane", emoji: "🔮", kind: "spell", depth: 0 },
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
