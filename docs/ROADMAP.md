# Where the game stands, and what comes next

Updated on 2026-11-02, during 3.3.

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

## Done in 3.2: measure and protect the budget

1. **No more bulk rewrites.** Programs of any version from 2 on are served as they are. Replaying every stored program on today's runtime (`scripts/replay-stored.ts`): v2 4/4, v3 10/11 (Earth has its own bug, a repair case), v4 117/117; v1 rows are not code and are written once on their next cast. Fourteen old programs in `lab/legacy` are cast by `npm test`. The admin card says which API version and model wrote a spell and has a "Rewrite this spell" button that names the cost first. Repairs go to Haiku whatever the tier.
2. **Cost.** Merges compared on 30 known pairs, graded blind (DESIGN.md, `docs/measurements/merge-models-2026-11.md`): Opus 55/60, Haiku 51, Sonnet 47 at low effort. Merges stay on Opus: they are frozen forever and cost $0.0013 each. Lone Opus and Sonnet spell calls no longer write the prompt cache (about $0.0035 a call); the Sonnet 5.5 cache read price is $0.10, not $0.20; `/api/spend` and the admin badge group the month by call and model. The tier was already in the merge answer; what remained were 47 separate tier calls ($0.09, six times the cost of all descriptions) for 92 elements from before tiers, now replaced by a one-off batched backfill endpoint and the depth as a fallback.
3. **Frame HUD** behind a long press on the title, with samples sent to `/api/perf`. No phone session yet: the numbers below are from Node and a headless browser.
4. **Performance**, measured with `scripts/prof-spell.ts` (Node) and `scripts/prof-view.mjs` (Spell Lab):
   - Frames are drawn only after a simulation tick or a camera move, 30 a second at most on touch screens: 60 draws a second become 30 on a 60 Hz screen, 120 become 30 on a 120 Hz screen.
   - Voxels in a fixed hash table of typed arrays with a reusable flood fill queue: in a 16,000 voxel forest fire the voxel code takes 15 to 20% less CPU and the garbage collector 20 to 30% less; worst tick 98 and 76 ms before, 55 and 65 ms after.
   - Decor instances updated one by one: a fire spreading through a forest spends 537 ms updating them instead of 1,256 (p95 5.3 ms instead of 14.2), and uploads only the changed range. A whole forest lit at once is 23% cheaper in total but its worst update is 18 ms instead of 13.
   - Darkness drawn by the materials (16 light points in the shader) instead of a full screen 2D canvas with a gradient per light; same look, checked side by side in the Spell Lab.
   - A grid for creatures and precomputed danger probes: with 312 creatures, creature update p50 1.07 to 0.91 ms, worst 25 to 18 ms. The pairwise scan was not the main cost.
5. **Hygiene.** Prettier and ESLint in CI; the simulation cannot import the view or three.js; `voxelkey.ts` and `colors.ts` replace copies in five files; physics and voxels no longer import each other; the day clock moved from the view into the simulation.

## Done in 3.3: spells that get better

DESIGN.md, "Spells that get better", has the rules; `docs/measurements/spell-quality-2026-11.md` the measurement.

1. **Every version is kept** (`programs` table): trial, live, retired or rejected, with where it came from. Nothing is deleted, so anything can come back.
2. **A test run before a program is stored.** The browser casts it on a practice island in a hidden sandboxed frame and compares it with the same island left alone: a crash, nothing visible, or an island wiped by a spell that is not cosmic gets it rewritten once by Haiku with the failing code. The Worker cannot do it (no `new Function` in Cloudflare Workers).
3. **Votes.** An anonymous id per browser, casts recorded with the version cast, a Good / Not good bar six seconds after a cast with one reason on a down vote, only from players who cast that version in the last 48 hours, one vote each. N = max(1, 10% of the 7-day average daily players), at most 25; N votes and 60% down rewrite the spell with the reasons in the prompt, at most once every three days and within `REWRITE_BUDGET_USD` a day; a rewrite voted worse than its parent rolls back.
4. **The library.** Programs voted up (N votes, 60% up) are shown to Haiku as two examples picked by shared words, kind and tier.
5. **Big spells drafted now, written later.** A new legendary or cosmic spell is drafted by Haiku at once and written by Opus through the Batch API at half price; a cron every ten minutes collects it, and it goes through the test run like any program. Big rewrites go through the batch too.
6. **The judge.** Haiku scores three Spell Lab frames with what changed; its threshold and its prompt are calibrated on votes, and it only advises until it agrees with ten or more votes 70% of the time. `scripts/judge-runner.mjs` and a nightly GitHub workflow give it its frames.
7. **View source** on the spell card, for everyone; the admin row lists every version with votes, test run and judge score.
8. **Checked**: `npm test` casts good and bad programs through the test run and checks the vote rules; a local end to end run (wrangler dev, local D1, a stub Claude API) went through trial, failed test, rewrite, live, casts, votes, rewrite with reasons, rollback, cooldown, a legacy row, a batch rewrite, a draft then its batch upgrade, the library and the judge; a headless browser went through the World, the test run frame, a cast, the vote bar and View source.

## Decisions taken

