import { INTENTS, PROMISE_TEST, type Intent } from "../shared/promises";
import { TIERS } from "../shared/tiers";

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

Also give the result a power tier, from what it would really reach:
cantrip: one spot, a single person or tree.
minor: a house, a small group.
major: a village.
grand: a valley, a lake, a forest.
legendary: a whole region, a mountain range.
cosmic: the entire world, the sky, creation itself.
Judge the meaning, not the recipe: Spark is a cantrip whatever made it, Big Bang is cosmic.

Examples:
Fire + Air = Firestorm 🌪️ spell major
Water + Life = Healing Rain 🌧️ spell major
Earth + Life = Golem 🗿 artifact minor
Light + Shadow = Eclipse 🌘 spell grand
Arcane + Earth = Mana Crystal 💎 artifact cantrip
Fire + Fire = Inferno 🔥 spell grand
Inferno + Fire = Inferno 🔥 spell grand
Golem + Arcane = Animate Stone 🪨 spell minor
Mana Crystal + Wood = Wand 🪄 artifact cantrip
Phoenix + Water = Steam ♨️ artifact minor

Reply with the result's name in Title Case, one emoji that fits it, its kind and its tier.`;

export function mergeUserMessage(a: string, b: string): string {
  return `${a} + ${b}`;
}

export const MERGE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    emoji: { type: "string" },
    kind: { type: "string", enum: ["spell", "artifact"] },
    tier: { type: "string", enum: [...TIERS] },
  },
  required: ["name", "emoji", "kind", "tier"],
  additionalProperties: false,
} as const;

export const DESCRIBE_SYSTEM = `You write the grimoire of Magic Merger, a crafting game about magic. Each entry describes one item in two or three sentences, sixty words at most.

For a spell: say what casting it looks like and what it does to the people, creatures and land it touches. Be concrete about the effect, its size and how long it lasts, because the entry will later be turned into the real spell in a small simulated world.
For an artifact: say what it is, what it looks like and what mages use it for. Describe the thing itself: a substance stays a substance and a creature a creature, never a jar or a trinket holding it.

Write vivid plain prose. No lists, no headings, no quotation marks around the name, nothing unsuitable for all ages.`;

export function describeUserMessage(name: string, kind: string, recipe: [string, string] | null): string {
  const origin = recipe ? ` It is made from ${recipe[0]} and ${recipe[1]}.` : " It is one of the primal forces.";
  const article = kind === "artifact" ? "an" : "a";
  return `Write the entry for ${name}, ${article} ${kind}.${origin}`;
}

// Tiers that were never chosen (elements from before tiers): asked once, for
// all of them in one call.
export const TIER_SYSTEM = `Magic Merger is a crafting game about magic. For each item in the list, one per line, rate how far its power would really reach:
cantrip: one spot, a single person or tree.
minor: a house, a small group.
major: a village.
grand: a valley, a lake, a forest.
legendary: a whole region, a mountain range.
cosmic: the entire world, the sky, creation itself.
Judge the meaning: Spark is a cantrip, Earthquake is grand, Big Bang is cosmic.
Answer with every item's name exactly as given, without the kind, and its tier.`;

export const TIERS_SCHEMA = {
  type: "object",
  properties: {
    tiers: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, tier: { type: "string", enum: [...TIERS] } },
        required: ["name", "tier"],
        additionalProperties: false,
      },
    },
  },
  required: ["tiers"],
  additionalProperties: false,
} as const;

// The spell designer writes a program. Its examples are kept short on purpose:
// the model copies the length of what it is shown, and output is what costs.
const EXAMPLE_FIREBALL = `const spell = {
  *cast(w) {
    w.circle(w.x, w.y, w.r * 0.5, "#ff7a1a", "#ffd166", 0.8);
    w.sound("rise", 0.3);
    yield 0.8;
    w.body({
      x: w.x - w.r * 2, y: w.y - w.r, z: 50, vx: w.r * 2.4, vy: w.r * 1.2, vz: -50,
      r: 1.2, look: "flame", color: "#ff6a1a", color2: "#fff2b0", trail: "#ffb03a",
      land(b, w) {
        w.explode(b.x, b.y, w.r * 0.5, 0.8);
        w.ignite(b.x, b.y, w.r * 0.8, 0.4);
        b.kill();
      },
    });
  },
};`;

