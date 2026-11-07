// What an item is (4.6): seven kinds, decided at the merge with the name.
// `elements.kind` stays "spell" or "artifact" (everything that casts, places,
// pays and votes reads it); `elements.form` says which of the six kinds of
// artifact it is, and so which maker of the engine builds it and which size
// its test run holds it to. Elements merged before 4.6 have no form until the
// library is sorted again: `formOf` guesses one from the name until then.

import type { ElementKind } from "./types";

export const FORMS = ["spell", "creature", "object", "building", "settlement", "place", "land"] as const;
export type Form = (typeof FORMS)[number];

export function isForm(v: unknown): v is Form {
  return typeof v === "string" && (FORMS as readonly string[]).includes(v);
}

// The two kinds the rest of the game knows.
export function kindOfForm(form: Form): ElementKind {
  return form === "spell" ? "spell" : "artifact";
}

export const FORM_LABEL: Record<Form, string> = {
  spell: "Spell",
  creature: "Creature",
  object: "Object",
  building: "Building",
  settlement: "Settlement",
  place: "Place",
  land: "Land",
};

// Words that name a form, whole words only, the last one that names a form
// deciding (a Dragon Egg is an object, an Egg Dragon a creature, as body.ts
// reads bodies). Only for elements no sort has reached yet.
const WORDS: [Form, string[]][] = [
  [
    "settlement",
    ["village", "town", "city", "hamlet", "camp", "encampment", "settlement", "kingdom", "capital", "metropolis", "outpost", "colony", "realm", "empire"],
  ],
  [
    "building",
    [
      "tower",
      "temple",
      "castle",
      "fortress",
      "forge",
      "smithy",
      "church",
      "chapel",
      "cathedral",
      "library",
      "house",
      "hut",
      "cottage",
      "inn",
      "tavern",
      "mill",
      "windmill",
      "lighthouse",
      "palace",
      "keep",
      "citadel",
      "academy",
      "observatory",
      "pyramid",
      "monastery",
      "barn",
      "bakery",
      "market",
      "shrine",
      "altar",
      "wall",
      "bridge",
      "gate",
      "dungeon",
      "manor",
      "hall",
      "workshop",
      "laboratory",
      "granary",
      "mausoleum",
      "crypt",
    ],
  ],
  [
    "land",
    [
      "island",
      "mountain",
      "volcano",
      "lake",
      "canyon",
      "oasis",
      "swamp",
      "marsh",
      "bog",
      "valley",
      "hill",
      "mesa",
      "plateau",
      "desert",
      "glacier",
      "crater",
      "ravine",
      "gorge",
      "dunes",
      "archipelago",
      "continent",
      "peninsula",
      "pond",
      "sea",
      "ocean",
      "tundra",
    ],
  ],
  [
    "place",
    [
      "grove",
      "spring",
      "ruin",
      "ruins",
      "cave",
      "cavern",
      "waterfall",
      "forest",
      "garden",
      "meadow",
      "glade",
      "arch",
      "henge",
      "portal",
      "nexus",
      "sanctuary",
      "geyser",
      "well",
      "tree",
      "jungle",
      "woods",
      "wood",
      "graveyard",
      "cemetery",
      "labyrinth",
      "maze",
      "abyss",
      "rift",
      "vortex",
      "nest",
      "den",
      "lair",
      "hive",
      "reef",
      "paradise",
      "underworld",
      "heaven",
      "eden",
      "wonder",
    ],
  ],
  [
    "creature",
    [
      "dragon",
      "serpent",
      "snake",
      "wolf",
      "fox",
      "bear",
      "phoenix",
      "griffin",
      "gryphon",
      "unicorn",
      "golem",
      "elemental",
      "spirit",
      "ghost",
      "wraith",
      "zombie",
      "undead",
      "skeleton",
      "vampire",
      "werewolf",
      "human",
      "person",
      "wizard",
      "witch",
      "mage",
      "sorcerer",
      "necromancer",
      "knight",
      "warrior",
      "king",
      "queen",
      "giant",
      "troll",
      "ogre",
      "goblin",
      "elf",
      "dwarf",
      "fairy",
      "faerie",
      "pixie",
      "imp",
      "demon",
      "angel",
      "beast",
      "monster",
      "hydra",
      "kraken",
      "leviathan",
      "behemoth",
      "titan",
      "wyvern",
      "wyrm",
      "basilisk",
      "chimera",
      "sphinx",
      "minotaur",
      "centaur",
      "mermaid",
      "siren",
      "harpy",
      "owl",
      "raven",
      "crow",
      "eagle",
      "hawk",
      "bird",
      "fish",
      "whale",
      "shark",
      "cat",
      "dog",
      "horse",
      "deer",
      "stag",
      "rabbit",
      "spider",
      "bee",
      "butterfly",
      "moth",
      "beetle",
      "ant",
      "slime",
      "ooze",
      "familiar",
      "ent",
      "treant",
      "dryad",
      "nymph",
      "lich",
      "banshee",
      "shade",
      "specter",
      "spectre",
      "druid",
      "shaman",
      "priest",
      "hero",
      "villager",
      "guardian",
      "sentinel",
      "colossus",
      "mammoth",
      "yeti",
      "frog",
      "toad",
      "turtle",
      "tortoise",
      "lion",
      "tiger",
      "boar",
      "ape",
      "monkey",
      "rat",
      "bat",
      "worm",
      "salamander",
      "lizard",
      "wisp",
      "djinn",
      "genie",
      "ghoul",
      "mummy",
      "people",
    ],
  ],
];
// Things held or placed: they win when they are the last word (a Dragon Egg).
WORDS.push([
  "object",
  [
    "book",
    "tome",
    "grimoire",
    "sword",
    "blade",
    "ring",
    "amulet",
    "talisman",
    "charm",
    "staff",
    "wand",
    "rod",
    "potion",
    "elixir",
    "lantern",
    "lamp",
    "candle",
    "crown",
    "orb",
    "gem",
    "jewel",
    "scroll",
    "shield",
    "cloak",
    "egg",
    "feather",
    "key",
    "chalice",
    "goblet",
    "grail",
    "mirror",
    "compass",
    "dagger",
    "axe",
    "hammer",
    "bow",
    "arrow",
    "helm",
    "helmet",
    "armor",
    "armour",
    "boots",
    "gloves",
    "map",
    "coin",
    "relic",
    "idol",
    "totem",
    "mask",
    "horn",
    "flute",
    "harp",
    "bell",
    "cauldron",
    "flask",
    "vial",
    "bottle",
    "seed",
    "pearl",
    "skull",
    "bone",
    "necklace",
    "bracelet",
    "pendant",
    "cape",
    "robe",
    "hat",
    "spear",
    "trident",
    "scepter",
    "sceptre",
    "artifact",
    "trinket",
    "box",
    "chest",
    "crystal",
  ],
]);
const FORM_OF_WORD = new Map<string, Form>();
for (const [form, words] of WORDS) for (const w of words) if (!FORM_OF_WORD.has(w)) FORM_OF_WORD.set(w, form);

