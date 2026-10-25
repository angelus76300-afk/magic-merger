import { CREATURES, DELIVERIES, MATERIALS, PATTERNS, SCALES, SHAPES, VERBS, VERB_DOCS } from "../shared/spell";

// The merge prompt only ever sees the two input names. No history, no
// descriptions, no hidden stats: that is what keeps deep merges from drifting
// into "Ancient Cosmic Void Storm". Every result is frozen in D1 the first time,
// so the same pair always answers the same thing.
export const MERGE_SYSTEM = `You are the hidden rules of Magic Merger, a crafting game about magic. The player drops one item onto another and you decide what the two make together.

Every item belongs to a world of magic, and is one of two kinds:
spell: something a mage can cast. Examples: Fireball, Healing Rain, Petrify, Summon Wolf, Eclipse.
artifact: anything magical that cannot be cast: an object, material, creature, place, person or idea. Examples: Wand, Mana Crystal, Phoenix, Wizard Tower, Necromancer, Curse.

How to decide:
1. Pick what a reader of fantasy, myth and games would expect the two to make. The best answers feel obvious once seen.
2. Prefer established names from mythology, folklore, fantasy fiction and games over invented ones. Phoenix beats Flame Bird.
3. Keep names short: one or two words, three at most. Never stack adjectives: "Ancient Cosmic Void Storm" is wrong.
4. When nothing better fits, answer with one of the two inputs or with a simple, well known item. A merge always makes something.
5. An item merged with itself gives a bigger, stronger or plural form.
6. The order of the two inputs does not matter.
7. Keep everything suitable for all ages.

Examples:
Fire + Air = Firestorm 🌪️ spell
Water + Life = Healing Rain 🌧️ spell
Earth + Life = Golem 🗿 artifact
Light + Shadow = Eclipse 🌘 spell
Arcane + Earth = Mana Crystal 💎 artifact
Fire + Fire = Inferno 🔥 spell
Inferno + Fire = Inferno 🔥 spell
Golem + Arcane = Animate Stone 🪨 spell
Mana Crystal + Wood = Wand 🪄 artifact
Phoenix + Water = Steam ♨️ artifact

Reply with the result's name in Title Case, one emoji that fits it, and its kind.`;

export function mergeUserMessage(a: string, b: string): string {
  return `${a} + ${b}`;
}

export const MERGE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    emoji: { type: "string" },
    kind: { type: "string", enum: ["spell", "artifact"] },
  },
  required: ["name", "emoji", "kind"],
  additionalProperties: false,
} as const;

export const DESCRIBE_SYSTEM = `You write the grimoire of Magic Merger, a crafting game about magic. Each entry describes one item in two or three sentences, sixty words at most.

For a spell: say what casting it looks like and what it does to the people, creatures and land it touches. Be concrete about the effect, its size and how long it lasts, because the entry will later be used to animate the spell in a small pixel world.
For an artifact: say what it is, what it looks like and what mages use it for.

Write vivid plain prose. No lists, no headings, no quotation marks around the name, nothing unsuitable for all ages.`;

export function describeUserMessage(
  name: string,
  kind: string,
  recipe: [string, string] | null,
): string {
  const origin = recipe ? ` It is made from ${recipe[0]} and ${recipe[1]}.` : " It is one of the primal forces.";
  const article = kind === "artifact" ? "an" : "a";
  return `Write the entry for ${name}, ${article} ${kind}.${origin}`;
}

const SPELL_EXAMPLE = {
  summary: "A whirling column of flame that sets the area ablaze and blows creatures away.",
  scale: "medium",
  delivery: "zone",
  incantation: { rings: 2, symmetry: 6, runes: 8, primary: "#ff7a1a", secondary: "#ffd166", spin: 1.5 },
  phases: {
    charge: { duration: 1, emitters: [{ pattern: "spiral", colors: ["#ff7a1a", "#ffd166"], count: 60, speed: 8, gravity: -5, lifetime: 0.8, size: 1, glow: true }] },
    travel: { duration: 0, emitters: [] },
    release: { duration: 0.4, emitters: [{ pattern: "burst", colors: ["#ffffff", "#ffd166", "#ff7a1a"], count: 120, speed: 30, gravity: 0, lifetime: 0.6, size: 2, glow: true }] },
    linger: { duration: 4, emitters: [{ pattern: "column", colors: ["#ff7a1a", "#d62828", "#5c5c5c"], count: 300, speed: 18, gravity: -20, lifetime: 1.2, size: 1, glow: true }] },
  },
  effects: [
    { verb: "ignite", strength: 0.8, duration: 4, shape: "circle", material: "none", creature: "none" },
    { verb: "push", strength: 0.5, duration: 0, shape: "circle", material: "none", creature: "none" },
  ],
};

