# The spell library, measured: varied, interact, smart (12 November 2026)

Version 4.12, step 1 (`docs/ROADMAP.md`). The owner, 12 November: "I am still not satisfied at how smart, varied, how spells interact with each other". This pass measures only. Nothing was written to production, no program was rewritten, no Claude call was made.

## Headline

| Question                                                                                    | Number             |
| ------------------------------------------------------------------------------------------- | ------------------ |
| Varied: share of items in the five commonest shapes                                         | 74.6% (176 of 236) |
| Varied: items in a cluster of near duplicates                                               | 27.5% (65 of 236)  |
| Interact: sampled pairs where B after A differs from A and B alone                          | 43% (129 of 300)   |
| Interact: sampled pairs that make something neither makes alone                             | 2% (6 of 300)      |
| Interact: pairs a player would expect something from, that do                               | 18 of 40           |
| Smart: programs that read the island at all (static)                                        | 46.6% (110 of 236) |
| Smart: programs that change the island in a different way on water, a village and bare rock | 9.7% (23 of 236)   |

## What was measured, and how

- **Programs.** Admin GETs only, cached under `/tmp/spell-measure/cache`: `/api/admin/forms` (486 elements, their kind and casts, no code), `/api/admin/programs?limit=100` and `?creatures=1` (live programs not judged yet, with code), `/api/admin/challenge-candidates?limit=60` (live programs reachable for a challenge, with code), and `/api/spell/info?name=` once per element (model and version, 570 GETs, 3 a second). Together they gave the code of **236 live programs of 485**. All 236 ran; none failed.
- **Runtime.** `scripts/spell-measure.ts` runs each program in the game's own `Runtime` and `stepHeadless`, on the test run's practice island (`src/sim/check.ts`: seed 11, the reference size, a dead and a wounded villager by a village). Programs draw from their own random stream; the island from its own.
- **The island left alone** is run with 16 different lives of its creatures. A creature more, or a deer that flees, changes every later life on the island, so villagers farm and build elsewhere. A cell, creature or voxel counts as changed only when none of the 16 lives shows it that way. Fields, flowers, trees and houses under 80 cells count as that drift, not as the item's doing.
- **Span.** 30 simulated seconds after the cast. B of a pair is cast at the same spot 3 seconds after A.
- **Repeat.** `node node_modules/.cache/spell-measure.mjs --out <dir>` after the esbuild line at the top of the script. Results are kept in `<dir>/runs.json`; a second call only prints. `--shard k/4 --phase items|pairs` splits the runs over 4 processes (about 70 minutes in all on 4 cores).

## 1. Varied

Shapes are set by rule from what the run left, against the island left alone: the system with the largest score wins (cells painted, land raised or lowered, cells on fire, fluid cells, hotter or colder cells, gas, creatures born at 15 a creature, creatures hurt, healed, frozen or scared at 6 each, voxels at a quarter each, an object or model at 40, a ward at 40).

| Shape                                                | Items | Share |
| ---------------------------------------------------- | ----: | ----: |
| sets down an object (an artifact, landmark or model) |    64 | 27.1% |
| drops creatures                                      |    34 | 14.4% |
| acts on creatures                                    |    31 | 13.1% |
| paints one material                                  |    30 | 12.7% |
| dome or ward                                         |    17 |  7.2% |
| paints a mix                                         |    15 |  6.4% |
| raises a structure                                   |    11 |  4.7% |
| only lights and particles                            |    10 |  4.2% |
| pours a fluid                                        |     8 |  3.4% |
| releases gas                                         |     5 |  2.1% |
| reshapes land                                        |     5 |  2.1% |
| nothing lasting                                      |     3 |  1.3% |
| heats or chills                                      |     3 |  1.3% |
| sets fire                                            |     0 |    0% |

By kind (the kind from `/api/admin/forms`; 84 fetched items have no row there and are "unsorted"):

| Kind       | Items | Commonest shape            | Five commonest |
| ---------- | ----: | -------------------------- | -------------: |
| spell      |    53 | paints one material, 20.8% |          71.7% |
| creature   |    44 | drops creatures, 38.6%     |          90.9% |
| object     |    20 | sets down an object, 90%   |           100% |
| place      |    17 | sets down an object, 35.3% |          94.1% |
| land       |    14 | sets down an object, 28.6% |           100% |
| building   |     3 | sets down an object        |           100% |
| settlement |     1 | drops creatures            |           100% |
| unsorted   |    84 | sets down an object, 20.2% |          79.8% |