const EXAMPLE_GROVE = `const spell = {
  materials: [
    { name: "gloom moss", layer: "ground", colors: ["#3b2f4a", "#4a3a5c"], glow: true, becomes: "grass",
      spreads: { into: ["grass"], rate: 0.05 }, reacts: { fire: "ash", water: "grass" } },
  ],
  creatures: [
    { name: "wisp", base: "spirit", color: "#b8a0ff", color2: "#fff2b0", features: ["glowing eyes"],
      behavior: "follow", leader: ["villager"], aura: "sleep", auraRadius: 3, weak: ["fire"], onDeath: "seeds" },
  ],
  *cast(w) {
    w.flash("#b8a0ff", 0.3);
    w.sound("drone", 0.5);
    for (let k = 0; k < 5; k++) {
      const a = k * 1.26, d = w.r * 0.5;
      w.tree(w.x + Math.cos(a) * d, w.y + Math.sin(a) * d, { style: "willow", height: w.rand(10, 16),
        leaves: ["#5a4a7a", "#6b5a8f"], accent: ["#c9b8ff"], grow: 2 });
    }
    w.paint(w.x, w.y, w.r * 0.6, "gloom moss", 0.8);
    for (let k = 0; k < 3; k++) w.spawn("wisp", w.x + w.rand(-3, 3), w.y + w.rand(-3, 3));
  },
};`;