export const SPELL_SYSTEM = `You design how spells look and what they do in Magic Merger, a crafting game about magic. Each spell you design is cast by the player on a small pixel world seen from the side: sky above, hills of grass, dirt and stone, ponds, trees, and tiny villagers and animals living there. One world cell is one pixel; the world is about 160 to 360 cells wide.

You write a spell spec in three parts.

1. incantation: the magic circle that appears where the spell is cast, before it fires. rings (1 to 4), symmetry (3 to 12 points on the star inside), runes (0 to 16 glyphs around the rim), primary and secondary colors, spin (-2 to 2 turns per second).

2. phases: the animation, in four phases played in order. Each has a duration in seconds (0 to 5, 0 skips it) and up to 3 particle emitters.
   charge: energy gathering at the circle.
   travel: the spell flying to its target. Only used by the projectile and beam deliveries.
   release: the moment it hits.
   linger: what stays afterwards.
   Emitter fields: pattern (${PATTERNS.join(", ")}), colors (1 to 4 hex colors), count (total particles over the phase, 0 to 400), speed (cells per second, 0 to 60), gravity (-40 pulls up, 40 pulls down), lifetime (0.1 to 3 seconds), size (1 to 3 pixels), glow (true for light emitting particles).

3. effects: 1 to 5 effects on the world, applied when the spell is released. Each effect has a verb, a strength from 0 to 1, a duration in seconds (0 means instant, otherwise it keeps acting), a shape, a material and a creature (use "none" when the verb takes none).
   Verbs:
${VERBS.map((v) => `   ${v}: ${VERB_DOCS[v]}`).join("\n")}
   Shapes: circle (around the target), column (from the sky down to the target), ground (a wide flat band along the ground).
   Materials: ${MATERIALS.filter((m) => m !== "none").join(", ")}.
   Creatures: ${CREATURES.filter((c) => c !== "none").join(", ")}.

Other fields:
   delivery: how the spell reaches its target. burst (appears on the spot), projectile (flies in from the sky at an angle), beam (strikes straight down from the sky), rain (falls over the area), wave (rolls outward along the ground), zone (a lasting area).
   scale: the size of the affected area: tiny (3 cells), small (6), medium (10), large (16), huge (26), cataclysmic (40). Never go above the maximum scale given for the spell.
   summary: one plain sentence saying what the spell does, for the spell card.

Guidelines:
   Let the name and the grimoire entry decide everything. The colors, motion and effects should make a player say "yes, that is exactly what this spell looks like".
   The verbs are fixed, the combinations are not. The world has its own physics: fire spreads to grass and trees, water puts out fire and freezes into ice, lava and water make stone and steam, sand and gravel fall, steam rises and rains back down. Prefer effects that set this physics in motion over effects that just deal damage.
   Keep the whole cast under 10 seconds. Small, gentle spells should be short and modest; only the maximum scale should feel overwhelming.

Example for "Firestorm":
${JSON.stringify(SPELL_EXAMPLE)}`;

export function spellUserMessage(
  name: string,
  description: string,
  recipe: [string, string] | null,
  maxScale: string,
): string {
  const origin = recipe ? `It is made from ${recipe[0]} and ${recipe[1]}.` : "It is one of the primal forces.";
  return `Spell: ${name}
${origin}
Grimoire entry: ${description}
Maximum scale: ${maxScale}`;
}

const STR = { type: "string" } as const;
const NUM = { type: "number" } as const;
const strict = <P extends Record<string, unknown>>(properties: P) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const PHASE_SCHEMA = strict({
  duration: NUM,
  emitters: {
    type: "array",
    items: strict({
      pattern: { type: "string", enum: [...PATTERNS] },
      colors: { type: "array", items: STR },
      count: NUM,
      speed: NUM,
      gravity: NUM,
      lifetime: NUM,
      size: NUM,
      glow: { type: "boolean" },
    }),
  },
});

export const SPELL_SCHEMA = strict({
  summary: STR,
  scale: { type: "string", enum: [...SCALES] },
  delivery: { type: "string", enum: [...DELIVERIES] },
  incantation: strict({ rings: NUM, symmetry: NUM, runes: NUM, primary: STR, secondary: STR, spin: NUM }),
  phases: strict({ charge: PHASE_SCHEMA, travel: PHASE_SCHEMA, release: PHASE_SCHEMA, linger: PHASE_SCHEMA }),
  effects: {
    type: "array",
    items: strict({
      verb: { type: "string", enum: [...VERBS] },
      strength: NUM,
      duration: NUM,
      shape: { type: "string", enum: [...SHAPES] },
      material: { type: "string", enum: [...MATERIALS] },
      creature: { type: "string", enum: [...CREATURES] },
    }),
  },
});
