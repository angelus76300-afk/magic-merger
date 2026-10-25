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
