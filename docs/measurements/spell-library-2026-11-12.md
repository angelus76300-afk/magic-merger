# The spell library, measured: varied, interact, smart (12 November 2026)

Version 4.12, step 1 (`docs/ROADMAP.md`). The owner, 12 November: "I am still not satisfied at how smart, varied, how spells interact with each other", and on the measure: "measure: all". This pass measures only. Nothing was written to production, no program was rewritten, no Claude call was made.

**Coverage: 345 of the 485 live programs.** Every program a read only route returns is in. The remaining 140 are artifacts with a live program: no read route returns an artifact's code (`POST /api/library` returns spells only, the admin GETs are capped), so they cannot be measured without a new route. The 40 spells and 45 artifacts with no live program are not counted in the 485.

## Headline

| Question                                                                                    | Number             |
| ------------------------------------------------------------------------------------------- | ------------------ |
| Varied: share of items in the five commonest shapes                                         | 69.0% (238 of 345) |
| Varied: items in a cluster of near duplicates                                               | 31.9% (110 of 345) |
| Interact: sampled pairs where B after A differs from A and B alone                          | 42% (127 of 300)   |
| Interact: sampled pairs that make something neither makes alone                             | 1.7% (5 of 300)    |
| Interact: pairs a player would expect something from, that do                               | 22 of 40           |
| Smart: programs that read the island at all (static)                                        | 60.3% (208 of 345) |
| Smart: programs that change the island in a different way on water, a village and bare rock | 9.0% (31 of 345)   |

The first pass (236 programs fetched by GET) read 74.6%, 27.5%, 43%, 2%, 18 of 40, 46.6% and 9.7%. The 109 spells added by `POST /api/library` read the island far more (89.9%) and raise fewer wards (17.4% against 25.4%); the numbers moved the way that predicts, and the conclusions did not change. By source, five commonest shapes: GET 74.6% (n 236), library 70.6% (n 109).

## What was measured, and how

- **Programs.** Admin GETs, cached under `/tmp/spell-measure/cache`: `/api/admin/forms` (486 elements, their kind and casts, no code), `/api/admin/programs?limit=100` and `?creatures=1` (live programs not judged yet, with code), `/api/admin/challenge-candidates?limit=60` (live programs reachable for a challenge, with code), `/api/spell/info?name=` once per element (model and version, 486 GETs). Then `POST /api/library` for the 334 names the GETs did not give, 20 names a call: it returned 109 spells. That POST route was read end to end first: `handleLibrary` (`worker/index.ts` 1436 to 1465) runs one `SELECT` on `spells` joined to `elements`, parses the stored JSON and returns it; it writes nothing, queues nothing and makes no paid call (its comment says "never written on demand, so it costs nothing"). Together: **345 live programs**. All ran; none failed.
- **Runtime.** `scripts/spell-measure.ts` runs each program in the game's own `Runtime` and `stepHeadless`, on the test run's practice island (`src/sim/check.ts`: seed 11, the reference size, a dead and a wounded villager by a village). Programs draw from their own random stream; the island from its own.
- **The island left alone** is run with 16 different lives of its creatures. A creature more, or a deer that flees, changes every later life on the island, so villagers farm and build elsewhere. A cell, creature or voxel counts as changed only when none of the 16 lives shows it that way. Fields, flowers, trees and houses under 80 cells count as that drift, not as the item's doing.
- **Span.** 30 simulated seconds after the cast; five minutes for the 24 items that only set down an object or drop one creature. B of a pair is cast at the same spot 3 seconds after A.
- **Repeat.** `node node_modules/.cache/spell-measure.mjs --out <dir>` after the esbuild line at the top of the script. Results are kept in `<dir>/runs.json`; a second call only prints. `--shard k/4 --phase items|pairs` splits the runs over 4 processes (items about 10 minutes, pairs about 20, on 4 cores); fold the shards with one unsharded `--phase items` run before the pairs phase.

## 1. Varied

Shapes are set by rule from what the run left, against the island left alone: the system with the largest score wins (cells painted, land raised or lowered, cells on fire, fluid cells, hotter or colder cells, gas, creatures born at 15 a creature, creatures hurt, healed, frozen or scared at 6 each, voxels at a quarter each, an object or model at 40, a ward at 40).

