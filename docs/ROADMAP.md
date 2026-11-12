# Where the game stands, and what comes next

Updated on 2026-11-04, with 4.4.6.

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

## Done in 4.0: a review, then accounts

Asked for: an independent review before the link goes beyond close friends, then accounts built on the reviewed code. `docs/REVIEW-4.0.md` has the findings and the numbers; DESIGN.md, "Accounts", has the rules.

1. **The review**: no critical finding; three high (a player's idea could be the routine's task, a challenge win could set par to 0 for everyone, a lost test verdict left a program a trial for good) and seven medium fixed with a check each; the hold proved by mutation; the sandbox headers verified on the live site; a newcomer's first ten minutes at phone size with screenshots; the open items numbered under 4.1 and 4.5.
2. **The invite becomes the account, with the same id**: a passkey made from the link creates it, the link dies, and spend, First Discoveries, ideas and wins follow with no move; votes and casts are the account's across devices.
3. **Sign in anywhere** with the passkey, or a one use link: the admin's "New link" on an account, or by email when a sender is set up (`EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`).
4. **Progress on the server**: discoveries as a union, the board, the island packed; last saved wins for the island, with a warning before an older device replaces a newer save, and the other island loaded if the player says no.
5. **The account page**: passkeys, devices (each can be signed out), what is saved, email, export as one file, delete everything.
6. **Checked**: `npm run test:worker` (one use links opened twice at once, a forged passkey answer, a spent challenge, sessions made up, signed out or deleted, one account reading or writing another's progress, malformed and oversized uploads, email links used twice and rate limited, export, deletion leaving nothing of the person and keeping the library and the spend) and `scripts/account-verify.mjs` in a phone sized browser with a virtual authenticator (a link into an account, a second device signing in and receiving the island, one link on two devices at once, deletion signing both out).

Not done: two tabs of one browser still overwrite each other's local saves (review M6; the server merge limits the damage to the island); the welcome is still long on a phone.

## Done in 4.1: the 4.0 review's open findings, fixed

Asked for: every open finding of the 4.0 review that code can correct, each reproduced first and shown passing after, no spell rewritten. `docs/REVIEW-4.0.md` says "fixed in 4.1" under each finding with its commit.

1. **Nothing lost without a word**: two tabs of one browser no longer overwrite each other (M6), a full storage says so (M13), a frozen World frame is replaced by a watchdog (M3).
2. **Server**: the admin token compared in constant time, perf samples rate limited, the cron's jobs caught and logged, pull requests linked to ideas only on `Closes` or `Fixes`, the chronicle digest quoted as data (L1, L2, L7, L8, L10).
3. **Players**: the vote bar and the challenge banner stacked on a phone (M10), a broken spell stops asking for repairs (L5), Retry keeps the challenge head start (L6), the refresh report says "not sent" (M12); **the drum** players kept hearing is gone (routine villager work is silent, an unknown sound name plays the nearest voice or nothing).
4. **Tests**: `scripts/` typechecked and linted, Worker test sections for votes, rewrites, rollbacks, repairs, casts, reports, spell info, spend, perf and the admin routes (M7), nothing asserted on wall clock time (M8), passkey counter and attestation checks; one tick loop, one PRNG and one admin helper for the runners (L4).

## Done in 4.2: faster creation, every item written at the merge

Asked for: everything from dropping one item on another to using the result gets faster, and every new item is written as soon as it is created; no lower quality (no fast mode, no weaker drafts), the extra cost of writing items nobody casts accepted inside a daily cap. Measured first, before any change: `docs/measurements/creation-4.2.md`. DESIGN.md, "Faster creation (4.2)", has the rules.

1. **Measured**: Server-Timing on every answer, a creation timeline in the page and in the HUD's perf sample, and three scripts: `creation-timing.mjs` (phone sized browser, real merges), `test-run-timing.ts` (every live program in Node), `quality-20.ts` (the 20 spells: test, probes, judge, cost).
2. **A bug the measurement found**: the probes (protection, five minutes) decided nothing in browsers since they were added; fixed, 15 live programs listed.
3. **The test run in a Web Worker** made by the sandboxed check frame, simulation only, run to the end; the five minute test stops once the artifact has acted.
4. **Every item written at the merge** by a Cloudflare Queue job, idempotent, paid by the merger, within $1.50 a day and 80% of the month; big items by Opus through the Batch API with no draft.
5. **Fewer waits**: three programs at once, castable on a local pass, independent calls side by side; **the hour's prompt cache** for the spell writer on every model.
6. **Chips** say writing, testing, ready, with a toast.

Not done: the real phone session (the perf sample now carries the creation steps: turn the HUD on and play a few merges); the prompt was not trimmed (DESIGN.md says why); a burst's later items wait up to 20 s for their job, since Cloudflare Queues adds a consumer only after a whole batch: Cloudflare Workflows, one instance per item, would run them side by side (size S to M). Owner's calls before the deploy: no draft for big items, and a big item's failed test is written again by Opus.

## Done in 4.3: creatures that move like they mean it

Asked for: every creature moves like it means it, with no new API call and no prompt change; measured first. Measured: `docs/measurements/movement-4.3.md`. DESIGN.md, "Creatures that move like they mean it (4.3)", has the rules.

1. **Measured first**: sharp turns (over 150 degrees within half a second) per kind on an island of 112, seeds 3, 6 and 9, natural ones apart from flip-flops, where each flip-flop came from, intent flips, stuck seconds, hops and action changes, printed by `npm test`. Half the deer's flip-flops were fear switching on and off at one distance, a fifth the way out chosen again every tick, a fifth the right angle side step.
2. **Decisions that stick**: fear with memory and hysteresis (alarmed at its sense, calm past 1.7 times it and 3 s out of sight), a flight way chosen once a second toward cover and the herd, meals from 0.7 to 0.3, the next task thought of in the same tick, wander points ahead.
3. **Steering**: heading and speed with acceleration and a turn rate per kind, turning on the spot, arriving, sideways separation, feelers that read slopes.
4. **Paths**: flow fields shared per destination, 1,500 cells a tick, made again after 30 s.
5. **Gaits and idles** in the rigs: walk, trot, run; grazing, looking around, lying down; the view turns with the simulation.
6. **Herds, flocks, packs**: a herd runs behind the one that saw the danger and drifts together, birds fly with a flock, wolves close in from around their prey.
7. **The same for everyone**: villagers, wildlife and spell creatures through one steering, no program rewritten.

Deer flip-flops 16.9 to 0.4 a minute (0.4 to 1.4 on four other sets of seeds), rabbits 11.2 to 1.1, villagers 4.1 to 0.4; deer stuck 15.2 to 0.0 s a minute; hops 4 to 6 a minute to under 2. Wolves still catch deer (10 over the scene's three streams, 7 on main), every challenge passes, the simulation's p95 on a large island is lower than main's.

Not done: real phones (the steering adds about 0.3 ms p50 and 0.4 ms p95 of creature time in Node, paid back by a cheaper temperature step; the HUD will tell); fish school with the herd rule and separation, not true boids; the lava challenges stay a coin flip on any three seeds (owner's call below).

Owner's calls: the challenge guard in `npm test` now also reads each plain solution's win rate over 12 seeds; the wildfire counts houses burnt, not houses standing; replays give creatures their own random stream.

## Done in 4.4: bigger and richer worlds

Asked for: bigger islands for devices that can run them (a huge size and beyond, offered only when the device's own HUD numbers show headroom, never by default on phones, saved on the account); biomes and island shapes with better rivers and coasts, chosen by a seed and sliders at reset, every species' habitat and `npm test` working on each; baked ambient occlusion, better water, visible weather, sun, moon and stars, each measured with the HUD before and after on a phone sized browser. Items 1 to 3 of "4.1 Bigger and richer worlds" below, which 4.1 left for later. DESIGN.md, "Islands of every kind (4.4)", has the rules; `docs/measurements/view-4.4.md` the numbers.

1. **A new island is chosen**: Reset opens a dialog with the size, the land (temperate forest, desert, tundra, jungle, swamp, volcanic, mesa), the shape (coast, archipelago, plateaus, ridges, inland lakes, delta), water, mountains and forest sliders, and a seed. The same seed and choices make the same island. `docs/visual-checks/biomes-and-shapes.png` shows all 42 from above.
2. **Rivers that run and lakes that stay**: depressions filled from the edge inward (priority flood), rivers where enough of the island drains (flow accumulation), always downhill and fordable, fed by springs at their heads and along their length; lakes keep their level, a volcano its lava; water leaves over the island's edge, so the sea does not rise (0.01 to 0.03 after three minutes on every biome).
3. **Every species lives on every biome**: the simulation keeps its materials (grass is grass in the desert), a biome brings its climate, colors, trees and weather; where a forest animal would have no habitat, a grove by a pond is planted (an oasis, a stand of pines), and a pool for the fish. `npm test` generates all 42 islands and checks villagers and every habitat, then leaves each biome alone for three simulated minutes in its worker threads (each species alive at least 60% of the time, villages standing, rivers running, nothing flooding or burning).
4. **Huge (288) and giant (384) islands**, offered when this device's frame numbers on its island project a simulation p95 within 12 ms and frames are on time (p95 under 40 ms); never chosen by default. Saves past 400k characters are kept gzipped (a giant island is 0.6M instead of 2.5M), in the browser and on the account; the Worker accepts the two sizes.
5. **The view**: ambient occlusion per corner and in the creases of walls; water colored by depth and biome, foam on the shore, waves that stay still at the shore; rain, snow and fog that come and go by biome, from the seed and the time (the simulation never knows); a sun and a moon on a low path, stars at night. Each behind a switch, measured alone: none costs more than the noise (about 0.3 ms of drawing at p50).
6. **A bug the measure found**: flowing rivers rebuilt terrain chunks every frame (6.2 ms of drawing instead of 2.5); wetness and levels are now redrawn with a margin and, when only water flowed, from a slow queue. And one in the engine: after a restart a frame could step time backwards and hold the simulation still.
7. **Checked**: `scripts/verify-4.4.mjs` runs the real game in a phone sized browser against `wrangler dev`: no huge or giant without headroom, a desert of lakes from seed 42 saved and loaded, with headroom every size offered and none chosen, a giant tundra kept gzipped and loaded again.

Not done: real phones and a real GPU (the measure is a phone sized browser with software WebGL: the JavaScript side is measured, the GPU is not); the delta's fan of branches is faint at 152 cells; islands saved before 4.4 keep their old land (a reset gives the new one) but get the sky and weather; weather does not touch the simulation (rain does not put out fires): it would change challenges and test runs, so it waits for the owner's call.

## Done in 4.4.1: the seed chooses, big islands mix

Asked for, after 4.4: no choosing a land or a shape from a list; several lands on one island where the island is big enough. DESIGN.md, "Chosen by a seed, mixed on big islands (4.4.1)", has the rules.

1. **The dialog** has a size, a seed and four sliders (warmth, water, mountains, forest). The seed picks the shape; warmth and water pick the land the way climate does, with a little of the seed, so mid sliders still give one island in six cold and one in six hot.
2. **Large, huge and giant islands always mix lands** in regions about 100 cells across, from a warmth and a wetness drawn over the island (a cold side, the cold of high ground), with speckled borders; one in three has a volcanic region. Each cell has its own climate, ground, forest, colors, trees and water; terraces and swamps fade at a region's edge; the weather is the region's under the camera. 24 large islands of 24 mixed two lands or more (4.5 on average).
3. **Rivers wind** (the owner's feedback on 4.4: straight runs and right angle turns): each river's route is bent into meanders along a curve and carved along it, banks worn so walkers climb out. Longest straight run 26 to 13 cells, steps in straight runs of 8 or more 25% to 3%, river cells with a bank too high to climb 2.7% to 0.2%.
4. **Checked**: the seed's rules on 400 seeds, four large islands mixing lands with every habitat, the regions and climates through a save, a mixed island alive for three minutes in `npm test`; `scripts/verify-4.4.mjs` makes a hot dry island from seed 42 (a desert) and a giant mixed island in the real game. A mixed island costs about 0.3 ms more per tick.

Not done: villages do not dress by region yet (a desert village looks like a temperate one); animals keep their habitats, not their regions (no camels, no polar bears).

## Done in 4.4.5, part A: nature that is never the same twice

Asked for: items 1 to 5 of "4.4.5 Every island a surprise" below, and the balance items 13 to 16 for what they add. DESIGN.md, "Nature that is never the same twice (4.4.5, part A)", has the rules; `docs/measurements/nature-4.4.5.md` the numbers and frames.

1. **Variety inside a region**: each cell has its tree by place (willows by fresh water, palms on warm beaches, birches at forest edges, pines up high, cypresses in swamp water, dead trees and giant mushrooms in damp old hearts, acacias in dry land), 17 styles from the structure kit's palettes, and every tree its own height, girth, lean, turn and tint; old hearts grow bigger trees.
2. **Undergrowth and ground by ecology rules**: reeds, ferns, berry bushes, fallen logs, fungi rings, flowers in drifts of one color and meadows in forest clearings, cacti, tufts of grass, lily pads, moss on north walls; outcrops, scree under cliffs, pebbles on beaches, standing stones, volcanic crystals. Sixteen cover kinds after the old ids and a path ground; old saves load unchanged (`builtins` in the save).
3. **Rare variants**: ten, by land, one patch in ten: cherry grove, red autumn forest, bamboo, mangroves, glowing mushroom wood, petrified forest, salt flats, crystal desert, glowing shore at night, flamingo lagoon. 33 of 80 medium islands have one.
4. **Villages of their region**: adobe, snow roofs, stilts, stone or timber by land and by the wood around; a well from the start, then fenced fields, a shrine, a windmill on a rise and a dock as the stores grow (over about ten minutes of play), paths worn where villagers walk.
5. **Animals of their region**: camels, lizards, polar bears, foxes, hares, frogs, herons, monkeys, parrots, salamanders, flamingos, each a body, a goal and a place in the food web, counted on their habitat.
6. **Balance (13 to 16)**: births follow food (grazers under their plants, hunters under their prey), arrivals from the edge under a quarter, walking out past twice, a refuge per species and block, succession after fire; checked by half an hour on every land and a mixed large island and a wipe on two islands in `npm test`.
7. **Found in the frames**: rain, snow, smoke and lightning halos were hidden behind water since 4.4 (drawn before it, writing no depth); now drawn after it.

Not done: tree models are box models with a per-tree shape, not voxel trees grown by the kit (a forest of kit trees would be hundreds of voxels each, past the 20,000 voxel budget spells share); one shape per style (two or three cost a draw call each per style, and lifted a large island from about 45 to 80 calls); monsters and spell creatures rely on the caps they had (part B and C check again); `npm test` takes about ten minutes instead of three and a half, for the half hour runs.

## Done in 4.4.5, part B: wonders, and villages where no two houses are alike

Asked for: items 6 to 8 of "4.4.5 Every island a surprise" below, buildings that differ inside a village, and the balance checks again. DESIGN.md, "Wonders, and villages where no two houses are alike (4.4.5, part B)", has the rules; `docs/measurements/wonders-4.4.5-b.md` the numbers and frames.

1. **Wonders by rarity**: seventeen kinds, five common, five uncommon, four rare, three legendary, each in the lands it belongs to. Two to four an island, one uncommon or better, never the set of one of the player's last ten islands (the page keeps the sets). On 96 islands every kind appeared, a legendary one on 6.
2. **Every wonder does something**: geysers throw whoever stands on them, a hot spring heals and melts the snow, miners take a crater's ore home as gold, the dead rise from giant bones on a full moon (one night in four, the moon drawn bigger), a fairy ring makes creatures dance at night, a dragon wakes when its gold is taken, a frozen waterfall thaws under heat and runs, and the rest (the table in DESIGN.md). Checked one by one in `npm test`.
3. **Names and a first look**: islands, wonders and villages named from syllables of their land, no API call; a new island opens with a short flight over its wonders, each with its name and what it does, skippable by a tap.
4. **Buildings that differ inside a village**: every house from its own seed (size, roof and its color, walls, door to the plaza, shutters, porch, chimney, lean-to later, a patched roof after a fire), all in one draw call; ten buildings with a job that each do something; a plaza, a main street, gardens, hamlet to village to town.
5. **Balance**: every new creature from a wonder comes from a capped source; part A's half hour runs and wipes pass with wonders and buildings on the islands.
6. **Found on the way**: "calm" stops a creature where it stands, so auras soothe fear instead (the first build froze villages round a chapel); a sinkhole in the tundra froze solid (deep water does not freeze now).
7. **Back only where it can live** (the owner's rule): a kind with habitat on the island never dies out (room for a pair whatever its food, a pair walking in when too few, a small habitat never missed); a kind whose habitat is gone, or a village whose houses are all gone, does not pop back, and returns only as the land regrows. Checked in `npm test` both ways (a wipe that leaves the habitat, a scorched island).
8. **The owner's report on part A, fixed**: fish drawn on frozen lakes (now under the ice), rivers invisible on big islands (wider on large and bigger, running water freezes only below -10), Huge and Giant locked on fast devices (a recommendation now), and picking a spell still being made cast the previous one (a creation bar, a wait message, the spell in hand once ready).

Not done: wonders are box models, not voxels (they cost no voxel budget, and a spell's blast takes a standing one away rather than breaking it block by block); villagers do not rest under a lone tree or bathe in a hot spring on their own, they get the effect when they pass; no sound of their own for wonders yet (4.8, sound and music).

## Done in 4.4.5, part C: a library of nature that keeps growing

Asked for: items 9 to 12 of "4.4.5 Every island a surprise" below, with the wonder prompt, three wonders it wrote and the cost from the ledger shown first; the owner chose Opus from uncommon up, a full moon trigger, a test that shows each wonder its change, and the judge's advice, and asked for the wonders to go into a pool every player's new islands draw from. Then, from a phone during the work: too much water, bad waves, elongated lands, too many cliffs, a weird sea. DESIGN.md, "A library of nature that keeps growing" and "The owner's report on the land and the water", has the rules; `docs/measurements/wonders-4.4.5-c.md` the numbers and frames.

1. **A new wonder a day from the API**: a rarity, a land and a change of time drawn each day, the wonder written as a program in the spell format with its kind, lands, spot, reach and line for the first look, through the Batch API at half price (Haiku for a common one, Opus from uncommon up), in its own cap, `WONDER_BUDGET_USD` ($2, holds of $0.10 and $0.01 before each call). From the ledger: about $1.03 a month, $1.69 at worst. The first prompt wrote one wonder in three that passed; the second, three in three on the existing test.
2. **Tested in Node by the nightly Action** (`npm run wonders`, `src/sim/wondercheck.ts`): built on three islands of its lands at its spot, a day and night from the morning of a full moon, a drought round it when it speaks of one; it fails on a crash, nothing built, over 1,500 voxels or 2 ms a tick, nothing done, over three of its creatures, or half the villagers or animals gone. Live or rejected with the reason; the owner retires or puts live any wonder (People, Wonders). The judge scores two day frames and a night one, as advice.
3. **A pool for everyone**: `GET /api/wonders`; every new island draws from the live wonders beside the seventeen built-in kinds, in their lands; the save keeps a wonder's code, so a retired one stays where it is. The three wonders shown to the owner are in it: the aurora ice spires and the moon mire live, the dew towers rejected (they did nothing on one island in three).
4. **Players' discoveries grow into the world**: a day's new artifacts up to grand are sorted by Haiku (place, material, creature, object, person); places, materials and creatures become rare trial wonders with their live program and the name of the friend who found them first, tested like any wonder. Nothing goes into an inventory.
5. **New on islands this week**: said once when the World opens, and listed in the new island dialog.
6. **A full moon trigger** for artifacts (`when: "full moon"`), asked for by both Opus wonders.
7. **The owner's report on the land and the water**: noise that grows with the island and a warp that no longer stretches lands into worms, ridges on broad lands instead of in bands of sea, only the largest hollows kept as lakes, a little less sea, slopes softened once (cliffs of two voxels or more: medium 12.8% to 4.8% of land, huge 12.6% to 1.6%; water: medium 31% to 27%, huge 34% to 26%); waves drawn per pixel as thin broken crests instead of a vertex heave; the sea's color shaded per corner and nearly opaque past four voxels, so the seabed's steps no longer show through as a grid.
8. **Found on the way**: water tops on gently sloping rivers opened hairline gaps (a corner judged against each top's own level); the frozen waterfall's check passed only while the land round it was warm.

Not done: the production call has not run yet (the container had no API key; the first daily wonder will be the first real ledger row); the two program wonders up close are clusters of voxel pillars, chunkier than the built-in box models (the kit's spire is coarse; the judge's advice will say whether the next prompt should steer them to the land and fewer, finer voxels); "new this week" is a toast and a line in the new island dialog (4.5's what's new list now carries the updates).

## Done in 4.4.6: accounts you can trust

Asked for: items 1 to 7 of "4.4.6 Accounts you can trust" below, the two bugs reproduced as failing tests before any fix, the live database exported before the migration, and the flow shown on the live site on a phone and a computer before merging. DESIGN.md, "Accounts you can trust (4.4.6)", has the rules; `docs/measurements/accounts-4.4.6.md` the tests before and after.

1. **Reproduced first**: `scripts/worker-test.mjs` section 29 and `scripts/account-verify.mjs` E (the owner on a computer and a phone) and F (Ben signing in on the phone Ann used) failed 12 and 12 on main: the phone showed 8 items after the computer found 9, and Ben's account received Ann's discovery and island.
2. **The owner is an account**: `migrations/0015_owner_account.sql` adds the `admin` flag and the owner's row with the id the admin's rows already use (`admin`), so nothing moves. The device holding the token makes its passkey; then any device signed in to it has the admin powers with no token, the token is dropped from the browser, no allowance of its own. The token alone works as before for scripts and the nightly Action, and a session beside it is never hidden. The owner's row cannot be paused, revoked or deleted, only given a new link.
3. **Progress belongs to one account**: the save is tagged with its account; another account's save is set aside on sign in (IndexedDB), never merged or sent, and comes back when its account returns; the Worker refuses an upload tagged with another account; an untagged save is offered once. Sign out asks to remove (the default) or keep a copy, and keeps a copy anyway when it cannot save first.
4. **Sign in, sign out, switch, "signed in as"** in the `?` menu, and the passkey sign in on the gate, whatever the device holds; the account page lists devices with their last sync.
5. **Sync you can see**: the status line, **Sync now**, a pull of the discoveries every minute, the Worker joining discoveries instead of replacing them; a newer island from another device is taken when this one did not change, offered next to this one when it did, and the one not played stays on the account as the previous island.
6. **What syncs** is written in DESIGN.md: discoveries, board, island, wins, ideas and votes, the recipe book through the discoveries, the favorite spell once it exists; settings stay per device, on purpose.
7. **Checked**: every test above passes, with the 4.0 attacks of `docs/REVIEW-4.0.md` section 10 (the worker section 16 and 26 checks, account-verify A to D) and `scripts/verify-4.1.mjs`. On the live site, a computer and a phone ran the flow with test accounts (`docs/review-4.4.6`); the owner's own passkey is left for the owner to make (SETUP.md, "Your own account").

Not done: the board is still taken only when the device's board is empty (last saved wins otherwise, as in 4.0); a newer island noticed while playing is offered, not loaded by itself; a save set aside lives in that browser's IndexedDB only, so clearing the browser's data loses the copy (the account still holds what it synced).

## Done in 4.5: daily challenges, the Community tab and what's new

Asked for: the five items of "4.5" below, with the owner's answers on the two open questions of daily challenges (whoever reaches the new item first wins, owning the parents or not; a challenge never expires and there is no cap), deployed and merged without waiting. DESIGN.md, "Daily challenges, the Community tab and what's new (4.5)", has the rules; `scripts/worker-test.mjs` section 30 the checks.

1. **Daily challenges**: the first cron run after midnight in Toronto merges two pool items nobody merged, keeps the result only if it is truly new, describes it without its recipe and writes its program ahead; the pair stays out of the recipe book. The first to reach the item is its finder and First Discovery (the secret pair is free); a Daily tab lists every open one and the last finds. About $0.003 a night plus the program.
2. **The Community tab**: who plays, when, items found, First Discoveries, daily finds and each friend's favorite spell, no recipe; the favorite and a hide switch on the account page and at the foot of the tab.
3. **What's new**: `public/changelog.json`, a dot on the `?` button and a list since the last visit, "your idea was built" by title.
4. **Ideas follow pull requests**: the `Ideas` workflow moves `Idea #<n>` to "Waiting for review", then "Done".
5. **Previews**: a staging Worker with its own D1 (copied nightly, accounts stripped), its own queue and $5 a month (raised from $2 on 8 November 2026); each pull request gets `pr-<n>-magic-merger-staging.angelus76300.workers.dev`. Staging lets nobody in without the admin token.

Not done: without `STAGING_ANTHROPIC_API_KEY` the previews run in mock mode (the `CLOUDFLARE_API_TOKEN` secret is set since 5 November and previews upload); the Community tab has no name checks or report button yet (needed before 5.4); "items found" is unknown for friends who play with a link and no account.

## Done in 4.5.1: an audit, and the fixes that needed no owner

Asked for: every claim checked (`docs/AUDIT-2026-11-05.md`, about 760 claims, 25 live items cast in Node, five guards broken on purpose, the newcomer's path at phone size, the development loop), then the fixes that do not need the owner, merged and deployed. Section 31 of `scripts/worker-test.mjs` and `scripts/fixes-test.ts` (run by `npm test`) hold the checks; each was seen to fail with its fix taken out (an adversarial review by fresh subagents broke them on purpose). The three attempt gates and the page's call sites in `src/worldhost.ts` and `src/whatsnew.ts` are covered through the one function each calls (`takeRun`, `reportable`, `whatIsNew`), not one by one.

1. **No paid loop**: the API designer, the daily challenge and the daily wonder record every attempt (`job_runs`, migration 0017), so a design answered "none", a night with nothing new or a wonder that failed its checks waits for the next day instead of calling Opus every ten minutes. The daily rewrite budget now covers failed test runs and broken promises too. The sweep waits for a wonder's batch and frees the hold of a rewrite that never got a batch.
2. **Promises**: `w.body()` keeps a copy of the `data` a program gives it (Starfall Rain heals again; up to 32 live programs used it); a refusal is never stored as a description, nor kept in a device's cache (Village's is written again the next time its card is opened; one refused twice gets a plain "no description yet", stored so it is not paid for again); a test run that times out is no pass for everyone; a failure with no named problem is a crash, not a pass; past the day's rewrite budget a failed trial waits as a trial instead of going live; a challenge win is checked against a true lower bound, so an honest one is no longer refused, and a claim the graph cannot check never lowers par.
3. **Players' data**: a wonder grown from a find shows its finder only while the account exists and is not hidden, on new islands and on islands already saved (the name stays inside islands saved before, unseen; taking it out of other players' saves would rewrite their data, the owner's call); deletion also clears that name, frame times and refusals; export adds the days played, daily finds, community settings, wonders, frame times, refusals and items written ahead (rewrites and holds keep the id for the budget and are left out); a challenge attempt and a win not yet recorded belong to the account on the device; the staging copy drops players' idea text.
4. **Tests that can fail**: fire spreading into a ward, the staging guard in mock mode, the CSP and the iframes' sandbox, the daily description that keeps its recipe secret.
5. **Small things players saw**: "1 new since your last visit" no longer comes back after reading, and an update or a built idea later the same day still shows; the Daily tab no longer says every challenge was found when none existed; the Community tab's items found leave out the eight forces and its last play is to the hour.

Not done, waiting for the owner (4.5.1a below): the preview pipeline and the production admin token, branch protection, rewrites of Frost Nova and Light, and a CI job for the browser checks.

## Done in 4.5.2: the AI drives, the owner steers

Asked for: the seven items of "4.5.2" below, with a dry run on three recent pull requests and the brief the owner would have received (`docs/LOOP.md`). The rules are in `docs/DAILY.md`; the reviewer's protocol in `docs/REVIEWER.md`.

1. **Production deploys only from `main`**, by the `Deploy` workflow after CI: the gate's deploy check, migrations, `wrangler deploy` with a `main <sha>` message, a read only smoke test of the live site at 390 by 844 and the health route (`scripts/smoke.mjs live`), the Worker's failed invocations in the minute after, and `wrangler rollback` with an issue labelled `rollback` on any failure or cancellation; a red `main` opens an issue too. `npm run deploy` refuses outside GitHub Actions.
2. **Risk classes** read from every diff (`scripts/risk.mjs`: 14 red rules, 8 amber; `npm run test:risk`, 144 checks, and the table in `docs/DAILY.md` checked against the script). The `Gate` workflow merges green once CI ran in full, the preview smoke test passed and an independent review of the head commit passed; amber needs the owner's OK, red the owner's yes, each recorded by the planner as a label and an `mm-owner` comment.
3. **A reviewer that is not the builder**: a separate session, blocking on what it can show, reproducing one claim on the preview; a block or a raised class sticks on its commit. This version itself went through five review passes by four fresh agents (the last three by the same reviewer session, as the protocol asks); every finding they could show was fixed before the merge, among them a deploy that would have shipped dependency versions CI never tested.
4. **The planner** gets a night run that starts the builder and the Night workflow, and a morning run that looks at the night's frames and sends the brief with questions, options and a recommendation.
5. **The night** (`.github/workflows/nightly.yml`): the newcomer's path and a ten minute session on a random island on staging, frames for the vision check, the live errors, slow ticks, down votes, open reports and refusals, and drift between production and `main`.
6. **Three designer ideas a week**, the first three in `docs/IDEAS.md`.
7. **Measured** in `docs/LOOP.md` (`scripts/loop-metrics.mjs`), with the baseline from the audit.

Also: previews of the Ideas routine's pull requests wait for `owner-ok` (audit risk 1, in part); previews, staging and the night use a staging only admin token once the owner sets `STAGING_ADMIN_TOKEN`; CI skips its two long steps on drafts and docs only changes and cancels superseded runs (measured from the Actions runs: 451 minutes on 4 November, 1,154 from 1 to 5 November, of the 2,000 a private repository gets free each month).

Not done: what only the owner can change (4.5.1a), and the planner's schedule (a night run and a new prompt), which the owner applies. As long as sessions act as the owner's GitHub account with the Cloudflare token in their environment, the gates hold against mistakes, not against a session that sets out to break them (`docs/DAILY.md`, "What holds").

## Decisions taken

1. **Cosmic spells may ruin the island.** Consequences are part of the fun; the land regrows on its own (ash turns to soil, grass and forests come back) and Reset is one tap away. Revisit if it feels punishing in play.
2. **Haiku writes spells up to grand, Opus the legendary and cosmic ones** (see DESIGN.md for the measurement).
3. **Declined by the owner**, and never built unless the owner reopens them: hints, suggested recipes or any idea handed to players (players are the creative ones; challenges stay "fewest merges from nothing"); village mana; discoveries made in the World; sharing features ("Things worth sharing"); fast mode or weaker drafts shown to players to make spells appear sooner. The daily planner and builders read this list (`docs/IDEAS.md`, "Declined").

## What to watch

1. **The judge and the votes.** 69 votes by 5 November, still too few to calibrate the judge, which only advises; the library is empty until players vote programs up. Watch `GET /api/admin/judge-stats` after a week of play, and how often a vote leads to a rewrite and a rewrite to a rollback (`rewrites` table).
2. **Phones.** Still measured only in Node and a headless browser. The HUD sends real numbers to `/api/perf` as soon as someone plays with it on. In steady state the simulation's cost is temperature and fluids (about 40% of a tick in every scene), not voxels or creatures: that is the next lever if phones run hot.
3. **Sounds** were checked for errors, not listened to. Players heard a drum that never stopped (the woodcutters); 4.1 silenced routine work, and 4.5 gives the island real sound.
4. **Whether Claude uses bodies.** New spells should declare `body` and `features`; models should stay rare. Look at a week of new programs (`programs` table) for how often each appears, and at the bestiary when one looks wrong.
5. **Creatures on phones.** 375 creatures cost 1.0 ms p50 but 5.1 ms p95 of CPU in the headless browser; the HUD's `parts` count in `/api/perf` will say what a real island costs.
6. **Challenge balance with real spells.** The checks use simple hand-written solutions; Claude's spells may be stronger or weaker. Wildfire used to be won by doing nothing 1 time in 5: villagers rebuilt the burnt houses while the fire died down, and the end check counted them. It is now lost the moment a second house burns, and `npm test` replays every challenge with nothing over 8 seeds (0 wins in 64 for Wildfire, rain still wins 64 in 64).

7. **The API's growth.** Read `GET /api/admin/evolution` weekly for a month: are gaps honest (the writer saying what it lacked) or noise, does the designer choose helper, hint or engine sensibly, and do live helpers get used. If gaps are mostly noise, raise the three spells to five before anything else.
8. **Big islands and the new view on phones.** The HUD's samples in `/api/perf` now carry the island's width; look for huge and giant islands and how their simulation p95 compares with `headroom.ts`'s projection (12 ms). If a phone's frames suffer from the view, `src/sim/voxel/graphics.ts` turns each improvement off.
9. **Movement on phones.** The steering and flow fields add about 0.3 ms p50 and 0.4 ms p95 of creature time per tick in Node on a large island (cheaper temperature pays it back). `parts` and the simulation p95 in `/api/perf` will say whether a phone feels it; `BUDGET` in `src/sim/paths.ts` is the first knob.
10. **Stored protection spells.** Export them (`scripts/replay-stored.ts` has the command), run the probe on each, and rewrite the ones that fail from the admin card, one at a time, never in bulk.

## What the money taught us

The ledger holds $15.41 for November by the morning of 5 November (read in the live `spend` table by the 4.5.1 audit; plus about $3.32 in October before it existed). Since 3.4 the cap is $50 a month, $48 for the game since 4.5 with $2 for the previews (raised to $5 on 8 November 2026, which on one key can pass $50 by $3). Opus spells are 88% of it. Opus spell calls went from 43 to 96 in one day because the program version bump to 4 rewrote every big spell on its next cast. **Never rewrite spells in bulk again**: new API features stay backward compatible, and spells are rewritten one at a time (an admin button in 3.2, player votes in 3.3).

## Next versions

### The list as it stands (12 November 2026)

The lead session (`CLAUDE.md`, "Who leads") shipped five updates on 11 and 12 November from the owner's brief of six bets, without writing them here. They are numbered below so that this file is the one list again. Versions that are done keep their sections further down; states of 4.6 to 4.9.5 are read from `docs/HANDOVER.md` and the merged pull requests, not replayed.

| Version | Name                                                                | State on 12 November                                                                      |
| ------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 4.6     | Every item is what it is                                            | Built; the library's rebuild by kind at 220 of 483 items, 20 a day                        |
| 4.7     | Things that behave as they should                                   | Not started as a version; pieces through daily fixes. Folded into 4.12 below              |
| 4.7.5   | A game that runs itself                                             | Partly: the Worker's daily jobs run; "spend only on what players use" is open             |
| 4.8     | Sound and music                                                     | Built; the Sound button fix (#94) on its way                                              |
| 4.9     | Builders: villages that grow, roads and vehicles                    | Parts 1 and 2 built. Part 3 open: towns and the island's life read from the normal zoom   |
| 4.9.5   | Wonders review                                                      | Approved by the owner ($3 to $6), not started                                             |
| 4.10    | The island tells its stories (#121)                                 | Live, 11 November                                                                         |
| 4.11    | The island needs you: a wildfire (#123)                             | Live, 12 November                                                                         |
| 4.11.1  | Weather that crosses the island (#124)                              | Live, 12 November                                                                         |
| 4.11.2  | High water, the second trouble (#134)                               | Built, in its second round of fixes; the owner's OK recorded                              |
| 4.11.3  | A drought, reworked                                                 | Designed and challenged (`docs/HANDOVER.md`), not built                                   |
| 4.12    | Spells that are smart, varied, and answer each other                | New, the owner's ask of 12 November; measured first (below)                               |
| 5.0     | Look closer: select anything                                        | Partly: creatures have a card with Follow and Become; buildings, trees and wonders do not |
| 5.1     | Take control, shipped as "Become anything, through its eyes" (#131) | Live, 12 November, ahead of its place in the order                                        |
| 5.1.1   | The island seen from the ground (#132)                              | Live, 12 November                                                                         |
| 5.2     | Looks and speed (with "it runs beautifully on the Fold")            | Not started                                                                               |
| 5.3     | Interface, accessibility and quality of life                        | Not started                                                                               |
| 5.4     | Ready for strangers                                                 | Not started                                                                               |
| 5.5     | Items worth showing a friend                                        | Not started; needs the owner's yes (a running cost, and something public)                 |

The order from here: 4.11.2, then 4.9 part 3, then 4.9.5, with 4.12's measurement and 5.5's design page alongside, since both end in a question for the owner.

### 4.12 Spells that are smart, varied, and answer each other

The owner, 12 November: "I am still not satisfied at how smart, varied, how spells interact with each other". Three complaints in one sentence, with different causes, so it starts by measuring which one players meet most, on the live library, before anything is rewritten (rewriting stored programs in bulk needs the owner's yes, and the last bump of `PROGRAM_VERSION` doubled a month's spend in a day).

1. **Measure first, on the live library, read only.** For every live program: what it actually does on a practice island (materials placed, creatures made, land changed, how long it lasts), grouped into shapes, to answer "varied" with a number: how many items fall into the five most common shapes (a ball that bursts, a ring of something, a creature dropped, a patch painted, a dome). Then pairs: cast A, then B on it, for a sample of a few hundred pairs across kinds and tiers, and count how often B's result differs from B alone. That is "interact". "Smart" is the hardest to count: a program that reads the island before acting (what is under it, who is near) against one that ignores it.
2. **Interaction through the land, not through each other.** A spell cannot know the 483 others; it can declare what it is made of and what it does to what (the 3.0 reactions, the 3.1 lures and fears, the 3.4.2 wards). Where the measure shows a reaction missing in the engine (steam from fire on water exists; what does lightning do to a flooded field, cold to a swarm, shadow to light), add it once in the engine, so every stored spell gains it with no rewrite and no cost.
3. **Sameness at the source.** If the shapes are few, the cause is the writer's prompt and its examples, not the items: change what new items are asked for (a signature that no other item of its kind has, checked against its neighbours in the library at writing time), and let the existing rebuild by kind carry it to old items inside its approved budget.
4. **Reading the island.** Helpers that make the smart thing the easy thing for the writer: what is here, what would this hurt, where is the nearest village, water, fire; and a check in the test run that a program asked at least one question of the island when its name promises judgement (a guardian, a healer, a hunter).
5. **Shown to the owner as before and after**: the three numbers, and twenty pairs filmed, before any spend is proposed.

Sizes are per Claude Code session: S a few hours, M a full session, L two or more. The roadmap page has a ready prompt per version.

**Numbered in the order to run them.** Renumbered on 3 November so the numbers are the order; `docs/REVIEW-4.0.md` and older pull requests use the old numbers (the review's findings were 4.0.2, faster creation 4.0.1, worlds 4.1, sound 4.2, strangers 4.6). Done since: 4.1, 4.2, 4.3, 4.4, 4.4.1, 4.4.5 (parts A, B and C), 4.4.6 and 4.5, summed up above; their plans are in the git history of this file. Revised on 5 November with the owner's new ideas, in this order: 4.5 daily challenges, the Community tab and what's new (the owner asked for it next), 4.5.1 an audit of every claim and of the development loop, 4.5.2 the AI drives and the owner steers, 4.6 every item is what it is (creatures, objects, buildings, settlements, places and land, each made by the engine's own makers), 4.7 things that behave as they should, 4.7.5 a game that runs itself and a morning brief that makes you want to build, 4.8 sound and music (was 4.5), 4.9 builders, roads and vehicles, 5.0 look closer and 5.1 take control (the first person update), 5.2 looks and speed, 5.3 interface, accessibility and quality of life, 5.4 ready for strangers (was 4.6). The daily updates run between them: the planner gives the next version when none is being built, and a small daily fix in other files while one is.

### 4.4.5 Every island a surprise (done, see above)

Goal: be amazed at every new island, never feel the same one twice, and have it stay alive and balanced. Checked against main on 4 November: 4.4 gave each biome one tree look among seven models (oak, pine, palm, snowy pine, jungle, willow, juniper) and planted oases where a habitat was missing; a region otherwise has one bush, one flower, crops and boulders (cover kinds unchanged since 3.0), the structure kit (`src/sim/structures.ts`: birch, dead, giant, mushroom and crystal trees, arches, towers) is used only by spells, and 4.4.1 left villages and animals alike in every region. Native numbers are kept up by births in the habitat (`creatures.ts`, `lifeCycle`), with no notion of food, recovery or new species. Three parts, each its own pull request, in this order.

**Part A. Nature that is never the same twice**

1. **Variety inside a region**: several trees per region chosen by place (willows by water, palms on beaches, birches at forest edges, dead trees in swamps, mushrooms in damp shade, cacti in deserts), each grown from the kit with its own height, lean, crown and color within its kind, so no two trees and no two forests repeat.
2. **Undergrowth and ground**: grass tufts, ferns, reeds and lily pads, moss on north faces, fallen logs, several flowers in several colors growing in drifts and meadows, berry bushes, fungi rings; rocks as outcrops, scree under cliffs, pebbles on beaches, standing stones, crystals in volcanic ground. Placed by ecology rules (wetness, light, slope, height, neighbors) rather than noise alone, so a forest has an edge, a clearing and an old heart.
3. **Rare variants of a land**, a few percent of regions, chosen by the seed: a cherry blossom grove, a red autumn forest, a bamboo stand, mangroves, a glowing mushroom wood, a petrified forest, salt flats, a crystal desert, a bioluminescent shore that lights up at night, a flamingo lagoon.
4. **Villages that differ** (4.4.1: "a desert village looks like a temperate one"): house styles by region and by what grows nearby (timber, adobe, stone, stilts, snow roofs), wells, fenced fields, paths worn where villagers walk, a dock on the shore, a shrine, a windmill on a rise, added as a village gets richer.
5. **Animals of their region** (4.4.1 left them on habitats): camels and lizards in deserts, polar bears, foxes and hares in the tundra, frogs and herons in swamps, monkeys and parrots in jungles, salamanders near lava, flamingos in lagoons; each a body from the 3.5 plans, a goal, and a place in the food web.

**Part B. Wonders, and a first look at every island**

6. **Wonders by rarity**: a catalog of natural wonders, each with a rarity: common (a waterfall, a hot spring, a cave mouth, a stone arch, a lone hill tree), uncommon (ruins of an old village, a sinkhole lake, geysers, sea stacks, a meteor crater with strange ore), rare (a floating rock, giant bones half buried, a frozen waterfall, a fairy ring that hums at night), legendary (a world tree, a sleeping dragon's hoard, a sunken temple). Every island gets two to four, at least one uncommon or better, and never the same set as the player's last ten islands (the browser keeps their signatures).
7. **Every wonder does something** (the 3.6 rule): a hot spring melts snow and heals, geysers throw what stands on them, ruins draw explorers and monsters, a fairy ring makes creatures dance at night, ore in a crater draws villagers to mine it, bones raise a skeleton on a full moon.
8. **A name and a first look**: each island and its wonders get names from syllables per region (no API call: "Vael's Hollow", "the Weeping Falls"); a new island opens with a short flight over its wonders, skippable, so the player sees what is special about this one before anything else.

**Also in part B, buildings that differ inside a village**, not only between regions: no two houses alike. Each from a seeded house builder (like the body plans: a few cached shapes per island, so draw calls stay low): size (hut, cottage, longhouse, two storeys), roof (thatch, tile, slate, flat, turf) and its color, walls, chimneys, porches, shutters, a lean to added later; patched roofs after a repair. Buildings with a job, each doing something: a smithy (villagers arm themselves), a granary (food kept through winter), a bakery, a barn and stables, a tavern where villagers gather at night, a market with stalls on trade days, a chapel or shrine, a watchtower that spots monsters early, a lumber yard, a fisher's hut on the shore. A layout with a plaza, a main street, houses facing the paths, gardens and fences, growing from hamlet to village to town as the village gets richer.

**Part C. A library of nature that keeps growing**

9. **A new wonder every day, from the API**: one call a day (like the daily design call of 3.4.2) designs a new wonder as a program in the existing format, from the structure kit, the behaviors and the abilities: what it is, where it grows, what it does, its rarity. Haiku or Opus as the tier says, in the Batch API at half price; about $0.03 to $0.06 a day, under $2 a month, inside its own cap.
10. **Tested before any island gets it**: in Node by the nightly Action (the way `evolve-runner.ts` tests helpers), not by a player's browser (review M11): it builds, stays within a voxel and tick budget, does what it says on three seeds, breaks nothing in five simulated minutes. A wonder that fails is thrown away; the owner can retire any wonder from the admin view.
11. **Players' discoveries grow into the world**: items players found that are places, materials or creatures (an Ancient Oak, a Crystal Spire, a Will-o'-wisp), up to grand tier, become rare wonders of new islands, with the name of the friend who found them first. Nothing goes into anyone's inventory: discoveries stay made on the board (Decisions taken).
12. **What is new shows**: "new on islands this week" in the what's new list (4.5), so returning players have a reason to reset.

**Balance, in every part: spawns that keep the island alive**

13. **Carrying capacity from food**: a region holds as many grazers as its plants feed and as many hunters as its grazers feed; births follow food, not only a fixed density. Plants spread by seed and regrow by succession after fire or a cosmic spell (grass, then shrubs, then young trees, then forest), and herbivores come back before predators.
14. **Never empty, never overrun**: a species that drops under a quarter of its target while its habitat exists gets arrivals from the island's edge (a pair walking in, birds flying in, fish with a river), a species over twice its target stops breeding and starts to roam out; monsters and spell creatures are capped per region and never respawn on their own.
15. **A refuge per species**: every region keeps a small patch the generator marks for each of its animals, so a wildfire or a flood cannot end a species for good.
16. **Checked**: a thirty minute scene per biome and on a mixed large island in `npm test`, every native and regional species within a band of its target 80% of the time; a wipe (every animal killed, half the plants burnt) recovered to half the targets within ten simulated minutes; wolves still catch deer; every challenge passes on its seeds.

**Measured** in each part like 4.4: the HUD numbers on medium and large islands stay within 4.4's (voxel and instance counts, simulation and frame p95), frames of the same three seeds before and after, and the variety itself: ten islands from ten seeds side by side, which no two should look alike.

### 4.4.6 Accounts you can trust: the owner's progress, signing in and out (done, see above)

Runs after every part of 4.4.5 (renumbered on the owner's ask, so it never interrupts 4.4.5). Found by the owner on 4 November: playing as the admin on a computer and a phone, progress is not kept. Read in the code (not yet reproduced in a test):

- **The admin is not an account.** `authenticate` in `worker/index.ts` returns at once when the admin token matches (`{ admin: true, payer: ADMIN_PAYER }`), with no session and no invite, so `/api/health` has no `account`, `Sync.start` never runs and nothing goes to the server: the admin's discoveries, board and island live in each browser apart. A session held next to the token is ignored, since the token wins. The token is also typed again on every device (five taps on the title).
- **Signing out keeps everything on the device.** "Sign out here" (`src/account.ts`) drops the session and reloads, but the local save stays; whoever signs in next on that device starts from it, and since discoveries merge as a union on sign in (`Sync.start`, then the upload), **a second account signing in on the same device would receive the first one's discoveries for good**.
- **Signing in is hard to find** once a device has a link or a save: the passkey sign in shows on the gate only when the device has nothing.
- With an account, the island does sync (last saved wins, `docs/DESIGN.md`, "Accounts"); the owner never saw it only because the admin has no account.

The plan, in order:

1. **Reproduce first**, as tests in `scripts/worker-test.mjs` and `scripts/account-verify.mjs` (phone sized, virtual authenticator): the admin's progress on two devices, and account B signing in on a device that held account A's progress.
2. **The owner is an account, and admin is a role of it**: the owner signs in with a passkey like everyone, and an `admin` flag on that account gives the admin powers on every device where it is signed in, with no token to type. Existing rows written by the admin (`elements.invite`, ideas, wins, the payer `admin`) are kept by giving the owner's account the id they already use, the same trick as 4.0 (nothing moves). No personal cap for the owner, as today. The admin token stays for scripts and the nightly Action (`MM_TOKEN`), and a token next to a session no longer hides the session.
3. **Progress belongs to one account**: the device's save is tagged with the account it belongs to. Signing out asks "keep a copy on this device" or "remove it from this device" (the default, since the account holds it); signing in with another account sets the other account's local save aside, never merges it, and never uploads it. Only a save made before any account (a link not yet claimed) is offered for upload, once, as in 4.0.
4. **Connect and disconnect anywhere**: "Sign in" always in the ? menu and on the gate, even on a device with a link or a save; "Sign out", "Switch account" (sign out, then sign in, in one step) and "Signed in as <name>" in the menu; the account page lists devices with their last sync and signs any of them out, as today.
5. **Sync you can see**: "Saved to your account 2 minutes ago", or "Not saved: offline" or "Not signed in", in the menu; "Sync now"; when another device saved a newer island, the warning says which device and when (as today) and offers both.
6. **What syncs, written down**: discoveries, board, island, challenge wins (already on the server), the recipe book and the favorite spell (once the Community tab exists); settings stay per device (sound, HUD, graphics switches), on purpose.
7. **Checked**: the tests of item 1 pass; the owner on two devices sees the same discoveries and island within a minute; sign out and sign in with another account leaves no trace of the first; the admin powers work with a passkey and with the token; the attacks of `docs/REVIEW-4.0.md` section 10 still pass. Shown to the owner on the live site before merging, on a phone and a computer.

### 4.5 Daily challenges, the Community tab and what's new (done, see above)

The owner's social ideas, together because they share one screen: who plays, what they found, what is new.

1. **Daily challenges** (`docs/IDEAS.md`): a new item each day from two pool items nobody has merged yet, its name, emoji, tier and description shown, the pair hidden; a tab of every challenge not found yet; the first finder's name on it.
2. **The Community tab** (`docs/IDEAS.md`): who plays, each friend's chosen favorite spell, items found and First Discoveries, no recipe shown, hideable.
3. **What's new in the game**: `public/changelog.json`, one line per merged update, a dot and a list since the player's last visit; a player whose idea was built is told so.
4. **The Ideas tab follows daily builds**: a pull request that says `Idea #<n>` moves that idea to "Waiting for review" and then "Done".
5. **A preview for each pull request**, so the owner tries it on a phone before merging: a staging Worker with its own D1 (a copy refreshed nightly, accounts, sessions, invites and emails stripped) and a $5 budget (first $2), deployed by CI from a token kept in GitHub's secrets.

### 4.5.1 An audit: every claim checked, and how much the AI can drive (done, see above)

Before more is built on top, and before the AI is trusted to merge on its own (4.5.2): an independent session, ideally a different model from the one that built 4.1 to 4.5, checks that what the docs, pull requests and the game's own items promise is true. Read only: no deploy, no write to the live database, no paid call; its only output is `docs/AUDIT-<date>.md` in a draft pull request. The full prompt is on the roadmap page.

1. **Claims, by priority**: every "Done in" item of this file (newest first), every "fixed in 4.1" note of `docs/REVIEW-4.0.md`, DESIGN.md, SETUP.md, the last 15 pull request descriptions, and **the game's own promises**: 25 live items cast in Node (the 10 most cast, 10 at random, Serpent, Human, Village, Wormhole and a ward), each compared with its summary and intents.
2. **Statuses**: Implemented, Partial, Stub, Unreachable (no entry point reaches it: the page, the two frames, the Worker's fetch, cron and queue, the Actions, the npm scripts), Missing, Contradicted, or Wrong (it runs, but not as claimed), each with file, function and lines, and how it was checked.
3. **Tests that can fail**: every check run twice with its real output; the five main guards (the monthly hold, the $5 cap, the burst guard, a ward against fire, the save merge of two tabs) broken on purpose in a scratch copy to show a test catches each.
4. **The game played** locally at phone size against `wrangler dev` with no API key: the newcomer's path, every tab, a reset, signing in and out, with screenshots.
5. **The development loop**: every step from an idea to a live change (idea, plan, session started, built, tested, reviewed, merged, deployed, watched, rolled back) and who does it today (the owner, an AI session, CI, or nobody), counted from the last 15 pull requests and the session history (how often the owner had to say "merge", "deploy", "check where we are"); which human gates protect a real risk (money, players' data, accounts, a prompt that changes every spell, going public) and which are habit; what automated guard would replace each one that is habit.
6. **The report**: a table of claims with severity (critical: money, players' data or the game for everyone; high: a promise players see is false, or a guard with no failing test), the library sample, test and mutation results, the five biggest risks with the smallest fix, a fix order mapped to the planned versions, the loop map with a recommendation, and what could not be verified.

### 4.5.1a Safety before autonomy (waits for the owner's answers)

From the audit's risks 1 and 4 (`docs/AUDIT-2026-11-05.md`, sections 5 and 6). Each item is a setting, a credential or a running cost, so the owner decides; the code part is small once decided.

The owner's answers, 5 November: item 1, previews stay as they are ("for this project specifically, I don't mind trusting you"; the Ideas routine's pull requests still wait for `owner-ok`); item 3, the one owner passkey is the owner's own, so nothing to remove and no rotation for now; item 4, no GitHub Pro ("Don't want to pay"), the Gate stands in against mistakes; item 6, done by the AI without asking ("Those are things you can do"), built as the daily rewrite by evidence (DESIGN.md, "Old spells and new promises"), Frost Nova and Light its first two reviewed findings; item 7, not now. Items 2 and 5 are open.

1. **Previews stop running unreviewed code with production credentials**: today every pull request from a branch of this repository is built with the account wide `CLOUDFLARE_API_TOKEN`, and the staging Worker holds the production admin token (MM_TOKEN). Options: a `preview` label the owner adds before CI builds it (free, a one line change), or a GitHub environment with a required reviewer (needs GitHub Pro for a private repository). Recommended: the label now. Since 4.5.2 the Ideas routine's pull requests already wait for `owner-ok`; the label for every pull request would also stop the Gate from merging green work at night, so the better fix is item 2 plus a Cloudflare token for CI scoped to the staging Worker and database.
2. **Staging gets its own admin token**, a new repository secret the owner creates; previews then open with it, not with production's. Since 4.5.2 every workflow uses `STAGING_ADMIN_TOKEN` when it exists: the owner only creates the secret (and gives sessions the same value instead of the production `ADMIN_TOKEN`).
3. **Rotate ADMIN_TOKEN and MM_TOKEN**, then list the owner's passkeys on the account page and remove any not recognised: since 4.4.6 the admin token can make a lasting owner passkey, and it has been reachable from preview code.
4. **Branch protection on `main`**, needed before 4.5.2 lets sessions merge alone: GitHub Pro (a running cost) or a public repository.
5. **The nightly Judge job** casts live spells and trial wonders in Node next to MM_TOKEN; move the casting into a worker thread with an empty environment (code, small) once item 3 is done.
6. **Frost Nova** (its thaw sets the village on fire) and **Light** (it promises protection and fails its test) rewritten one at a time from the admin card, a few cents each.
7. **The browser checks in CI** (`account-verify.mjs`, `verify-4.1.mjs`): about 10 more Actions minutes per pull request; the private repository's free minutes are limited.

### 4.5.2 The AI drives, the owner steers (done, see above)

The owner, 5 November: the owner wants to touch three things only: questions from the sessions building an update, the morning brief, and the game with its Ideas tab. All the creation and coding is done by AI already, and the admin is there for steering, showing bugs and bringing ideas, yet the admin is still driving when the AI should be driving, asking questions and bringing ideas as a game design expert; so many things should just be checked and corrected without anyone asking, and having to say "merge" and "deploy" all the time should not be needed. Today: the planner proposes one prompt and changes nothing; the owner opens every session, pastes the prompt, and says when to merge; production is deployed by hand from the building session, before the merge, so the live game can run code that is not on `main` and two sessions deploying the same day overwrite each other. Since 4.5, a pull request gets a preview and `main` deploys to staging. Built on the audit's loop map (4.5.1), in this order:

1. **Production deploys only from `main`, by CI, after the merge**: migrations, deploy, a smoke test on the live site (the newcomer's path at phone size and the health route), and an automatic rollback (`wrangler rollback`) with an issue opened when the smoke test or the error rate fails. Sessions stop deploying production; they give the preview link.
2. **Merging and deploying without the owner** (started on 5 November in `CLAUDE.md`, the agreement every session reads): a session merges its own pull request once CI, its own checks, the preview and an independent review are green, then deploys from up to date `main` and checks the live site, until item 1 moves the deploy into CI. It asks the owner first only for money (a new running cost or a raised cap), players' data (deleting or rewriting it), spells in bulk, and anything public. This version makes those rules a script that reads every diff, so they are enforced, not only written.
3. **An AI reviewer that is not the builder**: fresh subagents through the `adversarial-review` skill (`docs/SKILLS.md`), or the Claude Code Review action, read each diff adversarially against DESIGN.md, the ask-first rules and the audit's findings, reproduces at least one claim of the pull request on the preview, and blocks on any finding it can show.
4. **The planner launches the work**: each morning it starts the day's builder session itself (a version step or the day's fix, green or amber), and sends the owner a brief of what was started, what merged and deployed overnight, what failed and was rolled back, and **questions with options and a recommendation** for what only the owner can decide. The owner's day is answering, choosing and playing, not pasting and merging.
5. **Checks that run without being asked**: after each deploy, the nightly self audit of 4.7.5 and the library sample of 4.5.1 run on live items; a mismatch becomes the next day's fix, not a message to the owner.
6. **Bugs found before the owner finds them**: today the owner is the main bug finder (the drum, the deer, the meteor through the shield, the admin's lost progress, the stone serpent were all seen in play first). A nightly play test in a headless phone sized browser plays the newcomer's path and a long session on a random island, records frames, and a vision check of the judge looks for what a person would notice (things floating, stuck, overlapping, flickering, invisible, nothing happening after a cast); the live Worker's errors, slow ticks from `/api/perf`, players' down votes and reports are read every night; each finding becomes a reproduced test and the next day's fix, and the owner only hears about it in the brief.
7. **Ideas from both sides**: the AI acts as the game's designer, not only its builder: every week it proposes three ideas of its own with the reasoning a game designer would give (what the player feels, what it adds to the loop, what it costs, what similar games do), next to the owner's ideas and players' ideas from the Ideas tab, in `docs/IDEAS.md`; the owner picks, rejects with a reason, or reshapes. The owner's ideas still come first in their category.
8. **The owner keeps**: taste (what is fun, what looks right), money (any new running cost), what goes public, and veto at any time ("pause" stops everything; any red item waits). A short weekly review: what shipped, what players did, cost, and the decisions queue.
9. **Measured**: the share of merged pull requests that needed no owner action, the bugs the owner found first versus those the AI found first, the owner's minutes per week, the rollbacks and their causes; a red item merged without a yes is a failure of this version.

### 4.6 Every item is what it is: creatures, objects, buildings, places and land

Part A built in PR #50 (`docs/DESIGN.md`, "Every item is what it is"): seven kinds at the merge, the engine's makers, sizes checked, a prompt section per kind, the library's sort and rewrites by form after the owner's approval. Part B (creatures as living things) built in its own pull request on top of A (`docs/DESIGN.md`, "Creatures worth creating"), with the owner's change of 7 November first: a person item is one of the island's own villagers, with a calling from its name. Still open from item 8: the Serpent and Human of the live library rewritten (the list is in `docs/measurements/creatures-4.6b.md`, waiting for the owner) and ten new items from the writer itself on a preview. At the owner's request, the fine box models of 4.7 item 4 came with part A for items (`w.model`); wonders written as programs keep theirs for 4.7.

The owner, 5 November: creatures made by merges are poor ("just take the serpent or the human"), artifacts, creatures and buildings should be handled differently, "a lot of the things we create do not make sense... a giant book", and some items should shape the land ("a floating island"; "the village spell should actually create a village as the generation does"). Read in the live programs: **Serpent** is an artifact of twelve stone spheres in a line that never moves; **Human** is a villager with glowing eyes; **Village** is "a brass Village Lantern Charm" ringed by a few wooden boxes, not a village. The cause is structural: an item is either a spell or an artifact (`elements.kind`), and every artifact is written the same way, as a voxel thing of a few cells' reach, whether it is a book, a dragon, a temple or a town. Meanwhile the engine already knows how to make each of these properly: bodies, goals and steering for creatures (3.5, 3.6, 4.3), seeded buildings and villages (4.4.5 part B), land, lakes, rivers and floating rocks (4.4, 4.4.5), wonders (4.4.5).

**Part A. The kinds, each with the engine's own way of making it** (a new migration; existing rows keep working)

1. **Seven kinds**, decided at the merge with the name (the 4.4.5 part C Haiku sort already says place, material, creature, object or person): **spell** (an effect, cast once), **creature** (alive: moves, wants, acts), **object** (small, held or placed: a book, a sword, a potion, a lantern), **building** (made by people: a tower, a temple, a forge, a castle), **settlement** (a village, a town, a camp, a city), **place** (nature or old magic: a grove, a spring, a ruin, a wonder) and **land** (it reshapes the terrain: a floating island, a volcano, a lake, a canyon, an oasis, a swamp).
2. **A maker per kind, from the engine, not from scratch**: a building goes through the seeded building builder of part B with its own style and job; a settlement through the village generator, so "Village" makes a real village with houses, a plaza, fields and villagers; land through the terrain functions of 4.4 (shapes, lakes, rivers, floating rock); a place through the wonder system; an object is small and goes to the object rules of 4.7; a creature to part B. Claude's program chooses the parameters and adds what is special, instead of drawing everything in voxels.
3. **Sizes that make sense, checked**: an object fits in a hand, a creature is sized against a villager (3.7), a building against a house, a settlement and land by their reach. A giant book is a bug the test run catches, unless the item says it is giant ("the Library of Babel" may be a building).
4. **One prompt section per kind**, short, with an excellent example each, so a merge that makes a temple gets the building rules and one that makes a lantern gets the object rules.
5. **The library re-sorted**: every item classified again (Haiku, cheap), the owner shown the list with the ones that change kind, then rewritten in capped batches through the 3.7 refresh path after approval, the worst first (Serpent, Human, Village, the giant books), never all at once and with no `PROGRAM_VERSION` bump.

**Part B. Creatures worth creating**

6. **Written as living things first**: body plan from what it is (a serpent slithers on the serpent plan, a human walks as a person), size, colors and features, gait, needs, a goal of its own, one to three abilities with triggers, whom it is friends with, hunts or fears, how it breeds or dies; the 3.5 bodies, 3.6 goals and abilities and 4.3 steering as a short reference, and two hand written examples (a serpent, a fox spirit).
7. **A creature probe** in the test run: it moves on its plan, pursues its goal, uses an ability within two simulated minutes, reacts to what it fears or hunts, and the five minute populations still hold; a creature that stands still or does nothing is written again once. The judge asks "does this look and act like a <name>?".
8. **Checked**: Serpent and Human rewritten as creatures and Village as a settlement, shown to the owner on a phone; ten new items from new merges, at least one of each kind, watched in a frame strip.

### 4.7 Things that behave as they should

The owner, 5 November: "so many things don't interact in the right way". Systemic causes first; the long tail goes to the daily updates (below), which now have an Interactions category.

1. **Shields with a breaking point**: a ward has health, takes damage from what it stops, shows cracks, and breaks; strong spells break weak wards. It stops projectiles and calamities, not only harm (Ideas tab `#2`: "a shield from immortality let a meteor pass through"): bodies, meteors, fireballs, lightning and lava stop at its edge, each with a check in `npm test`.
2. **Sizes held at runtime**: the kinds of 4.6 set the scale (an object small, a building as a house, a place large); a spell that grows or shrinks something keeps it within its kind's range.
3. **Objects that are picked up and used**: a creature or villager that reaches an object can take it, carry it in hand (the 3.5 carried items), and gains the object's action as an ability (a staff throws its fireball, a potion heals once, a lantern lights the way); it can be dropped, stolen or lost when its owner dies. The player gets the same actions in 5.1.
4. **Looks drawn like the built-in wonders**: artifacts and wonders written by Claude get box models with fine parts (the idea in `docs/IDEAS.md`), instead of balls of whole-cell voxels. The Wormhole, a voxel ball with a ring of single voxels, is the first one rewritten.
5. **An interaction table in `npm test`**: every effect (fire, flood, lightning, projectile, summon, teleport, heal, freeze) against every protection and every material, with what should happen, so a fix in one place cannot break another.

### 4.7.5 A game that runs itself, and a morning that makes you want to build

The owner, 5 November: a much more advanced daily routine, one that updates the game on its own for everything it needs (the daily challenge, the new wonder, badly rated spells, and the rest), and one that encourages the owner to make more updates. Today the Worker's cron already runs some of this on its own (the daily wonder of 4.4.5 part C, the API's growth of 3.4.2, the judge, votes that rewrite a spell in 3.3), each with its own cap, but nothing ties them together, says what happened, or asks players the right question.

**Part A. The game's own day, on the server, inside caps**

1. **One daily job list**, run by the cron in a fixed order with a total daily cap (for example $1.50 a day, apart from the 4.2 cap for new items) and a log line each: set the day's challenge (4.5), write the day's wonder (4.4.5), rewrite the spells players voted down, retire wonders and challenges that failed their checks, refresh the "new this week" list, and keep a seasonal or moon calendar (a full moon night, a solstice, a festival a village holds) that islands read.
2. **Better votes on spells**: more reasons than today's five (`shared/votes.ts`: nothing happened, too small, looked wrong, broke the island, boring): "it does not do what its name says", "too strong", "too weak", "it lags", "the creature or object looks wrong", "I love it" with what was best. Each reason goes into the rewrite prompt, and "does not do what its name says" weighs most, since it is what the owner sees most.
3. **Rewrites by evidence, not only by votes**: a spell the promise probe fails, the judge scores low twice, or the audit of 4.7 flags is queued for a rewrite too, one at a time, within the daily cap, the old version kept for rollback as in 3.3. Started on 5 November as a daily update: a live program whose stored test run failed, or that a reviewed finding names, is written again by the cron, one a day, inside the daily rewrite budget (`worker/evidence.ts`). Since the owner's idea of the same day, a program whose 2 November refresh rewrite failed its own test gets one informed retry, told what that test found. Still to come: the judge's low scores, the audit of 4.7, and the total daily cap of item 1.
4. **The library audits itself**: every night a few of the most cast items are cast in Node and compared with their name, description and intents (the audit lens of DAILY.md, automated); mismatches become rewrite candidates for the next night or lines in `docs/IDEAS.md` through a pull request the owner reviews.
5. **A report the owner can read in one minute**: what the game did overnight, what it cost, what players did (new discoveries, casts, votes, challenges found, wonders seen), what failed and what is waiting for a decision, at `/api/admin/day` and on the admin badge.

**Part B. The owner's morning brief, so the game moves every day**

6. **The planner's message reads the night's report** first: "while you slept: 3 spells rewritten, today's challenge is the Dodo Lantern, 12 merges by 4 friends, one wonder rejected". Players' activity is the best reason to build.
7. **Three choices, not one**: a quick fix of under an hour (an Interactions item), a daily idea of a session, and the next version, each with its prompt ready to paste, so there is always something the size of the time the owner has.
8. **Momentum, not pressure**: a streak of days with something merged, what the last week shipped in one line each, and what players asked for that is still open; on a day with nothing waiting, the brief says so and gives the next version.
9. **Checked**: a dry run of the job list on a copy of the database for seven simulated days (costs, what it changed, nothing left half done); the brief written from that week and shown to the owner before the schedule changes.

### 4.8 Sound and music

The island is heard the same way from everywhere: a sound carries no position, villager work went silent in 4.1 because a thump from across the island could not be placed, and 12 voices serve 167 live programs (all of them call `w.sound`; "chime" alone 127 times), so spells sound alike. Goal: the island sounds like a place, each spell sounds like itself, and music follows what happens, all generated in the browser with no audio files and no new paid call.

1. **Sounds have a place.** Every sound event carries where it happened (a spell's default is its center, so `w.sound(name, size)` stays valid in every stored program). The listener is the camera: distance fades and dulls a sound (a low pass with distance), left and right follow the camera's angle, zoomed out the island is heard as a whole and zoomed in the near things stand out. Equal power panning by default, which is cheap on phones; HRTF only as a setting for headphones, since it costs memory and CPU on low end phones.
2. **A sound budget.** At most about 24 voices at once; sounds of the same name within 100 ms merge into one louder sound; each name has a cooldown; when the budget is full the quietest at the listener is dropped. Routine work (felling, building, digging) plays only near the camera, quietly, with variation. A test renders a busy island's events offline and checks that no name repeats faster than its cooldown.
3. **Ambience from what is in view.** Beds that rise and fall with what the camera sees, sampled a few times a second from the simulation's own grids: waves and shore where there is water, wind in leaves over forests, crackle and roar near fire, bubbling near lava, a village murmur and tools near houses, rain and wind with the weather (when 4.4 brings it), birds by day and crickets at night, a hollow wind at the island's edge.
4. **Creatures you can hear.** A short call per body plan and species, made from the same synth (a wolf howls at night, birds chirp, a dragon roars when it breathes fire, slimes squelch), rate limited and only within earshot. A creature's ability plays its own sound.
5. **Richer spell sounds, still backward compatible.** More voices (bell, gong, choir pad, wind, water, splash, crystal, heartbeat, thunder, roar, sparkle, pluck), each varied in pitch and timbre per cast so the same chime is never twice the same. A spell may describe a sound of its own within bounds (`w.sound({ wave, from, to, seconds, noise, filter, echo })`), as it describes a model of its own; the prompt gains a short section on it, measured against the judge and probes before and after, and **no stored program is rewritten** for it: old ones keep their names, which now sound richer by themselves. The tier of a spell scales its sound (a small spell a sparkle, a cosmic one fills the sky).
6. **Music that follows the island.** Generated from the island's seed (key, tempo, a few chord progressions, pad, bass, a sparse melody), scheduled on a timer about 100 ms ahead and never from the drawing frame, in layers whose volume follows the state: calm by day, sparse at night, tense when fire, monsters or a challenge's hazard rise, a short swell when a big spell lands, a few notes when something is discovered. It ducks under loud spells, rests often (silence is part of it), and changes key with the time of day.
7. **The Craft view is not silent.** A soft sound for picking up and dropping a chip, a merge that sounds by tier, a First Discovery that sounds like one, a refusal that is gentle. Its own small audio context on the page, the same mute rules.
8. **Settings and manners.** One sound button as today, plus volumes for music, effects and ambience in the menu; music off by default on first visit until the player turns it on; audio paused when the tab is hidden (battery) and resumed on return; a mono option; never a sound before the player's first tap (browsers forbid it, and it should not surprise anyone).
9. **Measured and tested.** Every voice rendered offline in `npm test` (no NaN, length bounded, peak and loudness within a range so no voice is ten times louder than another); the number of live audio nodes and voices in the HUD and in the perf sample; a ten minute session on a real phone with sound and music on, read back from `/api/perf`, simulation and frame p95 within the numbers of 4.4. Someone listens: the owner, on a phone, before merge.

### 4.9 Builders: villages that grow, roads and vehicles

The owner, 5 November: as people discover things and have the resources, they build. Today a village builds houses from wood and gold (3.1, 4.4.5 part B buildings).

1. **Discoveries a village makes**: from what it has seen and been given (spells cast near it, artifacts it picked up, resources around it), a village learns crafts in a small tree: masonry, the wheel, the forge, the mill, boats, roads, bridges, magic. Each craft unlocks buildings and tools.
2. **Resources and building**: wood, stone, clay, ore, food and gold gathered by jobs; a plan of what to build next by what the village needs (a granary before a famine, a wall after a raid, a bridge where a river blocks the way); building sites you can watch go up.
3. **Roads**: paths worn where villagers walk become dirt roads, then stone roads, then bridges; roads join villages and wonders; walking on them is faster, and the flow fields of 4.3 prefer them.
4. **Vehicles**: carts on roads, boats on rivers and lakes, a ferry, later a flying ship from a spell or a wonder; each a small box model that moves with the 4.3 steering and carries people and goods between villages; trade caravans that monsters can rob.
5. **Checked**: a village left alone for an hour of simulated time grows from hamlet to town on three seeds; roads join every village that trades; the simulation p95 on a large island stays within the HUD numbers.

### 4.9.5 Wonders review

The owner, 9 November ("wonders: yes"): the wonders on the islands were written one at a time, by different models, and nobody has looked at all of them together. A wonder that is a ball of blocks under a grand name breaks the promise of its name.

1. **Frame every wonder**: each wonder of the pool and each built in wonder, on an island at phone size (390 by 844), from the same three shots, saved under `docs/measurements/`.
2. **Judge each against its name**: does it look like what it is called, does it do something (an effect the player can see or a creature it draws), is it a fine `w.model` shape and not a ball of voxels, is it sized right for its tier and its land. One line each, with the frame.
3. **A scored list**: every wonder scored on those four points, worst first, with `decision-matrix` so the order is not a mood. The list is the deliverable even if nothing is rebuilt.
4. **Rebuild the weak ones**: with the fine box models of 4.7 item 4, one at a time, each tested like a new wonder and framed again; the cost of each rewrite logged in the pull request. Never the whole pool at once, and never a rewrite of a wonder players have already met without its old version kept.
5. **Cost**: about $3 to $6 of AI, approved by the owner as "wonders: yes" (9 November). Back to the owner only past $12.

### 5.0 Look closer: select anything

The first person update, part 1. When no spell is selected (or after a cast, when the player is back to nothing selected), a tap selects whatever is there: a creature (today's inspect card, 3.6), a villager, a building with a job, a wonder, a landmark, an artifact or object, a tree or plant, water or a road.

1. **One card for everything**: what it is, what it does now, what it wants or holds, its history (who placed it, when, what it did), and actions where they make sense (follow with the camera, name it, set it as favorite).
2. **Follow cam**: the camera follows the selection smoothly; the selection stays highlighted.
3. **Checked**: every kind of thing on an island selectable at phone size, with a frame per card.

### 5.1 Take control

The first person update, part 2 (Ideas tab `#3`: "make the characters first person playable characters"). From the card, "take control": the camera moves behind or into the entity and the player plays it.

1. **Controls per kind**: a bird flies, a fish swims, a villager walks and does its jobs (farm, fell, fish, build, trade), a beast hunts or grazes, a creature of a spell uses its own abilities, an object held gives its action (4.7).
2. **Phone first**: a thumb stick and up to four action buttons from the entity's abilities; a tap to let go, and the entity goes back to its own goal.
3. **The world goes on**: the simulation does not pause; others react to the player's entity as to any other.
4. **Checked**: each kind played for two minutes in a phone sized browser with a frame strip; the simulation p95 unchanged while controlling.

### 5.2 Looks and speed: a visual and performance pass

The owner, 5 November: another visual and performance update down the line. By then 4.6 to 5.1 will have added creatures, objects, buildings, roads, vehicles and a controllable entity, all paid for in frame time. Measured first, on real phones through `/api/perf`, never guessed.

1. **Where the time goes**: a profile of a large island at the end of 5.1 on a phone sized browser and on the owner's phone, split by simulation system (temperature and fluids were 40% of a tick in 3.x) and by draw call; a budget per system written down.
2. **The simulation in a Worker thread**, the full answer to review M3: since 4.2 the check frame already runs spell code in a blob Worker, so the CSP path exists; the view reads the state the Worker sends.
3. **Far things cost less**: levels of detail for creatures, buildings and wonders by distance, instancing for every repeated model, updates of far simulation regions at a lower rate.
4. **Quality presets chosen by the device** (low, medium, high) from its own HUD numbers, with a battery saver that lowers the frame rate when idle or hidden.
5. **Visuals that the budget then allows**: soft shadows, light and color that follow the hour, glow that blooms at night, water that reflects the sky, more particles where they read (embers, pollen, snow), each behind a switch and measured alone, as in 4.4.
6. **Checked**: 30 fps on a mid range phone on a large island with everything of 4.6 to 5.1 in play, the simulation p95 within its budget, and frames of three seeds before and after.

### 5.3 Interface, accessibility and quality of life

The owner, 5 November. By then the game has a Craft view, the World, Challenges, Ideas, Community and Daily challenges, and cards for everything: a pass on the whole interface before strangers see it.

1. **An interface audit at phone size**: every screen and card in a frame strip, one thumb, what is too small, too far or too crowded; the tabs and menus regrouped so the main two (Craft and World) stay one tap away.
2. **Quality of life** from `docs/IDEAS.md`: search in the inventory, a long press for an item's recipe and history, tidy the board, follow a creature, preview a spell's reach, haptics, undo the last merge, a settings page that holds every switch.
3. **Accessibility**: tiers by shape as well as color, text that scales with the phone's font size, touch targets of at least 44 pixels, a switch for flashes and shakes apart from reduced motion, labels for screen readers on every control, the keyboard on a computer.
4. **The game in French**, English kept, every string through one table, the language from the browser.
5. **Checked**: the audit's frames before and after, an automated accessibility check (contrast, labels, target sizes) in CI, and one session with the owner on a phone.

### 5.4 Ready for strangers

AI Gateway spend caps, Turnstile, name checks, AI labels, small legal pages. Accounts (4.0) come first, so strangers can keep their progress. From the 4.0 review: trials decided by the admin's runner (or two browsers that agree), not by one browser's word (M11), since a stranger can promote a crashing program for everyone. Quotas, the report button and invite links instead of a shared token came early, in 3.4, for friends. Nothing public before this.

### Daily updates (running since 4 November, between the versions)

The game moves forward every day. Since 4.5.2 the scheduled planner session runs twice: at night (01:13, Toronto time) it starts the day's builder itself, the next step of this roadmap while planned versions remain, then the night's fixes and one idea a day in a good mix of kinds (gameplay, quality of life, visual, living world, content, audio, performance and code quality, security, ready for strangers, accessibility, non invasive monetization, and one wild idea every fourteen); in the morning (07:36) it sends the owner the brief. The Gate merges what is green, the Deploy workflow deploys `main`, and the owner answers the amber and red questions. The rules are `docs/DAILY.md`, the backlog `docs/IDEAS.md`. The planner never edits the repository and never reads the database.

Two limits by design. **The owner's answers are the bottleneck, not ideas**: at most five questions a brief, and green work does not wait for them, so a week away costs only the amber and red items. **Small and finished beats big and started**: anything larger than a session is given in parts or becomes a roadmap version for the owner.