By tier: cantrip 40 items, five commonest 95%; minor 52, 86.5%; major 39, 64.1%; grand 25, 72%; legendary 52, 73.1%; cosmic 28, 82.1%. The small tiers are the least varied.

Other counts:

- 180 items (76.3%) are still changing the island at 30 seconds.
- 49 items (20.8%) touch one engine system or none.
- Only 13 items (5.5%) set more cells on fire than the island does alone, and none has fire as its main effect, though 23 fetched names are about fire, flames, meteors, volcanoes or blasts.
- 59 items (25%) place a material of their own.
- **61 items (25.8%) raise a ward** (`w.ward` called by the program at run time). Only 8 of them have a name about protection. The others include Alpha Werewolf, Archangel, Ark, Assassin, Baptism, Black Dragon, Bog Mummy, Boogeyman, Cave, Cloud Giant, Death, Desert, Dragon and Gold. The writer's prompt (`worker/prompts.ts`) already says a dragon or gold must not ward; these programs predate that line or ignore it. A ward is nearly invisible and blocks fire, fluids and creatures, so it also stops other items from answering.

**Near duplicates.** Each effect is a vector (cells per built-in material, own materials pooled by layer, fluids, fire, temperature, gas, raised and lowered land, creatures born by kind with own kinds pooled, hurt, healed, statuses, voxels, objects, wards; log scaled). Pairs with cosine above 0.98: 141, in 17 clusters holding 65 items (27.5%). The largest:

| Size | Items                                                                                                                                         | What they share                               |
| ---: | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
|   12 | Archaeologist, Armada, Bog Spirit, Djinn, Familiar, Flying Dutchman, Homunculus, Lost Soul, Phoenix, Unicorn, Void Familiar, Will-o'-the-Wisp | one creature of its own, nothing else lasting |
|    7 | Fire Opal, Gold, Last Survivor, Meteorite, Nightmare, Talos, Wisp Lantern                                                                     | a landmark and a few voxels                   |
|    7 | Leprechaun Gold, Mana Rocket, Rocket, Rocket Fleet, Spaceship, Starblade, Starship                                                            | one object or model                           |
|    5 | Adam, Avatar, Demiurge, Grim Reaper, Pyromancer                                                                                               | one creature that changes creatures around it |
|    4 | Assassination, Night, Purifying Flame, Spaceflight                                                                                            | statuses on nearby creatures                  |
|    4 | Consecrate, Fire Ward, Holy Barrier, Turn Undead                                                                                              | a ward and a patch                            |

A Phoenix and a Unicorn leave the same trace on the island in 30 seconds: one creature of their own, no fire, no flowers.

## 2. Interact

**Sample.** 300 ordered pairs, A drawn by kind in turn and B by tier and by shape in turn (seeded), from all 236 items; plus 40 pairs chosen by name (below). A is cast by the village; B on the same spot 3 seconds later.

**Test.** Placing is random (a meteor lands somewhere in its reach), so two runs of one item rarely match cell by cell. The test therefore compares counts: cells of each material, of each fluid, on fire, hotter, colder, raised, lowered; creatures by kind, dead, by status, their health; voxels; wards. A pair interacts in a count when B after A differs from A alone plus B alone (B alone cast at 3 seconds) by more than: twice the two items' noise in that count (each item run again on another random stream), a floor (8 cells, 2 creatures, 20 voxels, 1 ward), and the number of cells both items change alone (B covering A explains up to that many). It also interacts when it makes 5 cells or more of a material, fluid or gas that neither makes alone in any run.

- Noise, summed over counts, median and 95th percentile across 209 items: materials 0 and 100 cells, temperature 0 and 35, gas 0 and 25, structures 0 and 31 voxels, creatures 0 and 15.
- The same run twice gives the same result except for 61 smoke cells on one item of 10 (Arcane Cataclysm); not traced further.
- Cells both items change alone: median 6, 95th percentile 323.

**Result on the 300 sampled pairs.**

|                                                                        | Pairs | Share |
| ---------------------------------------------------------------------- | ----: | ----: |
| interact in at least one count                                         |   129 |   43% |
| interact, leaving out pairs that differ only by fewer than 5 creatures |   117 |   39% |
| make something neither makes alone                                     |     6 |    2% |
| differ only in creatures                                               |    52 | 17.3% |

By the system that carried it (a pair may count in several): creatures 97 (32.3%), materials 31 (10.3%), temperature 31 (10.3%), fire 27 (9%), gas 24 (8%), fluids 19 (6.3%), structures 9 (3%), land 9 (3%), wards 1 (0.3%).