| Shape                     | Items | Share |
| ------------------------- | ----: | ----: |
| sets down an object       |    69 | 20.0% |
| paints one material       |    55 | 15.9% |
| acts on creatures         |    49 | 14.2% |
| drops creatures           |    37 | 10.7% |
| paints a mix              |    28 |  8.1% |
| dome or ward              |    27 |  7.8% |
| only lights and particles |    18 |  5.2% |
| pours a fluid             |    14 |  4.1% |
| raises a structure        |    13 |  3.8% |
| nothing lasting           |    12 |  3.5% |
| releases gas              |     8 |  2.3% |
| reshapes land             |     8 |  2.3% |
| heats or chills           |     7 |  2.0% |
| sets fire                 |     0 |    0% |

By kind (the kind from `/api/admin/forms`; 84 fetched items have no row there and are "unsorted"):

| Kind       | Items | Commonest shape            | Five commonest |
| ---------- | ----: | -------------------------- | -------------: |
| spell      |   157 | paints one material, 22.3% |          71.3% |
| creature   |    44 | drops creatures, 38.6%     |          90.9% |
| object     |    21 | sets down an object, 85.7% |         100.0% |
| building   |     4 | sets down an object, 50.0% |         100.0% |
| settlement |     1 | drops creatures, 100.0%    |         100.0% |
| place      |    17 | sets down an object, 41.2% |         100.0% |
| land       |    17 | sets down an object, 23.5% |          88.2% |
| unsorted   |    84 | sets down an object, 20.2% |          79.8% |

By tier (five commonest shapes): cantrip 60 items, 81.7%; minor 73, 78.1%; major 65, 58.5%; grand 39, 71.8%; legendary 62, 72.6%; cosmic 46, 84.8%. The small tiers are the least varied.

Other counts:

- 261 items (75.7%) are still changing the island at 30 seconds.
- 87 items (25.2%) touch one engine system or none.
- 31 items reach 5 or more cells on fire, and none has fire as its main shape (0 items), though 28 of the 345 names are about fire, flames, meteors, volcanoes or blasts.
- 87 items (25.2%) place a material of their own.
- **79 items (22.9%) raise a ward** (`w.ward` called by the program at run time). Only 13 of them have a name about protection (Arcane Shield, Celestial Bastion, Consecrate, Divine Shield, Fire Ward, Guardian Angel, Hallowed Ground, Holy Barrier, Holy Ground, Last Stand, Portal Ward, Protection Spell, Ward). The others include Alpha Werewolf, Archangel, Ark, Assassin, Baptism, Black Dragon, Bog Mummy, Boogeyman, Cloud Giant, Death, Desert, Dragon, Dinosaur and Gold. The writer's prompt (`worker/prompts.ts`) already says a dragon or gold must not ward; these programs predate that line or ignore it. A ward is nearly invisible and blocks fire, fluids and creatures, so it also stops other items from answering.

**Near duplicates.** Each effect is a vector (cells per built-in material, own materials pooled by layer, fluids, fire, temperature, gas, raised and lowered land, creatures born by kind with own kinds pooled, hurt, healed, statuses, voxels, objects, wards; log scaled). Pairs with cosine above 0.98: 217, in 30 clusters holding 110 items (31.9%). The largest:

| Size | Items                                                                                                                                         |
| ---: | --------------------------------------------------------------------------------------------------------------------------------------------- |
|   12 | Archaeologist, Armada, Bog Spirit, Djinn, Familiar, Flying Dutchman, Homunculus, Lost Soul, Phoenix, Unicorn, Void Familiar, Will-o'-the-Wisp |
|    9 | Arcane Shield, Consecrate, Divine Shield, Exorcism, Fire Ward, Holy Barrier, Light, Protection Spell, Turn Undead                             |
|    8 | Fire Opal, Gold, Last Survivor, Meteorite, Nightmare, Portal Ward, Talos, Wisp Lantern                                                        |
|    7 | Ascension, Assassination, Holy Light, Kiss of Death, Night, Purifying Flame, True Love's Kiss                                                 |
|    7 | Leprechaun Gold, Mana Rocket, Rocket, Rocket Fleet, Spaceship, Starblade, Starship                                                            |
|    5 | Adam, Avatar, Demiurge, Grim Reaper, Pyromancer                                                                                               |

