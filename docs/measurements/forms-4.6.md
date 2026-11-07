# The library sorted into seven kinds (4.6 part A)

Measured on 5 November 2026 on the preview of PR #50, whose database is a copy of the live library (493 items). Haiku sorted every item from its name alone, at medium effort, in 180 items a call; nothing was applied on production. The live programs of the 289 artifacts were then cast in Node with the kind proposed for them (`src/sim/check.ts`, the kind and size check only, probes left out).

## Why by the name alone

Two runs that also read the grimoire entry disagreed on 25 and then 40 of 477 items, and called people objects: the entries were written before the kinds and often made a person a trinket (Warlock "a slender black-iron cage", Paladin "a blade-shaped artifact", Selkie "a pelt"). By the name alone, Warlock, Paladin, Healer and Selkie are creatures, Crypt is a building, Dwarven Hold and Camelot are settlements.

## Counts

| Kind       | Items |
| ---------- | ----- |
| spell      | 193   |
| creature   | 138   |
| object     | 60    |
| building   | 15    |
| settlement | 6     |
| place      | 44    |
| land       | 37    |

## Flips: the owner decides each one

These would turn a spell into an artifact or back, which changes how players use them (cast or placed). `forms-apply` applies them only by name with `flip: true`.

- **Stone Wall**: spell to building (a structure people raise)
- **Ember Swarm**: spell to creature (a group of living beings)
- **Maelstrom**: spell to land (A whirlpool that reshapes the sea and covers it)
- **Sinkhole**: spell to land (A reshaped land hole.)
- **Magma Trail**: spell to land (A trail of lava lying on the land)
- **Miasma**: spell to land (a foul vapor that covers the land)
- **Quagmire**: spell to land (A swamp covering the land.)
- **Sea of Steam**: spell to land (A vapor-covered expanse of land and sea)
- **Volcanic Smog**: spell to land (Volcanic ash covering the land)
- **Lava Rune**: spell to object (A rune stone a hand can hold.)
- **Stone Shard**: spell to object (a broken stone a hand can hold)
- **Immortality**: artifact to spell (A state a mage would cast)
- **Alchemy**: artifact to spell (an art a mage would cast)
- **Great Voyage**: artifact to spell (a journey that happens)
- **Pilgrimage**: artifact to spell (a journey that happens)
- **Samsara**: artifact to spell (A cycle of rebirth a mage would cast.)
- **Shooting Star**: artifact to spell (A celestial event that is called down)

## Live programs that are not their kind

117 of 289 fail the check for the kind proposed; these are the rewrites by form, most cast first. At the refresh's held estimates ($0.006 a small item, $0.06 a big one) all of them cost about $2.65, inside the $3.63 left of November's $8 refresh budget.

### creature (70)

