import { toColor } from "./colors";

// What a creature looks like, as data (3.5). The simulation only carries it;
// the view turns it into a rig of boxes (voxel/rigs.ts). A spell declares
//
//   body: "four legs", features: ["horns", "wings"], color2: "#ffd166"
//
// or, for a creature no body plan fits, a model of up to 16 boxes. Kinds that
// declare nothing get a body from their name (a Fire Wolf has four legs, a
// Lich King a crown), and failing that from their base kind, so the creatures
// of spells written before 3.5 get a body without being written again.

export const PLANS = ["two legs", "four legs", "bird", "fish", "serpent", "insect", "spider", "slime", "spirit", "golem", "dragon", "tree folk"] as const;
export type Plan = (typeof PLANS)[number];

// Features any body can carry. One horn is a unicorn's; horns are a pair.
export const FEATURES = ["horn", "horns", "antlers", "wings", "tail", "mane", "hat", "hood", "crown", "glowing eyes", "armor"] as const;
// One carried item at most. hoe and rod are for villagers' jobs; tusks for boars.
export const ITEMS = ["sword", "axe", "spear", "staff", "torch", "hammer", "shield", "lantern", "book", "basket", "hoe", "rod"] as const;
export const EXTRA = ["tusks", "beard", "apron", "cap", "straw hat"] as const;
export type Feature = (typeof FEATURES)[number] | (typeof ITEMS)[number] | (typeof EXTRA)[number];

// Proportions of a plan, as multipliers around 1. Not offered to spells: the
// wild species and the names below use them.
export interface Build {
  legs?: number;
  long?: number;
  bulk?: number;
  neck?: number;
  head?: number;
  ears?: number;
  tail?: number;
  snout?: number;
}

// How a model box moves: legs and arms swing (leg2 and arm2 in the other
// phase), wings flap, tails sway, a head nods; glow shines at night.
export const MODEL_PARTS = ["leg", "leg2", "arm", "arm2", "wing", "tail", "head", "glow"] as const;
export type ModelPart = (typeof MODEL_PARTS)[number];

export interface ModelBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: number;
  part: ModelPart | null;
}

export const MAX_MODEL_BOXES = 16;

export interface BodySpec {
  plan: Plan;
  features: Feature[];
  build: Build;
  // Belly, wings, mane, hood, leaves and glowing eyes; null: from the body color.
  color2: number | null;
  // A model replaces the plan and its features.
  model: ModelBox[] | null;
  // The villagers' own figure: skin, hair and clothes from each one's look.
  villager?: boolean;
  // Features some individuals of a species have and others not (stags have
  // antlers, does do not), chosen by the creature's look.
  vary?: Feature[];
}

const PLAN_WORDS: Record<string, Plan> = {
  biped: "two legs",
  humanoid: "two legs",
  human: "two legs",
  person: "two legs",
  "two-legged": "two legs",
  legs: "two legs",
  quadruped: "four legs",
  "four-legged": "four legs",
  animal: "four legs",
  beast: "four legs",
  snake: "serpent",
  worm: "serpent",
  bug: "insect",
  beetle: "insect",
  ghost: "spirit",
  wisp: "spirit",
  floating: "spirit",
  "floating spirit": "spirit",
  ooze: "slime",
  blob: "slime",
  treant: "tree folk",
  tree: "tree folk",
  treefolk: "tree folk",
  "tree-folk": "tree folk",
  wyrm: "dragon",
};

const FEATURE_WORDS: Record<string, Feature> = {
  antler: "antlers",
  wing: "wings",
  tails: "tail",
  hats: "hat",
  "wizard hat": "hat",
  "pointed hat": "hat",
  helmet: "armor",
  armour: "armor",
  "glowing eye": "glowing eyes",
  "glow eyes": "glowing eyes",
  eyes: "glowing eyes",
  "red eyes": "glowing eyes",
  cloak: "hood",
  cape: "hood",
  robe: "hood",
  "carried item": "staff",
  wand: "staff",
  blade: "sword",
  pick: "hammer",
  pickaxe: "hammer",
  club: "hammer",
  lamp: "lantern",
  pitchfork: "hoe",
};

const ALL_FEATURES = new Set<string>([...FEATURES, ...ITEMS, ...EXTRA]);
const ITEM_SET = new Set<string>(ITEMS);