A Phoenix and a Unicorn leave the same trace on the island in 30 seconds: one creature of their own, no fire, no flowers. Nine protection items (Arcane Shield, Consecrate, Divine Shield, Exorcism, Fire Ward, Holy Barrier, Light, Protection Spell, Turn Undead) are one dome.

## 2. Interact

**Sample.** 300 ordered pairs, A drawn by kind in turn and B by tier and by shape in turn (seeded), from all 345 items; plus 40 pairs chosen by name (below). A is cast by the village; B on the same spot 3 seconds later.

**Test.** Placing is random (a meteor lands somewhere in its reach), so two runs of one item rarely match cell by cell. The test therefore compares counts: cells of each material, of each fluid, on fire, hotter, colder, raised, lowered; creatures by kind, dead, by status, their health; voxels; wards. A pair interacts in a count when B after A differs from A alone plus B alone (B alone cast at 3 seconds) by more than: twice the two items' noise in that count (each item run again on another random stream), a floor (8 cells, 2 creatures, 20 voxels, 1 ward), and the number of cells both items change alone (B covering A explains up to that many). It also interacts when it makes 5 cells or more of a material neither makes alone.

- Noise (276 items), summed over counts, median 0 in every count; 95th percentile: materials 198 cells, temperature 201, gas 223, fire 19, fluids 10, creatures 13, structures 12.
- The same run twice does not always give the same result (10 items, 4016 cells or creatures in all, mostly gas); the noise floor above absorbs it. Not traced further.
- Cells both items change alone: median 6, 95th percentile 153.

**Result on the 300 sampled pairs.**

|                                                                        | Pairs | Share |
| ---------------------------------------------------------------------- | ----: | ----: |
| interact in at least one count                                         |   127 | 42.3% |
| interact, leaving out pairs that differ only by fewer than 5 creatures |   115 | 38.3% |
| make something neither makes alone                                     |     5 |  1.7% |
| differ only in creatures                                               |    48 |   16% |

By the system that carried it (a pair may count in several): creatures 90 (30%), fire 31 (10.3%), materials 29 (9.7%), temperature 28 (9.3%), gas 27 (9%), fluids 18 (6%), structures 15 (5%), land 8 (2.7%).

Most of what counts as an interaction is two items using the same fuel (both burn the grass, so A then B burns less than A plus B), a ward or a flood that stops the next item's fire, or villagers and beasts that react to the first item. New products, the clearest answer a player can see, came from 5 sampled pairs: steam 4, ice 2, snow 2, smoke 1, pearl 1, water 1, mud 1.

By B's shape, the share that interact: reshapes land 8 of 13, releases gas 13 of 20, paints one material 24 of 37, acts on creatures 19 of 37, paints a mix 13 of 30, pours a fluid 11 of 21, sets down an object 14 of 40, dome or ward 9 of 25, drops creatures 7 of 34, raises a structure 5 of 16, heats or chills 4 of 9, only lights and particles 0 of 18. Items that only set down an object, drop a creature or draw light (36% of the library) rarely answer anything.

**The 40 expected pairs** (A then B, picked by name from the fetched items, most cast first):

