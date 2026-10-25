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

## Spell format (proposal for v1, not built yet)

A spell is generated once, on demand, from its name and description, and stored like recipes. Three parts:

1. **Incantation**: the magic circle drawn before the cast. Parameters, not pixels: rings, symmetry, rune set, rotation speed, colours.
2. **Animation**: one to three phases (charge, travel, release, linger). Each phase is a set of particle emitters with shape, motion, colours, gravity, lifetime and trail.
3. **Impact**: a list of effects on the world. Each effect is a verb applied to a target in an area for a duration.

Rule of thumb: restrict the verbs, not the outcomes. The world exposes generic physics (heat, wetness, velocity, health, mood, size, material) and the spell spec combines verbs on them. Fire on a wet tile makes steam because of the world's rules, not because the spell says so. That is how Noita and Powder Toy get emergent results from a small rule set.

Size budget: the model picks a scale class (tiny to cataclysmic), and the engine caps it by depth, so huge spells must be earned through long merge chains.