export function isItem(f: string): boolean {
  return ITEM_SET.has(f);
}

export function planOf(v: unknown): Plan | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if ((PLANS as readonly string[]).includes(s)) return s as Plan;
  return PLAN_WORDS[s] ?? null;
}

// A feature list as a spell wrote it: names or {name}, known ones only, one item.
export function featuresOf(v: unknown): Feature[] {
  const out: Feature[] = [];
  let item = false;
  for (const raw of Array.isArray(v) ? v.slice(0, 12) : typeof v === "string" ? [v] : []) {
    const name = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { name?: unknown }).name : null;
    if (typeof name !== "string") continue;
    const s = name.trim().toLowerCase();
    const f = (ALL_FEATURES.has(s) ? s : FEATURE_WORDS[s]) as Feature | undefined;
    if (!f || out.includes(f)) continue;
    if (isItem(f)) {
      if (item) continue;
      item = true;
    }
    out.push(f);
  }
  return out;
}

// [x, y, z, w, h, d, color, part] or {x, y, z, w, h, d, color, part}; at most
// 16, numbers bounded, boxes without a size dropped. null when nothing is left.
export function modelOf(v: unknown): ModelBox[] | null {
  if (!Array.isArray(v)) return null;
  const out: ModelBox[] = [];
  for (const raw of v) {
    if (out.length >= MAX_MODEL_BOXES) break;
    let a: unknown[];
    if (Array.isArray(raw)) a = raw;
    else if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      a = [o.x, o.y, o.z, o.w ?? o.width, o.h ?? o.height, o.d ?? o.depth, o.color, o.part];
    } else continue;
    const n = (k: number, lo: number, hi: number, fallback: number) => {
      const x = a[k];
      return typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fallback;
    };
    const w = n(3, 0, 32, 0);
    const h = n(4, 0, 32, 0);
    const d = n(5, 0, 32, 0);
    if (w <= 0 || h <= 0 || d <= 0) continue;
    const part = typeof a[7] === "string" && (MODEL_PARTS as readonly string[]).includes(a[7].toLowerCase()) ? (a[7].toLowerCase() as ModelPart) : null;
    out.push({ x: n(0, -32, 32, 0), y: n(1, -32, 32, 0), z: n(2, -32, 32, 0), w, h, d, color: toColor(a[6]) ?? 0xcccccc, part });
  }
  return out.length ? out : null;
}

// Proportions by species, used by the wild animals and by names.
export const BUILDS: Record<string, Build> = {
  wolf: { legs: 1, long: 1, bulk: 0.9, tail: 1.2, snout: 1.2, ears: 1 },
  deer: { legs: 1.45, long: 1, bulk: 0.85, neck: 1.6, snout: 0.9, ears: 1, tail: 0.3 },
  horse: { legs: 1.6, long: 1.25, bulk: 1.05, neck: 1.7, head: 1.1, snout: 1.3, ears: 0.8, tail: 1.1 },
  rabbit: { legs: 0.55, long: 0.75, bulk: 1.1, head: 1.25, ears: 2.4, snout: 0.4, tail: 0.25, neck: 0.3 },
  boar: { legs: 0.65, long: 1.05, bulk: 1.35, neck: 0.3, snout: 1.4, ears: 0.8, tail: 0.4 },
  bear: { legs: 0.9, long: 1.05, bulk: 1.55, neck: 0.5, head: 1.25, snout: 0.9, ears: 0.6, tail: 0.15 },
  cat: { legs: 0.95, long: 0.95, bulk: 0.85, snout: 0.6, ears: 1, tail: 1.7 },
  ox: { legs: 0.95, long: 1.15, bulk: 1.4, neck: 0.5, snout: 1, ears: 0.7, tail: 0.8 },
  rat: { legs: 0.5, long: 0.8, bulk: 0.9, snout: 1.3, ears: 0.8, tail: 1.8, neck: 0.3 },
  small: { legs: 0.8, bulk: 0.85, head: 1.3 },
  stout: { legs: 0.75, bulk: 1.4, head: 1 },
  thin: { bulk: 0.7, legs: 1.1 },
};

interface Guess {
  plan?: Plan;
  build?: string;
  features?: Feature[];
}