| fire then water | Fire then Great Flood | no interaction beyond noise (B alone: flood silt +1535, mud +433, rock -374; cells both change: 783) |
| lava then water | Volcano then Great Flood | interacts (materials, creatures): new snow 9 cells, hp -41, frozen +7 |
| water then cold | Great Flood then Black Ice | no interaction beyond noise (B alone: cold +381, snow +129, black ice +124; cells both change: 254) |
| water then lightning | Great Flood then Cosmic Tempest | no interaction beyond noise (B alone: starlit grass +343, boulder -1, rock +1; cells both change: 294) |
| a wall or ward then a flood | Celestial Bastion then Great Flood | interacts (materials, fluids): volume -452, life -254 |
| a ward then fire | Celestial Bastion then Fire | interacts (materials, fire): life +405, ash -382, fireMax -106 |
| light on shadow | Shadow then Divine Shield | no interaction beyond noise (B alone: wards +1, rock +1, water +1; cells both change: 0) |
| growth on ash | Extinction Event then World Seed | interacts (materials, fire, creatures): life -233, ash +219, fire +18, dead -3 |
| fire on growth | World Seed then Fire | interacts (fire): fire +64 |
| cold then fire | Black Ice then Fire | interacts (materials, fire): life +422, fireMax -105 |
| wind on fire | Fire then Healing Breeze | no interaction beyond noise (B alone: rock +1, water +1, hot 0; cells both change: 21) |
| a creature then its predator | Familiar then Serpent | no interaction beyond noise (B alone: serpent +1, rock +1, water +1; cells both change: 0) |
| undead then holy | Lich then Divine Shield | no interaction beyond noise (B alone: wards +1, rock +1, water +1; cells both change: 1) |
| healing on harm | Meteor Strike then Healing Rain | interacts (creatures): calm -17 |
| rain on desert | Crater then Healing Rain | interacts (creatures): calm -4 |
| fire on a swamp | Bog Spirit then Fire | no interaction beyond noise (B alone: smoke +527, hot +517, ash +386; cells both change: 4) |
| lava then water | Molten Gold then Healing Rain | interacts (fire): fire +58 |
| water then cold | Healing Rain then Blizzard | interacts (creatures): calm -4 |
| water then lightning | Healing Rain then Sandstorm | no interaction beyond noise (B alone: hot 0, cold 0, up 0; cells both change: 0) |
| a wall or ward then a flood | Golem then Maelstrom | no interaction beyond noise (B alone: rock -39, hot 0, cold 0; cells both change: 4) |
| a ward then fire | Holy Barrier then Meteor Strike | interacts (gas, creatures): smoke +214, stunned +5 |
| light on shadow | Shadow Step then Aurora | no interaction beyond noise (B alone: snow -42, voxels +1, rock +1; cells both change: 4) |
| growth on ash | Ash Cloud then Yggdrasil | interacts (fluids): new water 13 cells |
| fire on growth | Yggdrasil then Meteor Strike | interacts (fire, gas, creatures): smoke +200, fireMax +47, hp -16, dead +5 |
| cold then fire | Blizzard then Meteor Strike | interacts (fire, fluids, gas, creatures): new mud 56 cells, new steam 46 cells, fireMax -174, smoke +95, steam +46, frozen -20 |
| wind on fire | Meteor Strike then Hurricane | interacts (gas, creatures): new steam 100 cells, smoke +353, steam +100, hp +23 |
| a creature then its predator | Human then Black Dragon | no interaction beyond noise (B alone: smoke +176, clinging shadow +37, cold +29; cells both change: 2) |
| undead then holy | Undead Legion then Divine Intervention | interacts (creatures): calm -8 |
| healing on harm | Extinction Event then Healer | interacts (materials, fire, creatures): ash +161, fire +25, calm -3 |
| rain on desert | Dead Sea then World Seed | no interaction beyond noise (B alone: seedbloom +15, rock +1, water +1; cells both change: 23) |
| fire on a swamp | Swamp then Meteor Strike | interacts (fire, gas, creatures, structures): voxels -1827, smoke +257, fireMax +115, fire -42 |
| fire then water | Phoenix then Cloud Fountain | no interaction beyond noise (B alone: voxels +446, up +37, water +33; cells both change: 5) |
| lava then water | Obsidian then Cloud Fountain | interacts (creatures): hp -159, dead +19 |
| water then cold | Cloud Fountain then Frost Nova | no interaction beyond noise (B alone: hot +390, smoke +331, ash +89; cells both change: 72) |
| water then lightning | Cloud Fountain then Firestorm | interacts (gas, structures): new steam 218 cells, steam +218, voxels -140 |
| a wall or ward then a flood | Holy Barrier then Deluge | interacts (fluids, temperature, creatures): volume -2160, water -1026, ice -127, cold -81 |
| a ward then fire | Fire Ward then Phoenix | no interaction beyond noise (B alone: fish -1, phoenix +1, rock +1; cells both change: 0) |
| light on shadow | Boogeyman then Divine Intervention | no interaction beyond noise (B alone: ash +10, calm +8, dead +1; cells both change: 0) |
| growth on ash | Crater then Garden of Eden | interacts (creatures): calm +3 |
| fire on growth | Garden of Eden then Phoenix | no interaction beyond noise (B alone: fish -1, phoenix +1, rock +1; cells both change: 5) |

