# Design notes

## Decisions so far

1. Audience: one player, then (3.4) friends and coworkers by personal invite link. Not public: nothing about the game is listed or open without a link. Browser game, must work well on phones.
2. Stack: TypeScript and Vite frontend, one Cloudflare Worker serving both the page and `/api`, D1 (SQLite) as the recipe book.
3. Eight primal forces to start: Fire, Water, Earth, Air, Light, Shadow, Life, Arcane.
4. Two kinds of items: spells (castable) and artifacts (magical, not castable).
5. A merge always makes something. Like Infinite Craft, it may loop back to one of its inputs.
6. World tab: a sandbox where you cast anywhere and tiny people react. The world persists until reset.
7. Goal: sandbox discovery, with First Discovery. Objectives later.
8. Game language: English.

## How the merge stays coherent without hidden stats

Infinite Craft does not track attributes. Its coherence comes from four structural choices, all copied here:

1. **Stateless prompt.** The model only ever sees the two names. No history, no description, no recipe chain. Depth 50 is judged exactly like depth 1, so nothing accumulates.
2. **Frozen answers.** The first answer for a pair is stored and reused forever. An element name has one emoji and one kind forever.
3. **Short, known names.** Results are one to three words, and the prompt prefers names from myth, fiction and games. Known concepts are attractors: the model keeps landing on the same few hundred ideas instead of inventing new adjective stacks.
4. **Loops are allowed.** A pair may give back one of its inputs. This is how the graph converges instead of exploding.

Descriptions are generated separately and are never fed back into merges, so rich text cannot drift the names.

If drift still shows up in play, the next lever is to show the model a short list of existing names to reuse, not hidden stats.

## Spells are programs (v2)

A spell is a short JavaScript program written once by Claude from its name, tier, recipe and grimoire entry, then stored in D1 and reused forever. It defines `const spell = { *cast(w) { ... } }`: a generator where `yield seconds` waits, so a spell reads as a sequence (gather, deliver, impact, aftermath). It acts through the World API `w`, documented for Claude in `worker/prompts.ts` and implemented in `src/sim/runtime.ts`:

1. **Big moves** that do a lot in one call: explode, quake, ignite, flood, drain, paint, temperature, terraform, build, grow, gas, wind.
2. **Bodies**: the moving parts of a spell (a falling meteor, a drifting cloud, a wandering vortex), with tick, land and end callbacks.
3. **Free voxels** for what floats or overhangs: a tree's crown, a floating rock, a statue.
4. **Creatures**: find, spawn, hurt, heal, push, set statuses, transform, resize.
5. **Show**: particles, bursts, shockwaves, lights, night, tints, flashes, magic circles, free canvas drawing painted on the land, camera moves, sounds.
6. **New rules**: a spell may define materials (with a per cell tick) and creatures (with their own behavior). They stay in the world after the spell ends and are saved with it.

The API is deliberately high level: a few calls do a lot, so programs stay around 40 lines. Output tokens are the expensive part of a call.

### Safety

