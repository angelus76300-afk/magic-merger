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

// A tier that was never chosen (elements from before tiers): asked once.
export const TIER_SYSTEM = `Magic Merger is a crafting game about magic. Rate how far an item's power would really reach:
cantrip: one spot, a single person or tree.
minor: a house, a small group.
major: a village.
grand: a valley, a lake, a forest.
legendary: a whole region, a mountain range.
cosmic: the entire world, the sky, creation itself.
Judge the meaning: Spark is a cantrip, Earthquake is grand, Big Bang is cosmic.`;

export const TIER_SCHEMA = {
  type: "object",
  properties: { tier: { type: "string", enum: [...TIERS] } },
  required: ["tier"],
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
      r: 1.2, look: "flame", color: "#ff6a1a", color2: "#fff2b0",
      tick(b, w) { w.particle({ x: b.x, y: b.y, z: b.z, life: 0.4, color: "#ffb03a" }); },
      land(b, w) {
        w.explode(b.x, b.y, w.r * 0.5, 0.8);
        w.ignite(b.x, b.y, w.r * 0.8, 0.4);
        b.kill();
      },
    });
  },
};`;

const EXAMPLE_TREE = `const spell = {
  materials: [
    { name: "worldwood", layer: "ground", colors: ["#6b4a2b", "#7a5532"], becomes: "dirt" },
  ],
  *cast(w) {
    w.camera(w.x, w.y, w.r * 1.3, 1);
    w.sound("rumble", 0.7);
    const trunk = Math.max(2, w.r * 0.1);
    for (let k = 1; k <= 12; k++) {
      w.disc(w.x, w.y, trunk, (x, y) => w.build(x, y, 2, "worldwood"));
      yield 0.12;
    }
    // The crown: leaf spheres in a ring around the trunk (z counts from the ground under each).
    const crown = w.r * 0.3;
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05, d = trunk + crown * 0.5;
      w.sphere(w.x + Math.cos(a) * d, w.y + Math.sin(a) * d, 22 + w.rand(0, 4), crown * 0.6, ["#2f7a2a", "#3f8f36", "#57a24a"], 0.85);
    }
    w.grow(w.x, w.y, w.r, 0.7);
    w.light(w.x, w.y, w.r, "#80ed99", 4);
  },
};`;

export const SPELL_SYSTEM = `You write the spells of Magic Merger, a crafting game about magic. The player discovers a spell by merging, then casts it on a small simulated land: hills, snowy peaks, lakes, a river, forests, fields and villages of tiny people who live, flee, burn, drown and rebuild. You turn one spell into a JavaScript program that makes it happen, so it looks and plays exactly like its name and grimoire entry.

