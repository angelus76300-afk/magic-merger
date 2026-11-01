# Design notes

## Decisions so far

1. Audience: one player for now. Browser game, must work well on phones.
2. Stack: TypeScript and Vite frontend, one Cloudflare Worker serving both the page and `/api`, D1 (SQLite) as the recipe book.
3. Eight primal forces to start: Fire, Water, Earth, Air, Light, Shadow, Life, Arcane.
4. Two kinds of items: spells (castable) and artifacts (magical, not castable).
5. A merge always makes something. Like Infinite Craft, it may loop back to one of its inputs.
6. World tab: a sandbox where you cast anywhere and tiny people react. The world persists until reset.
7. Goal: sandbox discovery, with First Discovery. Objectives later.
8. Game language: English.

## How the merge stays coherent without hidden stats

Infinite Craft does not track attributes. Its coherence comes from four structural choices, all copied here:

1. **Stateless prompt.** The model only ever sees the two names. No history, no description, no recipe chain. Depth 50 is judged exactly like depth 1, so nothing accumulates.
2. **Frozen answers.** The first answer for a pair is stored and reused forever. An element name has one emoji and one kind forever.
3. **Short, known names.** Results are one to three words, and the prompt prefers names from myth, fiction and games. Known concepts are attractors: the model keeps landing on the same few hundred ideas instead of inventing new adjective stacks.
4. **Loops are allowed.** A pair may give back one of its inputs. This is how the graph converges instead of exploding.

Descriptions are generated separately and are never fed back into merges, so rich text cannot drift the names.

If drift still shows up in play, the next lever is to show the model a short list of existing names to reuse, not hidden stats.

## Spell format (v1)

Types, limits and the verb list live in `shared/spell.ts`. The same list is pasted into Claude's prompt, so the engine and the prompt cannot disagree. A spell is designed once by `SPELL_MODEL` from its name, recipe and grimoire entry, sanitized (every number clamped, every unknown value replaced by a safe default), then stored in D1. Only the admin can force a redesign.

Three parts:

1. **Incantation**: the magic circle. Rings, star symmetry, rune count, two colors, spin. Drawn flat on the ground, or upright in the sky for projectiles and beams.
2. **Animation**: four phases (charge, travel, release, linger), each with a duration and up to three particle emitters (pattern, colors, count, speed, gravity, lifetime, size, glow).
3. **Impact**: one to five effects. Each is a verb with a strength, a duration (0 = instant), a shape (circle, column, ground band), and a material or creature when the verb needs one.

The 23 verbs: damage, heal, ignite, freeze, heat, cool, push, pull, levitate, fear, calm, sleep, shrink, enlarge, transform, summon, revive, teleport, spawn, erase, convert, grow_plants, quake.

Restrict the verbs, not the outcomes: the world has its own physics (falling sand, flowing water and lava, rising steam that rains back, spreading fire, freezing and melting), and spells set it in motion. Fire on a forest burns the forest because the fire spreads, not because the spell says so.

### What the prompt has to tell Claude about the engine

The first real specs were coherent but played weakly. Claude could not know how the engine plays them, so the spell prompt now states it plainly:

1. Strength is intensity inside the area, not size. Below 0.3 an effect is barely visible.
2. The real size of each shape: the ground band is 3.2 R wide but only 0.8 R tall.
3. Spawn only fills empty cells. An instant circle drops one blob that falls or flows; a ground band only makes a film.
4. A lasting terrain effect touches nearly every cell of its area within a second or two.
5. Which statuses cancel: fear wakes sleepers, calm removes fear, ignite thaws, freeze puts out fire.
6. Which effects only show when there is something to act on (heal, cool, revive, teleport).

When the engine changes, this part of `worker/prompts.ts` must change with it. The Spell Lab (`scripts/spell-lab.mjs`, see SETUP.md) is how to check both.

### Size budget

| Depth | Max scale | Radius in cells |
| --- | --- | --- |
| 0 to 1 | small | 6 |
| 2 to 3 | medium | 10 |
| 4 to 5 | large | 16 |
| 6 to 8 | huge | 26 |
| 9+ | cataclysmic | 40 |

Claude is told the maximum and the sanitizer enforces it, so a primal force can never wipe the map.

### World

1. Falling sand grid of 16 materials, one byte per cell, 30 ticks per second, about 0.3 ms per tick on the large world.
2. Sizes: small 120, medium 200, large 320 cells wide; the height follows the screen shape, capped so a phone gets sky, not a tower of stone.
3. Creatures: villagers, beasts, spirits (float), golems (heavy, fireproof). They walk, climb steps, avoid cliffs, fire and water, flee, burn, drown, freeze, levitate, sleep, and die from falls.
4. Saved in the browser every 10 seconds and when the page closes. Reset from the tab, with a size choice.
5. A tap in open sky just above the ground is aimed at the ground; far up in the sky it is taken as it is.