The program is untrusted code, so the World runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`: it has an opaque origin, cannot read the game page, its token or its storage. `public/_headers` gives it a CSP with `connect-src 'none'`, so it cannot reach the network either. Everything it needs comes in by `postMessage` (`src/sim/protocol.ts`), and the parent stores its save. Every loop in a program gets a guard (`shared/spellcode.ts`) so an endless loop throws instead of freezing the page; every call into spell code is wrapped, and a spell that keeps a frame busy too long is stopped.

### When a spell crashes

The error goes back to Claude with the program, and the fixed version replaces it: at most twice per session per spell, three times in total unless the admin asks.

### Power tiers

The merge model gives every new element a tier from its meaning: cantrip (a spot), minor (a house), major (a village), grand (a valley), legendary (a region), cosmic (the world). A result can be at most two tiers above its strongest input, so power is built up but a meaningful leap is still possible. A spell's reach is a share of the world's size (`shared/tiers.ts`), and the camera pulls back when a spell is bigger than the view. Elements from before tiers get one the first time they are cast.

### Which model writes which spell

Measured on six of the player's spells, same prompt, same effort: Haiku 5.5 wrote small and mid spells as well as Opus 5.5 for a thirtieth of the price ($0.002 against $0.076), but only Opus made a World Tree Awakening that grows an actual giant tree. Sonnet 5.5 cost ten times Haiku without doing better. So spells up to grand go to Haiku and legendary or cosmic ones to Opus (`SPELL_MODEL_SMALL`, `SPELL_SMALL_UP_TO`, `SPELL_MODEL`).

### Which model decides merges

Measured on 2026-11-02 on 30 pairs already in the recipe book, spread from depth 1 to 14, each asked once of Haiku 5.5, Sonnet 5.5 and Opus 5.5 at low effort through `/api/admin/merge-trial` (nothing stored). Graded blind (answers shuffled per pair, by a separate grader that only saw the merge prompt's rules): 2 for what a reader would expect with the right kind and tier, 1 for a generic or invented name or one input ignored, 0 for incoherent.

| Model, low effort | Score of 60 | Answers graded 2 | Same name as the frozen answer | Same tier | Cost per merge | Median time |
| ----------------- | ----------- | ---------------- | ------------------------------ | --------- | -------------- | ----------- |
| Haiku 5.5         | 51          | 21               | 7 / 30                         | 14 / 24   | $0.00012       | 2.1 s       |
| Sonnet 5.5        | 47          | 17               | 11 / 30                        | 16 / 24   | $0.00063       | 1.2 s       |
| Opus 5.5          | 55          | 25               | 21 / 30                        | 20 / 24   | $0.00126       | 1.7 s       |

Merges stay on Opus. A merge is answered once and frozen forever, so a weak answer is a permanent part of everyone's recipe book, while all the merges of the busiest day so far (184) cost $0.22. Haiku would save about a dollar in a month of heavy play and gave the only incoherent answer of the 90 (Elixir of Life + Eternal Night = Dawn, cosmic). Sonnet at low effort was the weakest of the three. Even Opus gives its own frozen answer again only 21 times in 30, which is why answers are frozen.

### Repairs

A crashing program is mended by `REPAIR_MODEL` (Haiku) whatever its tier: the repair sees the program and the error, and fixing one error is not where Opus earns forty times the price. Since 3.3 the fix is a trial like any new program and goes through the test run before it replaces the crashing one.

### Program versions

`PROGRAM_VERSION` records which World API a program was written for. It never triggers a rewrite: 3.1 bumped it to 4 and every big spell was written again on its next cast, which took Opus spell calls from 43 to 96 in a day. The API only grows, old programs keep running (`lab/legacy` holds fourteen v2 and v3 programs that `npm test` casts), and a spell is rewritten one at a time: by players' votes (3.3, below) or the admin's "Rewrite this spell" button. Only version 1 rows, which are declarative specs and not code, are written again on their next cast.

## Spells that get better (3.3)

A program is no longer written once and frozen: players vote, and a spell they vote down is written again. Everything below is in `worker/index.ts`, `worker/programs.ts` and `shared/votes.ts`; the schema is `migrations/0005_votes_versions.sql`.

### Every version is kept

Each program ever written for an element is a row of `programs`, with its origin (new, draft, batch, votes, judge, check, repair, admin, or legacy for those from before 3.3) and a status: **trial** (written, not yet through its test run), **live** (the one everybody gets), **retired** (replaced, kept to come back to) or **rejected**. `spells` still holds the live one of each element, plus `pid`, its row. Nothing is ever deleted.

### The test run

A new program is a trial until a browser has cast it on a practice island (`src/sim/check.ts`): the small seeded island, a cast near a village with a corpse and a wounded villager next to the target (so healing and raising spells have something to act on), compared second by second with the same island left alone, so a river that flows or a villager who walks is not counted as the spell. It fails on:

1. **a crash**: an error, or no generator;
2. **nothing visible**: fewer than 3 land cells, 4 blocks and 1 creature differ from the control and no body flew for half a second (particles, flashes and circles alone do not count);
3. **an island wiped**: more than 60% of the land changed (90% for legendary), or a spell up to grand that leaves fewer than a fifth of the villagers and houses. Cosmic spells may (decision 1 below).

A failed trial is written once more by Haiku with the failing code and what the test found; a second failure keeps the program that was live before, or, for a new spell, keeps the second one (something to cast is better than nothing, and a crash still has the repair loop). The 14 old programs in `lab/legacy` and the 6 reference spells all pass, and 131 of the 132 programs stored on 2026-11-02 (Earth crashes); it takes 0.1 to 1.2 s in Node.

It runs in the browser because the Worker cannot: Cloudflare Workers forbid `new Function`, and a spell is code. It runs in a second hidden sandboxed iframe (`check.html`, same CSP as the World) so a program under test shares nothing with the player's island, and it works before the World tab is opened. It runs 8 ms at a time between frames. A browser could lie about a result; the worst it can do is one extra Haiku call per trial, since a program written to fix a failed test is never fixed again.

### Votes

The browser makes up an anonymous id (a random UUID in localStorage) and sends it with every request. A cast is recorded with the version that was cast. Six seconds after a cast, if this player may vote on that version, a small bar asks "How was Fireball?", Good or Not good, and Not good asks one reason: nothing happened, too small, looked wrong, broke the island, boring. Only players who cast that version in the last 48 hours may vote, once each (a changed mind replaces the earlier vote).

After each vote, in this order (`afterVote`):

1. **Rollback.** A version that replaced another (except a repair) goes back to its parent when it has N votes and a larger share of them down than the parent.
2. **Library.** N votes and at least 60% up: the program joins the library; it leaves it when that stops being true.
3. **Rewrite.** N votes and at least 60% down: the spell is written again with the reasons in the prompt ("2 players voted it down: it was too small for its name and tier"), unless it was rewritten in the last three days or the day's rewrites are over `REWRITE_BUDGET_USD` ($0.50). Spells up to grand are written at once by Haiku; legendary and cosmic ones go to Opus through the Batch API, and the live version stays until the new one is back and through its test run.

N = max(1, round(10% of the average daily players over the last seven days)), at most 25. With one player, one vote is enough.

### The library

Programs voted up are shown to Haiku when it writes a spell: the two closest by shared words in the name and grimoire entry (the name counts double), same kind and nearby tier first, each cut to 3,000 characters, with a line saying to take what makes them work and not their look. No embeddings: there are a few hundred short names, and the words that matter (fire, tree, vampire) are literal. Opus is not shown them.

### Big spells: a draft now, Opus later

A new legendary or cosmic spell used to wait 20 to 40 s for Opus at $0.076. Now Haiku drafts it at once (about $0.002, through the test run like any program), and the same request goes to Opus through the Batch API at half price. A cron every ten minutes collects finished batches; the Opus program comes back as a trial whose parent is whatever is live by then, so it is rolled back if players like it less than the draft. The admin's "Rewrite this spell" still asks Opus directly and says so. `BIG_SPELLS_BATCH=0` brings back the 3.2 behaviour.

### The judge

Haiku looks at three Spell Lab frames (1, 3 and 6 s after the cast; 2, 6 and 12 s for legendary and cosmic spells, which build up longer) with a sentence of what changed (cells, deaths, statuses) and scores 1 to 5 with the reason a player would give. The Worker cannot render, so the frames come from `scripts/judge-runner.mjs` (on a computer with Playwright, or the daily `Judge` GitHub workflow), which casts every live program the judge has not seen and posts its frames to `/api/admin/judge`.

It is calibrated on votes in two ways. Its prompt carries the latest cases where it disagreed with the player ("Tornado: you gave 4; the player voted it down because it was too small"), and the score at or below which it means "voted down" is the one that best matches the votes once five judged programs have votes. Until it agrees with ten or more voted programs at least 70% of the time it only advises (on the admin card and `/api/admin/judge-stats`); after that, a bad score on a live program nobody voted on asks for a rewrite, within the same cooldown and budget as votes.

### Measured

On 20 spells (`docs/measurements/spell-quality-2026-11.md`), graded blind from Spell Lab frames: writing a spell again without a reason does not make it better. Small spells went from 2.73 to 3.00 out of 5 with the library (2.80 without), within noise; big ones went from 3.80 to 3.00 with fresh Opus programs, with swings from 5 to 1. Rewrites only pay when votes choose what to rewrite and what to keep, which is the design. A big spell now costs $0.040 instead of $0.061, a small one $0.0024 instead of $0.0014, and the judge agrees with the blind grader within one point on 54 programs of 60 but only advises until votes calibrate it.

### View source

The spell card has a "View source" link for everyone: the program, its version number, its API version and who wrote it. The admin row lists every version with its status, origin, votes, test run and judge score.

### Artifacts

Artifacts use the same program format and the same endpoint, with one paragraph of the prompt telling the model they are placed, not cast: a short arrival, the thing itself as the point, built in voxels or spawned as a creature, with a tick when it acts on its own.

## Sharing with friends (3.4)

$50 of API a month in total, the admin's own plays included, and at most $5 per person. Players never see dollars: they see credits, 100 to the dollar (`shared/credits.ts`), so the $5 reads as 500 credits and a merge as a fraction of one. The Worker and the admin's People view count in dollars, with credits beside them. Everything is in `worker/ledger.ts`; the schema is `migrations/0006_invites.sql`; `scripts/worker-test.mjs` checks it.

### Invites

One link per person, made from the admin badge with a name: `/#invite=<secret>`. The secret is 24 random bytes, after the `#` so it never reaches a server log or another site's Referer; the page stores it in localStorage and takes it out of the address bar, so copying the URL does not share it. The Worker keeps only its SHA-256, so a lost link is replaced (relink, same person, same history), never shown again. An invite is active, paused (the shared library only) or revoked (the link is dead, every request answers 403). The admin token stays separate and has no allowance. Without either, the API answers 401 "invite only"; in mock mode (no API key) it stays open, since it costs nothing.