22 of 40 interact. By group, those that fall short: fire then water 0 of 2, water then cold 1 of 3, water then lightning 1 of 3, a wall or ward then a flood 2 of 3, a ward then fire 2 of 3, light on shadow 0 of 3, fire on growth 2 of 3, wind on fire 1 of 2, a creature then its predator 0 of 2, undead then holy 1 of 2, rain on desert 1 of 2, fire on a swamp 1 of 2.

**Reactions a player would expect that are missing**, ranked by the expected pairs they would touch. Each was checked against the calls the items made (the run-time trace) and the engine (`src/sim/physics.ts`, `src/sim/creatures.ts`, `src/sim/runtime.ts`) on the first pass; the full set shows the same gaps. "Engine" means a rule added once would reach every stored item; "item" means the program does not do what its name says, and only a rewrite would change it.

1. **Fire-named creatures carry no fire** (item and engine). Phoenix only spawns its creature; it burns nothing. The engine has a "breathe fire" ability but no rule that a creature of fire sets what it touches alight.
2. **Light and shadow are not part of the world** (plus the 18 items whose only effect is light; engine). `w.light`, `w.darken` and `w.tint` draw; no cell or creature holds light or darkness, so nothing can dispel it. Aurora grows plants and sets a landmark; Shadow Step paints rock and smoke.
3. **Blasts and gusts move only creatures** (engine). `w.shockwave` is drawn only; Blast Wave, Healing Breeze and Hypercane push or calm creatures but leave fire, smoke and water where they are. `w.wind` steers fire and gas but not water.
4. **Storms strike no lightning** (item). Hurricane, Cosmic Tempest, Sandstorm and Hypercane call `w.wind`, never `w.lightning`. The engine already shocks every creature in the same water when lightning hits it, so the reaction exists and goes unused. Maelstrom makes no water at all.
5. **Growth ignores ash** (engine). World Seed paints its own bloom and Yggdrasil raises a model; neither grows more or differently on ash, and `w.grow` does not read the ground.
6. **Spell creatures do not hunt each other** (engine). `prey` names the island's kinds. Serpent does nothing to Familiar, Black Dragon nothing to Human.
7. **Holy light does not hurt the undead** (engine). Divine Radiance heals and calms whoever is near; the undead tag exists in `creatures.ts` but no rule ties it to holy items.
8. **Cold after water froze nothing more** (cause not traced). Water freezes below 0 in `stepTemperature`; Black Ice alone makes 381 colder cells, yet Great Flood then Black Ice held no more ice than the two alone.

## 3. Smart

**Static.** The World API's reading calls (`src/sim/runtime.ts`): `w.cell`, `w.creatures`, `w.corpses`, `w.artifacts` (and `inside`, not counted). Read with the TypeScript parser.

- 208 programs (60.3%) call a reading function: `creatures` in 180, `cell` in 82, `corpses` in 11.
- 148 (42.9%) branch on what they read (an `if`, a ternary, `&&`, `||`, or a `filter`, `find`, `some`, `every` or `sort` whose condition holds a reading call, a variable set from one, or a cell or creature field).