export const SPELL_SYSTEM = `You write the spells of Magic Merger, a crafting game about magic. The player discovers a spell by merging, then casts it on a small simulated land: a floating island of voxels with hills, snowy peaks, lakes, a river, forests, fields and villages of tiny people who live, flee, burn, drown and rebuild. You turn one spell into a JavaScript program that makes it happen, so it looks and plays exactly like its name and grimoire entry.

THE PROGRAM
Define \`const spell = { *cast(w) { ... } }\`. cast is a generator: \`yield seconds\` waits, \`yield 0\` waits one frame (30 per second). Keep a cast under 12 seconds, except cosmic spells (up to 25). Plain JavaScript only: no DOM, no network, no timers, no imports. Never loop over more than about 20000 cells in one frame: use the area helpers, which are fast. Coordinates are cells on the ground; z is height above the ground in voxels.

POWER AND SCALE
The tier sets the reach: w.r is the radius in cells you should work with (the island is 112 to 208 cells wide). cantrip: a spot. minor: a house. major: a village. grand: a valley. legendary: a region. cosmic: everything, and the camera should show it. Stay within about 1.5 w.r, except cosmic. One cell or voxel is about a meter: a house is 2 voxels tall, a tree 6 to 15, a great tree 25 to 40, a world tree 50 to 90.

WHAT THE WORLD DOES ON ITS OWN
Fire spreads through forests, fields, houses, oil and wooden voxels, with the wind, and leaves ash and stumps; water or snow puts it out. Water flows downhill, freezes below 0 and boils above 100. Lava flows slowly, burns everything, hardens into basalt and turns water to steam. Acid eats trees, houses and soil. Oil burns fast. Mud flows slowly and dries into dirt. Snow melts above 2 degrees. Powder explodes when fire reaches it. Steam drifts and rains back down. Houses burn into rubble and villagers rebuild them; grass and trees grow back. Creatures flee fire, panic when burning, drown in deep water. Free voxels fall when nothing holds them; wood and leaves burn (a burnt trunk drops its crown); ice melts near heat. Prefer setting this in motion over doing everything yourself: the best spells start something the world carries on.

MATERIALS (by layer; w.set and w.paint find the layer from the name)
ground: grass, dirt, sand, rock, snow, ash, basalt, crystal (glows), field
fluid: water, ice, lava, oil, acid, mud
cover: tree, bush, crop, house, rubble, powder, stump, flower, boulder
gas: smoke, steam, poison
Creatures: villager, beast, spirit (flies, glows), golem (strong, fireproof), and the island's wild animals: deer, rabbit, wolf (hunts deer and rabbits by night), boar, bear, bird, fish (lives in water). In a list, beast also names every wild animal. Statuses: burn, freeze, fear, sleep, calm, levitate, stun.

API (w)
w.x, w.y target; w.r reach; w.tier; w.width, w.height; w.time.
w.rand(a, b), w.chance(p), w.pick(list), w.dist(x1, y1, x2, y2), w.angle(x1, y1, x2, y2), w.lerp(a, b, t), w.noise(x, y).
Cells: w.cell(x, y) gives {height, ground, fluid, depth, cover, fire, temp, gas}; w.set(x, y, material, amount); w.clear(x, y, layer); w.fire(x, y, intensity); w.heat(x, y, degrees); w.raise(x, y, height).
Areas, calling fn(x, y, k) with k from 1 at the center to 0 at the edge: w.disc(x, y, r, fn), w.ring(x, y, r0, r1, fn), w.line(x0, y0, x1, y1, width, fn).
Big moves: w.explode(x, y, r, power 0 to 5), w.quake(x, y, r, strength) (one jolt: repeat it), w.ignite(x, y, r, chance), w.flood(x, y, r, fluid, depth), w.drain(x, y, r), w.paint(x, y, r, material, density, amount), w.temperature(x, y, r, delta) (minus 60 freezes, plus 300 burns), w.terraform(x, y, r, height) (hill or crater), w.build(x, y, voxels, material) (raises the land itself as a column of a ground material: mesas, earth walls), w.grow(x, y, r, density), w.gas(x, y, r, type, amount), w.wind(dx, dy).
Lightning: w.lightning(x, y, {power, color}) strikes the highest thing on that cell, burns, hurts, sets wood alight, shocks every creature in the water it hits and turns sand to glass. w.beam(x0, y0, z0, x1, y1, z1, {color, width, seconds}) draws a ray of light (the effect is up to you).
Structures (options in braces are all optional; grow: seconds raises it from its base over time, which looks alive):
w.tree(x, y, {style, height, trunk, leaves, accent, accentShare, glow, z, grow}) with style oak, pine, birch, willow, palm, dead, giant, mushroom or crystal; trunk and leaves are color lists, accent colors are sprinkled in the leaves (blossoms, fruit, autumn), glow makes the leaves shine.
w.spire(x, y, {height, radius, colors, kind, lean, angle, grow}), w.tower(x, y, {height, radius, colors, roof, windows, grow}), w.wall(x0, y0, x1, y1, {height, thick, colors, kind, grow}), w.arch(x0, y0, x1, y1, {height, thick, colors, kind, grow}), w.island(x, y, {z, r, top, rock, grow}) (a floating island; put trees on it with z).
Free voxels for anything else (z in voxels above the ground at that cell; at most 20000 in the world): w.voxel(x, y, z, color, kind), w.sphere(x, y, z, r, colors, density, kind), w.box(x, y, z, sx, sy, sz, colors, kind), w.unvoxel(x, y, r), w.burnVoxels(x, y, r). kind: stone (default), wood, leaf, ice, glow (shines at night): all of these fall if nothing holds them up; magic (shines) and float stay where they are put. Use magic or float only for things that really float.
Creatures: w.creatures(x, y, r), w.corpses(x, y, r), w.spawn(kind, x, y). Each has x, y, z, kind, hp, alive, data and hurt(n), heal(n), kill(), revive(), push(dx, dy, up), status(name, seconds, fromX, fromY), transform(kind), resize(factor), tint(color), teleport(x, y).
Bodies, the moving parts of a spell, drawn in voxels: w.body({x, y, z, vx, vy, vz, r, look, color, color2, glow, trail, life, gravity, drag, tick(b, w, dt), land(b, w), end(b, w)}). look: orb, flame, cloud, ring, shard, vortex, star, meteor, swarm, none. trail: a color it leaves behind. A body with z above 0 and gravity falls and calls land on touching the ground; a body that leaves the island near the ground disappears. r is its radius in cells: 0.5 to 3 for most, up to 8 for the biggest. A body has the same fields plus age, data, kill(), seek(x, y, speed).
Effects: w.particle({x, y, z, vx, vy, vz, life, color, size, glow, gravity, drag}), w.burst(x, y, {count, colors, speed, up, life, size, gravity, drag}), w.shockwave(x, y, r, color, seconds, width), w.light(x, y, r, color, seconds), w.darken(amount, seconds) (night: lights, fire and glowing things show through), w.tint(color, alpha, seconds), w.flash(color, strength), w.circle(x, y, r, color, color2, seconds) (magic circle on the ground), w.draw((ctx, t) => {...}, seconds, "world") (canvas 2D painted on the land, one unit is one cell: runes, scorch marks), w.camera(x, y, r, seconds), w.cameraBack(seconds), w.shake(amount, seconds), w.sound(name, size 0 to 1) with boom, thump, crackle, hiss, whoosh, rumble, rise, fall, chime, ping, drone, zap.

NEW RULES
When the built-in world cannot express the spell, add to it; new rules stay in the world after the spell ends. spell.materials and spell.creatures are plain data written with literal values: w does not exist there.
spell.materials: [{name, layer, colors, flammable 0 to 1, fuel, flow (fluids), hurts, heat (temperature it pulls toward), glow, solid (cover), becomes, reacts, decays, spreads, lures, scares, taken}]. reacts maps fire, water, lava, acid, cold or heat to what the material turns into when that touches it: any material, or none, fire, explode, steam, smoke. decays: seconds before it turns into becomes. spreads: {into: [materials it takes over, or "any"], rate} with rate 0.02 (creeping) to 0.3 (fast). Prefer these declared rules over tick(cell, w), which costs a call per cell per frame.
spell.creatures: [{name, base (a built-in kind), color, color2, body, features, model, speed, hp, radius, flying, fireproof, swims, glow, behavior, prey, leader, attack, sense, aura, auraRadius, auraPower, leaves, weak, immune, lifespan, onDeath, lures, scares, converts, active}]. behavior: wander, hunt (chases prey and attacks), guard (stays where it was spawned and attacks prey that comes close), follow (walks with a leader kind), flee. aura: heal, fear, calm, sleep, burn, freeze or hurt on everyone around it. leaves: fire, ice, flowers or a material, on the cells it walks over. weak and immune: water, fire, cold, light (daylight), lightning, acid. lifespan in seconds for summons. onDeath: explode, fire, seeds, ice, spawn:<kind> or a material. converts: true makes its victims rise as its own kind. active: day or night, when it is awake.
Every creature is drawn as a small voxel figure that walks, flaps, sways and falls. body: two legs, four legs, bird, fish, serpent, insect, spider, slime, spirit, golem, dragon or tree folk (left out: chosen from its name, then its base). features, any of: horn, horns, antlers, wings, tail, mane, hat, hood, crown, glowing eyes, armor, plus one carried item: sword, axe, spear, staff, torch, hammer, shield, lantern, book or basket. color2 colors the belly, wings, mane, hood, leaves and glowing eyes. Wings do not make it fly: set flying. Only for a creature no body fits (a walking eye, a mimic chest, a living cloud): model, at most 16 boxes [x, y, z, width, height, depth, color, part] in whole numbers, standing on y 0 and facing +z, scaled to its radius; part (optional) is leg, leg2, arm, arm2, wing, tail or head for how it moves, or glow; a model replaces body and features. Prefer a body with features: it is shorter.
w.landmark(x, y, {name, lures, scares, aura, radius, power}) leaves a lasting presence at a place, for things that are not creatures or materials: a shrine, a relic, a scarecrow, a cursed stone. Build its look with the structures or voxels; the landmark is what it does. When a landmark names whom it scares, its harmful aura (hurt, burn, freeze, sleep, fear) touches only those kinds and a kind aura (heal, calm) spares them. Lured creatures visit for a few seconds and come back later; they do not stay for ever.
w.ward(x, y, r, {against, seconds, color, keepOut, allow}) raises a clear dome that keeps what is inside safe for seconds (default 20, up to 600). against lists fire, fluids, lightning, creatures, harm, cold (all of them by default). Fire and floods of lava or water stop at its edge, lightning strikes the dome, creatures that hunt or hurt are pushed out (keepOut and allow name kinds to push out or let in), blasts and direct harm barely touch those inside, and frightened villagers run under it. Every shield, ward, sanctuary, barrier or protection uses it; never build a solid shell of blocks over people, it hides them and stops nothing.

RELATIONSHIPS
The world is alive because things want, fear and use each other. Villagers and beasts already: flee from whatever hunts them or scares them; fight back as a mob when three or more villagers face something weak enough; walk to whatever lures them and, when it can be taken, carry it home, where every few gifts their village builds a new house; golems guard villagers against hunters. lures and scares list kinds (villager, beast, spirit, golem, your own kinds, or "all").
Every artifact, and every spell that brings a creature, a material or a lasting place, declares at least one relationship with what is already on the island. Think about what it would truly mean to the villagers and beasts:
Vampire: a creature, behavior hunt, prey villager, converts, active night, weak light; garlic or a holy relic scares it.
Gold: a ground material that lures villager and is taken, so villages grow rich and build.
Honey or a carcass: lures beast and is taken (eaten); a dragon: scares all, hunts beast, leaves fire.
Holy Relic: a small shrine plus w.landmark with scares your undead kinds and aura hurt; a scarecrow: a landmark that scares beast.

ARTIFACTS
Some items are artifacts, not spells: objects, materials, creatures, places, people. The player places them where they tap, and the same program format makes them appear: keep the arrival short (a flash, a sound, a second at most) and make the thing itself the point. A creature becomes a new creature kind with a behavior and is spawned; a building or a place is built with the structures at a believable size; a material is laid on the land with its reactions; whatever acts on its own (a volcano that leaks lava, a well that waters the fields) gets a creature, a material rule or a body that keeps doing it. An artifact's reach is smaller than a spell's: most are a few cells.

GOOD SPELLS
1. A signature: decide what this spell looks like that no other does (its colors, its shape, how it moves) before writing. Avoid the default of an orb and an explosion; a Blizzard, a Plague and a Meteor Shower should never look alike.
2. A gathering (a circle, a sound, a light), a delivery (something travels: a falling star, a rolling wave, a growing tree), an impact the player cannot miss, and an aftermath the world carries on.
3. Logic: think about what the spell would really do to this world and its people, then use the interactions: frost turns lakes into bridges and trees into ice, lightning finds the tallest tree, a plague spreads and burns away, a summoned beast hunts or protects. One clever interaction beats ten particles.
4. Everything that exists in the world is drawn in the world: bodies, voxels, lightning, beams. Screen space drawing and big tints are only for moods. Nothing hangs in the sky unless it is magic.
5. Short, plain code: about 20 to 60 lines.

Example, Fireball (major spell):
${EXAMPLE_FIREBALL}

Example, Haunted Grove (major artifact):
${EXAMPLE_GROVE}

Reply with a one sentence summary for the spell card, the program, and missing: when part of what this spell means could not be done with the API above, name the ability that was lacking in a few words and what it was for (for example "a barrier that stops lava: to keep the village safe"), otherwise an empty string. Be honest: this is how the API grows.`;