// The form of an element: the stored one, else a guess from its name, else
// object for an artifact (the small thing is the safe guess: it builds least).
export function formOf(e: { name: string; kind: ElementKind | string; form?: string | null }): Form {
  if (isForm(e.form)) return e.form;
  if (e.kind === "spell") return "spell";
  return guessForm(e.name) ?? "object";
}

export function guessForm(name: string): Form | null {
  const words = name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  for (let k = words.length - 1; k >= 0; k--) {
    const w = words[k];
    const f = FORM_OF_WORD.get(w) ?? (w.endsWith("s") ? FORM_OF_WORD.get(w.slice(0, -1)) : undefined);
    if (f) return f;
  }
  return null;
}

// An item may be bigger than its kind when it says so ("Giant's Book",
// "a colossal tome"): its name, or the grimoire entry, in so many words.
const GIANT = /\b(giant|giants|gigantic|colossal|colossus|titanic|titan|enormous|huge|immense|towering|mountainous|vast|mega|great tree|world tree)\b/i;
// In the entry, only words that say the thing itself is of giant size: "a
// huge help to farmers", "lights a vast plain" or "forged by a giant long
// ago" say nothing of its size (the review of #50).
const GIANT_ENTRY = /\b(gigantic|colossal|enormous|titanic|giant-sized|mountain-sized|house-sized|towering over)\b/i;
export function saysGiant(name: string, description = ""): boolean {
  return GIANT.test(name) || GIANT_ENTRY.test(description);
}

// Beings a person is small beside: drawn up to 3.2 villagers (rigs.ts caps
// every creature there). Any other creature is held to 1.6 villagers.
const BIG_BEINGS =
  /\b(dragon|wyrm|wyvern|giant|titan|troll|ogre|whale|kraken|leviathan|behemoth|hydra|golem|colossus|ent|treant|mammoth|elephant|roc|yeti|minotaur|cyclops|basilisk|chimera|sphinx|phoenix|griffin|gryphon|demon|angel|elemental|colossal)\b/i;
export function bigBeing(name: string): boolean {
  return BIG_BEINGS.test(name);
}

