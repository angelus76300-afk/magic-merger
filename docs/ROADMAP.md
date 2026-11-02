# Where the game stands, and what comes next

Updated on 2026-11-02, after the World was rebuilt as a voxel island and spells became programs.

## Done since the first review

1. **Spells are programs.** Claude writes each spell as code against a World API, and can add new materials and creatures with their own rules. A World Tree now grows an actual giant tree; a Great Flood is a wall of water that drowns the island; a Big Bang darkens everything, swallows the camera in a point of light and scorches the world.
2. **A floating voxel island** replaces the side view: layered cut sides, waterfalls off the edges, orbit and zoom from a doorstep to the whole island in the sky. It runs on phones (about 60 draw calls on a medium island).
3. **A richer land**: water, lava, oil, acid, mud, ice and snow with temperature; fire that spreads with the wind; powder that explodes; houses that burn and collapse and that villagers rebuild; forests that grow back.
4. **Power tiers chosen at merge time** instead of chain depth.
5. **Cost under control**: small spells cost $0.002, big ones $0.08, every call is recorded, and a monthly cap stops Claude calls past `BUDGET_USD`.

## What to watch

1. **Phones.** Measured in a headless browser, not on a real device. If a mid-range phone stutters, the first levers are the small world size and lower pixel density.
2. **Spells that scorch the whole world.** Cosmic spells tend to leave the island ruined (Big Bang turns it to ash and embers). That is fair for a cosmic spell, but the player needs a way back: the Reset button for now, maybe a "Rewind" later.
3. **Sounds** were checked for errors, not listened to.

## Next steps, in order

### 1. Give the World a reason: small scenarios

A scenario is a seeded island with one problem and a measurable win condition: "The forest is on fire, save the village" (no fire left, at least 5 villagers alive), "Cross the river", "The lava flow is coming", "Bring back the dead". The engine already measures everything a win condition needs. This turns discovery into a hunt for the right spell.

### 2. Make artifacts placeable

Spells are cast, artifacts are placed: Golem places a golem, Phoenix a phoenix that revives once, Volcano a vent that leaks lava. The program format already supports it: an artifact would get a program too, with a `place(w)` instead of `cast(w)`.

### 3. A "First discovery" moment

The card opens with a little ceremony, and the first cast of a brand new spell gets the camera's attention.

### 4. Quality net

Run the Spell Lab on `lab/spells` in CI and fail when a program throws or a tick gets slow.

## Open questions for you

1. Is the World meant to stay a toy box, or is it where the game happens? Scenarios assume the second.
2. Should a cosmic spell be allowed to ruin the island for good, or should the island heal over a few minutes?