Most of what counts as an interaction is two items using the same fuel (both burn the grass, so A then B burns less than A plus B), a ward or a flood that stops the next item's fire, or villagers and beasts that react to the first item. New products, the clearest answer a player can see, came from 6 sampled pairs: ice, ash, smoke, water, moondust, pearl. 65 of the 236 programs declare `reacts` on a material of their own (fire 50 times, lava 29, water 26, acid 22), but those reactions need fire, lava or water to touch that material within the span, and pairs rarely bring it there.

By B's shape, the share that interact: paints a mix 20 of 26, pours a fluid 13 of 20, paints one material 24 of 37, acts on creatures 24 of 39, sets down an object 12 of 51, drops creatures 5 of 28, only lights and particles 1 of 22. Items that set down an object or drop a creature, 41.5% of the library, rarely answer anything.

**The 40 expected pairs** (A then B, picked by name from the fetched items, most cast first):

| Expected                     | A then B                             | What happened                                                             |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| fire then water              | Meteor Strike then Cloud Fountain    | interacts: 223 fewer voxels, 199 fewer smoke cells                        |
| fire then water              | Phoenix then Maelstrom               | nothing beyond noise; Maelstrom alone only lowers 39 rock cells, no water |
| fire then water              | Meteor Swarm then Moraine            | interacts: 341 fewer ash cells, 113 fewer cells on fire                   |
| lava then water              | Volcano then Cloud Fountain          | interacts: 339 cells of ash new to the pair, 234 more basalt              |
| lava then water              | Molten Gold then Maelstrom           | interacts: 398 fewer hot cells, 381 fewer smoke                           |
| lava then water              | Obsidian then Moraine                | nothing beyond noise                                                      |
| water then cold              | Cloud Fountain then Black Ice        | nothing beyond noise (Black Ice alone: 381 colder cells, 129 snow)        |
| water then cold              | Maelstrom then Blizzard              | interacts: 14 less creature health                                        |
| water then cold              | Moraine then Frozen Tomb             | nothing beyond noise                                                      |
| water then lightning         | Cloud Fountain then Cosmic Tempest   | nothing beyond noise                                                      |
| water then lightning         | Maelstrom then Hurricane             | nothing beyond noise                                                      |
| water then lightning         | Moraine then Hypercane               | interacts: 332 fewer ash, 65 fewer cells on fire                          |
| a wall or ward then a flood  | Celestial Bastion then Maelstrom     | nothing beyond noise (Maelstrom makes no water)                           |
| a wall or ward then a flood  | Golem then Deluge                    | interacts: 1879 less water volume, 127 less ice                           |
| a wall or ward then a flood  | Holy Barrier then Tsunami            | interacts: 5972 less water volume, 11 fewer dead                          |
| a ward then fire             | Celestial Bastion then Meteor Strike | interacts: 741 fewer hot cells, 697 fewer ash                             |
| a ward then fire             | Holy Barrier then Phoenix            | nothing beyond noise (Phoenix makes no fire)                              |
| a ward then fire             | Fire Ward then Meteor Swarm          | interacts: 301 fewer ash, 63 more health                                  |
| light on shadow              | Shadow Step then Aurora              | nothing beyond noise                                                      |
| light on shadow              | Boogeyman then Will-o'-the-Wisp      | nothing beyond noise                                                      |
| light on shadow              | Fog then Aurora Borealis             | nothing beyond noise                                                      |
| growth on ash                | Ash Cloud then World Seed            | nothing beyond noise                                                      |
| growth on ash                | Crater then Yggdrasil                | nothing beyond noise                                                      |
| growth on ash                | Extinction then Garden of Eden       | interacts: 48 fewer hot cells                                             |
| fire on growth               | World Seed then Meteor Strike        | interacts: 133 more smoke, 47 fewer on fire                               |
| fire on growth               | Yggdrasil then Phoenix               | nothing beyond noise                                                      |
| cold then fire               | Black Ice then Meteor Strike         | interacts: 322 fewer cold cells, 13 fewer frozen                          |
| cold then fire               | Blizzard then Phoenix                | nothing beyond noise                                                      |
| wind on fire                 | Meteor Strike then Healing Breeze    | nothing beyond noise                                                      |
| wind on fire                 | Phoenix then Blast Wave              | nothing beyond noise                                                      |
| a creature then its predator | Familiar then Serpent                | nothing beyond noise                                                      |
| a creature then its predator | Human then Black Dragon              | nothing beyond noise                                                      |
| undead then holy             | Lich then Archangel                  | interacts: 3 fewer calm creatures                                         |
| undead then holy             | Undead Legion then Divine Radiance   | nothing beyond noise                                                      |
| healing on harm              | Meteor Strike then Healer            | interacts: 242 fewer smoke, 3 fewer calm                                  |
| healing on harm              | Meteor Swarm then Healing Breeze     | interacts: 1107 more hot cells, 1049 more smoke                           |
| rain on desert               | Crater then World Seed               | nothing beyond noise                                                      |
| rain on desert               | Dead Sea then Garden of Eden         | interacts: 555 fewer cold cells, 9 fewer frozen                           |
| fire on a swamp              | Bog Spirit then Meteor Strike        | interacts: 83 more smoke, 61 more cells on fire                           |
| fire on a swamp              | Swamp then Phoenix                   | nothing beyond noise                                                      |

