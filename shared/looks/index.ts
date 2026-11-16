// The ten reference looks (roadmap 5.2.5, phase 2): what the writer is shown, three at a time,
// picked by the kind of thing it draws. Frames: docs/visual-checks/looks-references/.
import { BEAST } from "./beast";
import { BIRD } from "./bird";
import { BOOK } from "./book";
import { ORB } from "./orb";
import { POTION } from "./potion";
import { RUIN } from "./ruin";
import { SHRINE } from "./shrine";
import { SWORD } from "./sword";
import { TOWER } from "./tower";
import { TREE } from "./tree";
import { PART_TARGETS, type Reference } from "./reference";

export { PART_TARGETS, type Reference };

export const REFERENCES: Reference[] = [BOOK, POTION, SWORD, ORB, BEAST, BIRD, TOWER, SHRINE, TREE, RUIN];

// The kinds an item can be (shared/forms.ts), plus a wonder and a spell's own look.
export type LookKind = "spell" | "creature" | "object" | "building" | "settlement" | "place" | "land" | "wonder";

// Three references for a kind: two of its own kind and one that shows another scale. Fixed per
// kind, so the same item is always shown the same three.
const PICKS: Record<LookKind, Reference[]> = {
  object: [BOOK, SWORD, POTION],
  creature: [BEAST, BIRD, ORB],
  building: [TOWER, SHRINE, BOOK],
  settlement: [SHRINE, TOWER, TREE],
  place: [TREE, RUIN, SHRINE],
  land: [RUIN, TREE, SWORD],
  wonder: [RUIN, TREE, TOWER],
  spell: [ORB, TOWER, TREE],
};

export function referencesFor(kind: string | null | undefined): Reference[] {
  return PICKS[(kind ?? "spell") as LookKind] ?? PICKS.spell;
}

// The parts a model of this kind should have (the look guide's targets).
export function partTarget(kind: string | null | undefined): [number, number] {
  switch (kind) {
    case "object":
    case "spell":
      return PART_TARGETS.object;
    case "creature":
      return PART_TARGETS.creature;
    case "building":
    case "settlement":
      return PART_TARGETS.building;
    case "wonder":
      return PART_TARGETS.wonder;
    default:
      return PART_TARGETS.place;
  }
}