1. **Cosmic spells may ruin the island.** Consequences are part of the fun; the land regrows on its own (ash turns to soil, grass and forests come back) and Reset is one tap away. Revisit if it feels punishing in play.
2. **Haiku writes spells up to grand, Opus the legendary and cosmic ones** (see DESIGN.md for the measurement).

## What to watch

1. **The judge and the votes.** No vote exists yet, so the judge is uncalibrated and only advises; the library is empty until players vote programs up. Watch `GET /api/admin/judge-stats` after a week of play, and how often a vote leads to a rewrite and a rewrite to a rollback (`rewrites` table).
2. **Phones.** Still measured only in Node and a headless browser. The HUD sends real numbers to `/api/perf` as soon as someone plays with it on. In steady state the simulation's cost is temperature and fluids (about 40% of a tick in every scene), not voxels or creatures: that is the next lever if phones run hot.
3. **Sounds** were checked for errors, not listened to.
4. **Challenge balance with real spells.** The checks use simple hand-written solutions; Claude's spells may be stronger or weaker. Doing nothing wins Wildfire 3 times in 16 seeded replays; the test passes on its one seed. Needs retuning and a multi-seed check.

## What the money taught us

The ledger holds $6.64 (plus about $3.32 before it existed): about $10 of the $25 budget. Opus spells are 88% of it. Opus spell calls went from 43 to 96 in one day because the program version bump to 4 rewrote every big spell on its next cast. **Never rewrite spells in bulk again**: new API features stay backward compatible, and spells are rewritten one at a time (an admin button in 3.2, player votes in 3.3).

## Next versions

Sizes are per Claude Code session: S a few hours, M a full session, L two or more. The roadmap page written after 3.0 has the research behind each item and a ready prompt per version.

### 3.2 Measure and protect the budget (done, see above)

1. **Budget guard.** Programs of older versions stay castable; the version only records what a program was written for. An admin "rewrite this spell" button for one spell at a time. Repairs always on Haiku.
2. **Cost quick wins.** Merges and tiers on Haiku or Sonnet at low effort after a side by side test on 30 pairs; no prompt cache write on lone Opus calls; tier folded into the merge answer; the Sonnet cache read price fixed in `worker/oracle.ts`; `/api/spend` grouped by call with the month's total, shown in the admin badge.
3. **Frame HUD** (frame time p50 and p95, simulation ms, draw calls, triangles, voxels, creatures) behind a long press on the title, then one ten minute session on a real phone.
4. **Performance.** 30 fps on phones and no redraw when idle; voxels in a dense typed array with a reusable flood fill queue; partial updates of the decor mesh; the night overlay as a tint; a spatial grid for creature lookups in `src/sim/social.ts`.
5. **Hygiene.** Prettier and ESLint (the simulation never imports the view), one module for voxel keys and one for colors, no import cycle between physics and voxels.

### 3.3 Spells that are always good, voted by players (done, see above)

1. **Votes.** An anonymous player id per browser; casts recorded on the server; after a cast, up or down, with one reason on a down vote (nothing happened, too small, looked wrong, broke the island, boring). Only players who cast that spell version recently vote, once each.
2. **Rewrite rule.** At least N votes and 60% down, with N = max(1, 10% of the average daily active players over seven days), capped at 25. With one player, one down vote is enough. Reasons go into the rewrite prompt; the old version is kept and comes back if the new one is voted worse; at most one rewrite per spell every three days, within a daily rewrite budget; big ones through the Batch API.
3. **Up votes** mark programs for the library of examples Haiku sees.
4. **Machine checks.** A test run before storing (crash, no visible change, island wiped: rewrite once), a Haiku judge on three Spell Lab frames calibrated on votes, Haiku drafts of big spells now and Opus versions through the Batch API later, and view source on the spell card.

### 3.4 A living island

Villagers, creatures, animals and artifacts that deal with each other, not only with the player. Builds on `src/sim/social.ts`.

1. **Food web.** Villagers eat from fields, beasts graze, predators eat beasts, births need food.
2. **Jobs.** Farmers, woodcutters who fell trees for houses, fishers, builders.
3. **Artifacts in hand.** A `grants` field: a sword fights, a staff makes a hedge mage who casts small spells, a lantern keeps vampires away.
4. **Allies and enemies** between kinds, taming, herds and packs.
5. **Memory.** Villagers remember harm (avoid the place) and help (follow or thank).
6. **Inspect** a creature with a tap: kind, mood, target, needs, what it carries.
7. **Scene test.** A village, a forest, wolves, a vampire, gold and a shrine for ten simulated minutes in `npm test`; populations neither explode nor vanish.

### 3.5 A reason to cast

Village mana from fed villagers in standing houses (a sandbox switch keeps it infinite), par scores and "three ways" stars on challenges, free play after a challenge, a recipe book with hints, opposites and depth based tiers in the merge prompt, a chronicle written from the event log and villagers' memories, discoveries made in the World.

### 4.0 Things worth sharing

A deterministic simulation first, then clips, replays as links, a daily island, a feed of first discoveries, pass the island.

### 4.5 Ready for strangers

AI Gateway spend caps, quotas, Turnstile, name checks and a report button, AI labels, small legal pages, no player token. Nothing public before this.