**At run time.** Each program was cast at three spots of the same island, with the same random stream: the village edge of the test run, open water far from houses, and bare rock far from houses. Every World API call the program made was recorded (not the API's calls to itself). Sounds, lights, particles, bodies, drawings and the camera were left out.

| Behavior                                               | Programs | Share |
| ------------------------------------------------------ | -------: | ----: |
| asked the island something at the village              |      199 | 57.7% |
| change the island in different ways at the three spots |       31 |  9.0% |
| differ only in what they do to the creatures they find |      100 | 29.0% |
| do the same things in other amounts                    |       29 |  8.4% |
| act the same wherever they are cast                    |      185 | 53.6% |

The shape of the result changes with the spot for 126 items (36.5%), but mostly because the land refuses what the item does (paint on water), not because the program chose.

Ten that change the island in different ways: Acid Breath, Archaeologist, Atlantis, Avalanche, Bog Spirit, Cataclysm, Clone, Cosmic Tempest, Curse, Cursed Water.

Ten that act the same: Abyss, Adam, Akashic Records, Alpha Werewolf, Ambrosia, Apocalypse, Arcane Barrage, Arcane Shield, Archangel, Ark.

The common pattern of the 100 in between: `w.creatures(x, y, r).forEach(c => c.hurt(...))`. They read who is near and hit them, but do the same to the land.

## Cost

- Live programs by model (`/api/spell/info`, the 401 elements whose row is marked live; 84 of the fetched programs have no such row): Haiku 297 (74.1%), Opus 104 (25.9%). Of the 345 fetched: Haiku 181, Opus 80, 84 with no model row.
- By `PROGRAM_VERSION`: v6 366, v4 32, v3 2, v2 1.
- Never cast (`casts` 0 in `/api/admin/forms`): 303 of 486 elements (62%).
- The last refresh (`/api/admin/refresh-report`) rewrote 240 programs for $3.54, about 1.5 cents each. The rewrite list (`docs/measurements/spell-rewrite-candidates-2026-11-12.md`) has 143 candidates; at the Worker's estimates ($0.006 a small item, $0.06 a legendary or cosmic one, batch price) the whole list is about $2.64, which fits in the $4.46 November's refresh budget has left. It still needs the owner's yes for the rewrite itself (bulk rewrite).

## What this does not measure, and why

- **140 live artifacts.** Their code is not returned by any read only route (see Coverage). The 345 measured lean to spells, creatures and challenge candidates; what the artifacts would add is unknown.
- **Long effects.** 30 seconds, and five minutes only for the 24 items that set down an object or drop one creature (`check.ts`). The rest are not followed past 30 seconds.
- **What a player sees.** Light, particles and bodies count only as "only lights and particles". A spell whose look is its point scores as nothing lasting.
- **Shapes are rules, not judgement.** The weights above decide ties; a different weight moves items between neighbouring shapes, mostly between "acts on creatures" and "drops creatures".
- **Interaction is counts.** Two items that change the same count in opposite ways in different places would cancel. Reactions slower than 27 seconds after B are missed.
- **Films** are on the Spell Lab's island (the game's medium island, seed 11), not on the practice island: they show the look, the numbers come from the measure.

## Films

20 pairs, three frames each at 700 by 830 (before, one second after the cast, fifteen seconds after; near duplicates are cast one at a time, `a-` and `b-` frames), made with `node scripts/spell-pair-frames.mjs <out>/films.json <frames dir>`.

|   # | Why                                                     | Pair                              |
| --: | ------------------------------------------------------- | --------------------------------- |
|   1 | interacts (sample)                                      | Undead Horde then Big Bang        |
|   2 | interacts (sample)                                      | Village then Flame Dash           |
|   3 | interacts (sample)                                      | Molten Gold then Moraine          |
|   4 | interacts (sample)                                      | Obsidian then Volcanic Smog       |
|   5 | interacts (cold then fire)                              | Blizzard then Meteor Strike       |
|   6 | interacts (sample)                                      | Paradise Lost then Oblivion       |
|   7 | expected, no interaction (fire then water)              | Fire then Great Flood             |
|   8 | expected, no interaction (light on shadow)              | Shadow then Divine Shield         |
|   9 | expected, no interaction (a creature then its predator) | Familiar then Serpent             |
|  10 | expected, no interaction (water then lightning)         | Healing Rain then Sandstorm       |
|  11 | expected, no interaction (a wall or ward then a flood)  | Golem then Maelstrom              |
|  12 | expected, no interaction (rain on desert)               | Dead Sea then World Seed          |
|  13 | expected, no interaction (water then cold)              | Cloud Fountain then Frost Nova    |
|  14 | expected, no interaction (a ward then fire)             | Fire Ward then Phoenix            |
|  15 | near duplicates, cosine 1.000                           | Arcane Surge then Prismatic Storm |
|  16 | near duplicates, cosine 1.000                           | Ascension then Purifying Flame    |
|  17 | near duplicates, cosine 1.000                           | Archaeologist then Armada         |
|  18 | near duplicates, cosine 1.000                           | Assassination then Holy Light     |
|  19 | near duplicates, cosine 1.000                           | Bog Spirit then Djinn             |
|  20 | near duplicates, cosine 1.000                           | Clone then Ninja                  |
