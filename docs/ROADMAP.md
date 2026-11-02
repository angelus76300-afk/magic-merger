# Where the game stands, and what comes next

Updated on 2026-11-02, after V2: challenges, placeable artifacts, the First Discovery moment, and automated checks.

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

## Decisions taken

1. **Cosmic spells may ruin the island.** Consequences are part of the fun; the land regrows on its own (ash turns to soil, grass and forests come back) and Reset is one tap away. Revisit if it feels punishing in play.
2. **Haiku writes spells up to grand, Opus the legendary and cosmic ones** (see DESIGN.md for the measurement).

## What to watch

1. **Phones.** Measured in a headless browser, not on a real device. If a mid-range phone stutters, the first levers are the small world size and lower pixel density.
2. **Sounds** were checked for errors, not listened to.
3. **Challenge balance with real spells.** The checks use simple hand-written solutions; Claude's spells may be stronger or weaker. Wildfire still loses on its own only 7 times in 8.

## Next steps

1. **More challenges**, now that the format is cheap: "Wake the sleeping village", "Bring back the dead", "Night falls" (use the verbs nobody picks).
2. **A shared feed** of first discoveries, since First Discovery is already global.
3. **Artifact interactions**: a placed Phoenix reviving the dead, a Volcano artifact that can be calmed. The rules exist; the prompt could ask for them more often.