- Bog Monster (minor, kind): Bog Monster is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Sky Mage (major, kind): Sky Mage is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Archangel (legendary, kind): Archangel is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Astrologer (minor, kind): Astrologer is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Celestial Choir (cosmic, size): Celestial Choir is too big for a creature: 21 cells across
- Crystal Golem (minor, kind): Crystal Golem is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Extinct Spirit (minor, kind): Extinct Spirit is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Fenghuang (grand, kind): Fenghuang is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Healer (minor, kind): Healer is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Holy Avenger (minor, kind): Holy Avenger is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Last Survivor (cantrip, kind): Last Survivor is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Lich (major, kind): Lich is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Mermaid (cantrip, kind): Mermaid is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Monster Hunter (minor, kind): Monster Hunter is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Saint (minor, size): Saint is too big for a creature: 12 voxels tall
- Serpent (minor, kind): Serpent is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Spirit Guide (minor, kind): Spirit Guide is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Spirit Lights (grand, kind): Spirit Lights is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Swamp Wraith (minor, kind): Swamp Wraith is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Undead Legion (legendary, size): Undead Legion is too big for a creature: 9 cells across
- Villager (cantrip, kind): Villager is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Warlock (minor, kind): Warlock is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Army of the Dead (legendary, size): Army of the Dead is too big for a creature: 17 voxels tall
- Astronaut (cantrip, kind): Astronaut is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Astronomer (cantrip, kind): Astronomer is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Banshee (minor, kind): Banshee is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Basilisk (minor, kind): Basilisk is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Behemoth (legendary, kind): Behemoth is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Brynhild (major, kind): Brynhild is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Cosmic Entity (cosmic, kind): Cosmic Entity is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Dracula (legendary, kind): Dracula is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Draugr (minor, kind): Draugr is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Druid (minor, size): Druid is too big for a creature: 10 voxels tall
- Dryad (minor, size): Dryad is too big for a creature: 10 voxels tall
- Frost Kraken (grand, kind): Frost Kraken is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Frost Lich (legendary, size): Frost Lich is too big for a creature: 11 cells across
- Ghost Light (minor, kind): Ghost Light is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Gold Dragon (legendary, kind): Gold Dragon is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Hippocampus (minor, kind): Hippocampus is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Holy Order (major, kind): Holy Order is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Kelpie (minor, kind): Kelpie is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- King Arthur (legendary, kind): King Arthur is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Kraken (major, kind): Kraken is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Legion of the Damned (legendary, size): Legion of the Damned is too big for a creature: 14 voxels tall
- Loki (legendary, kind): Loki is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Marsh Light (cantrip, kind): Marsh Light is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Marsh Lights (grand, kind): Marsh Lights is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Merfolk (minor, kind): Merfolk is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Nightmare (minor, kind): Nightmare is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Paladin (minor, kind): Paladin is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Phoenix Flock (major, size): Phoenix Flock is too big for a creature: 14 voxels tall
- Seraph (legendary, kind): Seraph is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Shadow Double (cantrip, kind): Shadow Double is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Stone Guardian (minor, kind): Stone Guardian is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Storm Dragon (legendary, size): Storm Dragon is too big for a creature: 37 voxels tall
- Talos (major, kind): Talos is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Treant (minor, size): Treant is too big for a creature: 242 voxels
- Twin (cantrip, kind): Twin is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Twin Phoenixes (major, size): Twin Phoenixes is too big for a creature: 8 cells across
- Undead (cantrip, kind): Undead is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Undead Horde (major, kind): Undead Horde is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Valkyrie (minor, kind): Valkyrie is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Vampire Lord (major, size): Vampire Lord is too big for a creature: 16 voxels tall
- Void Familiar (minor, kind): Void Familiar is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Wild Hunt (legendary, size): Wild Hunt is too big for a creature: 25 cells across
- Wisp Swarm (minor, kind): Wisp Swarm is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Wizard (cantrip, kind): Wizard is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- World Tree Guardian (cosmic, size): World Tree Guardian is too big for a creature: 65 cells across
- World Turtle (cosmic, kind): World Turtle is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.
- Wraith (minor, kind): Wraith is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.

### object (22)

- Book of the Dead (legendary, size): Book of the Dead is too big for an object: 11 cells across
- World Seed (cosmic, size): World Seed is too big for an object: 14 cells across
- Akashic Records (cosmic, size): Akashic Records is too big for an object: 8 voxels tall
- Ambrosia (legendary, size): Ambrosia is too big for an object: 8 voxels tall
- Doombringer (legendary, size): Doombringer is too big for an object: 12 voxels tall
- Philosopher's Stone (legendary, size): Philosopher's Stone is too big for an object: 8 voxels tall
- Aegis (legendary, size): Aegis is too big for an object: 6 cells across
- Elixir of Life (cantrip, size): Elixir of Life is too big for an object: 7 cells across
- Excalibur (legendary, size): Excalibur is too big for an object: 19 voxels tall
- Fire Opal (cantrip, size): Fire Opal is too big for an object: 6 voxels tall
- Fire Staff (minor, size): Fire Staff is too big for an object: 8 cells across
- Halo (cantrip, size): Halo is too big for an object: 6 cells across
- Holy Grail (legendary, size): Holy Grail is too big for an object: 8 voxels tall
- Holy Scripture (major, size): Holy Scripture is too big for an object: 9 voxels tall
- Holy Sword (cantrip, size): Holy Sword is too big for an object: 10 voxels tall
- Magic Mirror (minor, size): Magic Mirror is too big for an object: 9 cells across
- Naglfar (legendary, size): Naglfar is too big for an object: 15 cells across
- Phylactery (cantrip, size): Phylactery is too big for an object: 6 voxels tall
- Soul Gem (cantrip, size): Soul Gem is too big for an object: 6 voxels tall
- Stake (cantrip, size): Stake is too big for an object: 12 voxels tall
- Sunflower (cantrip, size): Sunflower is too big for an object: 9 voxels tall
- Wisp Lantern (cantrip, size): Wisp Lantern is too big for an object: 7 voxels tall