### Who pays

Every row of `spend` carries the invite that triggered it: merges, descriptions, spells, repairs, test run rewrites, the rewrite a vote asks for (paid by the voter, who must have the allowance), and Batch API items, which are billed to whoever asked when the cron collects them. Elements remember who discovered them first. A request that cannot pay is refused only for what is new: a known recipe, a stored description and a stored program cost nothing and always work. A big spell is drafted by Haiku first; its Opus version through the Batch API is held only if the allowance can take it, otherwise the player keeps the draft.

### The budget check is a hold, not a read

3.2 read the month's total and then called Claude, so two requests near the cap could both pass. Now each call first inserts its expected cost (a merge $0.004, a small spell $0.008, a big one $0.15, a batch item $0.06: above the measured averages) into `reservations` with one `INSERT ... SELECT ... WHERE month spent + open holds + this one <= BUDGET_USD AND the same for the invite <= its allowance`. D1 runs one statement at a time, so the second request sees the first one's hold. When the request ends, the real costs go to `spend` and its holds are settled in one batch. A request that dies leaves its hold open; the cron turns holds older than an hour into spend at their estimate, which errs on the safe side. The worst overshoot is the difference between one call's estimate and its real cost.

The test seeds the month at $49.995 and sends two merges at once, five times: one passes, one gets "the magic is spent for this month", and the month never passes $50. With the check written as a read then an insert, both pass every time (tried, then reverted).