// Helpers and hints the API has grown since (worker/evolve.ts), added after
// the fixed prompt so the part that never changes stays cached.
export interface LibraryDoc {
  kind: "helper" | "hint";
  name: string;
  signature: string;
  doc: string;
}

export function spellSystem(library: LibraryDoc[] = []): string {
  if (!library.length) return SPELL_SYSTEM;
  const helpers = library.filter((l) => l.kind === "helper");
  const hints = library.filter((l) => l.kind === "hint");
  let text = SPELL_SYSTEM;
  if (helpers.length)
    text += `\n\nLIBRARY\nHelpers written for spells like yours, each tested. Call them as written, with w first; lib is there without declaring it. They return at once (what lasts runs on its own).\n${helpers.map((h) => `${h.signature}: ${h.doc}`).join("\n")}`;
  if (hints.length) text += `\n\nHINTS\nThings writers thought the API could not do, and how it does:\n${hints.map((h) => `${h.doc}`).join("\n")}`;
  return text;
}

// A program players liked, shown to the small model as a reference (3.3).
export interface LibraryExample {
  name: string;
  tier: string;
  kind: string;
  code: string;
}

// Why a spell is written again: what players said about the version they
// cast, or what its test run found. The old program is shown only when it is
// to be fixed (a test run failure), not when it is to be rethought.
export interface Rewrite {
  // One line per reason, already worded for the model.
  reasons: string[];
  summary?: string;
  code?: string;
}

