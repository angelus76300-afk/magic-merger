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

export function describeUserMessage(
  name: string,
  kind: string,
  recipe: [string, string] | null,
): string {
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
    { name: "wisp", base: "spirit", color: "#b8a0ff", behavior: "follow", leader: ["villager"],
      aura: "sleep", auraRadius: 3, weak: ["fire"], onDeath: "seeds" },
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
Creatures: villager, beast, spirit (flies, glows), golem (strong, fireproof). Statuses: burn, freeze, fear, sleep, calm, levitate, stun.

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
spell.creatures: [{name, base (a built-in kind), color, speed, hp, radius, flying, fireproof, swims, glow, behavior, prey, leader, attack, sense, aura, auraRadius, auraPower, leaves, weak, immune, lifespan, onDeath, lures, scares, converts, active}]. behavior: wander, hunt (chases prey and attacks), guard (stays where it was spawned and attacks prey that comes close), follow (walks with a leader kind), flee. aura: heal, fear, calm, sleep, burn, freeze or hurt on everyone around it. leaves: fire, ice, flowers or a material, on the cells it walks over. weak and immune: water, fire, cold, light (daylight), lightning, acid. lifespan in seconds for summons. onDeath: explode, fire, seeds, ice, spawn:<kind> or a material. converts: true makes its victims rise as its own kind. active: day or night, when it is awake.
w.landmark(x, y, {name, lures, scares, aura, radius, power}) leaves a lasting presence at a place, for things that are not creatures or materials: a shrine, a relic, a scarecrow, a cursed stone. Build its look with the structures or voxels; the landmark is what it does. When a landmark names whom it scares, its harmful aura (hurt, burn, freeze, sleep, fear) touches only those kinds and a kind aura (heal, calm) spares them. Lured creatures visit for a few seconds and come back later; they do not stay for ever.

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

Reply with a one sentence summary for the spell card, and the program.`;

export function spellUserMessage(name: string, kind: string, description: string, recipe: [string, string] | null, tier: string): string {
  const origin = recipe ? `It is made from ${recipe[0]} and ${recipe[1]}.` : "It is one of the primal forces.";
  const label = kind === "artifact" ? "Artifact (placed, not cast)" : "Spell";
  return `${label}: ${name}\nTier: ${tier}\n${origin}\nGrimoire entry: ${description}`;
}

export function repairUserMessage(name: string, tier: string, code: string, error: string): string {
  return `Spell: ${name}\nTier: ${tier}\nThis program crashed in the game with: ${error}\n\nFix it, keeping the spell's look and feel. The program:\n${code}`;
}

export const SPELL_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" }, code: { type: "string" } },
  required: ["summary", "code"],
  additionalProperties: false,
} as const;
