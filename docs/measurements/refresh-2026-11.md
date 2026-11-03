# Refresh of the legacy library (2026-11-03)

Every stored program written again with today's prompt and engine through the Batch API (62 by Opus, 88 by Haiku), each decided by `scripts/refresh-runner.ts`: its test run in Node (promise probe and the five minute test of an artifact included), then the judge on the old and the new program on the same frames. Replaced only if it passed, scored no lower and its creatures looked no less alive. Old versions are retired, not deleted; votes roll a replaced one back if players like it less.

## Outcome

|                                           | Programs         |
| ----------------------------------------- | ---------------- |
| Replaced, judged better                   | 27               |
| Replaced, judged the same                 | 70               |
| Kept the old: the new failed its test run | 17               |
| Kept the old: judged lower                | 36               |
| Rolled back by votes since                | 0 (no votes yet) |

## Cost

$2.91 of Batch API ($2.79 Opus, $0.11 Haiku), the dry run included, plus about $0.10 of judge calls, under the $8 cap. Started on November 3.

## The ten biggest changes

`refresh-2026-11-biggest.jpg`: old left, new right, the last of the three judge frames.

## Read with care

1. Most replacements are ties (judged the same). They were let through because the new program was written for today's engine: 14 of the 20 old programs checked in the dry run broke their promise probe and every new one kept it, which the judge cannot see. A tie is not an improvement in look; votes are the real test.
2. Items that promise protection still lean toward a clear dome (Crystal, Portal Ward) even after the prompt asked to keep each item's own look; the fix helped some (Final Incantation, Adamantine Wall) but not all. Worth a look in play.
3. Kept because the new one failed its test run (a crash, a broken promise, or an artifact idle for five minutes). Protection Spell is the awkward one: its new program broke its promise, so the old one, which breaks it too (a shell of blocks), stays live; the next vote or the admin's Rewrite button should settle it:
   - Protection Spell: its test run failed (promise): It promises protection, but the village it covers was barely safer with it than without it (a rain of fire: 3
   - Last Survivor: its test run failed (crash): It crashed: ReferenceError: w is not defined (line 1)
   - Meteorite: its test run failed (idle): Placed by a village and left alone for five minutes, it changed nothing after it arrived: no effect, nothing vil
   - Saint: its test run failed (promise): It promises protection, but the village it covers was barely safer with it than without it (a rain of fire: 2
   - Shadow: its test run failed (nothing): Nothing visible happened in the world: no land, water, plant, house, block or creature changed and nothing fl
   - Wormhole Network: its test run failed (crash): It crashed: TypeError: Cannot set property data of #<CreatureHandle> which has only a getter (line 15)
   - Ent: its test run failed (idle): Placed by a village and left alone for five minutes, it changed nothing after it arrived: no effect, nothing vil
   - Fountain of Youth: its test run failed (crash): It crashed: ReferenceError: Cannot access 'spell' before initialization (line 1)
   - Holy Light: its test run failed (nothing): Nothing visible happened in the world: no land, water, plant, house, block or creature changed and nothing fl
   - Holy Sword: its test run failed (promise): It promises protection, but the village it covers was barely safer with it than without it (a rain of fire: 0
   - Maelstrom: its test run failed (crash): It crashed: TypeError: Cannot read properties of undefined (reading 'has') (line 1)
   - Mandrake: its test run failed (crash): It crashed: ReferenceError: Cannot access 'spell' before initialization (line 1)
   - Prismatic Storm: its test run failed (crash): It crashed: TypeError: Cannot read properties of undefined (reading '0') (line 1)
   - Sanctuary: its test run failed (idle): Placed by a village and left alone for five minutes, it changed nothing after it arrived: no effect, nothing vil
   - Steam: its test run failed (idle): Placed by a village and left alone for five minutes, it changed nothing after it arrived: no effect, nothing vil
   - Stone Guardian: its test run failed (promise): It promises protection, but the village it covers was barely safer with it than without it (a rain of fire: 3
   - Void Familiar: its test run failed (idle): Placed by a village and left alone for five minutes, it changed nothing after it arrived: no effect, nothing vil

## Every verdict

| Item                 | Judge old / new | Verdict      |
| -------------------- | --------------- | ------------ |
| Arcane Shield        | 2 / 3           | replaced     |
| Protection Spell     | 3 / None        | kept the old |
| Adamantine Wall      | 3 / 2           | kept the old |
| Divine Shield        | 2 / 3           | replaced     |
| Dungeon              | 3 / 2           | kept the old |
| Final Incantation    | 2 / 3           | replaced     |
| Holy Avenger         | 4 / 2           | kept the old |
| Holy Tome            | 3 / 3           | replaced     |
| Last Survivor        | 2 / None        | kept the old |
| Light                | 3 / 2           | kept the old |
| Meteor               | 2 / 3           | replaced     |
| Meteorite            | 3 / None        | kept the old |
| Portal Ward          | 3 / 4           | replaced     |
| Raise Dead           | 2 / 2           | replaced     |
| Saint                | 3 / None        | kept the old |
| Shadow               | 2 / None        | kept the old |
| Stone Wall           | 3 / 3           | replaced     |
| Ward                 | 2 / 2           | replaced     |
| Water                | 3 / 2           | kept the old |
| Air                  | 2 / 2           | replaced     |
| Meteor Strike        | 4 / 4           | replaced     |
| Necronomicon         | 2 / 2           | replaced     |
| Wormhole             | 3 / 3           | replaced     |
| Wormhole Network     | 3 / None        | kept the old |
| Yggdrasil            | 2 / 2           | replaced     |
| Angel                | 2 / 2           | replaced     |
| Arcane               | 3 / 2           | kept the old |
| Arcane Surge         | 2 / 2           | replaced     |
| Crystal              | 2 / 3           | replaced     |
| Crystal Cavern       | 4 / 3           | kept the old |
| Crystal Cluster      | 3 / 3           | replaced     |
| Cycle of Life        | 2 / 3           | replaced     |
| Darkness             | 4 / 3           | kept the old |
| Dhampir              | 3 / 3           | replaced     |
| Dodo                 | 2 / 2           | replaced     |
| Dodo Flock           | 2 / 2           | replaced     |
| Apocalypse           | 4 / 3           | kept the old |
| Archangel            | 2 / 2           | replaced     |
| Armageddon           | 4 / 4           | replaced     |
| Astral Storm         | 2 / 2           | replaced     |
| Big Bang             | 3 / 2           | kept the old |
| Black Hole           | 2 / 2           | replaced     |
| Camelot              | 2 / 4           | replaced     |
| Cataclysm            | 4 / 4           | replaced     |
| Corona               | 2 / 2           | replaced     |
| Cosmic Storm         | 3 / 2           | kept the old |
| Creation             | 2 / 3           | replaced     |
| Dawn                 | 4 / 3           | kept the old |
| Divine Intervention  | 3 / 2           | kept the old |
| Divine Light         | 2 / 3           | replaced     |
| Druid                | 4 / 3           | kept the old |
| Dryad                | 2 / 3           | replaced     |
| Earth                | 2 / 4           | replaced     |
| Earthquake           | 2 / 2           | replaced     |
| Eclipse              | 3 / 2           | kept the old |
| Elixir of Life       | 4 / 3           | kept the old |
| Enchanted Forest     | 2 / 2           | replaced     |
| Ent                  | 3 / None        | kept the old |
| Fallen Angel         | 2 / 2           | replaced     |
| Fire                 | 4 / 4           | replaced     |
| Fireball             | 2 / 4           | replaced     |
| Firestorm            | 3 / 4           | replaced     |
| Flesh Golem          | 2 / 2           | replaced     |
| Fountain of Youth    | 2 / None        | kept the old |
| Geyser               | 2 / 2           | replaced     |
| Gold                 | 2 / 3           | replaced     |
| Golem                | 3 / 2           | kept the old |
| Eternal Night        | 4 / 3           | kept the old |
| Event Horizon        | 2 / 2           | replaced     |
| Excalibur            | 2 / 2           | replaced     |
| Exodus               | 2 / 2           | replaced     |
| Extinction Event     | 2 / 2           | replaced     |
| Gaia                 | 2 / 2           | replaced     |
| Garden of Eden       | 2 / 2           | replaced     |
| Genesis              | 4 / 2           | kept the old |
| Great Flood          | 4 / 3           | kept the old |
| Guardian Angel       | 2 / 2           | replaced     |
| Heavenly Host        | 2 / 3           | replaced     |
| Holy Grail           | 4 / 2           | kept the old |
| Hypernova            | 3 / 2           | kept the old |
| Immortality          | 2 / 2           | replaced     |
| Ley Line             | 2 / 2           | replaced     |
| Ley Lines            | 2 / 2           | replaced     |
| Meteor Shower        | 3 / 2           | kept the old |
| Miracle              | 2 / 2           | replaced     |
| Halo                 | 4 / 3           | kept the old |
| Healing Light        | 3 / 3           | replaced     |
| Holy Light           | 2 / None        | kept the old |
| Holy Order           | 2 / 2           | replaced     |
| Holy Sword           | 3 / None        | kept the old |
| Lady of the Lake     | 2 / 2           | replaced     |
| Life                 | 3 / 3           | replaced     |
| Maelstrom            | 3 / None        | kept the old |
| Mana Crystal         | 2 / 3           | replaced     |
| Mana Storm           | 3 / 2           | kept the old |
| Mandrake             | 2 / None        | kept the old |
| Morning Breeze       | 3 / 2           | kept the old |
| Necromancy           | 2 / 3           | replaced     |
| Nexus                | 2 / 2           | replaced     |
| Paladin              | 3 / 4           | replaced     |
| Paradise Lost        | 2 / 2           | replaced     |
| Part the Sea         | 2 / 2           | replaced     |
| Philosopher's Stone  | 2 / 2           | replaced     |
| Quintessence         | 3 / 2           | kept the old |
| Rebirth              | 3 / 2           | kept the old |
| Salvation            | 2 / 2           | replaced     |
| Seraph               | 3 / 3           | replaced     |
| Singularity          | 3 / 2           | kept the old |
| Star Seed            | 2 / 2           | replaced     |
| Starbloom            | 2 / 2           | replaced     |
| Pet Dodo             | 2 / 2           | replaced     |
| Phoenix Flock        | 3 / 2           | kept the old |
| Prism                | 3 / 3           | replaced     |
| Prismatic Storm      | 2 / None        | kept the old |
| Resurrection         | 3 / 3           | replaced     |
| Sanctuary            | 3 / None        | kept the old |
| Shadow Magic         | 2 / 3           | replaced     |
| Soul Gem             | 2 / 2           | replaced     |
| Spirit Guide         | 2 / 3           | replaced     |
| Stake                | 3 / 3           | replaced     |
| Star Familiar        | 2 / 2           | replaced     |
| Star Metal           | 2 / 2           | replaced     |
| Starburst            | 2 / 3           | replaced     |
| Starfall             | 4 / 3           | kept the old |
| Steam                | 3 / None        | kept the old |
| Stone Guardian       | 2 / None        | kept the old |
| Tidal Wave           | 4 / 2           | kept the old |
| Tornado              | 2 / 2           | replaced     |
| Treant               | 2 / 2           | replaced     |
| Twilight             | 2 / 2           | replaced     |
| Vampire              | 2 / 2           | replaced     |
| Void Familiar        | 2 / None        | kept the old |
| Void Grove           | 3 / 2           | kept the old |
| Water Sprite         | 2 / 2           | replaced     |
| Wellspring of Life   | 2 / 3           | replaced     |
| Whirlwind            | 2 / 2           | replaced     |
| Withering            | 2 / 3           | replaced     |
| Sunrise              | 3 / 2           | kept the old |
| Supernova            | 2 / 2           | replaced     |
| Transmutation        | 4 / 2           | kept the old |
| Tree of Life         | 4 / 2           | kept the old |
| Universe             | 2 / 2           | replaced     |
| Void                 | 2 / 2           | replaced     |
| Void Nexus           | 2 / 2           | replaced     |
| Void Storm           | 2 / 3           | replaced     |
| World                | 2 / 4           | replaced     |
| World Seed           | 2 / 3           | replaced     |
| World Tree           | 2 / 2           | replaced     |
| World Tree Awakening | 3 / 3           | replaced     |
| World Tree Guardian  | 2 / 2           | replaced     |