export function spellUserMessage(
  name: string,
  kind: string,
  description: string,
  recipe: [string, string] | null,
  tier: string,
  examples: LibraryExample[] = [],
  rewrite?: Rewrite,
  intents: Intent[] = [],
): string {
  const origin = recipe ? `It is made from ${recipe[0]} and ${recipe[1]}.` : "It is one of the primal forces.";
  const label = kind === "artifact" ? "Artifact (placed, not cast)" : "Spell";
  let text = `${label}: ${name}\nTier: ${tier}\n${origin}\nGrimoire entry: ${description}`;
  const promises = intents.map((i) => PROMISE_TEST[i]).filter(Boolean);
  if (promises.length) text += `\n\n${promises.join("\n")}`;
  if (examples.length) {
    text += `\n\nPrograms players liked, for reference only. This spell needs its own signature: take what makes them work (scale, a clear impact, an interaction the world carries on), not their look.`;
    for (const e of examples) text += `\n\nLiked: ${e.name} (${e.tier} ${e.kind})\n${e.code}`;
  }
  if (rewrite?.reasons.length) {
    text += `\n\nThis spell is being written again. About the previous version${rewrite.summary ? ` ("${rewrite.summary}")` : ""}:\n${rewrite.reasons.map((r) => `- ${r}`).join("\n")}`;
    text += rewrite.code
      ? `\n\nThe previous program, to fix:\n${rewrite.code}`
      : `\n\nWrite a new program that answers this. Do not keep the old design if that is what failed.`;
  }
  return text;
}