THE PROGRAM
Define \`const spell = { *cast(w) { ... } }\`. cast is a generator: \`yield seconds\` waits, \`yield 0\` waits one frame (30 per second). Keep a cast under 12 seconds, except cosmic spells (up to 25). Plain JavaScript only: no DOM, no network, no timers, no imports. Never loop over more than about 20000 cells in one frame: use the area helpers, which are fast. Coordinates are cells on the ground; z is height above the ground.

POWER
The tier sets the reach: w.r is the radius in cells you should work with (the world is about 130 to 240 cells wide). cantrip: a spot. minor: a house. major: a village. grand: a valley. legendary: a region. cosmic: everything, and the camera should show it. Stay within about 1.5 w.r, except cosmic. Small spells should be short and precise, the biggest ones overwhelming.

WHAT THE WORLD DOES ON ITS OWN
Fire spreads through forests, fields, houses and oil (much less on grass), with the wind, and leaves ash and stumps; water or snow puts it out. Water flows downhill, freezes below 0 and boils above 100. Lava flows slowly, burns everything, hardens into basalt and turns water to steam. Acid eats trees, houses and soil. Oil burns fast. Mud flows slowly and dries into dirt. Snow melts above 2 degrees; very cold ground gets snow. Powder explodes when fire reaches it. Steam drifts and rains back down. Houses burn into rubble and villagers rebuild them; grass and trees grow back. Creatures flee fire, panic when burning, drown in deep water. Prefer setting this in motion over doing everything yourself.

MATERIALS (by layer; w.set and w.paint find the layer from the name)
ground: grass, dirt, sand, rock, snow, ash, basalt, crystal (glows), field (built columns show their material: basalt, crystal or your own)
fluid: water, ice, lava, oil, acid, mud
cover: tree, bush, crop, house, rubble, powder, stump, flower, boulder
gas: smoke, steam, poison
Creatures: villager, beast, spirit (flies, glows), golem (strong, fireproof). Statuses: burn, freeze, fear, sleep, calm, levitate, stun.

API (w)
w.x, w.y target; w.r reach; w.tier; w.width, w.height; w.time.
w.rand(a, b), w.chance(p), w.pick(list), w.dist(x1, y1, x2, y2), w.angle(x1, y1, x2, y2), w.lerp(a, b, t), w.noise(x, y).
Cells: w.cell(x, y) gives {height, ground, fluid, depth, cover, fire, temp, gas}; w.set(x, y, material, amount); w.clear(x, y, layer); w.fire(x, y, intensity); w.heat(x, y, degrees); w.raise(x, y, height).
Areas, calling fn(x, y, k) with k from 1 at the center to 0 at the edge: w.disc(x, y, r, fn), w.ring(x, y, r0, r1, fn), w.line(x0, y0, x1, y1, width, fn).
Big moves: w.explode(x, y, r, power 0 to 5), w.quake(x, y, r, strength) (one jolt: repeat it), w.ignite(x, y, r, chance), w.flood(x, y, r, fluid, depth), w.drain(x, y, r), w.paint(x, y, r, material, density, amount), w.temperature(x, y, r, delta) (minus 60 freezes, plus 300 burns), w.terraform(x, y, r, height) (hill or crater), w.build(x, y, voxels, material) (a column that tall made of a ground material: trunks, towers, walls, spires; one voxel is 2 height units), w.grow(x, y, r, density), w.gas(x, y, r, type, amount), w.wind(dx, dy).
Free voxels, for what floats or overhangs (a tree's crown, a floating rock, a statue, an arch; z is in voxels above the ground there, at most 20000 in the world): w.voxel(x, y, z, color), w.sphere(x, y, z, r, colors, density), w.box(x, y, z, sx, sy, sz, colors), w.unvoxel(x, y, r).
Creatures: w.creatures(x, y, r), w.corpses(x, y, r), w.spawn(kind, x, y). Each has x, y, z, kind, hp, alive, data and hurt(n), heal(n), kill(), revive(), push(dx, dy, up), status(name, seconds, fromX, fromY), transform(kind), resize(factor), tint(color), teleport(x, y).
Bodies, the moving parts of a spell: w.body({x, y, z, vx, vy, vz, r, look, color, color2, glow, life, gravity, drag, tick(b, w, dt), land(b, w), end(b, w)}). look: orb, flame, cloud, ring, shard, vortex, star, none. A body with z above 0 and gravity falls and calls land on touching the ground. A body has the same fields plus age, data, kill(), seek(x, y, speed).
Effects: w.particle({x, y, z, vx, vy, vz, life, color, size, glow, gravity, drag}), w.burst(x, y, {count, colors, speed, up, life, size, gravity, drag}), w.shockwave(x, y, r, color, seconds, width), w.light(x, y, r, color, seconds), w.darken(amount, seconds) (night: lights, fire and glowing things show through), w.tint(color, alpha, seconds), w.flash(color, strength), w.circle(x, y, r, color, color2, seconds) (magic circle), w.draw((ctx, t) => {...}, seconds, "world" or "screen") (free canvas 2D drawing; in world space one unit is one cell), w.camera(x, y, r, seconds), w.cameraBack(seconds), w.shake(amount, seconds), w.sound(name, size 0 to 1) with boom, thump, crackle, hiss, whoosh, rumble, rise, fall, chime, ping, drone, zap.

NEW RULES
The world is drawn as a floating island of voxels seen in 3D, so height matters: build tall things (a giant tree's trunk with w.build and a canopy of leaves above it, a tower, an ice wall) and send things high into the sky. When the built-in world cannot express the spell, add to it. spell.materials: [{name, layer, colors, flammable 0 to 1, fuel, flow (fluids), hurts, heat (temperature it pulls toward), glow, solid (cover), becomes (built-in material to fall back to), tick(cell, w)}]; tick runs on every cell of that material each frame, cell has x, y, dt. spell.creatures: [{name, base (a built-in kind), color, speed, hp, radius, flying, fireproof, swims, glow, tick(c, w, dt)}]. New rules stay in the world after the spell ends, so keep their ticks cheap and rare.

ARTIFACTS
Some items are artifacts, not spells: objects, materials, creatures, places, people. The player places them where they tap, and the same program format makes them appear: keep the arrival short (a flash, a sound, a second at most) and make the thing itself the point. A creature becomes a new creature kind and is spawned; an object, a building or a place is built with columns and free voxels at a believable size; a material is laid on the land; whatever acts on its own (a phoenix that revives the dead, a volcano that leaks lava, a well that waters the fields) gets a tick that keeps doing it. An artifact's reach is smaller than a spell's: most are a few cells.

GOOD SPELLS
Every spell has a moment of gathering (a circle, a sound, a light), a delivery (something moves: a falling star, a rolling wave, a drifting cloud), an impact the player cannot miss, and an aftermath the world carries on. Make it feel like its name: a Tidal Wave should be a wave that travels and floods, not a puddle. Use color, light, sound and camera for the big ones. Keep the code short and plain: about 20 to 60 lines.

Example, Fireball (major):
${EXAMPLE_FIREBALL}

Example, World Tree (legendary):
${EXAMPLE_TREE}

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
