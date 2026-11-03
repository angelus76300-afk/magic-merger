# Where the game stands, and what comes next

Updated on 2026-11-03, during 3.7 (after 3.6).

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
4. **Automated checks.** `npm test` runs the simulation in Node in about 20 seconds on four cores, with the seeded challenge replays in worker threads; GitHub Actions runs it with the build on every pull request.

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
8. **Measured** on 20 spells, graded blind (`docs/measurements/spell-quality-2026-11.md`): a rewrite without a reason is a coin toss (small spells 2.73 to 3.00 out of 5, big ones 3.80 to 3.00, Meteor Strike 5 to 1), so votes, reasons and rollbacks are what make spells better. A big spell costs $0.040 instead of $0.061 (Haiku draft at once, Opus batch later), a small one $0.0024. The test run passes 131 of 132 stored programs.
9. **A bug found by the test run**: creatures raised from the dead died again at once (their fall speed kept growing while they lay dead). Resurrection never worked; fixed, with a check in `npm test`.
10. **Checked**: `npm test` casts good and bad programs through the test run and checks the vote rules; a local end to end run (wrangler dev, local D1, a stub Claude API) went through trial, failed test, rewrite, live, casts, votes, rewrite with reasons, rollback, cooldown, a legacy row, a batch rewrite, a draft then its batch upgrade, the library and the judge; a headless browser went through the World, the test run frame, a cast, the vote bar and View source.

## Done in 3.4: share with friends

Asked for: send the link to friends and coworkers, $50 of API a month in total with my own plays, at most $5 per person. DESIGN.md, "Sharing with friends", has the rules.

