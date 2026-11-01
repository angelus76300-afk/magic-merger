# Where the game stands, and what comes next

Written on 2026-11-01 after the first real session with Claude behind the game: 157 merges, 99 spell designs, every stored spell cast in the Spell Lab, and the deployed site played on a phone sized browser.

## What works

1. **The merge loop.** Answers are fast (about 3 s), cheap (a tenth of a cent) and coherent. The 36 pairs of primal forces gave Firestorm, Phoenix, Golem, Eclipse, Tidal Wave, Mana Crystal, Undead: names a player recognises at once. Chains stay grounded even at depth 9 (Black Hole, Shadowflame, Dawn). The stateless design from DESIGN.md holds.
2. **Fire, lava and water spells are a show.** Fireball, Inferno, Meteor, Volcanic Eruption and Armageddon set the world on fire, carve craters and kill villagers, and the fire keeps spreading on its own after the spell ends. This is where the falling sand engine pays off: the physics, not the spell, makes the drama.
3. **Opus judges size well.** Given a high cap, it still keeps Black Hole medium and Fog large, and saves huge for Armageddon and Meteor Storm.
4. **The cost is a non issue.** About 3 cents per new spell and a tenth of a cent per merge. $100 a month covers thousands of discoveries.

## What does not work yet

1. **The World has no purpose.** Crafting feeds the World, but the World feeds nothing back. Once a player has burned the village twice, there is no reason to cast again. This is the biggest gap, and it is a design gap, not a technical one.
2. **Depth is not power.** Depth counts the steps of the chain, so Fog and Dawn are depth 9 and allowed cataclysmic size, while Armageddon is depth 6. Opus covers for it at the top end, but at the bottom it hurts: a depth 1 Tidal Wave is capped at small, and on a 200 cell world it makes a puddle the size of four villagers.
3. **Status spells look weak next to physics spells.** Eclipse, Illusion, Shadowflame and Eternal Night only make villagers flee or sleep. That reads, but it is not a show. Opus has learned to spawn smoke as a visual filler: smoke is the most spawned material across the 34 spells.
4. **The verb palette is narrow in practice.** Over 34 spells: spawn 26 times, push and damage 14, fear 10. Shrink, enlarge, transform and erase were never chosen. Spells start to look alike after an hour.
5. **Artifacts are dead ends.** Phoenix, Golem, Kraken, Volcano and Mana Crystal can be merged and read, nothing more. Half of the discoveries do nothing in the World tab.

## Next steps, in order

### 1. Give the World a reason: small scenarios

A scenario is a hand made world with one problem and a measurable win condition:

1. "The forest is on fire. Save the village." Win: no fire left and at least 5 villagers alive.
2. "Cross the river." Win: a villager reaches the far bank (freeze the water, raise stone, levitate them).
3. "The lava flow is coming." Win: the lava stops before the houses.
4. "Wake the sleeping giant" or "Bring back the dead": use the verbs nobody picks.

This is what turns discovery into a hunt: the player is not merging at random any more, they are looking for a spell that does something. The engine already measures everything a win condition needs (the Spell Lab counts fire cells, water cells, deaths and statuses), so a scenario is mostly data: a terrain seed, a few hand placed cells and creatures, a goal check. It also gives a natural place for "objectives later" from DESIGN.md.

Start with three scenarios and a "solved" badge. If players come back for them, make more.

### 2. Make artifacts placeable

Spells are cast, artifacts are placed. Golem places a golem, Phoenix a phoenix that revives once, Volcano a vent that leaks lava, Mana Crystal a crystal that powers nearby spells, Kraken a beast in the nearest water. It doubles what the World can do with discoveries players already have. It needs a second kind of spec ("artifact spec": what it places and how it behaves), designed once by Opus like spells.

### 3. Replace depth with a power tier chosen at merge time

Ask the merge model for a tier (minor, major, legendary, mythic) alongside the name and emoji, frozen with the element like the emoji is. Keep a guard so a tier can rise by at most one step above its strongest input, which stops inflation. The tier sets the scale cap and shows on the card, which also tells the player something the depth number does not. It costs nothing: one more field in an answer Opus already gives.

### 4. Game feel

Done in this session: a flash and a short screen shake on release scaled by the spell's size, a buzz on phones for large spells, and procedural Web Audio sounds chosen by the spell's verbs (crackle, rumble, chime, ping, whoosh), with a mute button. Still to do:

1. A "First discovery" moment that is more than a toast: the card opens with a little ceremony.
2. Tune the sounds by ear on a real phone. They were checked for errors, not listened to.

### 5. Widen the palette, carefully

Two or three new materials with their own physics would multiply combinations more than new verbs: snow (powder that melts into water), mud (slow liquid that dries into dirt), and poison (a liquid that hurts creatures and kills grass). Each one needs a line in `shared/spell.ts` and a few rules in the grid, and the prompt picks them up automatically.

### 6. Quality and safety net

1. Run the Spell Lab on `lab/specs` in CI and fail when a spell suddenly does nothing or the world explodes. Engine changes are the most likely source of regressions now.
2. Add a handful of unit tests for the sanitizer and the merge name cleaning.
3. Give friends an access token and watch them play for ten minutes without explaining anything. Every point above is a guess until then.

## Open questions for you

1. Is the World meant to stay a toy box, or is it where the game happens? Scenarios assume the second.
2. One player or a small shared world? First Discovery is already global, so a feed of "who found what today" would be cheap and would make the global recipe book feel alive.
3. Should a few hand written "named" spells exist (a tutorial Fireball), or must everything come from merges?