// What the test run holds each kind to (src/sim/check.ts, `formCheck`). In
// cells across (a cell is about a meter, a house two by two of them), voxels
// tall above the ground (a house is 2, a villager about 2.5), and voxels in
// all. `giant` multiplies the first two when the item says it is giant.
export interface FormRule {
  across: number;
  tall: number;
  voxels: number;
}
export const FORM_RULES: Record<Exclude<Form, "spell">, FormRule> = {
  // In a hand, or on a pedestal, an altar or a lectern: the thing and what bears it.
  object: { across: 5, tall: 5, voxels: 50 },
  // A creature is its body, not a statue: what it builds stays small.
  creature: { across: 6, tall: 6, voxels: 120 },
  // A house is two by two cells and two voxels tall; a temple, a tower or a
  // castle a few houses wide, a lighthouse ten houses tall at most.
  building: { across: 10, tall: 20, voxels: 1500 },
  // Houses, a plaza, fields: a village is about thirty cells across.
  settlement: { across: 48, tall: 30, voxels: 3000 },
  // A grove, a spring, a ruin, a wonder: the wonders' reach, 4 to 14 cells.
  place: { across: 32, tall: 60, voxels: 3500 },
  // It reshapes the terrain: its reach is the measure, and the land's own.
  land: { across: 80, tall: 60, voxels: 4000 },
};
export const GIANT_FACTOR = 3;

// 4.6 part B: a person, a human or a role a human has, is made as one of the
// island's own villagers (w.person), not as a creature kind. Decided from the
// name like the kinds: the last word that names a person or a creature
// decides ("Dragon Rider" a person, "Witch Cat" a creature), and words that
// end in -mancer are people (a Pyromancer). Undead, spirits and other folk
// (a Lich, a Ghost, an Elf, a Vampire) stay creatures.
const PERSON_WORDS = new Set([
  "human",
  "humans",
  "person",
  "people",
  "man",
  "woman",
  "villager",
  "villagers",
  "peasant",
  "citizen",
  "child",
  "elder",
  "hermit",
  "stranger",
  "traveler",
  "traveller",
  "wanderer",
  "nomad",
  "king",
  "queen",
  "prince",
  "princess",
  "lord",
  "lady",
  "noble",
  "emperor",
  "empress",
  "chieftain",
  "chief",
  "knight",
  "paladin",
  "templar",
  "squire",
  "crusader",
  "warrior",
  "soldier",
  "guard",
  "archer",
  "ranger",
  "hunter",
  "huntress",
  "rider",
  "hero",
  "heroine",
  "champion",
  "wizard",
  "witch",
  "mage",
  "archmage",
  "sorcerer",
  "sorceress",
  "warlock",
  "magician",
  "enchanter",
  "enchantress",
  "conjurer",
  "summoner",
  "alchemist",
  "apprentice",
  "druid",
  "shaman",
  "priest",
  "priestess",
  "monk",
  "nun",
  "cleric",
  "healer",
  "saint",
  "oracle",
  "prophet",
  "seer",
  "pilgrim",
  "sage",
  "scholar",
  "astrologer",
  "astronomer",
  "bard",
  "blacksmith",
  "smith",
  "armorer",
  "armourer",
  "farmer",
  "fisherman",
  "fisherwoman",
  "fisher",
  "shepherd",
  "merchant",
  "trader",
  "innkeeper",
  "builder",
  "mason",
  "carpenter",
  "woodcutter",
  "lumberjack",
  "miner",
  "baker",
  "cook",
  "thief",
  "rogue",
  "bandit",
  "pirate",
  "sailor",
  "explorer",
  "astronaut",
  "survivor",
  "assassin",
  "ninja",
  "samurai",
  "viking",
  "gladiator",
]);
// Beings no person is, wherever they stand in the name ("Vampire Lord").
const NOT_PEOPLE =
  /\b(vampires?|lich|liches|ghosts?|ghouls?|zombies?|skeletons?|wraiths?|specters?|spectres?|demons?|devils?|werewol(f|ves)|undead|mummy|mummies|banshees?|golems?|elementals?|angels?|spirits?)\b/i;

export function personName(name: string): boolean {
  if (NOT_PEOPLE.test(name)) return false;
  const words = name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  for (let k = words.length - 1; k >= 0; k--) {
    const w = words[k];
    if (PERSON_WORDS.has(w) || /.mancers?$/.test(w)) return true;
    const f = FORM_OF_WORD.get(w) ?? (w.endsWith("s") ? FORM_OF_WORD.get(w.slice(0, -1)) : undefined);
    if (f) return false;
  }
  return false;
}