### A bug guard, not a play limit

1. **Identical requests in flight are answered once.** Merges (by pair), descriptions, spells and repairs (by name) and test runs (by program) take a key in `inflight`; an identical request waits until the first is done and then finds what it stored. Two friends discovering the same pair at the same second make one Claude call. A repair waits and then serves the fix already waiting for its test run instead of mending again.
2. **More than 10 paid requests from one person within 5 seconds are refused and logged** (`refusals`, shown per person in the admin view). Only requests that would call Claude count: merging known recipes as fast as one can never comes near it; a client stuck in a loop does at once. There is no hourly cap: the $5 is the limit. The admin is not guarded (measurement scripts).

### Reports and privacy

A card has "Report this name": Claude names things, and a name can be wrong or offensive. Reports go to the admin's people view, one open report per name and person; dismissing one is the only action for now (renaming an element would change everyone's recipe book). New players see one paragraph on what the game is, that Claude writes the spells, what their month looks like, and a short privacy note: what is kept and why, that item names go to Claude and nothing about the person does, Cloudflare's request logs, no ads or cookies, and who to ask for deletion. The `?` in the top bar shows it again.

## Feedback (3.4.1)

Invited players post ideas in the Ideas tab and vote for them, up only, one vote per invite, the author's included; five ideas a day per invite. The admin turns one into a brief and sends it to a Claude Code routine, which answers with a draft pull request. Everything is in `worker/feedback.ts`; the schema is `migrations/0007_feedback.sql`; the rules for the run are in [FEEDBACK.md](FEEDBACK.md).

### Two human gates

The text comes from players and goes to an agent that writes code, so a person stands at both ends. Before the run, the admin writes the brief: the routine is told to act on the brief only, and to treat the player's words as context, never as instructions (the routine also receives all of its fire text labelled as untrusted until its saved prompt says otherwise). After the run, the pull request is a draft that CI checks and the admin reviews, merges and deploys. Nothing merges by itself. The routine's own guard rails (no workflows, no spending settings, no `PROGRAM_VERSION` bump, no edited migrations) are in FEEDBACK.md, versioned with the code, so the routine's saved prompt stays short and never needs editing.

