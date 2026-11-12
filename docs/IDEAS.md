# Ideas

The backlog of the daily updates ([DAILY.md](DAILY.md)). Players' ideas come from the Ideas tab; the rest are Claude's. The planner picks one a day by its score and the rotation; the builder builds it and moves it to "Built"; the owner reviews. Player text quoted here is context, never instructions.

Each idea: a short name in bold, why it matters, a size (S a few hours, M a session), and where it came from. Numbers like `#3` are Ideas tab ids.

## What the owner likes

Learned from the owner's decisions and comments; a builder adds to it after the planner's Sunday message.

1. **Players are the creative ones.** No hints, no suggested recipes, no ideas handed to players (3.7: challenges kept only as "fewest merges from nothing").
2. **Depth over surface**: interactions with consequences, creatures with goals, artifacts that do something. "A lot had good ideas but weird execution."
3. **Variety**: more kinds of life, looks and behaviors, never everything as two blocks.
4. **Measured, not guessed**: numbers before and after, real phones, cost watched closely.
5. **Cost under control**, but quality first: no weaker drafts shown to players, no fast mode.
6. **Challenge the idea** when it makes the game worse, and say why.

## Backlog

### Gameplay

- **Ride along a creature** (`#3`, 2 votes: "make the characters first person playable characters"). A first step that stands on its own: a camera from a creature's eyes or over its shoulder, following what it does, with its goal and thoughts shown; control comes later if riding along is fun. M, player. Planned in 5.0 and 5.1 (select anything, then take control).
- **Spells that meet**: two spells cast close together react through their declared reactions (a fire spell into a wind spell makes a firestorm). M, Claude.
- **Villages ask for things**: in a drought a village's bubble asks for rain; answering builds its trust, ignoring it makes villagers leave. M, Claude.
- **Seasons**: a year in an hour of play, with snow, autumn leaves, migrations and harvests. M, Claude.
- **Time controls**: pause, 2x and 4x. S, Claude.
- **The card says what it did last time** (Claude, 4.5.1 audit). Under a spell's description, one plain line measured from its last cast on your island: "Last time: put out 40 burning cells, healed 3 villagers" or "Last time: burned 12 houses". What the player feels: the card stops being a promise and becomes a memory, and a spell that lies (Frost Nova burns the village it freezes) shows it on its own card, which turns a bug into a story and a reason to vote. What it adds: the audit found 6 of 25 live items doing something other than their summary while passing their test run; this puts the truth where players look, and the counts are already in the test run's diff of the island. Cost: no API call; a small counter per cast in the World frame and one line on the card. S to M, Claude.
- **Wins checked by their pairs** (Claude, 4.5.1 audit). A challenge win would carry the distinct pairs merged, and the Worker would check them against the recipe graph (each pair a real recipe, the spell at the end of the chain). What it adds: a count that can be trusted, so a better win could lower par for everyone again, as it did before 4.5.1 (a claim the graph cannot check no longer sets par). What the player feels: beating par moves it for friends, a small race. Cost: no API call; a list of pairs in the win request and a graph walk on the Worker. S, Claude.
- **Rewind ten seconds** after a cosmic mistake, from snapshots the simulation already saves. M, Claude.
- **Self-merges that climb once, then loop** (the owner, 4 November: "a lot you can do by merging two of the same things, flock to armada, those are not as interesting"). Rule 5 of the merge prompt makes X + X a cheap ladder: every rung is a new item, a new program written (money) and a discovery, with little new in it. Proposal: X + X gives the bigger form once; an input that is already a plural, a crowd, a mass or legendary and up gives itself back (like the prompt's own Inferno + Fire = Inferno), and legendary or cosmic X + X loops in code without a call. Cross merges (A + B) are untouched, so the interesting space is not cut. Measure before: from D1, the share of discoveries made by self-merges and how deep their chains go; after: forty self pairs and forty cross pairs through the merge model, the cross answers unchanged. Recipes already frozen stay. S, owner and Claude.

- **Villagers learn what you cast** (the designer's three, week of 5 November; lens: invert a rule). A spell cast on the same island many times is learned by its village: a villager starts casting a weak copy of it in its own work (rain on the fields in a drought, a small fire against a monster), drawn from the program already stored, at a fraction of its strength. What the player feels: the island takes on their style; their magic becomes a culture they can see. What it adds to the loop: today a cast is used once and forgotten; here casting with variety pays later, so merging new spells has a second reward beyond the discovery. What it costs: M, one session in the simulation (a counter per spell per village and a villager ability that replays a program scaled down); no paid call, no new program written. What similar games do: Black and White's villagers copy the god's miracles and worship by what they saw; Dwarf Fortress lets culture grow out of events; Populous ties a tribe's powers to its belief. Claude.
- **Tiers that make sense from strong parents**: two legendary items can merge into a cantrip (Miracle and the Philosopher's Stone make the Elixir of Life, a cantrip; Gold from the Philosopher's Stone too), because 3.7 ties the tier to depth. A floor: the result is at most one tier below its weaker parent, unless the merge is a joke worth keeping. S, Claude.

### Quality of life

Most of these are planned together in 5.3.

- **No dead tap on a cast** (the designer's three, week of 5 November; lens: juice; seen in the night play test on staging, where Fire answered "still being made" for over a minute and nothing happened on the island). A cast always answers within 100 ms: a rune circle and gathering light at the spot, the spell's color and tier, held until the program is ready, then the spell fires from there; if it fails, the light fades with a short line saying why. What the player feels: every tap is heard, waiting reads as charging, not as broken. What it adds to the loop: casting is the core verb of the World; a silent tap breaks the merge, cast, watch loop at its best moment. What it costs: S, the view and the spell bar, no paid call. What similar games do: Hearthstone and most online card games play an anticipation animation while the server answers; Noita and Magicka answer every input at once with particles. Claude.
- **The judge says it in players' words** (week of 7 November, after reasons by form). Today the judge that watches a cast answers with one of the five first reasons, while players now pick from twenty one by form (a creature that barely moved, a building floating). Give the judge the same list for the item's form, so a trusted judge's rewrite gets the same precise line a player's vote would, and its calibration compares like with like. What the player feels: items that nobody voted on yet arrive already fixed in the direction players would have asked. What it adds: the judge and the votes speak one language, so the planner can read both in one tally. What it costs: S, a red change (the judge's prompt and enum in `worker/prompts.ts`), no new call and the same model. Claude.
- **Search the inventory** by name and emoji, most recent first. S, Claude.
- **Long press a chip** for its recipe, description and first discoverer. S, Claude.
- **Tidy the board** in one tap, by tier or by type. S, Claude.
- **Follow a creature** with the camera, and a button to reset the view. S, Claude.
- **Preview a spell's reach** as a faint circle before the tap that casts it. S, Claude.
- **Haptics** on merges, casts and discoveries where the phone supports it. S, Claude.
- **A long press on a World tool shows its name** (the designer's idea, 2026-11-07; lens: feedback). On a phone the World's tools are a rail of pixel icons with no labels, so a newcomer cannot tell the star (Challenges) from the book (Chronicle). A long press shows the name for a second beside the icon. What the player feels: the icons are learnt in one session, without labels taking the island's room on every visit. What it costs: S, about 20 lines in the host, no paid call. Claude.
- **"New since you left" on the island** (the designer's idea, 2026-11-08; lens: the return visit). Several updates now merge in one evening, and a player back the next day sees the changelog only in the ? menu. On the first visit after an update, the item or creature the update changed glows once where it stands on the island, with its changelog line under it for three seconds. What the player feels: the island changed while they were away, and they see where. What it adds to the loop: a reason to cast the changed thing first. What it costs: S to M, the changelog entry would name an item, no paid call. Claude.
- **Items that sort themselves into shelves by kind** (the designer's idea, 2026-11-07; lens: the shelf in a crafting game). With rune tiles, spells and artifacts already read apart at a glance; past 60 items the inventory could show them as two shelves with a small rune header each, instead of one long wrap. What the player feels: a collection, not a pile. What it costs: S, the inventory list only. Claude.

### Visual

- **Footprints and trails** in snow, sand and mud that fade. S, Claude.
- **Cloud shadows** drifting over the island, and sky colors that follow the hour. S, Claude.
- **A rune circle** on the ground where a spell is cast, its color by tier. S, Claude.
- **Spell cards with a picture**: a frame of the spell's own test run as its thumbnail. M, Claude.
- **Lanterns at night** in villages, and glowing windows. S, Claude.
- **Puddles and wet ground after rain**: when a spell of rain eases out, the ground under it stays darker and shinier for a minute and small puddles shine on flat cells, then dry. The player feels the weather happened to the island, not just in front of the camera, and a burnt patch next to a wet one tells a story. View only, like the weather (no saving, no simulation change); one darkening term in the terrain shader. S, Claude.

- **Wonders written by Claude drawn like the built-in ones**: today a daily wonder can only place whole-cell voxels, so it comes out as towers of cubes (`docs/visual-checks/4.4.5-c/program-wonders.jpg`) while the seventeen built-in wonders are box models with fine parts (`src/sim/voxel/wonders.ts`). Give the wonder program a look of up to about 60 boxes of any size and the same helpers the built-ins use (lump, tree, column, arch, ring, crystal cluster, a part that glows at night), drawn by the same renderer for one or two draw calls and no voxel budget; keep voxels for what must burn, fall or be climbed. In the prompt, one built-in wonder as an example and "a clear silhouette, varied proportions, few fine parts" instead of "solid, dense shapes". No new paid call. S, Claude. Planned in 4.7.

- **Morning mist in the valleys** (Claude, the mist from afar, 7 November). At dawn a low, thin mist sits in the island's low ground and over the lakes and burns off by mid morning; a fog spell or a fog day thickens it. What the player feels: the island wakes up, and the shape of the land reads from afar as pale valleys between dark ridges, which the flat distance mist never gave. What it adds: a reason to look at the island at a time of day, and the height map made visible without labels. Cost: S to M, Claude: a few flat translucent sheets at water and valley height, faded by the hour; no paid call, no save change. The fog work showed the distance mist must stay off the land, so this would be the one place mist sits on it on purpose.

### Living world

- **A hall of your discoveries on the island** (the designer's three, week of 5 November; lens: what happens when the player leaves). Each First Discovery a player made stands on their island as a small statue or banner in a hall the village builds with the existing building maker, newest at the door; a tap shows the recipe's day and the card. What the player feels: pride and a sense of history; the island tells their story when they come back. What it adds to the loop: the Craft tab and the World are two halves that barely meet today; this turns discoveries into something seen in the World, and gives a reason to go back to Craft to fill the hall. What it costs: M, one session (a building kind from the 4.4.5 part B builder, a placement rule, the card on tap); no paid call, no players' data beyond what the island already holds. What similar games do: Animal Crossing's museum fills with what the player found; Minecraft players build trophy rooms by hand; Spore shows each creation in a gallery of the player's own. Claude.
- **A calling handed down** (the builder of 4.6 part B; lens: what happens over time). A person a merge made (a Blacksmith, a Necromancer) takes an apprentice: a child born in its household grows up with its calling, so the forge or the graveyard outlives the one who started it, and a village becomes known for it ("Ashby, the smiths' village"). What the player feels: the island remembers what they made long after it dies. What it adds to the loop: a reason to place people where a village lacks something, and a village whose character the player shaped. What it costs: S, half a session (the calling bits exist; the birth in lifeCycle copies them from the household), no paid call, no players' data. What similar games do: Dwarf Fortress dwarves teach skills, RimWorld colonists pass on traits through the family tree. Claude.
- **News travels by road** (the game designer, for 4.9 roads; lens: consequences beyond the cast). A traveller arriving on a road carries its village's memories: which kind hurt them and which magic helped. A village joined to one a dragon burned fears the dragon before it ever sees it, and its guards meet it at the edge. What the player feels: a spell or a monster matters past the spot it touched, and a burnt bridge cuts a village off from news as well as trade. What it adds: roads change minds, not only speed. What it costs: S, no paid call; it reuses `remember`, and memories stay capped at four. How to measure it: the share of a linked village's villagers who remember a kind they never met, 0 with no road, over 30% after two trips. Claude.
- **A creature's day**: villagers sleep in houses, wake, eat together, gather at a fire at dusk. M, Claude.
- **Trade caravans** between villages, which monsters can rob. M, Claude. Planned in 4.9.
- **Say why a villager does something else than it wants** (lens 1, follow one creature, done in part: on 7 November my taps on a mock island turned the camera more often than they picked a villager, so I read one panel, not ten minutes). The panel read "Wants to gather berries" above "Doing planting flowers by the houses", with nothing saying why. One short line would close the gap: "no berries within reach, so it tends the flowers". What the player feels: the village thinks, and a spell that grows berries is now an answer to something they saw. What it adds: the inspect panel becomes a hint to the next spell to cast, which is the merge, cast, watch loop. What it costs: S, the simulation already knows why it falls back; no paid call. Also worth a look: picking a villager by tap at phone size missed often in this run. Claude.
- **Population graphs**: how many of each kind lived over the last hour, in the inspect panel. S, Claude.
- **Dreams**: at night, bubbles over sleeping villagers show the spells they saw that day. S, Claude.

### Content

- **A new challenge each week**, verified solvable like the others before it appears. M, Claude.
- **Night events**: a full moon that wakes the undead, a meteor shower to watch. S, Claude.

### Audio

- **A sound per tier on every merge**, until 4.5 brings the rest. S, Claude.
- **A short sting on a First Discovery** that no other moment uses. S, Claude.

### Interactions

The long tail of things that do not behave as their name says, found mostly through the audit lens of DAILY.md. The systemic fixes are 4.6 (every item made as what it is) and 4.7 (wards with a breaking point, objects picked up, box looks).

- **Audit the most cast items first**: the twenty most cast live items, each cast on a medium island and compared with its name, description and intents; every mismatch becomes a line here, then one rewrite at a time. S, Claude.
- **Teleports land somewhere sensible**: the Wormhole sends creatures to the mirror point of the island, which can be the sea or a cliff; land on dry ground near the other end. S, Claude.
- **A settlement that grows into its land**: a village made by w.village starts as a hamlet of the size asked, but its fields, street and buildings come from where it stands; let a placed village pick its trade from what is round it (a fishing village on a shore raises a fisher hut and docks first, a mining camp by rock a smithy) and say so in its first story line. What the player feels: the village they made belongs where they put it, and two villages they make are never alike. What it adds: the place decides, as for the island's own villages, at no cost. Cost: no paid call, a few hours in makers.ts and buildings.ts. Found while building 4.6 part A. S, Claude.
- **Heirlooms** (lens 1, follow one creature, while building 4.7's objects in hand: a staff passed from a guard to a goblin and back through three hands in ten minutes). An object held by three different villagers takes the name of its first holder ("Mira's Staff") and keeps a line of who carried it, shown when it is tapped. What the player feels: the island has a history with the item they made, and a reason to follow one thing for a while. What it adds: the merge, cast, watch loop gets a long tail; an old cast keeps telling stories. What it costs: S, deeds and memories already exist; no paid call; one more field saved with the artifact. Claude.
- **Wards that throw back** (lens 4, invert a rule, while building 4.7's breaking point: a ward stops a meteor; what if it returned it?). A ward whose spell says mirror, reflect or rebound (an `against` word, `"reflect"`) sends a stopped body back along the way it came, at half its speed, with its own `land` hook, instead of bursting it on the glass. What the player feels: a duel between two of their own spells, the Mirror Shield answering the Meteor Storm in the air, the most Sensation a cast can give. What it adds: a reason to merge toward a second protection item, and a pair of spells that are better together. What it costs: S, the stop point and the body's velocity are already known in `hitsWard`; no paid call; a rebounding body is still capped by the 400 bodies rule. Degenerate case: two mirror wards bouncing one meteor forever; guard: a body rebounds once. Claude.
- **A place that says how far it spreads** (found by the playtest of 4.7's sizes, lens 13, audit one item): a legendary place now keeps its test run's reach, 34 cells, so on a giant island of 384 a "Great Forest of the Ages" covers a sixth of it, where a spell of the same tier covers all of it. Let the merge say when a place is meant to span its island (a forest, a sea, a sky realm), and test it as such: its reach a share of the island, like land. What the player feels: their legendary place matters on any island. What it adds: one size rule for things, with a named exception the test holds. Cost: S, a field on the form and the form check; no paid call beyond the merge it already makes. Claude.
- **Glass that stays** (the game designer, while designing 4.7's shields): a shattered shield's shards land as a ring of glittering voxels that melt away over 30 seconds. What the player feels: the island remembers what happened there. What it adds: a second look at the scene after the show, and a reason to rebuild the shield on the same spot. Cost: S, no paid call; the shards become magic voxels with a decay. Claude.
- **See the size before it lands** (lens 5, borrow from a genre: city builders show a building's footprint under the cursor before it is placed; found while building 4.7's sizes held at runtime). While an item is selected, a press and hold on the island shows a faint ring of its reach, w.r, with one villager's silhouette at its edge for scale: a staff's ring is a few cells on any island, a storm's a share of it. What the player feels: they choose where the Village or the Volcano goes, instead of finding out after; a small object never surprises them by being small. What it adds: the sizes of 4.7 become something the player can read, and placing turns into a small decision. What it costs: S, one session in the view and `castReach` (already shared by the runtime); no paid call. Risk: one more gesture on a phone where a tap already casts; a hold of 300 ms keeps it apart. Claude.
- **What a creature carries shows in its hand** and changes what it does (a villager with a torch lights the way, one with a sword fights back). S, Claude.
- **What a creature carries shows in its hand** and changes what it does (a villager with a torch lights the way, one with a sword fights back). S, Claude. Built for objects on 2026-11-07 in 4.7 item 3: a held object's own model shows in the hand and its effects come from there.
- **When the test and the judge disagree, players decide**: the 2 November refresh rejected four rewrites that passed their test run (Light, Crystal Cavern, Divine Intervention, Tree of Life) because the judge scored them a point or two lower, so the old programs that fail their own test stay live. The judge only advises and has 69 votes behind it. Serve such a rewrite to half the players who cast the item for a few days, with the vote bar, and keep whichever version players vote up. What the player feels: the spell they complained about gets better without anyone asking. What it adds: votes settle what an uncalibrated judge cannot. Cost: no paid call (the programs exist), one session; risk: two versions of one item in play for a few days. Found through lens 9, the numbers (the live `refresh_verdicts` and `programs` tables, read on 5 November). S, Claude.

### Performance

- **A spell's weight on a phone, measured in its test run** (Claude, 7 November; lens 10, an attacker). A stranger with the link can name an item "Ten Thousand Fireflies" and get a program that spawns hundreds of creatures or the 20000 voxel cap, and every frame after pays for it, on their island and on any island the spell is cast again. The test run already plays the spell for minutes in Node; it could count what it adds to a frame (creature parts, voxels, bodies, an estimate of triangles from the view's own counts) and fail a spell that would push a large island past the phone budget, with the numbers in the reason so the rewrite knows what to cut. What the player feels: nothing, which is the point; the island they love does not turn into a slideshow after one cast. What it adds: the frame budget becomes a rule spells follow, not a hope. Cost: S to M, one session; no paid call (a failed test already triggers the existing rewrite, inside its budget). Similar games: Roblox and Dreams both show creators a performance meter and refuse what is far over. Claude.
- **The simulation in a Web Worker** (Claude, 7 November). After the 60 a second pacing, the frame with a tick is the heavy one: on the owner's phone about 8.7 ms of tick plus 7.5 ms of drawing, at the edge of a 16.7 ms frame, and at p95 well over it. Moving the tick to a worker thread takes that off the frame entirely: the page would only draw, from a copy of the cells and creatures sent each tick. What the player feels: big islands at 60 on mid range phones, and no hitch when a big spell lands. Cost: L, two or three sessions (the view reads the world directly today; spells, sound and the camera need messages; a save from the worker). No running cost. Worth measuring first how often the phone falls back to 30 (the HUD could report the pacer's state with its numbers). Claude.

### Security

- **Shields that stop meteors and projectiles** (`#2`: "I had a shield from immortality that let a meteor pass through"). A bug players hit; planned in 4.4.5. S, player. Built on 2026-11-07 in 4.7 (shields with a breaking point): bodies stop at the dome, a ward cracks and breaks.
- **A CSP on the game page** itself, not only on the frames (review L3 found `/` has none). S, Claude.
- **Weekly dependency check**: `npm audit` and outdated packages, one upgrade at a time with the tests. S, Claude.
- **One route a week audited**: inputs, limits, who may call it, written as tests. S, Claude.
- **Secrets rotation day** on the calendar: the API key, the admin token, invite secrets of revoked people. S, Claude.

### Ready for strangers

- **The game in French** (planned in 5.3), with English kept: every string through one table, the language from the browser. M, Claude.
- **A two minute first session**: merge, discover, cast, see what it did, then let go. M, Claude.
- **A moderation queue** for reported names, with one tap to rename or hide. S, Claude.
- **A status line** when Claude is slow or the month's budget is spent, honest and friendly. S, Claude.
- **The first twenty merges, measured**: replay the first twenty merges a newcomer tends to try from the eight forces (a force with itself, then with its neighbours) against a copy of the recipe book, and count how many give a new item, a known one or a loop, and how many merges until the first castable spell. Why: with no hints allowed (pillar 1), the recipe book's early answers are the only tutorial, and three loops in a row read as "I did it wrong" to a stranger (flow: a frequent failure must cost almost nothing). It gives 5.4 a number and a target before strangers arrive, say 15 new items in 20 merges and a spell within 10. S, read only, no Claude call. Claude, from the `game-design` lenses.

### Accessibility

Planned in 5.3.

- **Tiers by shape as well as color**, for color blind players. S, Claude.
- **A switch for flashes and shakes**, apart from the system's reduced motion. S, Claude.
- **Text that scales** with the phone's font size without breaking the board. S, Claude.
- **The page fits a 320 px phone** (found by: ai, the review of #102, 2026-11-10). At 320 px wide the ? button in the top bar pushes the page to 330 px, so the whole screen slides sideways under the thumb. Small phones (an iPhone SE in zoomed mode, older Androids) are 320 wide. Let the top bar shrink the title first. What the player feels: a screen that stays put. What it costs: S, CSS only, and 320 by 640 in a ui-frames run. Claude.

### Non invasive monetization

- **"This month's magic is 40% funded"**: a quiet bar and a tip link, the cost shown honestly, nothing locked. S, Claude.
- **Supporter looks**: island palettes, chip frames, a badge on First Discoveries. Cosmetic only, never more spells or power. M, Claude.
- **Bring your own API key** for players who want more big spells than the shared budget allows. M, Claude.

### Wild

- **Laws of nature as artifacts**: place "Eternal Winter" and the island's physics change until it is removed. M, Claude.
- **The island has a mood** that follows how it is treated, and nature answers: lush after care, thorns after cruelty. M, Claude.
- **Creatures that evolve**: survivors pass traits to their young; burn the forest often enough and salamanders appear. M, Claude.

## Built

Newest first, one line each: the date, the idea, its category (the planner reads it to find today's place in the rotation), the lens the builder used, and the pull request.

- 2026-11-07: **Objects that are picked up and used** (ROADMAP 4.7 item 3; and "What a creature carries shows in its hand" for objects): villagers and thieves take the objects players cast, carry them in hand with their own look, and use them from there; a potion is drunk once, at death the object falls, a thief steals it. Interactions, the roadmap. Lens 1, follow one creature.
- 2026-11-07: **Shields hold** (the owner's report: "all of them let a meteor through"): what another spell does inside a ward is held (land, houses, fields, trees, voxels, blows on people); a ward never breaks against its own tier; a stronger tier breaks it in slow motion and it spends what it had on the blow, by the owner's scale of tier gaps, and at a gap of 2 its people live; cracks heal; the same spell mends its ward. Interactions, the owner's report. Lens 13, audit one item (the live protection and meteor programs). PR #83.
- 2026-11-07: **Sizes held at runtime** (ROADMAP 4.7 item 2) with the follow-ups of the day's reviews: an item that is not a spell or land has the reach of its test run's 112 cell island on every island; a spell grows a creature 1.6 times at most, a dragon 3.2, and nothing is drawn past 3.2 villagers; a body stopped on a ward runs its `end` hook; a wonder drawn only in fine models passes its test. Interactions, the roadmap. Lens 5, borrow from a genre. PR #78.
- 2026-11-07: **Rune tiles, daylight pages and full filter labels** (the planner's next interface step after #67): items are tiles with a kind's rune on a coloured tab, the four reading pages sit on the island's sky with sandstone panels, Craft's filters show "Any tier" and "Oldest" in full (a #67 regression, found by: ai). Visual. Lens: the player's two places, a night workbench and the island by day. PR #77.
- 2026-11-07: **Lantern night, a look of its own** (the owner: "Even the interface still looks vibecoded"): blocks that press, one lantern gold, a pixel face for names and a hyperlegible face for text, tabs under the thumb, every control 44 px, the vote in the drawer. Visual, the owner's request. Lens: the island's own material. PR #67.
- 2026-11-07: **Shields that stop meteors and projectiles** (`#2`), built as 4.7 item 1 with the interaction table of item 5: bodies of other spells stop at a ward's dome and burst on the glass, a ward has health by tier, cracks as it wears and breaks; a spell of the same tier never breaks it alone. Interactions, a player's idea. Lens 4, invert a rule. PR #64.
- 2026-11-07: **The World at 60 frames a second where the phone keeps up** (the planner's prompt, from the owner's HUD on a foldable: a flat 33.3 ms, a 30 a second cap on every touch screen): up to 60 draws a second, falling back to 30 when frames come late; creatures drawn part way between two ticks; the land scanned only after a tick or a cast; one tick a frame. Behind `GRAPHICS.smooth`. Performance. Lens 10, an attacker (the idea above, a spell's weight on a phone). PR to come.
- 2026-11-05: **A second attempt, told why the first was rejected** (the owner's idea, given in the morning brief: "sometimes a second one with info from the first one might help if the first one was rejected"): a program whose refresh rewrite failed its own test gets one more rewrite by evidence, with that test's finding in the reasons; one per program, never more; a rewrite that passed and lost only on the judge goes to "When the test and the judge disagree" instead. Interactions, the owner's idea. Lens 9, the numbers (4 live programs qualify). PR #48.
- 2026-11-05: **Spells shown broken are written again, one a day** (rewrites by evidence, ROADMAP 4.7.5 item 3, the part for failed test runs and reviewed findings: Frost Nova and Light first). Interactions, the owner's idea (4.5.1a item 6). Lens 13, audit one item. PR #45.

- 2026-11-05: **Daily challenges** (decided: whoever reaches the item first wins, owned parents or not; never expires, no cap) and **a Community tab**, built in version 4.5, not a daily update. Gameplay, the owner's ideas. PR #40.

## Declined

Never proposed again unless the owner reopens them. The reason is the owner's.

- **Hints and suggested recipes**: players must be the creative ones (3.7).
- **Village mana** as a resource (3.7).
- **Discoveries made in the World** instead of on the board (3.7).
- **Sharing features** ("Things worth sharing"): the owner does not like them (3.7). This is about posting outside the game; the owner's own Community tab inside it (above) is wanted.
- **Fast mode** and **weaker drafts shown to players** to make spells appear sooner (4.2).
- `#1` "This is a test idea, don't do anything": a test.