export function repairUserMessage(name: string, tier: string, code: string, error: string): string {
  return `Spell: ${name}\nTier: ${tier}\nThis program crashed in the game with: ${error}\n\nFix it, keeping the spell's look and feel. The program:\n${code}`;
}

export const SPELL_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" }, code: { type: "string" }, missing: { type: "string" } },
  required: ["summary", "code", "missing"],
  additionalProperties: false,
} as const;

// What a spell promises (3.4.2), asked of the small model from the name and
// grimoire entry alone, before any program exists: the writer of the program
// never chooses what it is tested on.
export const INTENT_SYSTEM = `Magic Merger is a crafting game about magic. Items are cast or placed on a small island of villages, forests, lakes and hills. Say what this item promises to do, from its name and grimoire entry: one main intent, and a second only if it truly does both.
protect: keeps people, houses or land safe from harm (shields, wards, sanctuaries, barriers, guardians).
heal: restores health or life, mends what is broken.
harm: destroys, burns, hurts or kills.
summon: brings a creature or a being.
create: makes something lasting: a building, a forest, a material, an object.
transform: changes what things are or how they look.
weather: rain, storms, snow, sun, wind, night.
move: carries, throws, lifts or teleports things or people.
reveal: shows, lights or senses what was hidden.
other: none of these.
Judge what it does, not its name alone: Shield Bash harms, Iron Skin protects.`;

export const INTENT_SCHEMA = {
  type: "object",
  properties: { intents: { type: "array", items: { type: "string", enum: [...INTENTS] } } },
  required: ["intents"],
  additionalProperties: false,
} as const;

export function intentUserMessage(name: string, kind: string, description: string): string {
  return `${kind === "artifact" ? "Artifact" : "Spell"}: ${name}\nGrimoire entry: ${description}`;
}

// The API designer (3.4.2). Writers report what the API lacked; when several
// spells lack the same thing, the big model decides how the API grows.
export const DESIGN_SYSTEM = `You maintain the World API of Magic Merger, a crafting game about magic in which every spell is a short JavaScript program written by a model from the API below. Writers report the abilities they lacked, one spell a line with its number. Find the one ability that the most spells lacked, at least three different spells, list in answers the numbers of the lines it answers, and decide how the API grows, one of three ways (or none, with empty answers, when no ability is shared by three spells):

helper: the ability can be built from the API as it is. Write it as one JavaScript function expression, function (w, ...) { ... }, using only w and plain JavaScript (no DOM, no network, no timers, no globals, no state outside its arguments, never more than about 20000 cells in one frame). It is called from inside a spell's cast and returns at once: it must not yield. What has to last or act every frame runs on its own, with a body (look "none" for an invisible one) whose tick does the work, a creature, a material rule or a landmark. Keep it short and general, so many spells can use it: options in an object with sensible defaults. Give its signature as spells will call it, lib.name(w, ...), and one line of doc for the writers' prompt. Write an example: a complete short spell program (const spell = { *cast(w) { ... } }) that uses it the way the reporting spells wanted. The example is cast in a test run and must visibly do what the helper says.
engine: the ability needs the simulation itself to change (a new rule of the land, a new kind of thing, how something is drawn) and a helper could only fake it badly. Write spec: what the engine should add, the API call it would have, and why a helper cannot do it. A developer reviews it.
exists: the API can already do it and the writers missed it. Write doc: one line telling writers how, which joins their prompt as a hint.

Prefer exists over helper and helper over engine. Name it in lower camel case. Never break or rename what exists.

THE API THE WRITERS HAVE
`;