### building (7)

- Sky Castle (major, size): Sky Castle is too big for a building: 50 voxels tall
- Crypt (minor, kind): Crypt is a building, but nothing was built: use w.building(x, y, {job}) for the building itself, then add what is special with the structures.
- Forge (minor, kind): Forge is a building, but nothing was built: use w.building(x, y, {job}) for the building itself, then add what is special with the structures.
- Lich Tower (major, size): Lich Tower is too big for a building: 26 voxels tall
- Lighthouse (minor, size): Lighthouse stacked 14 voxels on the cells of the building it raised, which the island's builder draws: build what is special at b.beside, next to it, never on i
- Noah's Ark (legendary, size): Noah's Ark is too big for a building: 13 cells across
- Wizard Tower (minor, size): Wizard Tower stacked 13 voxels on the cells of the building it raised, which the island's builder draws: build what is special at b.beside, next to it, never on

### settlement (5)

- Camelot (legendary, kind): Camelot is a settlement, but no village was made: use w.village(x, y, {houses}), which lays out houses, a plaza, fields and villagers as the island's own villag
- Village (major, kind): Village is a settlement, but no village was made: use w.village(x, y, {houses}), which lays out houses, a plaza, fields and villagers as the island's own villag
- Lost City (legendary, kind): Lost City is a settlement, but no village was made: use w.village(x, y, {houses}), which lays out houses, a plaza, fields and villagers as the island's own vill
- Necropolis (major, kind): Necropolis is a settlement, but no village was made: use w.village(x, y, {houses}), which lays out houses, a plaza, fields and villagers as the island's own vil
- Sunken City (major, kind): Sunken City is a settlement, but no village was made: use w.village(x, y, {houses}), which lays out houses, a plaza, fields and villagers as the island's own vi

### place (6)

- Wormhole (cosmic, size): Wormhole is too big for a place: 82 cells across
- Wormhole Network (cosmic, size): Wormhole Network is too big for a place: 67 cells across
- Yggdrasil (cosmic, size): Yggdrasil is too big for a place: 60 cells across
- Garden of Eden (legendary, size): Garden of Eden is too big for a place: 5010 voxels
- Bifrost (legendary, size): Bifrost is too big for a place: 37 cells across
- World Tree (cosmic, size): World Tree is too big for a place: 55 cells across

### land (7)

- Cloud (minor, kind): Cloud is land, but the land itself barely changed
- Steam (cantrip, kind): Steam is land, but the land itself barely changed
- Crystal Cluster (minor, kind): Crystal Cluster is land, but the land itself barely changed
- Gold (cantrip, kind): Gold is land, but the land itself barely changed
- Ice (cantrip, kind): Ice is land, but the land itself barely changed
- Mist (minor, kind): Mist is land, but the land itself barely changed
- Star Metal (minor, kind): Star Metal is land, but the land itself barely changed

## Every proposal