1. **Overlapping faces fixed first**, each reproduced in the Spell Lab (`scripts/overlap-lab.mjs`) with before and after in `docs/visual-checks`: waterfalls drawn in the same plane as the island's cut side showed its sand and soil bands as streaks (now 0.06 cells in front); water walls on terraces did the same with the land's walls (now they start on the water's own floor); spell blocks placed in the land flickered through its top and walls (now refused), and a wall built through a village cut through houses and trees (a block now takes the cover's place); spell drawings were projected down the cliffs and twice over water (now only on dry tops and fluid tops).
2. **One invite link per person** instead of the shared `ACCESS_TOKEN`: created from the admin badge with a name, stored hashed in D1, kept by the browser, pausable, top-uppable for the month, relinkable and revocable. The admin token stays separate.
3. **Every Claude call paid by an invite** in the ledger, batches and vote rewrites included. Past $5 in the month, new merges and spells say "Your magic is spent for now"; the shared library stays free.
4. **`BUDGET_USD` from $20 to $50**, checked by a hold inserted in one statement, so two calls at the last dollar cannot both pass. A bug guard: identical requests in flight ask Claude once; more than 10 paid requests from one person in 5 seconds are refused and logged. No hourly cap.
5. **The admin's People view**: spend, discoveries and last visit per person, refusals, what is left of the $50, reported names.
6. **A welcome** (what the game is, that Claude writes the spells, the player's month), **a report button** on names and **a privacy note**.
7. **Checked**: `npm run test:worker` runs the Worker under `wrangler dev` with a stub Claude, in CI (DESIGN.md has what it covers, and the mutation that proves the concurrency test can fail); a phone sized browser went through no link, the admin creating an invite, the friend's welcome, a merge, the cap, the People view and a revoked link.

This takes part of 4.5 "Ready for strangers" early, for a closed circle: quotas, a report button, a privacy note, no shared token. Still missing before anything public: Turnstile, name checks before a name is stored, AI labels on generated content, legal pages, AI Gateway caps.

## Done in 3.4.1: ideas from players, built by Claude

Asked for: a tab where people put suggestions and vote, and a way for the admin to send one to Claude to implement without opening a session by hand. DESIGN.md, "Feedback", has the rules; SETUP.md, "Feedback", the setup; FEEDBACK.md, the routine's rules.

1. **The Ideas tab**: post an idea or a bug, vote (up only, one per invite), see what became of it, with the pull request's link.
2. **Send to Claude** for the admin: an editable brief, a GitHub issue without the player's name, then a Claude Code routine fired through its API, which opens a draft pull request with `Closes #<issue>`.
3. **Statuses from GitHub** every ten minutes on the existing cron, or at once from the admin box.
4. **Checked**: `npm run test:worker` runs the whole flow against a stub GitHub and a stub routine (one issue, one fire, a double tap, a refused fire then a retry on the same issue, review, merged, declined); `npm test` checks the status rules.
5. **Found by the first real send**: a test idea whose brief said "don't do anything" was handled right (Claude read FEEDBACK.md, made no change and asked on the issue in 30 seconds), but the idea then said "Claude is on it" forever, since nothing on GitHub changed. Now the run puts a `needs-info` label on the issue when it stops to ask, the game shows "Claude has a question", and sending again takes the label off.

## Done in 3.4.2: spells keep their promise

Asked for: protection spells were not protecting and should be clear domes; new spells should do what they say; and the API should have grown a protection ability after the first protection spells, by itself. DESIGN.md, "Spells keep their promise" and "An API that grows", has the rules.

1. **Wards**: `w.ward` makes fire, fluids, lightning, hostile creatures, blasts and frost stop at an edge, and villagers run under it. Drawn as a clear dome that ripples when hit.
2. **Intents** for every element, decided before its program by a call of their own, and a **protection probe** in the test run: fire, lava, a blast and raiders against the village, at least half of the harm prevented. Aegis prevents 96 to 100%; the old shell of blocks none.
3. **An API that grows**: writers report what they lacked; once a day the big model turns what three spells lacked into a tested helper, a hint, or an engine proposal opened as a GitHub issue.
4. **Checked**: `npm test` (the ward, the probe both ways, helpers appended and refused), `npm run test:worker` (a promise before the program, gaps, a helper from trial to live to a writer's prompt to a stored program, a broken promise rewritten), and the two frames in `docs/visual-checks`.

Not done: no stored protection program was re-tested, since the live database is not reachable from here. Run the probe on them once (below) before trusting the numbers. Heal and summon have no probe yet. There is no admin card for the evolution yet; it is JSON at `/api/admin/evolution` and issues on GitHub.

## Done in 3.5: many kinds of life

Asked for: every creature was the same two blocks in a different color. DESIGN.md, "Many kinds of life", has the rules and the numbers.

1. **Twelve body plans** (two legs, four legs, bird, fish, serpent, insect, spider, slime, spirit, golem, dragon, tree folk), each a few boxes that turn about pivots: legs swing, an arm holding something stays steady, wings flap, tails sway, heads nod, a serpent undulates, a slime squashes. The dead fall on their side and sink; a dead fish floats belly up.
2. **Features on any body**: horn, horns, antlers, wings, tail, mane, hat, hood, crown, glowing eyes, armor and one carried item from ten.
3. **Models Claude designs**: up to 16 boxes with a motion each, scaled to the creature's size.
4. **Two draw calls for all creatures**, whatever the mix: every part is one instanced cube shaded from its own normal. A crowd of 375 creatures costs 26 draw calls where it cost 25, and 1.0 ms of CPU per frame (0.1 before) after making the first version twice as fast; creatures outside the camera are skipped and details dropped from far away. The HUD shows the boxes drawn.
5. **Wildlife with habitats**: deer, rabbits, wolves (hunt by night), boars, bears (hunt by day, scare people), birds and fish, kept at their numbers by births where their habitat lasts. Challenges keep only birds and fish (a burning rabbit lost the lava challenge with the right spell cast).
6. **Villagers who differ**: children, elders, clothes per village, a look per job, saved; old saves dressed by village.
7. **Old spells untouched**: their creatures get a body from what they declare, then their name (a Lich King gets a crown, a Dragonfly is not a dragon), then their base kind. A spell's own "wolf" stays apart from the island's wolves. The prompt teaches `body`, `features`, `color2` and `model` in one paragraph (about 280 tokens, 1.5 to 3% of a big spell's cost); `PROGRAM_VERSION` 5 only labels.
8. **The bestiary** (`lab/bestiary.html`, screenshots by `scripts/bestiary.mjs`) draws every plan, feature, animal, villager look and four sample models, walking, flying, dead or frozen.
9. **Checked**: `npm test` builds every plan with every feature and every villager look, reads names, bounds models, finds every species in its habitat on two island sizes, brings deer back after they are all killed, chokes a fish on land, keeps a spell's wolves apart and saves looks. Two things it caught: wolves born inside solid trees never moved, and the test run passed a spell that did nothing once animals drew random numbers (creatures now have their own stream there). The imp mob check was one seed that happened to pass (about 3 in 4 imps die in 20 s, before and after 3.5, over 52 seeds); it now asks for 5 of 6 seeds where the mob kills it or leaves it under half health.

## Done in 3.6: a living island (creatures)

Asked for: nothing on the island just stands there; if the player does nothing for five minutes, every creature must have changed something. This is the creatures half; artifacts that act and creatures casting library spells came in 3.7 part B. DESIGN.md, "A living island", has the rules and the numbers.

1. **A goal for every kind** from twelve (hunt, gather, hoard, build, tend, guard, steal, spread, convert, worship, explore, migrate), **needs before goals** (survive, rest, eat) and **marks**: a dragon's heap of gold, dams, goblin camps with loot, graveyards, dens, flowers and candles at shrines, cairns.
2. **Villagers' jobs are goals**, with a village's food, wood and gold: farmers sow and harvest, woodcutters fell trees, builders (a new job) build houses with that wood, fishers fish, guards patrol and fight, priests pray, heal and bury the dead, merchants carry food to poorer villages; children are born where there is food.
3. **Abilities** with a trigger and a cooldown from twelve engine actions (breathe fire, heal, summon, teleport, freeze, lightning, grow, raise the dead, shield, dig, flood, steal).
4. **Food web, taming, herds, memory**: wolves and bears hunt when hungry, grazers eat crops, birds sow, fish breed; begging animals fed three times are tame; villagers remember harm and help, magic included.
5. **Inspect**: tap a creature with no spell in hand.
6. **The five minute scene** in `npm test`, on the 3.4.2 probe island: ten minutes, three streams, 72 of 72 creatures changed something, no kind vanished or exploded. Challenges still balanced (it found an offering that knocked a house down and lost the lava challenge).
7. **The prompt** teaches `goal` and `abilities` in one paragraph (about 250 tokens); older creatures get both from their behavior, name and base kind. `PROGRAM_VERSION` 6 only labels.
8. **Performance** on the large island: whole tick unchanged within noise; creatures 0.07 to 0.15 ms p50 dearer in Node, paid for by probing danger every third tick and a lure scan without strings.

9. **Merges invent their own goals, jobs and abilities** (`spell.goals`, `w.hire`, abilities with code), so the twelve are a floor; the prompt teaches it in one paragraph.
10. **Old spells face new promises**: every element gets its intents on the cron, and a live program that never faced its promise's probe is tested by the next browser that holds it and, if it breaks it, written once more as a trial. Found because all nine live protection programs, the Protection Spell included, failed the probe.

Not done: the judge does not run the scene yet; abilities have no probe in the test run; no real phone session since goals (watch `/api/perf`).

## Done in 3.7: alive, acting and challenged

Everything before 4.0 in one pull request, in five parts. DESIGN.md, "Alive, acting and challenged", has the rules and the numbers.

1. **Creatures that look alive**: sizes against a villager and a house (a bear 0.72 villagers tall instead of 1.56), walking up and down steps, no two parts sharing a face (1,359 found, the villager's hair first), still models fall back to a body plan, and the judge says whether creatures look alive.
2. **Artifacts that act**: effects on triggers, charges, fuel and health, grants villagers use, uses creatures act on, pairs; creatures cast library spells by name at a capped tier and rate; every placed artifact faces a five minute test.
3. **Challenges from nothing**: a Challenges tab, eight hazard islands from a few primitives, scored by merges against a par from the recipe graph, shown only with a solver verified in the simulation.
4. **The island's story**: a chronicle by Haiku, a recipe book, opposites in the merge prompt and tiers capped by depth.
5. **The legacy library refreshed**: programs rewritten through the Batch API under an $8 cap, each one kept only if it passes its tests and the judge; duplicates become aliases after the owner approves each.

Not done: combined hazards (they need a new island); the three lava challenges have no verified solver yet and stay hidden; the refresh of the whole library waits for the owner's look at the dry run.

## Decisions taken

1. **Cosmic spells may ruin the island.** Consequences are part of the fun; the land regrows on its own (ash turns to soil, grass and forests come back) and Reset is one tap away. Revisit if it feels punishing in play.
2. **Haiku writes spells up to grand, Opus the legendary and cosmic ones** (see DESIGN.md for the measurement).

## What to watch

1. **The judge and the votes.** No vote exists yet, so the judge is uncalibrated and only advises; the library is empty until players vote programs up. Watch `GET /api/admin/judge-stats` after a week of play, and how often a vote leads to a rewrite and a rewrite to a rollback (`rewrites` table).
2. **Phones.** Still measured only in Node and a headless browser. The HUD sends real numbers to `/api/perf` as soon as someone plays with it on. In steady state the simulation's cost is temperature and fluids (about 40% of a tick in every scene), not voxels or creatures: that is the next lever if phones run hot.
3. **Sounds** were checked for errors, not listened to.
4. **Whether Claude uses bodies.** New spells should declare `body` and `features`; models should stay rare. Look at a week of new programs (`programs` table) for how often each appears, and at the bestiary when one looks wrong.
5. **Creatures on phones.** 375 creatures cost 1.0 ms p50 but 5.1 ms p95 of CPU in the headless browser; the HUD's `parts` count in `/api/perf` will say what a real island costs.
6. **Challenge balance with real spells.** The checks use simple hand-written solutions; Claude's spells may be stronger or weaker. Wildfire used to be won by doing nothing 1 time in 5: villagers rebuilt the burnt houses while the fire died down, and the end check counted them. It is now lost the moment a second house burns, and `npm test` replays every challenge with nothing over 8 seeds (0 wins in 64 for Wildfire, rain still wins 64 in 64).

7. **The API's growth.** Read `GET /api/admin/evolution` weekly for a month: are gaps honest (the writer saying what it lacked) or noise, does the designer choose helper, hint or engine sensibly, and do live helpers get used. If gaps are mostly noise, raise the three spells to five before anything else.
8. **Stored protection spells.** Export them (`scripts/replay-stored.ts` has the command), run the probe on each, and rewrite the ones that fail from the admin card, one at a time, never in bulk.

## What the money taught us

The ledger holds $6.64 (plus about $3.32 before it existed): about $10 of the first $25 budget (since 3.4 the cap is $50 a month; November so far: $7.26). Opus spells are 88% of it. Opus spell calls went from 43 to 96 in one day because the program version bump to 4 rewrote every big spell on its next cast. **Never rewrite spells in bulk again**: new API features stay backward compatible, and spells are rewritten one at a time (an admin button in 3.2, player votes in 3.3).

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

### 3.4 Share with friends (done, see above)

### 3.5 Many kinds of life (done, see above)

Today every creature is the same two blocks in a different color. Give each kind a body you recognize at a glance, and the island wildlife worth a food web.

1. **Body plans** as small voxel models, each drawn as a few instanced parts so a hundred creatures stay a handful of draw calls: two legs (people, knights, goblins), four legs (deer, wolf, boar, bear, horse), bird, fish and serpent, insect and spider, slime, floating spirit, golem, dragon, tree folk.
2. **Simple animation per plan**: legs swing, wings flap, tails sway, bodies tilt, the dead sink. A scale and a rotation per part, no skeletons.
3. **Features** on any body: horns, antlers, wings, tail, mane, hat, hood, crown, glowing eyes, armor, a carried item. Spells declare `body` and `features`.
4. **A model Claude designs**: up to 16 boxes of its own for a truly strange creature, bounded so it stays cheap.
5. **Native wildlife** with habitats: deer, rabbits, wolves, boars, birds, fish, bears.
6. **Villagers who differ**: children, elders, clothes per village, a look per job.
7. **A bestiary page** in the Spell Lab drawing every plan and feature.
8. Teach `body`, `features` and models in the spell prompt **without rewriting existing spells in bulk**; old creatures get a body chosen from their base kind.

### 3.6 Goals, actions and a living island (creatures done, see above; artifacts in 3.7 part B)

Nothing on the island just stands there. Every creature wants something and acts to get it, some with magic of their own; every artifact does something, on its own or when something happens. The test for anything new: if the player does nothing for five minutes, what has it changed? Builds on `src/sim/social.ts` and the species from 3.5.

1. **A goal for every kind**, from a small vocabulary: hunt, gather, hoard, build, tend, guard, steal, spread, convert, worship, explore, migrate.
2. **Needs before goals**: survive, then eat and rest, then the goal, then wander.
3. **Goals leave marks**: a dragon's hoard, a beaver dam, a goblin camp, a spreading graveyard.
4. **Abilities** with a trigger (enemy near, hurt, night, a friend dies, every so often) and a cooldown, from a fixed vocabulary of engine actions: breathe fire, heal, summon, teleport, freeze, lightning, grow, raise the dead, shield, dig, flood, steal.
5. **Creatures cast real spells** from the shared library by name, at a capped tier and rate.
6. **Villagers' jobs are goals**: farmers, woodcutters who fell trees for houses, fishers, builders.
7. **Artifacts that act**: effects over time and on triggers (a Well waters fields each morning, a Totem calls rain in a drought), state (charges, fuel, health), `grants` and `uses` (villagers draw water, arm themselves at a forge, pray; creatures steal, guard or destroy), and declared pairs between artifacts (a Phoenix Feather near a corpse revives it).
8. **Food web** with the 3.5 species, allies and enemies, taming, herds, villagers' memory of harm and help.
9. **Inspect** any creature or artifact with a tap: goal, current action, needs, charges, what it carries.
10. **The five minute test** in `npm test` and in the judge: a village, a forest, wolves, a dragon, a vampire, gold, a well and a shrine for ten simulated minutes; populations neither explode nor vanish, and every placed thing changed something.

### 3.7 Alive, acting and challenged (one pull request, everything before 4.0)

Everything left before 4.0, in one session and one pull request, built in five parts in this order. Each part ends with its own commit, its own checks green, and a deploy, so a problem is caught where it starts and the pull request can be read part by part. Decided: no village mana, no hints, no discoveries made in the World, no sharing features.

**Part A. Creatures that look alive** (found in play after 3.5)

1. **Sizes**: some animals are far too big (bears above all). Every species and body plan gets a size checked against a villager and a house, in the bestiary and in `npm test`.
2. **Smooth movement over terrain**: creatures jump from one terrain level to the next. They walk up and down steps, ease their height between cells, and only climb what they can climb.
3. **No flickering faces**: some animal and villager models have parts in the same plane (the old villager look was the one noticed). Find every case in the bestiary, fix it, and check that no two parts of a model share a face.
4. **Merged creatures are alive**: a model Claude designs gets motion on its parts; one without motion falls back to the nearest body plan with its colors and features; the judge asks "does it look alive?". Checked on stored creatures without rewriting spells in bulk.

**Part B. Artifacts that act** (items 5 and 7 of 3.6)

5. **Creatures cast real spells** from the shared library by name, at a capped tier and rate.
6. **Artifacts act**: effects over time and on triggers (a Well waters fields each morning, a Totem calls rain in a drought), state (charges, fuel, health), `grants` and `uses` (villagers draw water, arm themselves, pray; creatures steal, guard or destroy), declared pairs between artifacts (a Phoenix Feather near a corpse revives it). The five minute test extends to every placed artifact through the 3.4.2 promise checks.

**Part C. Challenges from nothing**

7. **A Challenges tab**: a hazard island and a start set (the primitives, or fewer). The player merges on the challenge's own board until they have something that saves the village, casts it, and is scored by the number of merges.
8. **Par and stars**: par is the shortest known solution from the shared recipe graph and players' solutions; three stars at par or better, two within two merges, one for any win; beating par lowers it for everyone. Each challenge shows the fewest merges any friend needed, and who.
9. **Increasing difficulty**: one obvious spell first, then a missing primitive (a wildfire without Water), combined hazards, a higher tier, or a hazard that starts while the player is still merging.
10. **Always solvable and fair**: a challenge appears only once a solution path is known and verified in the simulation (the 3.4.2 probe), re-verified when a spell on the path is rewritten. Known pairs are free; new ones count against the player's $5; discoveries join the main inventory.

**Part D. The island's story**

11. **The chronicle**: Haiku writes a short story from the event log and villagers' memories, once a session, about $0.002.
12. **The recipe book**: what the player found, how and when, and what it was used for. Memory only, no hints.
13. **Opposites and depth in the merge prompt**: Fire and Water give Steam, never "Super Fire Water"; a tier follows its depth in the recipe tree, plus or minus one.

**Part E. Refresh the legacy library** (last, once A to D exist, right before 4.0)

The one planned exception to "never rewrite in bulk": every stored program was written before bodies, goals, abilities, acting artifacts and wards existed, so old items look and behave poorer than new ones. On 2026-11-02 the library held 258 items (171 with a stored program, about a third legendary or cosmic) and 433 recipes.

14. **Rewrite programs, not items**: names, emojis, tiers and recipes stay; every stored program is written again with today's prompt and engine, from the item's own intent (3.4.2), through the Batch API at half price.
15. **A new version must earn its place**: it replaces the old one only if it passes the test run, the item's promise probe, the judge ("does it look alive?", "did it change anything after five minutes?") and is not voted below the old one; otherwise the old version stays. Old versions are kept for rollback, as with vote rewrites.
16. **Budget**: estimated $3 to $5 for the whole library (about 60 Opus programs at about $0.04 in batch, about 110 Haiku ones at under $0.002, plus checks), capped at $8 and started early in a month; a dry run on 20 items first, with before and after frames for the owner to approve.
17. **Trim duplicates without breaking anyone**: a cheap pass lists near duplicates and merges that make no sense (for example World Tree, World Tree Awakening and Yggdrasil; Ley Line and Ley Lines). Nothing is deleted: the owner approves each pair, and a duplicate becomes an alias of the kept item, so players' inventories, recipes and First Discoveries keep working.
18. **A report**: how many programs improved, stayed or rolled back, what it cost, and the frames of the ten biggest changes.

**Budget for the session**: keep the simulation p95 on a large island within the HUD numbers from 3.6, and API spend for parts A to D under about $3 (part E has its own cap).

### 4.0 Accounts: your progress everywhere

Today an invite link is kept by one browser, and progress lives in that browser only. The link becomes a one use account creation. Until 4.0 lands, invites keep working as they do. Revised by the 4.0 review (docs/REVIEW-4.0.md, part G), which found four things the plan was silent about: passkeys bind to the domain, the Worker cannot send email, everything the server holds is already keyed by the invite id, and two tabs of one browser overwrite each other's saves.

1. **An invite is used once**: opening it creates an account (a passkey first, no password); the link stops working for anyone else. The admin can reissue a one use link for a friend who lost theirs: it signs the person into their existing account and offers a passkey again. An email link is the same mechanism behind a sender that does not exist yet; it turns on with a provider secret, not a code change.
2. **The invite becomes the account, with the same id**: spend, First Discoveries, ideas, wins and reports are keyed by it already, so nothing moves and the $5 cap has no gap. Votes and casts, keyed by a random browser id today, use the account id once signed in, so one vote per person across devices.
3. **Nobody loses progress**: on creating an account, the browser's discoveries, board and island are uploaded (the island gzipped, with its own 2 MB limit); existing friends get a one time "save your progress" prompt and the invite header keeps working until they answer.
4. **The same progress on every device**: discoveries are the union by key with the earliest time; the island is last saved wins, with a warning before replacing a server save newer than this device's; the board follows the island.
5. **Sessions** are bearer tokens in a header like the invite today, hashed at rest, 30 days, rotated on each passkey sign in, revocable per device from the account page.
6. **Privacy**: an account page to export or delete everything the account holds; spend keeps the random id so the month's budget stays whole; the privacy note says so.
7. **Tested**: an invite opened twice and at once, a reissued link used twice, a replayed registration challenge, a guessed or reused session token, one account reading or writing another's progress, an oversized or malformed upload, a deleted account's rows in every table, and the $5 cap before and after claiming.
8. **Two tabs, one browser** (review M6): discoveries merge by key on every write; the island is saved by one tab at a time (a `BroadcastChannel` lock) or never over a newer save. The server side of 3 and 4 is where this is decided.
9. **The domain** is chosen before the first passkey (a move means every friend registers again).

### 4.1 Bigger and richer worlds

1. **Bigger islands for those who can run them**: a huge size and beyond, offered when the device's own HUD numbers show the headroom (simulation and frame p95 on the current size), never by default on phones. Saved on the account (4.0), since a big island outgrows the browser's storage.
2. **More varied terrain**: biomes (temperate forest, desert, tundra, jungle, swamp, volcanic, mesa), island shapes (archipelagos, plateaus, ridges, inland lakes, deltas), better rivers and coasts, chosen by a seed and a few sliders at reset.
3. **Visual improvements**: baked ambient occlusion in the voxel lighting, better water (shore foam, depth color, gentle waves), weather you can see (rain, snow, fog), sun, moon and stars in the sky. Each measured with the HUD on a phone before it ships.

4. **From the 4.0 review** (docs/REVIEW-4.0.md), in this order:
   1. A watchdog that replaces a frozen World frame after 20 s without a message (review M3; the full answer, the simulation in a Worker thread, is L and changes the CSP and the view).
   2. Chips in the spell bar say "writing" and "testing" instead of dimming, and the test run's duration joins the perf sample, so the 27 s first spell of the phone sized run can be measured on a real phone (M9).
   3. The vote bar and the challenge banner no longer overlap on a phone (M10, `docs/review-4.0/14-challenge-island.jpg`).
   4. `scripts/` typechecked (`@types/node`, a `scripts/tsconfig.json` in `npm run typecheck`) and `scripts/*.mjs` linted with Node globals (M7).
   5. One Worker test section each for votes, rewrites and rollbacks, repairs, the judge and judge-stats, spend and perf, reports (M7).
   6. `npm test` no longer asserts on wall clock time: `SLOW_MS` injectable, the worst tick printed, not asserted (M8); one scene stream in CI if the 92 s hurt.
   7. The admin token compared in constant time (L1); `/api/perf` one row per invite per 20 s (L2); `pollBatches` caught like its siblings in `scheduled()` (L7); the feedback sync matches pull requests that say `Closes #n`, not any mention (L8).
   8. A toast once when a save hits the storage quota, and `MAX_SAVE_CHARS` at 1.5M (M13); the refresh report says "not sent" for rows that never reached a batch (M12).
   9. A broken spell remembers the Worker's "mended too often" for the session (L5); Retry and Reset of a live challenge keep the head start (L6).
   10. Dead exports removed, one `api()` helper and one PRNG for `scripts/`, one tick loop shared by the engine, the check and the scripts, the two identical branches in `shared/tiers.ts` and the Worker test (L4).

### 4.5 Ready for strangers

AI Gateway spend caps, Turnstile, name checks, AI labels, small legal pages. Accounts (4.0) come first, so strangers can keep their progress. From the 4.0 review: trials decided by the admin's runner (or two browsers that agree), not by one browser's word (M11), since a stranger can promote a crashing program for everyone. Quotas, the report button and invite links instead of a shared token came early, in 3.4, for friends. Nothing public before this.
