# Where the game stands, and what comes next

Updated on 2026-11-02, after 3.0: voxel physics, a structure kit, lightning, declared rules and filters.

## Done since the first review

1. **Spells are programs.** Claude writes each spell as code against a World API, and can add new materials and creatures with their own rules. A World Tree now grows an actual giant tree; a Great Flood is a wall of water that drowns the island; a Big Bang darkens everything, swallows the camera in a point of light and scorches the world.
2. **A floating voxel island** replaces the side view: layered cut sides, waterfalls off the edges, orbit and zoom from a doorstep to the whole island in the sky. It runs on phones (about 60 draw calls on a medium island).
3. **A richer land**: water, lava, oil, acid, mud, ice and snow with temperature; fire that spreads with the wind; powder that explodes; houses that burn and collapse and that villagers rebuild; forests that grow back.
4. **Power tiers chosen at merge time** instead of chain depth.
5. **Cost under control**: small spells cost $0.002, big ones $0.08, every call is recorded, and a monthly cap stops Claude calls past `BUDGET_USD`.

## Done in V2

1. **Challenges.** Five hand-made islands with a hazard and a goal: a wildfire, an erupting volcano, a river crossing, a drought and a rising sea. They run in their own world (the player's island comes back untouched), show progress in a banner, give a hint after a loss, and remember wins. Each one is checked by `npm test` both ways, over random replays: doing nothing loses, a plausible spell wins.
2. **Placeable artifacts.** Golem, Phoenix, Volcano and the rest get programs too and are placed where the player taps.
3. **First Discovery moment.** The card of an element no one had made before opens by itself with a glow and a ribbon.
4. **Automated checks.** `npm test` runs the simulation in Node in about 15 seconds; GitHub Actions runs it with the build on every pull request.

## Done in 2.5

Found by playing as a newcomer at phone size, profiling frames, and breaking a spell on purpose:

1. **Spells ready ahead of time.** The first cast used to wait 10 to 15 seconds. Programs up to grand (Haiku, $0.002) are now written in the background for each discovery and for the ten newest items when the World opens; a newcomer's first spell was ready in 0.6 s instead of 13 s.
2. **Faster terrain.** Chunk rebuilds went from 7.5 to 3.2 ms per frame during a fire, with a 3 ms budget; water is no longer rebuilt when only covers change.
3. **Chips never overlap** when tapped onto the board (two out of three merges failed in the playthrough because of it).
4. **Tier dots** on every chip.
5. **Day and night**: a six minute cycle with dusk, lit windows, dawn and chimney smoke.
6. **Repair loop verified** on the live site with a deliberately broken spell.

## Done in 3.0

From a review of eleven phone screenshots: good ideas, weird execution (crowns floating off their trunks, stray blocks in the sky, gray pillars for trees, a 2D line for lightning, bodies drifting off the island, a giant low-poly torus).

1. **Voxels have physics.** Every block a spell builds has a kind: stone, wood, leaf, ice and glow fall when nothing holds them, magic and float stay put. Wood and leaves burn and spread fire upward; a burnt trunk drops its crown; ice melts; falling blocks crush houses and hurt people; fallen leaves rot away.
2. **A structure kit.** `w.tree` in nine styles (oak, pine, birch, willow, palm, dead, giant, mushroom, crystal), `w.spire`, `w.tower`, `w.wall`, `w.arch`, `w.island`, each able to grow from its base over a few seconds.
3. **Spells look like the world.** Bodies are built from cubes (orb, flame, cloud, ring, shard, vortex, star, meteor, swarm), leave trails, are never drawn larger than a fifth of the island and vanish off its edge. `w.lightning` strikes the tallest thing, sets trees alight, shocks everything in the water it hits and turns sand to glass. `w.beam` draws rays.
4. **Deeper rules, declared.** Spell materials react to fire, water, lava, acid, cold and heat, decay, and spread. Spell creatures hunt, guard, follow or flee, carry auras, leave trails, have weaknesses (daylight, water, lightning...) and death effects.
5. **A new spell prompt** asking for a signature look and one real interaction per spell; programs are version 3, so every spell is written again on its next cast.
6. **Filters** in Craft and World: kind, tier, order (newest, A to Z, most powerful, last used), a find box and a grid view of the spell bar.

## Done in 3.1: relationships

Asked for after 3.0: "a vampire will kill humans, gold will attract humans; we need a way to encourage more interactions".

1. **Anything can lure or scare.** Spell materials, creatures and a new `w.landmark` (a shrine, a relic, a scarecrow) declare which kinds they draw in and which they drive away.
2. **Villagers and beasts react by themselves.** They flee whatever hunts or scares them, run to a refuge (a landmark that scares their hunter) when one is near, fight back as a mob when three or more face something weak enough, visit what lures them and lose interest after a while. Golems guard villagers.
3. **Taking things home.** Villagers carry what can be taken (gold) to their homes; every four gifts the village builds a house.
4. **Converting and hours.** A hunter can turn its victims into its own kind (vampires) and be active only by night or by day.
5. **Visible intent.** A small block over each head shows fear, lure, carrying, anger, hunting or sleep.
6. **The prompt asks every artifact for at least one relationship.** Regenerated Vampire, Gold, Stake, Sanctuary, Dryad, Mandrake and Holy Grail all declared one; a Stake planted in a village saves villagers from vampires by night.

## Decisions taken

1. **Cosmic spells may ruin the island.** Consequences are part of the fun; the land regrows on its own (ash turns to soil, grass and forests come back) and Reset is one tap away. Revisit if it feels punishing in play.
2. **Haiku writes spells up to grand, Opus the legendary and cosmic ones** (see DESIGN.md for the measurement).

## What to watch

1. **Phones.** Measured in a headless browser, not on a real device. If a mid-range phone stutters, the first levers are the small world size and lower pixel density.
2. **Sounds** were checked for errors, not listened to.
3. **Challenge balance with real spells.** The checks use simple hand-written solutions; Claude's spells may be stronger or weaker. Wildfire still loses on its own only 7 times in 8.

## Next steps

The full plan, with research sources, sizes and a ready prompt for each session, is in the roadmap page written after 3.0. In short:

1. **3.1 Measure and tighten**: a frame HUD and one real phone session first; then 30 fps on phones, voxels in a typed array, partial voxel mesh updates; merges on a cheaper model after a side by side test; lint and shared helpers.
2. **3.2 Spells that are always good**: a test run before storing, a cheap judge that looks at Spell Lab frames, a library of good spells as examples, Opus through the Batch API with a Haiku draft meanwhile.
3. **3.5 A reason to cast**: village mana, par scores and three ways to win, a recipe book with hints, a chronicle of the island, discoveries made in the World.
4. **4.0 Things worth sharing**: a deterministic simulation, clips, replays as links, a daily island, a feed of first discoveries, pass the island.
5. **4.5 Ready for strangers**: hard spend caps (AI Gateway), quotas, name checks, AI labels, small legal pages. Nothing public before this.