**creature** (137): Angel, Archangel, Army of Clones, Army of the Dead, Astrologer, Astronaut, Astronomer, Banshee, Basilisk, Basilisk Brood, Behemoth, Bird, Black Dragon, Bog Monster, Bog Spirit, Boogeyman, Brynhild, Celestial Choir, Cloud Giant, Cosmic Entity, Crystal Golem, Dark Phoenix, Demiurge, Dhampir, Dodo, Dodo Flock, Doppelganger, Dracula, Dragon, Dragon Rider, Draugr, Druid, Dryad, Dwarf, Each-Uisge, Earth Dragon, Ent, Extinct Spirit, Fallen Angel, Familiar, Fenghuang, Fire Elemental, Fire Giants, Fireflies, Flesh Golem, Four Horsemen, Frost Giant, Frost Kraken, Frost Lich, Frost Phoenix, Gaia, Ghost, Ghost Light, Gold Dragon, Golem, Guardian Angel, Healer, Heavenly Host, Hippocampus, Holy Avenger, Holy Order, Homunculus, Human, Huorn, Hydra, Kelpie, King Arthur, Kraken, Lady of the Lake, Last Survivor, Legion of the Damned, Leviathan, Leviathan Armada, Leviathan Fleet, Leviathan Pod, Leviathan Shoal, Leviathan Swarm, Lich, Loki, Marsh Light, Marsh Lights, Merfolk, Mermaid, Monster Hunter, Mud Golem, Nightmare, Paladin, Pegasus, Pet Dodo, Phoenix, Phoenix Flock, Pyromancer, Rainbow Phoenix, Saint, Sandworm, Selkie, Seraph, Serpent, Shadow Double, Siren, Sky Mage, Spirit Guide, Spirit Lights, Star Familiar, Stone Guardian, Storm Dragon, Succubus, Swamp Horde, Swamp Thing, Swamp Wraith, Talos, Thunderbird, Thunderbird Flock, Treant, Twin, Twin Phoenixes, Undead, Undead Horde, Undead Legion, Unicorn, Unicorn Herd, Valkyrie, Vampire, Vampire Lord, Villager, Void Familiar, Warlock, Water Sprite, Wild Hunt, Will-o'-the-Wisp, Will-o'-the-Wisps, Wisp Swarm, Wizard, World Tree Guardian, World Turtle, Wraith, Ymir

**object** (58): Aegis, Akashic Records, Ambrosia, Black Mirror, Book of the Dead, Brick, Crystal, Dark Star, Doombringer, Dragon Egg, Elixir of Life, Excalibur, Fire Gem, Fire Opal, Fire Ruby, Fire Staff, Geode, Grimoire, Halo, Healing Potion, Holy Grail, Holy Scripture, Holy Sword, Holy Tome, Holy Water, Ice Crystal, Lost Tome, Magic Mirror, Mana Crystal, Mana Potion, Mandrake, Meteorite, Mirror, Moonflower, Moonstone, Naglfar, Necronomicon, Nectar, Obsidian, Onyx, Pebble, Philosopher's Stone, Phylactery, Prism, Quest, Quintessence, Scrying Mirror, Seal Skin, Sealskin, Soul Gem, Spellbook, Spellbook of Flight, Stake, Star Seed, Sunflower, Sunstone, Wisp Lantern, World Seed

**building** (14): Adamantine Wall, Celestial Bastion, Crypt, Fallen Castle, Forge, Frozen Tomb, Furnace, Haunted Tomb, Kiln, Lich Tower, Lighthouse, Noah's Ark, Sky Castle, Wizard Tower

**settlement** (6): Camelot, Dwarven Hold, Lost City, Necropolis, Sunken City, Village

**place** (44): Abyss, Asgard, Atlantis, Bifrost, Cave, Celestial Realm, Cloud Fountain, Crystal Cavern, Dragon Nest, Druid Circle, Dungeon, Event Horizon, Fairy Ring, Fountain of Youth, Garden of Eden, Haunted Ruins, Hot Spring, Ley Line, Ley Lines, Mana Garden, Moon Pool, Multiverse, Nebula, Nexus, Paradise, Paradise Lost, Rainbow, Sacred Ground, Sanctuary, Scrying Pool, Starbloom, Supermassive Black Hole, Tree of Life, Underworld, Universe, Void, Void Grove, Void Nexus, Wellspring of Life, World, World Tree, Wormhole, Wormhole Network, Yggdrasil

**land** (30): Black Ice, Bog, Clay, Cloud, Crater, Crystal Cluster, Desert, Enchanted Forest, Floating Island, Frozen Bog, Geyser, Glacier, Gold, Haunted Marsh, Ice, Lava, Magma, Meltwater Lake, Mist, Moraine, Mud, Oasis, Permafrost, Star Metal, Steam, Swamp, Tar Pit, Tar Pits, Volcanic Ash, Volcano