18 of 40 interact. By group: light on shadow 0 of 3, wind on fire 0 of 2, a creature then its predator 0 of 2, water then lightning 1 of 3, water then cold 1 of 3, growth on ash 1 of 3, undead then holy 1 of 2.

**Reactions a player would expect that are missing**, ranked by the expected pairs they would touch. Each was checked against the calls the items made (the run-time trace) and the engine (`src/sim/physics.ts`, `src/sim/creatures.ts`, `src/sim/runtime.ts`). "Engine" means a rule added once would reach every stored item; "item" means the program does not do what its name says, and only a rewrite would change it.

1. **Fire-named creatures carry no fire** (6 pairs, all with Phoenix; item and engine). Phoenix only spawns its creature; it burns nothing. The engine has a "breathe fire" ability but no rule that a creature of fire sets what it touches alight.
2. **Light and shadow are not part of the world** (3 pairs, plus the 10 items whose only effect is light; engine). `w.light`, `w.darken` and `w.tint` draw; no cell or creature holds light or darkness, so nothing can dispel it. Aurora grows plants and sets a landmark; Shadow Step paints rock and smoke.
3. **Blasts and gusts move only creatures** (2 wind pairs, and the 3 storm pairs below; engine). `w.shockwave` is drawn only; Blast Wave, Healing Breeze and Hypercane push or calm creatures but leave fire, smoke and water where they are. `w.wind` steers fire and gas but not water.
4. **Storms strike no lightning** (3 water-then-storm pairs; item). Hurricane, Cosmic Tempest and Hypercane call `w.wind`, never `w.lightning`. The engine already shocks every creature in the same water when lightning hits it, so the reaction exists and goes unused. Maelstrom makes no water at all.
5. **Growth ignores ash** (2 pairs; engine). World Seed paints its own bloom and Yggdrasil raises a model; neither grows more or differently on ash, and `w.grow` does not read the ground.
6. **Spell creatures do not hunt each other** (2 pairs; engine). `prey` names the island's kinds. Serpent does nothing to Familiar, Black Dragon nothing to Human.
7. **Holy light does not hurt the undead** (2 pairs; engine). Divine Radiance heals and calms whoever is near; the undead tag exists in `creatures.ts` but no rule ties it to holy items.
8. **Cold after water froze nothing more in 2 of 3 pairs** (cause not traced). Water freezes below 0 in `stepTemperature`; Black Ice alone makes 381 colder cells, yet the pair held no more ice than the two alone.

## 3. Smart

**Static.** The World API's reading calls (`src/sim/runtime.ts`): `w.cell`, `w.creatures`, `w.corpses`, `w.artifacts` (and `inside`, not counted). Read with the TypeScript parser.

- 110 programs (46.6%) call a reading function: `creatures` in 89, `cell` in 46, `corpses` in 6.
- 89 (37.7%) branch on what they read (an `if`, a ternary, `&&`, `||`, or a `filter`, `find`, `some`, `every` or `sort` whose condition holds a reading call, a variable set from one, or a cell or creature field).

