import { Rng } from "./noise";
import type { Biome } from "./land-options";

// Names for an island and its wonders (4.4.5 part B), from syllables of the
// land they belong to: no API call, the same seed always gives the same name.
// A desert sounds dry and sharp ("Zahrim's Reach"), a tundra hard and cold
// ("Skarvik"), a jungle round and open ("Oluma"), a swamp heavy and wet
// ("Mirebrook"). A name is two or three syllables and at most 14 letters,
// so it fits a phone's title line.

const SYLLABLES: Record<Biome, { start: string[]; mid: string[]; end: string[] }> = {
  temperate: {
    start: ["Ael", "Bryn", "Cal", "Dun", "El", "Fen", "Gal", "Hal", "Ith", "Lor", "Mor", "Vael", "Wyn", "Ash"],
    mid: ["a", "e", "i", "o", "en", "ar", "el", "or", "wy"],
    end: ["ford", "mere", "wick", "dell", "holm", "wyn", "ric", "ton", "brook", "ley", "dor", "is"],
  },
  desert: {
    start: ["Zah", "Ka", "Sa", "Ash", "Tar", "Qa", "Mar", "Ra", "Sef", "Ish", "Dah", "Ny"],
    mid: ["a", "i", "ra", "ha", "si", "ri"],
    end: ["rim", "ad", "ar", "ul", "esh", "ir", "um", "ah", "is", "kar", "zin"],
  },
  tundra: {
    start: ["Skar", "Fro", "Hel", "Ivr", "Kol", "Nor", "Sval", "Thor", "Ulf", "Vik", "Hrim", "Ys"],
    mid: ["a", "e", "i", "o", "y", "ja"],
    end: ["vik", "heim", "fell", "gard", "ness", "dal", "stad", "mark", "rune", "ul"],
  },
  jungle: {
    start: ["Olu", "Ta", "Ka", "Ma", "Xo", "Yu", "Iz", "Na", "Te", "Pa", "Lu", "Zu"],
    mid: ["a", "o", "u", "ma", "lo", "na", "ti"],
    end: ["ma", "tl", "lan", "oa", "uru", "ca", "ko", "pan", "ri", "mba"],
  },
  swamp: {
    start: ["Mire", "Bog", "Fen", "Mud", "Sedge", "Grim", "Wal", "Murk", "Slo", "Tar"],
    mid: ["a", "e", "o", "ow", "en"],
    end: ["brook", "moor", "hollow", "mire", "wash", "marsh", "pool", "sink", "low", "fen"],
  },
  volcanic: {
    start: ["Kra", "Vul", "Ign", "Pyr", "Az", "Dra", "Bas", "Cin", "Mag", "Sur"],
    mid: ["a", "o", "u", "ra", "ka"],
    end: ["kor", "gar", "rax", "thar", "dun", "mor", "zul", "vex", "cor", "ash"],
  },
  mesa: {
    start: ["Can", "Ser", "Mes", "Ro", "Al", "Pue", "Ter", "Vas", "Cor", "Sol"],
    mid: ["a", "e", "i", "o", "ra", "li"],
    end: ["ado", "ita", "era", "on", "illo", "esa", "anca", "ez", "al", "ora"],
  },
};

// What an island is: a place word after a name, or a name alone.
const PLACES: Record<Biome, string[]> = {
  temperate: ["Hollow", "Vale", "Rest", "Reach", "Isle", "Crown", "Haven"],
  desert: ["Reach", "Expanse", "Isle", "Mirage", "Sands", "Rest"],
  tundra: ["Reach", "Isle", "Crown", "Hold", "Watch"],
  jungle: ["Isle", "Green", "Crown", "Haven", "Deep"],
  swamp: ["Hollow", "Isle", "Mire", "Deep", "Rest"],
  volcanic: ["Forge", "Isle", "Crown", "Reach", "Ember"],
  mesa: ["Reach", "Isle", "Crown", "Mesa", "Rest"],
};

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng.next() * list.length)];

// A person's or a place's name, two or three syllables of its land.
export function wordOf(rng: Rng, biome: Biome): string {
  const s = SYLLABLES[biome];
  for (let tries = 0; tries < 8; tries++) {
    const parts = [pick(rng, s.start)];
    if (rng.next() < 0.4) parts.push(pick(rng, s.mid));
    parts.push(pick(rng, s.end));
    // No doubled letters across a joint beyond two ("Fenn" yes, "Fennn" no),
    // and no word ending as it starts.
    const word = capital(parts.join("")).replace(/(.)\1\1+/g, "$1$1");
    if (word.length >= 4 && word.length <= 10) return word;
  }
  return capital(pick(rng, s.start) + pick(rng, s.end));
}

