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

This takes part of 4.6 "Ready for strangers" early, for a closed circle: quotas, a report button, a privacy note, no shared token. Still missing before anything public: Turnstile, name checks before a name is stored, AI labels on generated content, legal pages, AI Gateway caps.

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

## Done in 4.0: a review, then accounts

Asked for: an independent review before the link goes beyond close friends, then accounts built on the reviewed code. `docs/REVIEW-4.0.md` has the findings and the numbers; DESIGN.md, "Accounts", has the rules.

1. **The review**: no critical finding; three high (a player's idea could be the routine's task, a challenge win could set par to 0 for everyone, a lost test verdict left a program a trial for good) and seven medium fixed with a check each; the hold proved by mutation; the sandbox headers verified on the live site; a newcomer's first ten minutes at phone size with screenshots; the open items numbered under 4.1 and 4.6.
2. **The invite becomes the account, with the same id**: a passkey made from the link creates it, the link dies, and spend, First Discoveries, ideas and wins follow with no move; votes and casts are the account's across devices.
3. **Sign in anywhere** with the passkey, or a one use link: the admin's "New link" on an account, or by email when a sender is set up (`EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`).
4. **Progress on the server**: discoveries as a union, the board, the island packed; last saved wins for the island, with a warning before an older device replaces a newer save, and the other island loaded if the player says no.
5. **The account page**: passkeys, devices (each can be signed out), what is saved, email, export as one file, delete everything.
6. **Checked**: `npm run test:worker` (one use links opened twice at once, a forged passkey answer, a spent challenge, sessions made up, signed out or deleted, one account reading or writing another's progress, malformed and oversized uploads, email links used twice and rate limited, export, deletion leaving nothing of the person and keeping the library and the spend) and `scripts/account-verify.mjs` in a phone sized browser with a virtual authenticator (a link into an account, a second device signing in and receiving the island, one link on two devices at once, deletion signing both out).

Not done: two tabs of one browser still overwrite each other's local saves (review M6, in 4.1; the server merge limits the damage to the island); the welcome is still long on a phone.

## Decisions taken

1. **Cosmic spells may ruin the island.** Consequences are part of the fun; the land regrows on its own (ash turns to soil, grass and forests come back) and Reset is one tap away. Revisit if it feels punishing in play.
2. **Haiku writes spells up to grand, Opus the legendary and cosmic ones** (see DESIGN.md for the measurement).

## What to watch

1. **The judge and the votes.** No vote exists yet, so the judge is uncalibrated and only advises; the library is empty until players vote programs up. Watch `GET /api/admin/judge-stats` after a week of play, and how often a vote leads to a rewrite and a rewrite to a rollback (`rewrites` table).
2. **Phones.** Still measured only in Node and a headless browser. The HUD sends real numbers to `/api/perf` as soon as someone plays with it on. In steady state the simulation's cost is temperature and fluids (about 40% of a tick in every scene), not voxels or creatures: that is the next lever if phones run hot.
3. **Sounds** were checked for errors, not listened to. Players now hear a drum that never stops: it is the woodcutters (see 4.1 and 4.5).
4. **Whether Claude uses bodies.** New spells should declare `body` and `features`; models should stay rare. Look at a week of new programs (`programs` table) for how often each appears, and at the bestiary when one looks wrong.
5. **Creatures on phones.** 375 creatures cost 1.0 ms p50 but 5.1 ms p95 of CPU in the headless browser; the HUD's `parts` count in `/api/perf` will say what a real island costs.
6. **Challenge balance with real spells.** The checks use simple hand-written solutions; Claude's spells may be stronger or weaker. Wildfire used to be won by doing nothing 1 time in 5: villagers rebuilt the burnt houses while the fire died down, and the end check counted them. It is now lost the moment a second house burns, and `npm test` replays every challenge with nothing over 8 seeds (0 wins in 64 for Wildfire, rain still wins 64 in 64).

7. **The API's growth.** Read `GET /api/admin/evolution` weekly for a month: are gaps honest (the writer saying what it lacked) or noise, does the designer choose helper, hint or engine sensibly, and do live helpers get used. If gaps are mostly noise, raise the three spells to five before anything else.
8. **Stored protection spells.** Export them (`scripts/replay-stored.ts` has the command), run the probe on each, and rewrite the ones that fail from the admin card, one at a time, never in bulk.

## What the money taught us

The ledger holds $6.64 (plus about $3.32 before it existed): about $10 of the first $25 budget (since 3.4 the cap is $50 a month; November so far: $7.26). Opus spells are 88% of it. Opus spell calls went from 43 to 96 in one day because the program version bump to 4 rewrote every big spell on its next cast. **Never rewrite spells in bulk again**: new API features stay backward compatible, and spells are rewritten one at a time (an admin button in 3.2, player votes in 3.3).

## Next versions

Sizes are per Claude Code session: S a few hours, M a full session, L two or more. The roadmap page written after 3.0 has the research behind each item and a ready prompt per version.

The plans of 3.2 to 4.0 are done and summed up under their "Done in" sections above; their full text is in the git history of this file.

**Numbered in the order to run them.** Renumbered on 3 November so the numbers are the order: the review's findings (was 4.0.2) are now 4.1, faster creation (was 4.0.1) 4.2, movement stays 4.3, bigger worlds (was 4.1) 4.4, sound and music (was 4.2) 4.5, ready for strangers (was 4.5) 4.6. Older documents, `docs/REVIEW-4.0.md` above all, use the old numbers. Why this order: the review's fixes are small and safe and add the tests faster creation needs on spend and repairs; creatures are what players watch most and moving them well costs no API; sound comes after worlds only for weather sounds, so the two could swap; nothing public before 4.6.

### 4.1 The review's findings, fixed

Every open finding of docs/REVIEW-4.0.md that code can correct, in one pull request. Each one is reproduced first (a test, a script or a screenshot that shows it) and the same check is shown passing after the fix; a finding that cannot be reproduced is written down as such, not fixed blind. No spell is rewritten, no prompt changes, no new paid call. Left out on purpose: M9 (in 4.2), M11 (4.6, when strangers come), L9 (UTC months, consistent, not a bug), the simulation in a Worker thread (the real answer to M3, size L, worth doing after 4.2 has moved the test run into a Web Worker and changed the CSP once).

1. **Nothing lost without a word.** Two tabs of one browser: discoveries merged by key on every write (the stored object read again first, a `storage` listener for the other tab's writes), the island saved by one tab at a time through a `BroadcastChannel` lock or refused over a newer save (M6, the last item of 4.0 still open). A toast once when a save hits the storage quota, and `MAX_SAVE_CHARS` at 1.5M (M13). A watchdog that replaces a World frame silent for 20 s while visible (M3, the part that fits in S to M).
2. **Server hardening.** The admin token compared in constant time on two digests (L1); `/api/perf` one row per invite per 20 s (L2); `pollBatches` caught in `scheduled()` like its siblings (L7); the feedback sync links a pull request to an idea only when it says `Closes #n` or `Fixes #n` (L8); the chronicle digest bounded and passed to Haiku as quoted data, not facts (L10, cheap even if self harm only).
3. **Small things a player sees.** The vote bar and the challenge banner stacked on a phone, checked with a screenshot at phone size (M10); a broken spell remembers the Worker's "mended too often" for the session and stops asking (L5); Retry and Reset of a live challenge keep the head start (L6); the refresh report says "not sent" for rows that never reached a batch (M12). **The drum players keep hearing**: every tree a woodcutter fells plays a "thump" at the same volume wherever it is on the island (`src/sim/goals.ts`, `fell`; about one every 3 s on a busy island, 41 in two simulated minutes in `npm test`), and so does every house built; any unknown sound name falls back to the same thump (`src/sim/sound.ts`, `VOICES[name] ?? VOICES.thump`; two live programs ask for "hum"). The quick fix: no sound for routine villager work until 4.5 gives it a place and a distance, and an unknown name falls back to the nearest voice by meaning ("hum" to drone) or to silence, never to a drum.
4. **Tests you can trust.** `scripts/` typechecked (`@types/node`, a `scripts/tsconfig.json` in `npm run typecheck`) and `scripts/*.mjs` linted with Node globals (M7). One Worker test section each for votes, rewrites and rollbacks, repairs, casts, reports, spell info, spend and perf, then the admin routes the review listed (M7). `SLOW_MS` injectable, the worst tick printed, not asserted (M8); one scene stream in CI if that brings `npm test` well under the 92 s (L11).
5. **Less code.** Dead exports removed (`artifactsOf`, `SOUND_NAMES`, `WorldHost.openChallenges`, `Store.markSolved`), one `api()` helper and one PRNG for `scripts/`, one tick loop shared by the engine, the check and the scripts (the engine's missing `world.events` clear decided on purpose, not by accident), the identical branches in `shared/tiers.ts` and the Worker test (L4). Behavior unchanged, proven by `npm test` and the Worker tests before and after.
6. **What the review could not verify.** A test for a passkey whose counter goes backwards (a cloned authenticator) and for each attestation format the library accepts; the two leftover test accounts (`ccf78a03`, `82a0d421`) deleted with the statements from the 4.0 pull request, by the owner or with the owner's go ahead.

Then the owner's part of the review's section 8, which no session can do: the routine's environment holds no token and `main` requires a pull request; one real phone session with the HUD on the medium island, read back from `/api/perf`; a real passkey made on a real phone; the welcome read on a phone; the refresh report read and its candidates decided.

### 4.2 Faster creation, every spell written at once

The 4.0 review measured 27 s from a discovery to a castable small spell in a phone sized browser, with 2 of 12 spells in the bar ready (M9). Most of that wait is the test run in the hidden frame, not Claude. Goal: everything from dropping one item on another to using the result gets faster, and every new item is written as soon as it is created. Rules set by the owner: **no lower quality** (no weaker drafts shown to players, no fast mode), and the extra cost of writing items nobody casts is accepted because spending has stayed well controlled, inside a daily cap.

1. **Measure first**: time each step of the whole path (merge answer, description, intent, program write, test run, verdict, first cast) for small and big spells and for artifacts, in the perf sample and in a script, on a phone sized browser and on the real phone. Every change below is judged on these numbers, and on cost per spell and quality, measured before and after.
2. **A faster test run**: simulation only with no rendering, in a Web Worker, as short as the probes allow, started as soon as the program arrives rather than when the World opens.
3. **Fewer round trips**: intent and program in one call or in parallel where they do not depend on each other; description alongside the merge answer where it is already written by the same call; no call waiting on another without need.
4. **Cheaper and faster at once**: the 1 hour prompt cache where writes come in bursts (it lowers cost too); shorter prompts where the 3.x additions grew them without effect, checked against the judge and the probes.
5. **Every item written at the merge**: the Worker starts the program the moment a merge creates a new item, for every tier (Haiku up to grand, Opus above, as today), and for a known item without a program when a player first gets it, in a background job that survives the response (Cloudflare Queues or Workflows; `waitUntil` is too short for a long Opus call), idempotent so two players never pay twice. The discoverer's $5 pays for what their merge starts. A daily cap on these writes (for example $1.50) sends anything beyond it back to being written on first use. Estimate from this month's numbers before shipping: at 50 new items a day, about $26 a month.
6. **Progress the player can see**: chips say "writing", "testing" and "ready", and a toast when a spell becomes ready.
7. **Guards**: cost per spell must not rise (the total rises only by the items written ahead, inside the daily cap); the judge's pass rate, the promise probes and votes on new programs must not fall, on a fixed set of 20 spells written before and after.

### 4.3 Movement that looks alive

Players see deer going back and forth. Measured on three seeds of a small island over two simulated minutes (a sharp turn is a heading change over 150 degrees within half a second): **a deer turns around 15.5 times a minute, about every 4 s**, a rabbit 9.3, a bird, a villager and a boar about 6.5, a bear 4.3. Most deer turns happen while "running away", "running for its life" or "keeping with its herd". The cause is in `src/sim/creatures.ts`: every tick picks the first rule that applies from a list (danger, social, flee, eat, behavior, wander) with no memory of the last choice, so a deer that flees past its sense radius (8 cells) stops at once, walks back to graze or to its herd, comes within 8 cells again and flees again; the flee itself is gated on hunger below 0.7, so a hungry deer switches between fleeing and eating as hunger crosses the line. Movement has no inertia either: speed and heading change in one tick, and an obstacle is dodged by a right angle step.

1. **Measure first, and keep measuring.** The turn counter above goes into `npm test` as a number per kind, printed on every run and asserted per kind once fixed (a deer under 2 turns a minute while it is not reaching a goal; turning back after a delivery is not a flip-flop). Also: seconds stuck, and how often each creature changes action.
2. **Decisions that stick.** Hysteresis on every threshold: a deer starts fleeing at 8 cells and stops only past about 14 and after a few seconds without seeing the danger; hunger starts a meal at 0.7 and ends it at 0.3. A minimum time per action and a small bonus for the current one, so a new reason must be clearly better to take over (the usual fix in game AI: separate start and stop distances, a momentum bonus of about 10 to 25%, a minimum duration). A fleeing animal remembers where the danger was and runs to cover, to its herd or out of sight, not straight away from the nearest point.
3. **Steering, not teleporting headings.** Velocity with acceleration and a turn rate per species (a deer bounds, a bear lumbers, a rabbit zigzags on purpose when chased), arrival that slows down, wandering toward a target that drifts slowly, separation inside herds instead of every member steering to the center, obstacles avoided by looking ahead rather than the right angle side step.
4. **Paths for long trips.** A grid path (A\* or a flow field shared per destination: one for a village's houses, one per water source) for trips home, to water, to food and to prey, recomputed rarely and bounded per tick, so nobody walks into a river or a cliff and turns back.
5. **Gaits and idling.** Walk, trot and run tied to speed in the rigs; grazing with the head down, looking around, lying down to sleep; the body turns before it moves. Standing still is fine; dithering is not.
6. **Herds and flocks.** Deer flee as a group behind one leader; birds and fish flock (separation, alignment, cohesion); wolves surround rather than chase in a line.
7. **Everyone gets it.** Villagers, wildlife and spell creatures use the same steering; behaviors spells declare (`hunt`, `guard`, `follow`, goals) go through it with no prompt change and no rewritten program.
8. **Guards.** The five minute test keeps its populations (wolves must still catch some deer; better fleeing changes the food web), every challenge still passes on its seeds, and the simulation p95 on a large island stays within the HUD numbers of 3.6 (paths and steering are bounded per tick and measured in the HUD).

### 4.4 Bigger and richer worlds

1. **Bigger islands for those who can run them**: a huge size and beyond, offered when the device's own HUD numbers show the headroom (simulation and frame p95 on the current size), never by default on phones. Saved on the account (4.0), since a big island outgrows the browser's storage.
2. **More varied terrain**: biomes (temperate forest, desert, tundra, jungle, swamp, volcanic, mesa), island shapes (archipelagos, plateaus, ridges, inland lakes, deltas), better rivers and coasts, chosen by a seed and a few sliders at reset.
3. **Richer nature at generation.** Today a new island has two tree models (`tree` and `pine`), one bush, one flower, crops and boulders, while spells already have a structure kit with oak, pine, birch, willow, palm, dead, giant, mushroom and crystal trees (`src/sim/structures.ts`) that the generator never uses. Plants by biome and place, from that kit: willows by water, palms on beaches, birches at forest edges, dead trees in swamps, a rare giant tree, mushrooms in damp shade, cacti in deserts. Undergrowth: grass tufts, ferns, reeds and lily pads, several flowers in several colors that grow in meadows, berry bushes. Rocks: outcrops, scree under cliffs, standing stones, crystals in volcanic ground.
4. **Natural landmarks**, one or two per island and never the same set twice: a waterfall, a hot spring, a cave mouth, a stone arch (the kit has one), a lone hill tree, ancient ruins, a sinkhole lake.
5. **Villages that differ.** Several house styles chosen by what grows nearby (timber by forests, stone in the hills, stilts by swamps), wells, fenced fields, paths between houses, a dock on the shore, a shrine, a windmill on a rise; villages that grow these as they get richer.
6. **Everything placed does something** (the 3.6 rule): berries feed deer and villagers, reeds hide rabbits, mushrooms spread in the dark, a hot spring melts snow and heals, ruins draw explorers and monsters, a well waters fields. Each new kind gets a test in `npm test`, and old saves load unchanged (new cover kinds are added after the existing ids, never renumbered).
7. **Visual improvements**: baked ambient occlusion in the voxel lighting, better water (shore foam, depth color, gentle waves), weather you can see (rain, snow, fog), sun, moon and stars in the sky. Each measured with the HUD on a phone before it ships.
8. **Two pull requests**: terrain, nature, landmarks and villages first (items 2 to 6), then size and visuals (items 1 and 7), each measured with the HUD on a phone sized browser (voxel and instance counts, simulation and frame p95) against today's medium and large islands.

### 4.5 Sound and music

The island is heard the same way from everywhere: a sound carries no position, routine villager work plays a thump the player cannot place, and 12 voices serve 167 live programs (all of them call `w.sound`; "chime" alone 127 times), so spells sound alike. Goal: the island sounds like a place, each spell sounds like itself, and music follows what happens, all generated in the browser with no audio files and no new paid call.

1. **Sounds have a place.** Every sound event carries where it happened (a spell's default is its center, so `w.sound(name, size)` stays valid in every stored program). The listener is the camera: distance fades and dulls a sound (a low pass with distance), left and right follow the camera's angle, zoomed out the island is heard as a whole and zoomed in the near things stand out. Equal power panning by default, which is cheap on phones; HRTF only as a setting for headphones, since it costs memory and CPU on low end phones.
2. **A sound budget.** At most about 24 voices at once; sounds of the same name within 100 ms merge into one louder sound; each name has a cooldown; when the budget is full the quietest at the listener is dropped. Routine work (felling, building, digging) plays only near the camera, quietly, with variation. A test renders a busy island's events offline and checks that no name repeats faster than its cooldown.
3. **Ambience from what is in view.** Beds that rise and fall with what the camera sees, sampled a few times a second from the simulation's own grids: waves and shore where there is water, wind in leaves over forests, crackle and roar near fire, bubbling near lava, a village murmur and tools near houses, rain and wind with the weather (when 4.4 brings it), birds by day and crickets at night, a hollow wind at the island's edge.
4. **Creatures you can hear.** A short call per body plan and species, made from the same synth (a wolf howls at night, birds chirp, a dragon roars when it breathes fire, slimes squelch), rate limited and only within earshot. A creature's ability plays its own sound.
5. **Richer spell sounds, still backward compatible.** More voices (bell, gong, choir pad, wind, water, splash, crystal, heartbeat, thunder, roar, sparkle, pluck), each varied in pitch and timbre per cast so the same chime is never twice the same. A spell may describe a sound of its own within bounds (`w.sound({ wave, from, to, seconds, noise, filter, echo })`), as it describes a model of its own; the prompt gains a short section on it, measured against the judge and probes before and after, and **no stored program is rewritten** for it: old ones keep their names, which now sound richer by themselves. The tier of a spell scales its sound (a small spell a sparkle, a cosmic one fills the sky).
6. **Music that follows the island.** Generated from the island's seed (key, tempo, a few chord progressions, pad, bass, a sparse melody), scheduled on a timer about 100 ms ahead and never from the drawing frame, in layers whose volume follows the state: calm by day, sparse at night, tense when fire, monsters or a challenge's hazard rise, a short swell when a big spell lands, a few notes when something is discovered. It ducks under loud spells, rests often (silence is part of it), and changes key with the time of day.
7. **The Craft view is not silent.** A soft sound for picking up and dropping a chip, a merge that sounds by tier, a First Discovery that sounds like one, a refusal that is gentle. Its own small audio context on the page, the same mute rules.
8. **Settings and manners.** One sound button as today, plus volumes for music, effects and ambience in the menu; music off by default on first visit until the player turns it on; audio paused when the tab is hidden (battery) and resumed on return; a mono option; never a sound before the player's first tap (browsers forbid it, and it should not surprise anyone).
9. **Measured and tested.** Every voice rendered offline in `npm test` (no NaN, length bounded, peak and loudness within a range so no voice is ten times louder than another); the number of live audio nodes and voices in the HUD and in the perf sample; a ten minute session on a real phone with sound and music on, read back from `/api/perf`, simulation and frame p95 within the numbers of 4.4. Someone listens: the owner, on a phone, before merge.

### 4.6 Ready for strangers

AI Gateway spend caps, Turnstile, name checks, AI labels, small legal pages. Accounts (4.0) come first, so strangers can keep their progress. From the 4.0 review: trials decided by the admin's runner (or two browsers that agree), not by one browser's word (M11), since a stranger can promote a crashing program for everyone. Quotas, the report button and invite links instead of a shared token came early, in 3.4, for friends. Nothing public before this.