**At run time.** Each program was cast at three spots of the same island, with the same random stream: the village edge of the test run, open water far from houses, and bare rock far from houses. Every World API call the program made was recorded (not the API's calls to itself). Sounds, lights, particles, bodies, drawings and the camera were left out.

| Behavior                                               | Programs | Share |
| ------------------------------------------------------ | -------: | ----: |
| asked the island something at the village              |      102 | 43.2% |
| change the island in different ways at the three spots |       23 |  9.7% |
| differ only in what they do to the creatures they find |       44 | 18.6% |
| do the same things in other amounts                    |       16 |  6.8% |
| act the same wherever they are cast                    |      153 | 64.8% |

The shape of the result changes with the spot for 89 items (37.7%), but mostly because the land refuses what the item does (paint on water), not because the program chose.

Ten that change the island in different ways: Archaeologist, Atlantis, Bog Spirit, Cosmic Tempest, Curse, Cursed Water, Demiurge, Dwarf, Extinction, Graveyard.

Ten that act the same: Abyss, Adam, Akashic Records, Alpha Werewolf, Ambrosia, Arcane Barrage, Archangel, Ark, Armada, Army of the Dead.

The common pattern of the 44 in between: `w.creatures(x, y, r).forEach(c => c.hurt(...))`. They read who is near and hit them, but do the same to the land.

## Cost

- Live programs by model (`/api/spell/info`, 485 elements with a live program): Haiku 357 (73.6%), Opus 128 (26.4%). Of the 236 fetched: Haiku 159, Opus 77.
- By `PROGRAM_VERSION`: v6 450, v4 32, v3 2, v2 1.
- Never cast (`casts` 0 in `/api/admin/forms`): 303 of 486 elements (62%).
- The last refresh (`/api/admin/refresh-report`) rewrote 240 programs for $3.54, about 1.5 cents each. At that rate a rewrite of all 485 would cost about $7; it still needs the owner's yes (bulk rewrite).

## What this does not measure, and why

- **Half the library.** Only 236 of 485 live programs could be fetched by GET. The routes that return code are capped (100 newest not judged, 100 creatures not judged, 60 per challenge not tried yet). The route that returns any program by name, `POST /api/library`, is a POST and was not used under this pass's read-only rule (it reads only, and returns spells, not artifacts). The sample leans to legendary and cosmic names and to creatures; 84 of the fetched items are not in the kind list yet.
- **Long effects.** 30 seconds. An object's five-minute behavior (`check.ts`) is not in the shapes.
- **What a player sees.** Light, particles and bodies count only as "only lights and particles". A spell whose look is its point scores as nothing lasting.
- **Shapes are rules, not judgement.** The weights above decide ties; a different weight moves items between neighbouring shapes, mostly between "acts on creatures" and "drops creatures".
- **Interaction is counts.** Two items that change the same count in opposite ways in different places would cancel. Reactions slower than 27 seconds after B are missed.
- **Films** are on the Spell Lab's island (the game's medium island, seed 11), not on the practice island: they show the look, the numbers come from the measure.

## Films

20 pairs, three frames each at 700 by 830 (before, one second after the cast, fifteen seconds after; near duplicates are cast one at a time, `a-` and `b-` frames), in `/tmp/spell-measure/pairs/<n>-<a>-<b>/`, made with `node scripts/spell-pair-frames.mjs /tmp/spell-measure/out2/films.json /tmp/spell-measure/pairs`.

|   # | Why                               | Pair                               |
| --: | --------------------------------- | ---------------------------------- |
|   1 | interacts                         | Meteor Storm then Death            |
|   2 | interacts                         | World Tree then Tartarus           |
|   3 | interacts                         | Lilith then Meteor Strike          |
|   4 | interacts, new ice and smoke      | Village then Flame Dash            |
|   5 | interacts, lava then water        | Volcano then Cloud Fountain        |
|   6 | interacts                         | Noah's Ark then Gamma Ray Burst    |
|   7 | expected, none (wall then flood)  | Celestial Bastion then Maelstrom   |
|   8 | expected, none (light on shadow)  | Shadow Step then Aurora            |
|   9 | expected, none (growth on ash)    | Ash Cloud then World Seed          |
|  10 | expected, none (predator)         | Familiar then Serpent              |
|  11 | expected, none (ward then fire)   | Holy Barrier then Phoenix          |
|  12 | expected, none (undead then holy) | Undead Legion then Divine Radiance |
|  13 | expected, none (lava then water)  | Obsidian then Moraine              |
|  14 | expected, none (light on shadow)  | Boogeyman then Will-o'-the-Wisp    |
|  15 | near duplicates                   | Night and Spaceflight              |
|  16 | near duplicates                   | Archaeologist and Armada           |
|  17 | near duplicates                   | Bog Spirit and Djinn               |
|  18 | near duplicates                   | Flying Dutchman and Homunculus     |
|  19 | near duplicates                   | Leprechaun Gold and Starship       |
|  20 | near duplicates                   | Lost Soul and Void Familiar        |
