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

## Spells are programs (v2)

A spell is a short JavaScript program written once by Claude from its name, tier, recipe and grimoire entry, then stored in D1 and reused forever. It defines `const spell = { *cast(w) { ... } }`: a generator where `yield seconds` waits, so a spell reads as a sequence (gather, deliver, impact, aftermath). It acts through the World API `w`, documented for Claude in `worker/prompts.ts` and implemented in `src/sim/runtime.ts`:

1. **Big moves** that do a lot in one call: explode, quake, ignite, flood, drain, paint, temperature, terraform, build, grow, gas, wind.
2. **Bodies**: the moving parts of a spell (a falling meteor, a drifting cloud, a wandering vortex), with tick, land and end callbacks.
3. **Free voxels** for what floats or overhangs: a tree's crown, a floating rock, a statue.
4. **Creatures**: find, spawn, hurt, heal, push, set statuses, transform, resize.
5. **Show**: particles, bursts, shockwaves, lights, night, tints, flashes, magic circles, free canvas drawing painted on the land, camera moves, sounds.
6. **New rules**: a spell may define materials (with a per cell tick) and creatures (with their own behavior). They stay in the world after the spell ends and are saved with it.

The API is deliberately high level: a few calls do a lot, so programs stay around 40 lines. Output tokens are the expensive part of a call.

### Safety

The program is untrusted code, so the World runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`: it has an opaque origin, cannot read the game page, its token or its storage. `public/_headers` gives it a CSP with `connect-src 'none'`, so it cannot reach the network either. Everything it needs comes in by `postMessage` (`src/sim/protocol.ts`), and the parent stores its save. Every loop in a program gets a guard (`shared/spellcode.ts`) so an endless loop throws instead of freezing the page; every call into spell code is wrapped, and a spell that keeps a frame busy too long is stopped.

### When a spell crashes

The error goes back to Claude with the program, and the fixed version replaces it: at most twice per session per spell, three times in total unless the admin asks.

### Power tiers

The merge model gives every new element a tier from its meaning: cantrip (a spot), minor (a house), major (a village), grand (a valley), legendary (a region), cosmic (the world). A result can be at most two tiers above its strongest input, so power is built up but a meaningful leap is still possible. A spell's reach is a share of the world's size (`shared/tiers.ts`), and the camera pulls back when a spell is bigger than the view. Elements from before tiers get one the first time they are cast.

### Which model writes which spell

Measured on six of the player's spells, same prompt, same effort: Haiku 5.5 wrote small and mid spells as well as Opus 5.5 for a thirtieth of the price ($0.002 against $0.076), but only Opus made a World Tree Awakening that grows an actual giant tree. Sonnet 5.5 cost ten times Haiku without doing better. So spells up to grand go to Haiku and legendary or cosmic ones to Opus (`SPELL_MODEL_SMALL`, `SPELL_SMALL_UP_TO`, `SPELL_MODEL`).

### Artifacts

Artifacts use the same program format and the same endpoint, with one paragraph of the prompt telling the model they are placed, not cast: a short arrival, the thing itself as the point, built in voxels or spawned as a creature, with a tick when it acts on its own.

## Challenges

Hand-made islands with a hazard and a goal (`src/sim/scenarios.ts`, titles in `scenario-list.ts` so the game page does not load the engine to list them). A challenge builds its own world, runs a `tick` every frame (a volcano vent, a rising sea, the sun drying fields) and a `check` twice a second that returns progress text and playing, won or lost. It never touches the player's island: the iframe keeps the sandbox save in memory and restores it on leaving.

Balance is measured, not guessed: `npm test` plays each challenge with nothing and with a plain solution spell from `lab/solutions`, and the parameters were tuned until eight random replays agree.

## World

1. **Simulation** (`src/sim`): a grid of columns, each with a height, a ground, a fluid and its depth, a cover (tree, house...), fire, temperature and a gas. 30 ticks per second.
2. **Rules of the land** (`physics.ts`): water runs downhill, freezes below 0 and boils above 100; lava flows slowly, burns and hardens into basalt, and makes steam with water; acid eats covers and soil; oil burns fast; mud dries; snow melts; fire spreads through forests, fields and houses with the wind and leaves ash and stumps; steam rains back down; powder explodes; grass and forests grow back.
3. **People** (`creatures.ts`): villagers live near their houses, rebuild rubble, flee fire, panic and run for water when burning, drown in deep water; a new villager appears now and then while houses stand. Beasts roam, spirits fly and glow, golems are strong and fireproof.
4. **Generation** (`world.ts`): fractal hills rescaled from their own distribution so every map gets about a fifth of water and a few snowy peaks, a river, forests, and villages on the flattest dry land.
5. **View** (`voxel/`): a floating voxel island in three.js, with layered cut sides and water spilling off the edges. Built for phones: lighting is baked into vertex colors and every material is unlit, terrain chunks are rebuilt only where a column changed, each kind of object is one instanced draw call, and the pixel density drops when frames are slow. A medium island is about 60 draw calls and 140k triangles. Chunks are built with a reusable typed array writer under a 3 ms per frame budget.
6. **Day and night** (`voxel/daylight.ts`): a six minute cycle that tints every unlit material and the sky; fire, lava and spell light are untouched, house windows light up at night and chimneys smoke.
7. **Saving**: the iframe sends a compact save (each layer quantized to bytes) every 10 seconds; the parent keeps it in localStorage. Materials and creatures that spells defined are saved by name with the spell that owns them, and that spell's rules are loaded again before the world.