// The island's name: "Vael's Hollow", "Skarvik", "Isle of Oluma".
export function islandName(seed: number, biome: Biome): string {
  const rng = new Rng((seed ^ 0x6e61) + 7019);
  const word = wordOf(rng, biome);
  const r = rng.next();
  if (r < 0.4) return `${word}'s ${pick(rng, PLACES[biome])}`;
  if (r < 0.6) return `Isle of ${word}`;
  if (r < 0.75) return `${word} ${pick(rng, PLACES[biome])}`;
  return word;
}

// Words that describe each wonder, and the noun it is known by. "{w}" is a
// name of its land: "the Weeping Falls", "Ithor's Arch".
const WONDER_NAMES: Record<string, { nouns: string[]; adjectives: string[] }> = {
  waterfall: { nouns: ["Falls", "Cascade", "Veil"], adjectives: ["Weeping", "Silver", "Whispering", "Thundering", "Bridal", "Singing"] },
  "hot spring": { nouns: ["Springs", "Pools", "Baths"], adjectives: ["Steaming", "Healing", "Sleeping", "Warm", "Sighing"] },
  "cave mouth": { nouns: ["Cave", "Grotto", "Hollow"], adjectives: ["Echoing", "Hidden", "Yawning", "Old", "Bat"] },
  "stone arch": { nouns: ["Arch", "Gate", "Bridge"], adjectives: ["Wind", "Giant's", "Sky", "Broken", "Sunset"] },
  "lone tree": { nouns: ["Tree", "Oak", "Watcher"], adjectives: ["Lonely", "Old", "Hill", "Wishing", "Elder"] },
  ruins: { nouns: ["Ruins", "Stones", "Old Town"], adjectives: ["Fallen", "Forgotten", "Sunken", "Silent", "First"] },
  "sinkhole lake": { nouns: ["Well", "Eye", "Deep"], adjectives: ["Blue", "Bottomless", "Drowned", "Still", "Dark"] },
  geysers: { nouns: ["Geysers", "Spouts", "Fountains"], adjectives: ["Roaring", "Breathing", "Restless", "Boiling"] },
  "sea stacks": { nouns: ["Stacks", "Needles", "Sisters"], adjectives: ["Seven", "Gull", "Standing", "Lonely", "Grey"] },
  crater: { nouns: ["Crater", "Scar", "Bowl"], adjectives: ["Star", "Fallen", "Burnt", "Glowing", "Sky"] },
  "floating rock": { nouns: ["Rock", "Isle", "Stone"], adjectives: ["Drifting", "Sky", "Dreaming", "Wandering", "Cloud"] },
  bones: { nouns: ["Bones", "Ribs", "Barrow"], adjectives: ["Giant's", "Old King's", "Titan's", "Whale's", "Moon"] },
  "frozen waterfall": { nouns: ["Falls", "Curtain", "Stair"], adjectives: ["Frozen", "Glass", "Silent", "Winter", "Crystal"] },
  "fairy ring": { nouns: ["Ring", "Circle", "Dance"], adjectives: ["Fairy", "Humming", "Moon", "Merry", "Starlit"] },
  "world tree": { nouns: ["Tree", "Ash", "Root"], adjectives: ["World", "Mother", "First", "Great", "Eternal"] },
  hoard: { nouns: ["Hoard", "Lair", "Gold"], adjectives: ["Dragon's", "Sleeping", "Wyrm's", "Old Worm's", "Burning"] },
  "sunken temple": { nouns: ["Temple", "Halls", "Shrine"], adjectives: ["Sunken", "Drowned", "Tide", "Pearl", "Moon"] },
};

export function wonderName(kind: string, seed: number, biome: Biome): string {
  const rng = new Rng((seed ^ 0x776e) + 9001);
  const words = WONDER_NAMES[kind] ?? { nouns: ["Wonder"], adjectives: ["Strange"] };
  const noun = pick(rng, words.nouns);
  if (rng.next() < 0.35) return `${wordOf(rng, biome)}'s ${noun}`;
  return `the ${pick(rng, words.adjectives)} ${noun}`;
}