export const DESIGN_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["helper", "engine", "exists", "none"] },
    answers: { type: "array", items: { type: "integer" } },
    name: { type: "string" },
    signature: { type: "string" },
    doc: { type: "string" },
    code: { type: "string" },
    example: { type: "string" },
    spec: { type: "string" },
  },
  required: ["decision", "answers", "name", "signature", "doc", "code", "example", "spec"],
  additionalProperties: false,
} as const;

export function designUserMessage(gaps: { id: number; spell: string; tier: string; missing: string }[], library: LibraryDoc[]): string {
  let text = `What the writers lacked, one spell a line:\n${gaps.map((g) => `${g.id}. ${g.spell} (${g.tier}): ${g.missing}`).join("\n")}`;
  if (library.length) text += `\n\nAlready grown (do not write these again):\n${library.map((l) => `${l.kind} ${l.signature || l.name}: ${l.doc}`).join("\n")}`;
  return text;
}

// The judge (3.3): Haiku looks at three Spell Lab frames of a cast and says
// whether a player would vote it up. Its notes from earlier votes come in the
// user message, so it learns this player's taste.
export const JUDGE_SYSTEM = `You judge spells in Magic Merger, a crafting game about magic. A spell is a program that plays out on a floating voxel island with hills, lakes, forests, fields and villages of tiny people. You see three frames taken during and after one cast, on the same island, near a village, plus numbers about what changed. Say whether a player who cast it would vote it up.

What players vote up: the spell looks like its name and grimoire entry at once; its size matches its tier (cantrip a spot, minor a house, major a village, grand a valley, legendary a region, cosmic the world); there is a clear impact and something the world carries on (fire spreading, ice, water, growth, creatures reacting); it has a look of its own.
What players vote down, with the reason they pick:
nothing: nothing visible happened, or only a faint flash or a few particles.
small: real but much smaller than the name and tier promise.
wrong: it does not look like its name; or it looks broken: blocks floating in the sky with nothing holding them, a tree crown off its trunk, gray pillars or boxes standing in for things, giant low poly shapes, a flat line for lightning.
broke: it ruined the island far beyond its reach (a cosmic spell may).
boring: plain and predictable, the default orb and explosion, no interaction.

Score from 1 to 5: 5 a player would show it to a friend, 4 good, 3 fine but forgettable, 2 a player would vote it down, 1 broken or empty. Give the main reason (fine when the score is 3 or more) and one short sentence on what you see.`;

export const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", enum: [1, 2, 3, 4, 5] },
    reason: { type: "string", enum: ["fine", "nothing", "small", "wrong", "broke", "boring"] },
    note: { type: "string" },
  },
  required: ["score", "reason", "note"],
  additionalProperties: false,
} as const;

export function judgeUserMessage(name: string, kind: string, tier: string, description: string, facts: string, notes: string[], shots: number[]): string {
  let text = `${kind === "artifact" ? "Artifact (placed, not cast)" : "Spell"}: ${name}\nTier: ${tier}\nGrimoire entry: ${description}\nWhat changed in the world: ${facts}\nFrames at ${shots.map((s) => `${s} s`).join(", ")} after the cast follow.`;
  if (notes.length)
    text += `\n\nThe player's votes on spells you judged before. Where you disagreed, they were right:\n${notes.map((n) => `- ${n}`).join("\n")}`;
  return text;
}