// Words in a creature's name, the last one that names a body deciding it
// ("Spirit Wolf" walks on four legs, "Wolf Spirit" floats). Features add up.
const NAMES: [string[], Guess][] = [
  [["dragon", "wyrm", "wyvern", "drake", "dragons"], { plan: "dragon" }],
  [["serpent", "snake", "naga", "viper", "cobra", "python", "eel", "worm", "basilisk", "hydra", "leviathan", "wurm", "asp"], { plan: "serpent" }],
  [["fish", "shark", "piranha", "carp", "koi", "trout", "salmon", "pike", "minnow"], { plan: "fish" }],
  [
    ["bird", "phoenix", "raven", "crow", "eagle", "hawk", "owl", "dove", "falcon", "vulture", "roc", "bat", "sparrow", "thunderbird", "songbird"],
    { plan: "bird" },
  ],
  [["griffin", "gryphon", "hippogriff", "pegasus"], { plan: "four legs", build: "horse", features: ["wings"] }],
  [["unicorn"], { plan: "four legs", build: "horse", features: ["horn", "mane"] }],
  [["spider", "tarantula", "arachnid", "scorpion", "spiderling"], { plan: "spider" }],
  [["bee", "wasp", "hornet", "moth", "butterfly", "firefly", "dragonfly", "fly", "mosquito", "fairyfly"], { plan: "insect", features: ["wings"] }],
  [["insect", "beetle", "ant", "locust", "scarab", "mantis", "cricket", "grasshopper", "bug", "termite", "centipede"], { plan: "insect" }],
  [["slime", "ooze", "blob", "jelly", "gel", "pudding", "goo", "sludge", "mimic", "kraken", "octopus", "squid", "jellyfish"], { plan: "slime" }],
  [
    ["ghost", "spirit", "wisp", "wraith", "phantom", "specter", "spectre", "shade", "soul", "banshee", "poltergeist", "spook", "apparition"],
    { plan: "spirit" },
  ],
  [["golem", "elemental", "titan", "colossus", "construct", "automaton", "sentinel"], { plan: "golem" }],
  [["gargoyle"], { plan: "golem", features: ["wings", "horns"] }],
  [["treant", "ent", "dryad", "treefolk", "sapling", "groot", "sylvan", "woodwose"], { plan: "tree folk" }],
  [["wolf", "wolves", "hound", "dog", "fox", "jackal", "warg", "cerberus", "coyote", "hellhound", "werewolf"], { plan: "four legs", build: "wolf" }],
  [["bear", "grizzly", "owlbear"], { plan: "four legs", build: "bear" }],
  [["boar", "pig", "hog", "swine"], { plan: "four legs", build: "boar", features: ["tusks"] }],
  [["deer", "stag", "elk", "moose", "reindeer", "hart", "doe", "fawn"], { plan: "four legs", build: "deer" }],
  [["stag", "elk", "moose", "reindeer", "hart"], { features: ["antlers"] }],
  [["horse", "steed", "mare", "stallion", "pony", "nightmare", "kelpie", "mount"], { plan: "four legs", build: "horse", features: ["mane"] }],
  [["rabbit", "hare", "bunny", "jackalope"], { plan: "four legs", build: "rabbit" }],
  [["cat", "lion", "tiger", "panther", "leopard", "lynx", "jaguar", "puma", "sphinx", "manticore", "kitten"], { plan: "four legs", build: "cat" }],
  [["lion", "manticore"], { features: ["mane"] }],
  [["goat", "ram", "sheep", "ox", "bull", "cow", "bison", "buffalo", "yak", "aurochs"], { plan: "four legs", build: "ox", features: ["horns"] }],
  [["rat", "mouse", "mice", "rats", "weasel", "ferret"], { plan: "four legs", build: "rat" }],
  [["knight", "warrior", "soldier", "paladin", "guard", "champion", "templar", "legionnaire", "crusader"], { plan: "two legs", features: ["armor", "sword"] }],
  [["king", "queen", "prince", "princess", "monarch", "emperor", "empress", "lord", "lady"], { features: ["crown"] }],
  [["witch", "wizard", "mage", "sorcerer", "sorceress", "warlock", "magician", "archmage"], { plan: "two legs", features: ["hat", "staff"] }],
  [
    ["necromancer", "cultist", "monk", "reaper", "druid", "priest", "priestess", "acolyte", "hermit", "oracle", "shaman", "lich"],
    { plan: "two legs", features: ["hood", "staff"] },
  ],
  [
    ["skeleton", "zombie", "ghoul", "mummy", "vampire", "elf", "human", "villager", "peasant", "hero", "hunter", "bandit", "thief", "ranger", "bard"],
    { plan: "two legs" },
  ],
  [["vampire", "dracula"], { features: ["hood", "glowing eyes"] }],
  [
    ["goblin", "gnome", "dwarf", "imp", "kobold", "hobbit", "halfling", "leprechaun", "pixie", "fairy", "sprite", "brownie"],
    { plan: "two legs", build: "small" },
  ],
  [["pixie", "fairy", "sprite"], { features: ["wings"] }],
  [["imp", "demon", "devil", "fiend", "satyr", "faun", "minotaur", "oni"], { plan: "two legs", features: ["horns"] }],
  [["troll", "ogre", "giant", "orc", "brute", "yeti", "cyclops", "sasquatch", "bigfoot"], { plan: "two legs", build: "stout" }],
  [["angel", "seraph", "valkyrie", "archangel", "cherub"], { plan: "two legs", features: ["wings"] }],
  [["winged", "flying"], { features: ["wings"] }],
  [["horned"], { features: ["horns"] }],
  [["crowned", "royal"], { features: ["crown"] }],
  [["armored", "armoured"], { features: ["armor"] }],
  [["hooded", "cloaked"], { features: ["hood"] }],
  [["glowing", "burning", "fiery", "infernal"], { features: ["glowing eyes"] }],
];