### Why an issue first

The Worker opens the GitHub issue before firing the routine: it is the record outside D1, the routine links its pull request to it with `Closes #<issue>`, and the game reads its timeline to show players what happened. The issue number is stored before the fire, so a fire that fails never opens a second issue; sending again comments on the same one. Two taps within a minute start one run (the first claims the idea by writing `sent_at`), since the routine API has no idempotency key.

### What players see

Open for votes, Claude is on it, Claude has a question (the run stopped to ask and put the `needs-info` label on the issue), Waiting for review (with the pull request), Done, Not this time (with the admin's reason, or "closed without merging"). The admin also sees the brief and the Claude Code session. A merged pull request wins over an open one, an open one over a closed issue, a closed issue over Claude's question, and a pull request closed unmerged only declines the idea if it came after the latest send. Sending again takes the label off, so an old question never sticks to a new brief.

## Spells keep their promise (3.4.2)

Protection spells did not protect. The writer had a good idea (a shield over the village) and no way to carry it out: nothing in the World API could stop fire, lava or a hunter, so it built a shell of `magic` blocks. Lava flowed under it, fire spread through it, and it hid the village it was meant to guard. The test run passed it, since something visible happened, and the judge scored a shiny dome on a calm island. Nothing anywhere checked that a spell does what its name says. Two fixes, in this order: first the means, then the test (a test without the means only pays for rewrites that cannot succeed).

### Wards

`w.ward(x, y, r, {against, seconds, color, keepOut, allow})` is a rule of the land (`src/sim/wards.ts`). Each ward sets bits on the cells it covers (`world.wardMask`, rebuilt only when a ward appears or ends), so physics reads one byte per cell:

1. **fire** does not spread in or start inside, what burned inside goes out, and heat from outside is capped;
2. **fluids**: lava, acid, water and every spell fluid stop at the edge (they pool against the dome); a spell's own fluids may still be placed inside its own ward;
3. **lightning** ends on the dome, at its height there;
4. **creatures** that hunt people, convert or carry a harmful aura are pushed out to the edge; `keepOut` and `allow` name kinds; a guard a spell set to fight only the undead is no threat and stays;
5. **harm**: blasts and quakes leave the land and houses inside alone, and direct harm from spells (`hurt`, `kill`, burn) keeps 15% of its force on those it protects;
6. **cold**: frost and blizzards stop at the edge.

Frightened villagers within 14 cells run under the nearest ward instead of away into the open (raiders were stopped 60% of the time before this, 90% after). Wards last up to 600 seconds and are not saved with the world.

The view draws each ward as a clear dome (`src/sim/voxel/domes.ts`): one draw call, nearly invisible face on, a bright rim edge on, faint rising bands, a flash where something hits it, and a ring on the ground. `docs/visual-checks/ward-dome-under-attack.png` shows lava pooled around it, lightning on it and the village untouched and in plain sight; `shell-of-blocks-before-wards.png` shows what protection spells built before.

### Intents and the protection probe

Every element gets one or two intents (`shared/promises.ts`: protect, heal, harm, summon, create, transform, weather, move, reveal, other), decided once by a small call of their own from the name and grimoire entry, before any program exists, and stored with the element. The model that writes the program never chooses what it is tested on. The writer is told the test its promise faces, so the test is the specification and not a surprise.

A spell that promises protection gets a fourth failure in its test run, **promise**. It is cast on the village; three seconds later a threat hits the same spot, one at a time: a rain of fire, a flood of lava, a blast and six raiders. What its reach covered at the cast (houses, and villagers by their health) is counted at twelve seconds and compared with the same threat and no spell, and with no threat at all. Each threat is a small hostile spell going through the same World API, so a ward has to stop what a player's Fireball would do, not a test double. It passes if it prevents at least half of the harm on average; a threat that does no harm on its own is not counted. Runs without the spell are cached. Aegis (`lab/promises/aegis.js`) prevents 96 to 100% at minor, major and grand; Glass Shell (`lab/promises/glass-shell.js`), the shell of blocks, prevents none and fails. A protection check takes 2 to 5 s in Node instead of under 1.2 s; in the browser it runs between frames like the rest.

Only protect is probed today. The other intents are recorded so the next probe (heal, summon) can be measured on every stored program before it gates anything.

## An API that grows (3.4.2)

The ward is the kind of change that should have come from the first protection spells, not from a player noticing months later. So writers now say what the API lacked, and the API grows from it (`worker/evolve.ts`):

1. **Gaps.** Every program's answer has `missing`: the ability the writer lacked, in a few words, or nothing. Each becomes a row of `gaps`.
2. **Design.** Once a day at most (the ten minute cron), when open gaps come from at least three spells, the big model reads them all, finds the ability at least three spells lacked (by meaning, not by shared words: "a barrier that stops lava" and "a shield against fire" share none) and decides one of three things:
   1. **helper**: the ability can be built from the API as it is. It writes a function, `lib.name(w, ...)`, and an example spell that uses it. The helper is a trial until the example passes the test run, with the promise of the spells that lacked it, at two reaches. Spell code cannot run in a Worker, so `npm run evolve` (`scripts/evolve-runner.ts`, also the first step of the daily Judge workflow) runs it in Node and reports back. A live helper is listed in every later writer's prompt.
   2. **hint**: the API could already do it; one line joins the writers' prompt.
   3. **engine**: the simulation itself must change. A proposal, which the runner opens as a GitHub issue labelled `api-gap` for a developer to review.
3. **Programs stay what was tested.** A program that calls `lib.name` gets the helper's code appended to it (`const lib = {...}` after the program, so line numbers in errors do not move) when it is stored. Changing or retiring a helper never touches programs already written, and a helper never needs a rewrite in bulk.

Why helpers are automatic and engine changes are not: a helper runs in the same sandbox as any spell, with the same loop guard and the same API, and only reaches new programs that chose it and then passed their own test run. The worst a bad helper does is fail its test. An engine change touches the physics every spell and challenge relies on, and the checks that would catch a regression there (`npm test`, the challenge replays) are a developer's to run and read. Wards are what an engine proposal looks like: no helper could have stopped lava at a boundary or drawn a clear dome.

Cost: the designer is one Opus call a day at most (held at $0.40), only when gaps are open; the intent call is a Haiku call per new element (about $0.0001). `EVOLVE=0` stops the daily design; `DESIGN_MODEL` picks its model. Admin endpoints: `GET /api/admin/evolution` (open gaps and every extension), `POST /api/admin/evolve` (design now), `GET /api/admin/helpers` and `POST /api/admin/helper-check` (the runner's), `GET /api/admin/proposals`, `POST /api/admin/extension` (`{id, status}` to retire a helper or close a proposal).

## Many kinds of life (3.5)

Every creature used to be the same two blocks in a different color. Now each kind has a body you recognize at a glance, and the island has animals of its own. Everything is in `src/sim/body.ts` (what a body is, as data), `src/sim/voxel/rigs.ts` (bodies as boxes), `src/sim/voxel/figures.ts` (drawing them), `src/sim/wildlife.ts` and `src/sim/villagers.ts`. The bestiary page of the Spell Lab (`lab/bestiary.html`) draws every plan, feature, animal and villager look; `docs/visual-checks/bestiary.png`, `bestiary-dead.png` and `creatures-before-after.png` are its screenshots and the same village before and after.

### Bodies

Twelve plans: two legs, four legs, bird, fish, serpent, insect, spider, slime, spirit, golem, dragon, tree folk. A plan is a function that lays out boxes in units of the creature's size, standing on the ground and facing forward, and says where features go: the head, the face, the torso, the back, the rear and two hands (a four legged animal carries in its mouth).

Each box turns about a pivot with one motion, and that is all the animation there is: legs swing in opposite pairs, arms against their legs, an arm that carries something is held forward and barely swings, wings flap (faster for insects, slower for dragons, folded on the ground), tails sway, heads nod, a serpent's segments follow each other sideways, insect and spider legs sweep, a slime squashes, motes circle a spirit. Proportions come from a build (longer legs and neck for deer, long ears for rabbits, bulk for bears), so wolves, deer, boars and bears share one plan.

A creature falls on its side when it dies (a fish turns belly up and floats), lying on the ground, then sinks into it over the 40 seconds before it is removed. Frozen, stunned or dead, nothing moves; asleep, the head drops. Elders stoop. Status colors (dead, frozen, burning) tint the whole figure.

Features go on any body: horn, horns, antlers, wings, tail, mane, hat, hood, crown, glowing eyes, armor, and one carried item (sword, axe, spear, staff, torch, hammer, shield, lantern, book, basket; hoe and rod for villagers). A feature the plan already has is not added twice (a dragon has wings). Wings do not make a creature fly. `color2` colors the belly, wings, mane, hood, leaves and glowing eyes.

A model is for the creature no plan fits: at most 16 boxes `[x, y, z, w, h, d, color, part]` in any units, scaled to 1.3 across and 1.7 tall at most, so it stays the size of the others. `part` (leg, leg2, arm, arm2, wing, tail, head, glow) picks the motion; the pivot follows from where the box is (a leg turns at its top, a wing at the edge nearest the middle). Numbers are bounded, a box without a size is dropped, extra boxes are ignored.

### Drawn as one cube

Every part of every creature is one instance of the same unit cube, in two draw calls whatever the mix: one for what the day and spell darkness dim, one for what shines (glowing eyes, spirits, torches, a staff's gem). The cube's faces are shaded in the shader from the instance's own normal, with the same light per side as the baked models, so a deer that turns keeps the sun on the right side. A rig is turned into flat arrays once; parts that share a pivot and a motion (a head, its hair, eyes and hat) share a matrix made once per figure, so each part costs one 3 by 4 multiply. Creatures outside the camera are not posed, details (eyes, ears, hooves, buckles) are left out where a creature is a few pixels tall, and only the instances written are uploaded.

### Old spells are not written again

The creatures of every stored spell get a body without a rewrite, from, in order: what the spell declares (`body`, `features`, `color2`, `model`), its name, its base kind. The name is read word by word and the last word that names a body decides it (a Spirit Wolf walks on four legs, a Wolf Spirit floats), whole words only (a Dragonfly is an insect, not a dragon); features add up (a Lich King gets a hood, a staff and a crown). The prompt teaches the new fields in one paragraph; `PROGRAM_VERSION` is 5 and, as always, only labels what a program was written for.

A spell that defines a creature named like an island animal ("wolf") gets its own kind, `wolf#<spell>`, so summoning wolves that hunt villagers does not turn the island's wolves against them. The spell's own `spawn`, `transform` and `onDeath: "spawn:wolf"` mean its wolf; every list (prey, lures, scares) and `c.kind` still say "wolf" for both.

### Wildlife

| Kind   | Habitat                                       | Per 10,000 cells | Does                                                                    |
| ------ | --------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| deer   | grass or fields by a forest, away from houses | 2.6              | flees people, wolves and bears; stags have antlers                      |
| rabbit | grass, fields, flowers                        | 3                | flees people and hunters                                                |
| wolf   | forest floor, far from houses                 | 1.3              | hunts deer and rabbits by night, sleeps by day                          |
| boar   | forest and bushes                             | 1.3              | stays in its patch of forest                                            |
| bear   | forest, far from villages                     | 0.45             | hunts deer and boars by day, scares people (a mob of four can kill one) |
| bird   | trees                                         | 3                | flies 7 voxels up                                                       |
| fish   | water deeper than 1.2                         | 3.5              | swims only in water, chokes on land                                     |

Numbers are kept by births, not by a food web: every few seconds the species furthest below its number gets one animal born in its habitat. Burn the forest and the deer, wolves and boars stop coming back; drain the lake and its fish die. On a medium island over ten minutes, wolves killed 8 deer and 2 rabbits and every species stayed at its number. The real food web, with hunger and herds, is 3.6.

In a list, `beast` (and "animals") also names every wild animal, so a scarecrow or honey written before 3.5 works on deer and bears. Animals are born in a cell they can walk out of: the first version put wolves inside trees, which are solid, and they never moved.

Challenges keep only birds and fish. In the lava challenge a rabbit set alight near the volcano ran into the village and burned it before the lava came, with the right spell cast; no spell could have prevented it. Birds fly over fire and fish stay in water, so they cannot change an outcome.

### Villagers

One number per villager, saved with it: age, job, village, skin, hair. A fifth are children (smaller, so weaker and slower), some are elders (gray hair, a beard or long hair, a stoop and a cane). Adults have a job that shows: farmers in straw hats with a hoe, woodcutters with an axe, fishers in caps with a rod, smiths with an apron and hammer, guards in armor with a spear, priests in a hood with a book, merchants in caps with a basket. Jobs are only looks until 3.6 gives them work. Each village has its own clothes (shirts, trousers, hats), from six styles; a villager born later is usually a child and wears the clothes of the nearest villager's village. Villagers from saves before 3.5 are dressed by village from where their homes are.

### The test run and wildlife

With animals on the practice island, a spell that only threw particles passed the test run: drawing random numbers for particles shifted the stream the creatures used, so one deer wandered differently from the control. Creatures in the test run now draw from their own seeded stream, the same in both runs, so only what a spell does to them counts.

### Measured

Headless Chromium with software WebGL on the medium Spell Lab island (`scripts/prof-view.mjs`, CPU time per frame, p50 / p95), and the simulation in Node:

| Scene                                       | Before 3.5                                      | After                                            |
| ------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| Island, nothing cast                        | 25 draw calls, 86k triangles                    | 26 draw calls, 88k triangles                     |
| 375 creatures of every kind near the camera | 25 calls, 92k triangles, creatures 0.1 / 0.4 ms | 26 calls, 125k triangles, creatures 1.0 / 5.1 ms |
| Bestiary, 99 figures                        |                                                 | 1,534 boxes, 3 draw calls, 1.1 to 1.7 ms to pose |
| Creatures per tick, 112 / 152 / 208 cells   | 52 / 36 / 78 creatures, 0.11 / 0.08 / 0.20 ms   | 68 / 63 / 129 creatures, 0.19 / 0.18 / 0.39 ms   |

The first version spent 1.9 ms p50 on the crowd; flat arrays, shared matrices per pivot, culling and details by distance brought it to 1.0. The HUD shows how many boxes creatures cost (`parts`), and sends it with every `/api/perf` sample.

## Challenges

Hand-made islands with a hazard and a goal (`src/sim/scenarios.ts`, titles in `scenario-list.ts` so the game page does not load the engine to list them). A challenge builds its own world, runs a `tick` every frame (a volcano vent, a rising sea, the sun drying fields) and a `check` twice a second that returns progress text and playing, won or lost. It never touches the player's island: the iframe keeps the sandbox save in memory and restores it on leaving.

Balance is measured, not guessed: `npm test` plays each challenge with nothing over eight seeds and with a plain solution spell from `lab/solutions`, and the parameters were tuned until the replays agree. A loss is decided the moment it happens, not at the end: villagers rebuild ruins, so a village that burned and was rebuilt would otherwise count as saved.

## World

1. **Simulation** (`src/sim`): a grid of columns, each with a height, a ground, a fluid and its depth, a cover (tree, house...), fire, temperature and a gas. 30 ticks per second.
2. **Rules of the land** (`physics.ts`): water runs downhill, freezes below 0 and boils above 100; lava flows slowly, burns and hardens into basalt, and makes steam with water; acid eats covers and soil; oil burns fast; mud dries; snow melts; fire spreads through forests, fields and houses with the wind and leaves ash and stumps; steam rains back down; powder explodes; grass and forests grow back.
3. **People** (`creatures.ts`): villagers live near their houses, rebuild rubble, flee fire, panic and run for water when burning, drown in deep water; a new villager appears now and then while houses stand. Spirits fly and glow, golems are strong and fireproof. Since 3.5, deer, rabbits, wolves, boars, bears, birds and fish live in their own habitats (above).
4. **Generation** (`world.ts`): fractal hills rescaled from their own distribution so every map gets about a fifth of water and a few snowy peaks, a river, forests, and villages on the flattest dry land.
5. **View** (`voxel/`): a floating voxel island in three.js, with layered cut sides and water spilling off the edges. No two faces share a plane (3.4, `docs/visual-checks`): a waterfall hangs 0.06 cells in front of the cut side, a water wall starts on its own floor, spell blocks are never placed inside the land and take the place of a cover they are put on, and spell drawings are projected only on dry land tops and fluid tops, never on walls or on land under water. Built for phones: lighting is baked into vertex colors and every material is unlit, terrain chunks are rebuilt only where a column changed, each kind of object is one instanced draw call, and the pixel density drops when frames are slow. A medium island is about 60 draw calls and 140k triangles. Chunks are built with a reusable typed array writer under a 3 ms per frame budget.
6. **Day and night** (`voxel/daylight.ts`): a six minute cycle that tints every unlit material and the sky; fire, lava and spell light are untouched, house windows light up at night and chimneys smoke.
7. **Saving**: the iframe sends a compact save (each layer quantized to bytes) every 10 seconds; the parent keeps it in localStorage. Materials and creatures that spells defined are saved by name with the spell that owns them, and that spell's rules are loaded again before the world.
