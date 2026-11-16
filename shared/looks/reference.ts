// A hand-made reference look (the looks revamp, roadmap 5.2.5): the level of detail the writer
// copies. Each is a short piece of a program's cast, shown to the writer as written: it builds a
// parts list and draws it with w.model, at the island's scale (a villager is about 1.2 tall, a
// house 2). They follow docs/LOOKS.md: silhouette first, three to five tones of a hue per material
// plus one accent, scale cues, the shapes, and parts by kind.
export type ReferenceKind = "object" | "creature" | "building" | "place";

export interface Reference {
  name: string;
  kind: ReferenceKind;
  // One line on what makes it read, for the writer.
  note: string;
  code: string;
}

// Parts a model should have, by kind (the look guide in worker/prompts.ts says the same).
export const PART_TARGETS: Record<ReferenceKind | "wonder", [number, number]> = {
  object: [25, 60],
  creature: [30, 80],
  building: [60, 140],
  place: [60, 160],
  wonder: [100, 160],
};