const NAME_INDEX = new Map<string, Guess[]>();
for (const [words, guess] of NAMES)
  for (const w of words) {
    const list = NAME_INDEX.get(w) ?? [];
    list.push(guess);
    NAME_INDEX.set(w, list);
  }

const IRREGULAR: Record<string, string> = { wolves: "wolf", mice: "mouse", geese: "goose", elves: "elf", dwarves: "dwarf", fishes: "fish", harpies: "harpy" };

function lookUp(word: string): Guess[] | undefined {
  const w = IRREGULAR[word] ?? word;
  return NAME_INDEX.get(w) ?? (w.endsWith("es") ? NAME_INDEX.get(w.slice(0, -2)) : undefined) ?? (w.endsWith("s") ? NAME_INDEX.get(w.slice(0, -1)) : undefined);
}

// What a name suggests: whole words only, so a Dragonfly is not a dragon.
export function guessBody(name: string): { plan: Plan | null; build: Build | null; features: Feature[] } {
  let plan: Plan | null = null;
  let build: string | null = null;
  const features: Feature[] = [];
  for (const word of name.toLowerCase().split(/[^a-z]+/)) {
    if (!word) continue;
    for (const g of lookUp(word) ?? []) {
      if (g.plan) {
        plan = g.plan;
        build = g.build ?? null;
      }
      for (const f of g.features ?? []) if (!features.includes(f)) features.push(f);
    }
  }
  // A single item, the last one named.
  const items = features.filter(isItem);
  const kept = features.filter((f) => !isItem(f) || f === items[items.length - 1]);
  return { plan, build: build ? BUILDS[build] : null, features: kept };
}

export function body(plan: Plan, features: Feature[] = [], extra: Partial<BodySpec> = {}): BodySpec {
  return { plan, features, build: {}, color2: null, model: null, ...extra };
}

// The body of a kind a spell defines, from what it declares, its name, then
// its base kind's body.
export function bodyFrom(raw: Record<string, unknown>, name: string, base: BodySpec | undefined): BodySpec {
  const declared = planOf(raw.body);
  const declaredFeatures = raw.features !== undefined ? featuresOf(raw.features) : null;
  const model = modelOf(raw.model);
  const color2 = toColor(raw.color2);
  const guess = guessBody(name);
  const fallback = base ?? body("four legs");
  const plan: Plan = declared ?? guess.plan ?? fallback.plan;
  let build: Build = {};
  if (guess.build && guess.plan === plan) build = guess.build;
  else if (!declared && !guess.plan) build = fallback.build;
  const features = declaredFeatures ?? (guess.features.length ? guess.features : declared || guess.plan ? [] : fallback.features);
  // A spell creature built on a villager is a person, not one of the villagers.
  return { plan, features, build, color2, model };
}
