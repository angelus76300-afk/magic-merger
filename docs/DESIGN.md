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

Neither guard covers code that never returns without a loop (a catastrophic regex, a huge sort). Since 4.1 the World frame sends a heartbeat every two seconds and the page replaces a frame that has said nothing for 20 s while the World is on screen, from its last save, with a toast (`src/worldhost.ts`, `watchdog`). Where the frame shares the page's thread (most phones, headless Chromium) the page freezes with it and the watchdog acts when it thaws; the full answer is the simulation in a Worker thread.

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

A failed trial is written once more with the failing code and what the test found, by Haiku, or since 4.2 by Opus for a legendary or cosmic item, so a big item's Opus program is never replaced by a Haiku one (the owner's call: before 4.2 the probes never failed anything in a browser, so it had not come up); a second failure keeps the program that was live before, or, for a new spell, keeps the second one (something to cast is better than nothing, and a crash still has the repair loop). The 14 old programs in `lab/legacy` and the 6 reference spells all pass, and 131 of the 132 programs stored on 2026-11-02 (Earth crashes); it takes 0.1 to 1.2 s in Node.

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

One number per villager, saved with it: age, job, village, skin, hair. A fifth are children (smaller, so weaker and slower), some are elders (gray hair, a beard or long hair, a stoop and a cane). Adults have a job that shows: farmers in straw hats with a hoe, woodcutters with an axe, fishers in caps with a rod, smiths with an apron and hammer, guards in armor with a spear, priests in a hood with a book, merchants in caps with a basket. Since 3.6 jobs are goals (below), and builders, in caps with a hammer, joined them. Each village has its own clothes (shirts, trousers, hats), from six styles; a villager born later is usually a child and wears the clothes of the nearest villager's village. Villagers from saves before 3.5 are dressed by village from where their homes are.

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

## A living island (3.6)

The rule: nothing on the island just stands there. If the player does nothing for five minutes, every creature has changed something. Everything is in `src/sim/kin.ts` (what creatures share: minds, villages, marks, memory), `src/sim/goals.ts` (deciding and acting), `src/sim/abilities.ts` and `src/sim/inspect.ts`. Artifacts that act and creatures casting library spells are 3.7 part B.

### Goals and needs

Every kind has one goal from a fixed vocabulary: hunt, gather, hoard, build, tend, guard, steal, spread, convert, worship, explore, migrate. Needs come first, in this order:

1. **Survive**, where it already was: fire, danger probes, hunters and what scares (`creatures.ts`, `social.ts`). Fleeing animals (deer, rabbits) run before they eat, unless starving.
2. **Rest** when badly hurt (back to its home or lair, healing slowly); villagers sleep at home at night, except guards; creatures of the night that daylight burns walk to the shade of the woods at dawn, and those that sleep out of their hours dig a den where they first lie down.
3. **Eat**: hunger rises every tick, asleep or awake; past half (a third for night hunters, whose night is short) it looks for food in its diet. Starving costs health.
4. **The goal**, then wandering.

A creature decides about twice a second (two to three while it hunts or fights), staggered, never every tick, and asks the crowd grid who is near; between decisions it walks to its task and, once there, works at it until done. A task it cannot reach is dropped after 30 seconds, or after 5 seconds without getting closer (then it steps out of the hollow it is in; a villager hemmed in by trees cuts a way through).

### Goals leave marks

| Goal    | Who                                                                   | What it does                                                                                                                                                                     | Mark                                                                   |
| ------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| hunt    | wolves (by night), bears (by day), spell hunters                      | chase prey when hungry, the pack joins in, eat the kill                                                                                                                          | the kill fades sooner                                                  |
| gather  | deer, rabbits, boars, children, plain villagers, woodcutters, fishers | graze crops, flowers, bushes; boars root grass up; berries, wood and fish brought home                                                                                           | eaten crops, bare patches, stumps                                      |
| hoard   | dragons                                                               | take gold from the land or raid a village's gold, carry it to its lair                                                                                                           | a heap of gold voxels                                                  |
| build   | builders, smiths, beavers                                             | builders build houses with the village's wood (5 a house, at most 12 houses a village, more with gold); a spell's builder fells trees into a den, or a dam where water runs near | houses, a dam (earth raised to the water's surface, with a log), a den |
| tend    | farmers, elders, dryads                                               | sow fields and harvest them, till new fields when the old ones burnt; plant flowers; grow stumps back into trees; heal the wounded                                               | fields, flowers, trees                                                 |
| guard   | guards, golems, tamed wolves                                          | patrol, fight what threatens the village, chase grazers out of the fields                                                                                                        |                                                                        |
| steal   | goblins, thieves                                                      | steal crops and stores, run them to a camp                                                                                                                                       | a tent and a pile of loot                                              |
| spread  | birds, the undead, kinds that leave a material                        | sow seeds; dig graves by the dead and the graveyard; spread their material                                                                                                       | bushes and saplings, a graveyard                                       |
| convert | vampires (by hunting), cultists (by preaching)                        | turn victims, or win villagers over to worship them                                                                                                                              |                                                                        |
| worship | priests, those won over                                               | pray at a shrine that does not scare them, at what they revere, or the village square; priests bury the dead                                                                     | flowers laid around, candles at a shrine, graves                       |
| explore | merchants, spirits, beasts                                            | roam far; merchants carry food from the richest village to the poorest                                                                                                           | cairns                                                                 |
| migrate | fish                                                                  | swim in schools between two places and spawn where few of them live                                                                                                              | young                                                                  |

A kind's goal comes from what it declares (`goal`), then its declared behavior (hunt, converts, guard or follow, leaves, a healing aura, flee), then its name (the last word that names one, like bodies: a Fire Dragon hoards, a Wolf Spirit explores), then its base kind. Only kinds that declare a goal get needs: older spell creatures keep doing what their behavior says and take up their goal when that leaves them idle, so no stored program behaves differently in its first seconds.

### Villages

Villagers whose homes are close make a village (found again every three seconds) with stores of food, wood and gold, saved with the world. Farmers and fishers bring food, woodcutters wood, gifts gold. Villagers eat at home from the stores, and a child is born only where there is food to spare (three of it). Jobs are goals: farmer, woodcutter, fisher, builder (new, a fifteenth of adults, in a cap with a hammer), smith (builds too), guard, priest, merchant. Children pick berries and flowers, elders plant flowers. A villager with nothing to do for its job forages or, one time in four, plants flowers, so nobody idles for long.

### Food web, taming, herds, memory

Wolves eat deer and rabbits, bears deer, boars and fish, dragons what their spell names; grazers eat crops, flowers and bushes; birds sow; fishers and bears eat fish; fish breed. Numbers are still kept up by births where the habitat lasts (3.5), now on top of the food web. Fish breed by themselves (restocked only once none is left): every fish spawns once in its life and dies of age after five to eight minutes, so each one replaces itself, and spawns again only where few of its kind live; fishers and bears keep them down. Wolves share a kill with their pack. A starving creature only runs from a threat within five cells instead of nine: it has to eat.

A hungry deer, rabbit, boar or wolf near a village with food may come to beg by day; a villager beside it feeds it from the stores, and the third meal tames it: it stays by that village, villagers do not hunt or chase it, and a tamed wolf guards the village. Deer, boars, wolves and fish keep with their herd, pack or school.

Everyone remembers up to four kinds that hurt or helped them, and villagers remember magic: a spell's `hurt` on a villager is harm, its `heal` help. A villager keeps away from a kind it remembers for harm, a guard goes for it; those that saw a villager hurt remember a little too. A threat that only scares and never attacks is got used to after 20 seconds (a dragon on its hoard does not keep a village in panic for ever), and a hunter asleep out of its hours is given a berth of four cells instead of nine.

### Abilities

Up to three per kind, each `{do, when, every}`: breathe fire, heal, summon, teleport, freeze, lightning, grow, raise the dead, shield, dig, flood, steal; when an enemy is near, when hurt, at night, when a friend dies, or every so often; `every` is the cooldown (3 to 120 s). Checked about three times a second whatever the creature is doing, so a hunted witch freezes her hunter while she runs. Nothing to act on costs a 3 second wait, not the cooldown. Each goes through the same rules as spells: fire and frost stop at wards, lightning ends on a dome, a shield is a small ward of six seconds, a flood never fills a house. Priests heal every 15 seconds, guards raise a shield when an enemy comes; older creatures get abilities from their name (a dragon breathes fire, a necromancer raises the dead at night, a rabbit digs a burrow when hurt). The dead a necromancer raises are a built-in kind, `risen`: weak, burnt by day, gone in 90 seconds.

### Goals, jobs and abilities a merge invents

The twelve goals and twelve abilities are a floor, not a ceiling. A program can define its own:

1. **Goals**: `spell.goals: [{name, seek, near, work, act(self, w, x, y, target), carry, like}]`. The engine does the walking: it looks near home for what `seek` names (a material on any layer, a creature kind, or landmark, home, village, anywhere), walks there, works `work` seconds, then runs `act` through the World API and counts a deed; `carry` brings a load home (villagers add it to their village's stores); `like` is a built-in goal to fall back on when nothing is found. A creature takes one with `goal: "its name"`.
2. **Jobs**: `w.hire(name, x, y, count)` gives up to six adult villagers near a place one of those goals as their job (a forge hires smiths, an orchard pickers). The job is saved by name and works again once the spell's rules are loaded; until then the villager does its usual job.
3. **Abilities**: `{name, when, every, act(self, w, target)}` beside the built-in ones, at most three in all, `act` returning false when there was nothing to do.

The code runs in the sandbox like a creature's tick, with the loop guard; a goal or ability whose code throws is reported like any spell error and switched off, never the world. Goals are registered when the program is compiled, like its materials and creatures. Inspect shows their names. This is how the vocabulary grows from merges: a Forge or an Apiary brings its own work, without an engine change, and what several programs reach for and cannot write goes through the API that grows (3.4.2), which can turn it into a helper or an engine proposal.

### Old spells and new promises

Asked after 3.6: the protection spell in play had not changed. Two causes, both found in the live database. First, 257 of 258 elements had no intents: intents are decided only before a new element's first program, so no older element was ever tested on its promise. Second, programs are never rewritten in bulk, so the Protection Spell kept the program written before wards existed. Run through the probe in Node, all nine live protection programs failed it (the Protection Spell prevented none of the harm, a shell of 554 magic blocks); the only one that passed was an admin rewrite of Divine Shield, still a trial because no browser had tested it yet.

Now:

1. **Intents for every element**, 25 per cron run on the small model, from the stored entry (about $0.0001 each; `POST /api/admin/intents` does 80 at once).
2. **A live program that never faced the probe of its promise** is flagged in `/api/spells/live`; the next browser that holds it tests it in the check frame. A pass is recorded. A broken promise is written once more (by the small model; since 4.2 by the big one for a legendary or cosmic item), with what the probe found, as a trial whose parent is the live program (origin `promise`); the live one stays until the trial passes its own test run. Never twice for the same program, and within the rewrite budget. One player's page load at a time, so never in bulk, and only for spells someone plays.

`npm run test:worker` checks the backfill, the flag, the rewrite as a trial with the live program kept, and that nothing is rewritten twice.

### Inspect

With no spell in hand, a tap on a creature opens a card in the World frame: who it is, what it wants, what it is doing, health, fed and rested bars, what it last did, what it carries, what it remembers, its abilities and when they are ready, its village's stores, its hoard or den, how many things it has done. A second tap on the selected spell puts it away. The inspected creature wears a white mark. The card is built from text nodes only, since kind names come from spells.

### The five minute scene

`sceneRun` in `src/sim/check.ts` uses the island, the seeded streams and the spell-as-a-threat approach of the 3.4.2 probes: the scene is a spell cast through the World API (a dragon that hoards, a vampire, three more wolves, gold and a shrine) next to the villages, forest and wildlife the practice island already has. `npm test` runs it for ten simulated minutes on three streams of life in its worker threads and asks: every creature that lived five minutes changed something (a counted deed: something on the land, in a store, or to another creature), no kind of three or more fell under a third of its number or grew past two and a half times, and the hoard, dens and offerings exist. All three streams pass with 72 of 72 creatures having changed something, and so do three more streams run by hand (`STREAMS=3` to `5` with `scripts/scene-run.ts`). Early versions failed it on real gaps, each fixed in the design rather than by tuning numbers: wolves slept all day and missed their prey in one short night (now they dig a den and share the pack's kill), fish in a crowded lake never spawned (now once in every life), deer stayed terrified of a dragon overhead until they starved, and villagers whose task was out of reach kept trying. It caught two real bugs before they shipped: offerings stacked on a house knocked it down (lost the lava challenge with the right spell), and villagers born in a pocket between trees and cliffs never moved at all, since 3.5.

`scripts/scene-run.ts` prints the scene in full (`WATCH=dragon,vampire` follows creatures); `scripts/prof-life.ts` measures a large island.

### Measured

`scripts/prof-life.ts`, large island (208 cells), 120 simulated seconds from morning, Node on the same machine, median of three interleaved runs of main and this branch, ms per tick p50 / p95:

| Scene                                                | Creatures, main | Creatures, 3.6 | Whole tick, main | Whole tick, 3.6 |
| ---------------------------------------------------- | --------------- | -------------- | ---------------- | --------------- |
| As generated (130 creatures; 138 in 3.6, fish breed) | 0.24 / 0.72     | 0.31 / 0.78    | 3.11 / 6.35      | 3.09 / 5.76     |
| With a dragon, vampires, gold, a shrine              | 0.30 / 0.72     | 0.45 / 1.08    | 3.16 / 6.80      | 3.35 / 6.56     |

Goals cost 0.07 to 0.15 ms p50 more for creatures. Two savings pay for most of it: danger probes are made every third tick instead of every tick (they were the dearest part of a creature's tick), and the scan for lures reads three tables instead of building three strings per cell (it was 3.3 ms p95 of a tick whenever a lure existed, now 0.27). The whole tick's p95 is unchanged within noise: it is physics, as in 3.2. Phones measured 13 to 17.5 ms p95 against about 6.5 in Node for the same island, so the creatures' extra p95 is about 0.9 ms on a phone at worst, out of 33.

## Alive, acting and challenged (3.7)

Everything before 4.0, in five parts. Decided: no village mana, no hints, no discoveries made in the World, no sharing features.

### A. Creatures that look alive

1. **Sizes against a villager and a house** (`src/sim/voxel/rigs.ts`, `drawScale`). A creature's drawn size used to be its simulation radius times 1.85, and a radius is a reach: a bear stood 1.56 villagers tall, a deer 1.42, a rabbit 0.43, and a stored Vampire of radius 1.2 twice a villager. Now every body plan and build has a natural standing height in villager heights at a natural radius (deer 0.9, bear 0.72, wolf 0.5, boar 0.45, rabbit 0.2, golem 1.45, dragon 1.6, a model 0.9); another radius grows it by its square root, a person's by its fourth root (giants have the stout build), and nothing is drawn past 3.2 villagers. Villagers are the measure and keep their size. The island's house is 0.81 of a villager: the house is the stylized thing, a cell wide, and was kept. The simulation's radius is unchanged, so no fight or challenge moves.
2. **Walking up steps** (`src/sim/voxel/walk.ts`, view only). The ground is columns of whole voxels and a creature popped up a voxel at a cell's edge. Within a third of a cell of an edge the ground now blends toward the next cell's when the step is a voxel or less (a taller one is a cliff and stays one), and the height drawn rises at a walking pace and falls with gravity. The simulation's rule of what can be climbed (1.6 height units) is untouched.
3. **No two parts share a face** (`src/sim/voxel/faces.ts`). Two coplanar faces facing the same way flicker. A checker found 1,359 at rest across every plan, feature and villager look: the villager's two hair boxes (the look players noticed), soles flush with legs, wing edges, item parts, serpent bellies. Every rig now pulls the smaller face of each pair back by about a hundredth, to a depth where it meets no other face; serpent segments are stepped by hand.
4. **Models that move**: a model with no part that moves falls back to the nearest plan, by its name, then its outline (tall stands on two legs, long walks on four, flat is a slime, flying floats), in its own colors. The judge now answers "does it look alive?" (`alive`: yes, no, none) and says so on the admin card; `MM_CREATURES=1 node scripts/judge-runner.mjs` asks it of live programs that bring creatures. `scripts/stored-creatures.ts` reads the creatures of every stored program without rewriting one: 115 programs, 36 kinds, no model among them.

### B. Artifacts that act

`src/sim/artifacts.ts`. An artifact is a landmark with a life of its own, placed by `w.artifact(x, y, "Name")` from `spell.artifacts` (plain data, kept across a reload) or from inline options:

1. **Effects** (up to four): when dawn, dusk, night, day, every, drought, fire, enemy, death or hurt; do water, rain, heal, grow, freeze, burn, lightning, shield, light, food, gold, revive, summon:<kind>, cast:<library spell>, or code of its own. A Well waters the dry fields each morning; a Rain Totem casts Rain in a drought.
2. **State**: charges that recharge, fuel that burns down, health that fire and destroying kinds wear away, with an effect on breaking. Saved with the world and checked on load.
3. **Grants** that villagers walk to and use (a task of their own in `goals.ts`, at most once every 40 seconds a villager): water carried to their fields, arms (they become guards, three a village at most), prayer, food, healing, gold. Grants are for villagers unless they name kinds: the first version let deer and wolves queue at the well too, and the wolves ate the deer there (the five minute scene caught it). **Uses** that creatures act on: steal, guard, destroy, worship.
4. **Pairs**: near a corpse, a kind, another artifact or a material, an effect; a Phoenix Feather near a corpse revives it, once.
5. **Inspect** shows an artifact too: what it does and when, what it gives, charges, fuel and health bars, what it did last.

**Creatures cast real spells** from the shared library: an ability `{do: "cast", spell: "Fireball", when, every}`. The World frame asks the page for spells it does not hold, and the page asks `POST /api/library`, which serves stored live spells by name and never writes one, so it costs nothing. Caps: a creature casts at minor at most, an artifact at major, never above the spell's own tier; once every 20 seconds a creature (30 an artifact effect); four seconds apart and two at once on the whole island; never pulling the camera. A spell whose intent is harm is cast only at an enemy: the first fire imps with nothing to aim at cast Fireball at their own feet and died.

**The five minute test** (`actsProbe` in `src/sim/check.ts`): an artifact's test run places it by the village of the practice island and leaves it five simulated minutes. It passes if it acted (deeds of its own at any time, or, after its arrival, deeds of its creatures, its material spreading, a body of its own at work); a statue fails with a new problem, **idle**, and is written once more like any failed trial. About 11 s in Node. The writer is told the test. A live artifact that never faced it is tested by the next browser that holds it, and the result is recorded; an idle one is not rewritten now, since part E writes every stored program again and would pay twice. The five minute scene now holds a Well and a Lantern Post, and `npm test` asks that every placed artifact changed something (both do, on all three streams).

Measured with `scripts/prof-life.ts` on the large island, three interleaved runs: whole tick p50 / p95 3.26 / 5.02 to 5.34 ms on main, 3.22 / 4.56 to 5.37 on this branch.

### C. Challenges from nothing

A Challenges tab (`src/challenges.ts`, `shared/challenges.ts`, `worker/challenges.ts`, schema `migrations/0009_challenges.sql`). Each challenge is one of the hazard islands and a start set of primitives, or fewer. The player merges on the challenge's own board (tap two items), casts what they made on the island, and is scored by the number of merges.

1. **Merges are ordinary merges**: `/api/merge`, so a known pair is free, a new one comes out of the player's allowance, and what is found joins the main inventory (with First Discovery). Only a spell made on the challenge's board counts: a win after casting anything else from the spell bar is not recorded.
2. **Par** is the fewest merges from the start set to a verified solver, through the shared recipe graph, counting each distinct merge once (a result made once serves every later use, so it is a set, not a sum), or a player's better win: beating par lowers it for everyone. Three stars at par or better, two within two merges, one for any win. Each card shows the fewest merges any friend needed, and who.
3. **Increasing difficulty**, eight challenges in order, the next one open once the one before is won: put out the wildfire, high water and the lava road from all eight forces; then the wildfire without Water, the river with no Water, Light or Life, the drought without Water; the eruption with grand magic or stronger; and racing the lava, whose eruption runs while the player merges. **Live** was measured before it was chosen: a wildfire with 10 seconds' head start is lost even to a grand rain, the drought has no clock and the rising sea is lost once it has started, but the lava is held by a wall cast after 10 seconds and not after 20. So the eruption plays one second for every six spent merging, at most 8, before the island appears. Combined hazards were not built: they need a new island, and the six hazards already give eight steps.
4. **Always solvable**: a challenge is listed only when a spell that solves it is verified for the program that is live now. `npm run challenges` (`scripts/challenge-runner.ts`, no Claude call) asks the Worker for spells reachable from each start set, strong enough, fewest merges first, never tried for their current program, plays the challenge in Node with each one cast at the challenge's spots, and reports: a solver wins on two seeds of three at one spot (a live one at its worst, after the full head start). A spell rewritten since its verification no longer counts and is tried first. A player's win is also a run of the challenge, and makes its spell a solver. `npm test` verifies every challenge with the plain solution of its hazard, in its worker threads.
5. **No hints**: the banner says nothing after a loss, in challenges and in the old hand-made islands. The World's Challenges button opens the tab.

### D. The island's story

1. **The chronicle** (`src/sim/chronicle.ts`, `/api/chronicle`). The World keeps a story log (`world.story`, saved, sixty lines at most): who died and what killed them as far as they remember, children born, what the mage cast, what creatures and artifacts did that is worth telling (a library spell cast, a creature tamed, a village raided), the same line within two minutes counted again instead of repeated; everyday work (grazing, harvesting, carrying food) is only counted. The Chronicle button in the World sends a digest of it, of what villagers remember of who hurt or helped them, and of how the island stands, to the Worker, where Haiku (`DESCRIBE_MODEL`, low effort) tells it as a village elder would, in 90 to 140 words. Once a session in the page, at most one every 20 minutes per person on the Worker, held and paid like any call (about $0.002); the last ten chapters stay in the browser. The digest is built in the sandbox, so it is bounded on the way back, and the prompt treats it as facts, never as instructions.
2. **The recipe book** (`src/book.ts`, the Book button by the inventory): every discovery, newest first, with the pair that made it for this player, when, what they made with it and when they last cast it. Memory only: everything in it is something this player did, nothing they have not made.
3. **Opposites** in the merge prompt (rule 8): opposites meet rather than stack, Fire and Water make Steam, never "Fire Water". An answer whose name holds every word of both inputs is asked once more with a note, and the second answer is kept only if it does better.
4. **Tiers by depth**, a challenge to the roadmap's "a tier follows its depth, plus or minus one": a result is at most one tier above what its depth implies (`shared/tiers.ts`, `capByDepth`: grand to depth 2, legendary from depth 3, cosmic from 7), on top of the two tiers above its strongest input. Only upward: a deep result may still be humble, since forcing a Candle at depth twelve to legendary would break meaning, the reason tiers come from meaning since 3.0. Measured first: 14 cosmic elements sat at depth 6 or less, three at depth 2, and cosmic spells are the ones Opus writes. Frozen answers keep their tier; only new merges are capped. The merge prompt still sees only the two names, so depth cannot drift names.

### E. Refresh the legacy library

The one planned exception to "never rewrite in bulk" (`worker/index.ts`, "refresh"; `scripts/refresh-runner.ts`; schema `migrations/0010_refresh.sql`).

1. **Programs, not items**: names, emojis, tiers and recipes stay. `POST /api/admin/refresh` writes each stored program again with today's prompt and engine, from the element's own name, entry, recipe, tier and intents, through the Batch API at half price: legendary and cosmic by `SPELL_MODEL`, the rest by the small model. Most cast first, never twice.
2. **Capped**: `REFRESH_BUDGET_USD` ($8 a month), counted from estimates held before each batch is sent ($0.06 a big program, $0.006 a small one), on top of the month's $50 and apart from the daily rewrite budget. Started early in a month.
3. **A new version earns its place**: it comes back as a `candidate`, a status nobody is served. The runner gives it its test run in Node (the promise probe and, for an artifact, the five minute test included), casts the old and the new on the same Spell Lab island at the same moments, and has the judge score both. It replaces the old one only if it passed, scored no lower and its creatures look no less alive; then players' votes roll it back if they like it less, as with any rewrite. The old version is retired, never deleted. `DRY=1` decides nothing and only saves the frames.
4. **Trim without breaking anyone**: one cheap pass (Haiku) lists near duplicates and merges that make no sense. The admin decides one at a time in the People view. An approved duplicate becomes an alias (`aliases`): its name keeps working in inventories, recipes and First Discoveries and means the kept item; a recipe made with the alias's name still answers. An approved senseless merge is asked again on its next merge, its old answer kept in `recipe_history` and in inventories. Nothing is deleted.
5. **The report**: `GET /api/admin/refresh-report`, replaced, kept, rolled back by votes since, and the cost.

## Accounts (4.0)

An invite link was kept by one browser, and progress lived there only. Now the link becomes an account the first time a passkey is made for it. Everything is in `worker/accounts.ts`, `src/account.ts` and `src/sync.ts`; the schema is `migrations/0011_accounts.sql`; `scripts/worker-test.mjs` (section 16) and `scripts/account-verify.mjs` check it. The plan was revised by the review in `docs/REVIEW-4.0.md`, part G.

### The invite is the account

Everything the server holds was already keyed by the invite id (`spend`, `elements.invite`, `suggestions`, `challenge_wins`, `reports`), so the account has the invite's id and nothing moves: the $5 a month, First Discoveries and ideas follow with no gap, and no migration rewrites a table. Votes and casts, keyed by a random browser id until now, use the account id for a signed in person, so a vote is one per person across devices. The claim is one statement (`UPDATE invites SET claimed_at ... WHERE claimed_at IS NULL`), so one link opened on two devices at once makes one account; the link's hash is replaced by one nobody holds, so it stops working for anyone else.

### Passkeys, sessions, links

Passkeys through WebAuthn (`@simplewebauthn/server` in the Worker, on WebCrypto; `@simplewebauthn/browser` on the page): discoverable credentials, so sign in needs no name; attestation `none`; user verification preferred, not required (a phone without biometrics still works); the relying party id is the request's host, which is why the domain must be chosen before the first passkey. Challenges live in `auth_challenges` for five minutes and are deleted when taken, so an answer cannot be replayed.

A session is 32 random bytes in the `x-session` header, like the invite's secret in `x-invite`: hashed at rest, 30 days, one row per device, revocable from the account page, dead with the invite if it is revoked or deleted. No cookie: nothing on the page uses one, the sandboxed frames cannot read either, and a header has no CSRF surface.

A one use link signs in an account that exists: the admin's "New link" on a claimed invite (the same `relink` as before; opening it calls `claim-link`, which retires the hash conditionally on the hash it was opened with, so two openings at once take it once), or a link sent by email when a provider is set up (`account_links`, 20 minutes, used once, three an hour, the same answer for an unknown address). The page uses either at once and drops the link from the address bar.

### Progress

Three documents per account in `progress`, each replaced whole: discoveries (key, time, the pair, and the element as the device knew it, so another device can show it), the board, and the island (the world save gzipped by `CompressionStream` and base64 encoded: a large island is about 700k characters raw and under 200k packed). Each has `updated_at` and a device label. Discoveries merge as a union by key with the earliest time (`shared/account.ts`, `mergeDiscoveries`); they go up five seconds after a change. The island goes up a minute after it changed and when the page is hidden; a device says what it last saw (`since`), and a newer save from another device is refused with when and where, so the page asks before replacing it, and loads the other one if the player says no. A device signing in takes the server's island when it is newer than its own, or has none.

Two tabs of one browser (4.1): each write of the discoveries reads the stored save again and merges by key first (`src/store.ts`, `mergeSaves`), and a `storage` listener shows what the other tab found. The island is written by one tab at a time: the tab that shows the World while visible claims it on a `BroadcastChannel`, the others stop writing it, and a tab that takes it back reloads the island first if another tab saved since; without `BroadcastChannel`, a write is refused over a newer save. Uploads read the "seen" times the tabs share, so one tab's upload never reads as an older device to the other. A full storage, or an island past `MAX_SAVE_CHARS` (1.5M characters), is said once per page (`src/quota.ts`).

The upload has its own limit (2 MB a body, `PROGRESS_LIMITS` a document); every document is checked for shape; a document is only ever read or written through the session's own account.

### Existing friends, export, deletion

A browser playing with a link is offered the account once, after the welcome; "Later" is an answer, and the `?` button keeps the offer. Nothing changes until they answer: the invite header keeps playing. Export is one JSON of every row keyed by the account. Deletion removes passkeys, sessions, challenges, links, progress, votes, casts, activity, ideas and their votes, wins and reports, sets `elements.invite` to null (the element stays, the First Discovery no longer names anyone), and keeps the invite row as deleted with its spend, so the month's budget stays whole and the id is never reused. The privacy note says all of this.

## Faster creation (4.2)

From a drop to a castable item used to take 27 s for the first small spell in the review's phone sized run, with 2 of 12 chips ready; the measurement (`docs/measurements/creation-4.2.md`) found where it went: about 15 s of Claude (grimoire entry 2 s, intent 1.5 s, program 11 to 17 s for Haiku, 25 s for a draft, 30 s for Opus), then the test run, which the hidden frame ran 7 times slower than its work (a protection cantrip: 3.7 s of work, 27.7 s), and artifacts never finished it at all (passed by the 60 s timeout, so their five minute test decided nothing), all one item after another. The rules, set by the owner: no lower quality (no fast mode, no weaker draft shown to players), and the extra cost of writing items nobody casts is accepted inside a daily cap.

### The test run in a Web Worker

The check frame (`src/sim/checkframe.ts`) is still the sandbox: an iframe with an opaque origin and a CSP with no network. It now makes up to two Web Workers from a blob (`src/sim/checkworker.ts`, built inline by Vite): a blob worker has the frame's opaque origin and inherits its CSP, so the only header that changed is `worker-src blob:` on `/check`. A worker runs the test from start to end, simulation only, off the page's thread, and keeps the control island and the probe runs without a spell between checks. A program that keeps it busy 45 s is stopped by terminating the worker, which the frame could never do; that counts as "did not finish", a pass, as a slow test always has. A browser that cannot make the worker runs the test in the frame, as before.

The five minute test of an artifact stops as soon as the artifact has acted (its own deeds, its creatures' deeds since the arrival, its material spreading, a body of its own at work for 30 s): nothing after that can make it fail. One that never acts still runs five minutes. On the 103 live artifacts the early stop gives the same verdict as the full run every time (`COMPARE=1 scripts/test-run-timing.ts`).

### Every item written at the merge

A merge that makes a new item, or reaches a known item that has no program, records one row in `writes` and sends its key to the `WRITES` Cloudflare Queue (`worker/ahead.ts`). A queue, not `waitUntil`, since a big model's program outlives the response. The consumer writes it with the model its tier calls for, as on first use: Haiku up to grand at once; above, Opus through the Batch API at half price with no Haiku draft, the batch polled every 30 s by delayed queue messages (the ten minute cron stays the fallback). The player whose merge started it pays, from their $5; the burst guard does not count jobs.

Idempotent three times: one row per item ever (its primary key), a claim in one statement (a message delivered twice runs once), and the same in-flight key as a player's own request (`spell:<key>`). A player asking while the job writes gets "writing" with when to ask again (`/api/spell` answers 202) instead of paying a second time; an older page waits, then gets a 503 to retry.

`AHEAD_DAILY_USD` ($1.50) caps these writes for everyone together; past it, past 80% of the month's budget, or when the player's allowance cannot take it, the row says `capped` or `unpaid` and the item is written on first use, exactly as before 4.2. `GET /api/admin/ahead` lists them by day. "0" turns writing ahead off.

Why no draft for big items: a draft is the weaker version shown first (2.80 against 3.80 blind in 3.3; both votes on drafts so far were down), and Opus directly at the merge would cost about twice the batch (one Opus program measured $0.125 direct, $0.062 at batch price), which breaks the rule that the cost of a spell must not rise. A big item picked before its batch ends says "writing" for a few minutes (batches took 2.5 to 4.7 minutes in November).

### Fewer waits

The page asks for the program of every item the merge said is being written, at once, three at a time (one at a time before, each waiting for the last one's test run); its test run starts as soon as it arrives. A program that passed its test here is castable at once and the verdict goes to the Worker in the background; only a failure waits for the rewrite. On the Worker the grimoire entry comes first (the program is written from it), then the intent call, the API library, the first recipe and the library examples side by side.

### The hour's prompt cache

The spell writer's system prompt (8,422 tokens, the same for every program) is cached for an hour on every model and in batches (`worker/oracle.ts`, `SPELL_CACHE`). Until 4.2 the big model skipped the cache as "rare and lone"; November's ledger says otherwise: 100 of 116 big spell calls and 251 of 279 small ones started within five minutes of the previous one, and most of the rest within the hour. An hour's write costs twice the input price and a read a tenth (a twentieth on Opus); hour writes are now priced as such in the ledger. Merges, grimoire entries and intents keep their five minutes: the last two are under the 512 token minimum and are never cached anyway.

The prompt was not trimmed. In the 275 programs written in November some parts are rarely used (floating islands 0, towers 1, custom goals 3, models 0), but a part a few programs reach for may be exactly what makes a World Tree; once cached, the whole prompt costs a tenth of its input price, so a fifth less of it saves under $0.0002 a program; and 20 spells cannot tell a small loss of quality from noise.

### What players see

Chips in the spell bar say "writing" (the Worker writes it, or the page is asking), "testing" (its test run here) or, for a few seconds, "ready"; one toast names the items that became ready together.

### A bug the measurement found

The page read the check frame's answer with only three problems (crash, nothing, wiped), so a broken promise (3.4.2) or an idle artifact (3.7) reached the Worker as "not ok, no problem", and the Worker promoted it like a pass: the probes had decided nothing in players' browsers since they were added. Fifteen live programs carry such a verdict (2 new ones promoted, 12 legacy rechecks that never asked for their rewrite, 1 vote rewrite); they are listed in the measurement and left live (never rewrite in bulk). Every problem is read now, and a failure the frame cannot name is a crash.

## Creatures that move like they mean it (4.3)

Players saw deer going back and forth. Measured first (`docs/measurements/movement-4.3.md`, `npm test` section "motion"), then fixed where the turns came from, with no API call and no prompt change. Everything here runs for villagers, the island's animals and the creatures of spells alike; no stored program was rewritten and the World API did not change (a spell that sets `x` or pushes a creature still does exactly that).

### Measured

`src/sim/motion.ts` is a meter the simulation reports to behind one null check, off outside tests. A **sharp turn** is a change of heading over 150 degrees within half a second, read from the creature's actual step; it is **natural** when the creature finished something in that half second (a task done, a wander or flight point reached, a catch, a delivery, a target someone else took, seeing a danger for the first time), otherwise a **flip-flop**. The same test on the direction the mind asked for gives **intent flips**: once motion has a turn rate, smoothing alone would satisfy the first count while the mind keeps dithering, so `npm test` asserts both. Also counted: seconds stuck (wanted to walk, moved less than a quarter of the step), hops (more than half a cell in one tick: a creature lifted out of a hollow), and changes of the drive per minute.

### Decisions that stick

1. **Fear with memory** (`src/sim/flight.ts`): alarmed at its sense (deer 8 cells from people and wolves, 9 from what hunts it), it calms only past 1.7 times that and after 3 seconds out of sight; it remembers where the danger was. Before, one distance switched fear on and off and a deer orbited it, roam, flee, roam.
2. **Where it runs**: twelve ways out walked in steps of 0.8 cells, scored by distance gained from the danger, keeping its heading, trees at the end for those that hide (deer, rabbits, boars) and the herd lying that way; chosen about once a second and again when reached, blocked or with the danger ahead, never turning back on a routine look. Before, the way out was chosen every tick from eight directions and a deer by a tree shook.
3. **Hysteresis everywhere**: a meal from hunger 0.7 to 0.3 (it used to stop after one mouthful at 0.55); the herd joined past 7 cells from its middle and reached at 3; danger from fire kept for 0.8 s after it is out of reach; a herd reconsidered after 2 s at the earliest.
4. **No gap between two tasks**: a finished task is followed by the next thought in the same tick. Before, for up to 0.85 s the creature walked toward a random point (`plan`), then turned to its real goal.
5. **Momentum**: wander points mostly ahead (within about 60 degrees), the next mouthful and the next furrow close by and ahead, a short trip whose straight line is blocked routed from the start rather than walked into and turned back from.

### Steering

`src/sim/steer.ts`. A creature has a heading and a speed (`hd`, `sp`, not saved). It speeds up and brakes at its kind's rate, turns at its kind's rate (deer 5 rad/s, rabbits 7, bears 3, golems 2.2; spell kinds by size and speed), a little more than twice as fast when nearly still, and turns on the spot before walking off the other way. It slows to arrive at a destination, and right down when close and facing away, so it does not circle its goal. It keeps apart from its own kind sideways only (a push straight back turned villagers round in lanes). Feelers look ahead along the way in half cell steps, each step climbed from the one before, so a slope is walkable and a cliff is not; when blocked it turns to the side it took last, up to 110 degrees. The right angle side step is gone, and with it most stuck time (deer 15 s a minute before).

### Paths

`src/sim/paths.ts`. A trip longer than 12 cells follows a flow field: walking distance to the destination's block of 4 by 4 cells, shared by everyone bound for it, filled breadth first 1,500 cells a tick over all fields, up to 64 steps, made again after 30 s and forgotten after 8 s unused (40 at most). A short trip whose straight line is blocked takes an exact field of its cell (28 steps). The aim is the furthest of the next six cells down the field that can be walked to in a straight line with a little room either side. A field climbs no step over 1.55 (creatures climb 1.6): a step that is just climbable when the field is made, or with a little water on it, does not stop a creature later. A creature the field cannot reach gives up its task and steps out of its hollow, as the stall did after 5 s before; a chase takes the field once the straight way to its prey is blocked.

### Herds, flocks, packs

A deer that sees a danger alarms its herd within 10 cells, and they run behind it (a place each behind the leader, unless the leader is nearer the danger). A herd roams a little ahead of its middle the way it is going, so nobody wanders off alone and is pulled back. Birds fly with a flock behind the lowest id around and land to sow when their leader does. Wolves hunting one animal take places on a circle around it, starting behind it, and go straight for it when close. Fish keep their schools as before, with separation.

### Gaits and idles

The view takes the simulation's heading, so a creature turns at its own pace and on the spot (`src/sim/voxel/view.ts`). `src/sim/voxel/gait.ts`: a walk, a trot or a run by speed against the kind's walking speed (longer strides, a body that bobs and leans into a run); standing, the head goes down to graze or work, looks around, or the legs fold and the body lies down when asleep or resting. The bestiary has run, graze and lie poses (`docs/visual-checks/gaits.png`); `docs/visual-checks/deer-before-after.jpg` is a deer by a bear on main and on 4.3 (`scripts/deer-clip.mjs`, `lab/clip.html`).

### Measured

`docs/measurements/movement-4.3.md` has every number. Deer flip-flops 16.9 to 0.4 a minute, rabbits 11.2 to 1.1, villagers 4.1 to 0.4; deer stuck 15.2 to 0.0 s a minute; hops (a creature lifted out of a hollow) 4 to 6 a minute to under 2. Cost, `scripts/prof-life.ts`, large island, median of three interleaved runs, ms per tick p50 / p95:

| Scene        | Creatures, main | Creatures, 4.3 | Whole tick, main | Whole tick, 4.3 |
| ------------ | --------------- | -------------- | ---------------- | --------------- |
| As generated | 0.36 / 1.02     | 0.69 / 1.52    | 3.13 / 6.40      | 3.18 / 5.00     |
| With guests  | 0.45 / 1.31     | 0.77 / 1.45    | 3.71 / 7.22      | 3.45 / 5.12     |

The steering costs about 0.3 ms p50 of creature time; `stepTemperature` reading its material tables by id instead of by name three times a cell takes more off the tick than that.

### Guards

`npm test` asserts a deer under 2 flip-flops a minute in its steps and in its mind, every kind under 3 and under 3 s stuck a minute, a herd running behind one leader, wolves closing in from around their prey, birds flying with a flock, and that wolves still catch deer in the five minute scene (2 at least over its three streams: on main the streams caught 0, 3 and 4). Three things the new movement exposed:

1. **Challenges.** A lava challenge is won 9 times in 12 seeds by the wall, on main and on 4.3 alike, and its verdict on seeds 101, 202 and 303 flipped with any change to what creatures do to the land (birds sowing, villagers felling). Replays now give creatures their own random stream, as the test run does, and `npm test` also asks every plain solution to win half of 12 seeds (`winRate`), so a failure on the three seeds with that green is luck, not a weaker solution.
2. **The wildfire** counts burnt houses as they burn: villagers who got about better rebuilt each house as the next burned, and doing nothing won once in 24 seeds without two houses ever down at once.
3. **Two test fixtures** passed by luck of the old movement and are now deliberate: the statue is 4 blocks tall, so it is visible and fails as idle; the imp hunter hunts only imps, so the imps always have an enemy near.

## Islands of every kind (4.4)

Asked for: bigger islands where the device can run them, biomes and shapes chosen at reset, and a better looking land, water and sky, each measured on a phone sized browser. Everything is in `src/sim/land.ts` (the land), `src/headroom.ts` and `src/island-store.ts` (sizes and saving), `src/sim/voxel/terrain.ts`, `sky.ts` and `graphics.ts` (the view). Numbers: `docs/measurements/view-4.4.md`. Pictures: `docs/visual-checks/biomes-and-shapes.png` (all 42 from above), `biomes-weather-sky.jpg`, `reset-dialog.jpg`, `desert-lakes-phone.jpg`, `giant-tundra-phone.jpg`.

### One set of materials, seven biomes

A biome does not add materials: grass is grass in the desert and the tundra, a tree is a tree. Every species' habitat (wildlife.ts), every spell's rules, lures and promises were written against those materials, and they keep working. What a biome changes:

1. **The climate**: degrees added to the ambient temperature, and where and how fast it falls with height (`World.climate`, `lapseFrom`, `lapse`; 0, 24 and 2.5 are the old island's). The desert is 14 degrees warmer; the tundra 10 colder near the sea and falls faster above it, so its sea and lowland lakes stay liquid (the fish need water) while the uplands freeze and snow over.
2. **Where each material goes**: sand and dunes with grass by the water in the desert, snowfields and frozen uplands in the tundra, dense forest in the jungle, low land with dug pools and mud in the swamp, a volcano with a lava crater and basalt slopes, terraced red rock in the mesa.
3. **The colors** of the built-in materials (a copy of the table per world, applied at generation and again when a save is loaded: colors are not saved), the island's cut sides, the water, and **the trees drawn**: palms, pines under snow, tall jungle trees, willows, junipers. The models are checked for faces in one plane by `npm test`.
4. **The weather** it gets (below).

Whatever the biome, every native species must have somewhere to live: where the forest animals' habitat is short (under a 400th of the island), a grove by a small pond is planted (an oasis in the desert), and a deep pool where the fish have none. On the 42 islands of `npm test` (112 cells) every species has habitat.

### Shapes, rescaled from their own distribution

A shape is raw heights where only the order matters: one corner pulled down (coast), soft warped islands (archipelago, lower mountains), terraces with steep risers (plateaus), long warped ranges (ridges), basins higher toward the edge (inland lakes), land falling to one side with a flat plain where the biggest river splits into four to six meandering branches (delta). The heights are then rescaled from their own distribution, as the old island was, so the water slider means a share of the island (5% to 35%, more for an archipelago or a swamp) and the mountains slider the height of the peaks (12 to 36 above the sea), whatever the noise did. Positions are warped by a low noise before the masks are applied, so no island comes out as a circle or a straight line.

### Water that runs and stays

1. **Lakes**: every depression is filled from the island's edge inward (priority flood, Barnes et al. 2014). A cell's filled level says where its water spills; where it is 0.6 deeper than the land and its spill point is above the sea, there is a lake, even if its bottom lies below the sea's level (the first version filled such a basin's bottom to the sea's level and its top to the spill point: a wall of water 13 high that fell at the first tick).
2. **Rivers**: the same flood gives each cell the way its water drains; the cells it drains (flow accumulation) say where rivers run and how big they are. Only streams that grow into a river (four times the threshold, which wetter biomes lower) are carved, upstream first, so a bed is always lower than the one above it; at most 1.4 deep with 0.9 of water, so walkers ford every river (paths.ts). A river crossing a lake leaves it at its surface, and its outlet is cut at most half a unit below it, so carving a river never drains a lake. The banks of big rivers are lowered, never beside a lake.
3. **Springs** (`World.springs`) keep a cell at a level: twelve at the river heads, one along every river cell (weak, as ground water), one at the deepest cell of each lake (faster for a big lake: the sun takes 0.004 a second from all of it), one at a volcano's vent (lava, and lava within a few cells of it never sets). A spring under another fluid stops, and starts again once the cell is clear, so a spell can still dam, freeze or boil a river. **Water above the sea leaves over the island's edge**, so rivers flowing for hours do not raise the sea. Both only exist on islands made by land.ts: challenges and the old island are unchanged.
4. **At rest from the start**: once everything is carved, still water is brought down to its spill point, so lakes do not drain in the first seconds of play.

`npm test` leaves one island of each biome (each on a different shape, the shapes going round) alone for three simulated minutes in its worker threads: each species alive at least 60% of the time (a lone bear killed by a mob is born again a little later: one death is an event, a species that stays gone a problem), villagers and houses standing, rivers and lakes still holding water (ice counts: the tundra's freeze), the open sea within 0.3 of its level, no house flooded, nothing burning by itself, the volcano still molten. Over ten minutes on the coast shape the rivers settle at half to two thirds of their first extent, the swamp gains water, the sea rises 0.01 to 0.02.

### What stays as it was

`generateWorld(w, h, seed)` without options is the island before 4.4, to the bit: the test run's practice island, the Spell Lab and every check that used it keep it, so no spell's verdict, judge frame or challenge moves. An island saved before 4.4 keeps its land (a reset gives a new one) and gets a temperate sky and weather.

### Bigger islands where the device can run them

Huge is 288 cells across (1.9 times a large island), giant 384 (3.4 times). The simulation's cost grows with the cells (the ticks measured grow 1.9 and 3.5 times), and nothing about a phone tells whether it can afford that, so the device says it itself: every 30 seconds the World frame sends the HUD's numbers of the island being played (challenges excepted), shown or not; the page keeps the latest. A bigger size is offered when the simulation p95, scaled by the cells, would stay within 12 ms (a third of a frame at 30 a second) and frames are on time now (p95 under 40 ms, at least 300 frames measured). The latest measure wins, so a device that got slower stops being offered more. A size is never chosen by default: a narrow screen starts small, others medium, and a big size stays the default only while the device still has the headroom. The frame runs spell code, which could send these numbers too: the worst it can do is offer this player an island they may decline.

A giant island's save is 2.5M characters of JSON, past what the browser keeps beside the discoveries (1.5M). Saves past 400k characters are kept gzipped (0.64M for a giant island), read back in both forms; the account keeps every island gzipped as before (1.5M limit), and the Worker accepts the two sizes. A giant island is also kept on a device with no account. Saves keep up to 600 creatures (400 before; a giant island holds about 450).

### The view

Each improvement is behind a switch (`graphics.ts`), for the Perf Lab and for a device that cannot afford it.

1. **Ambient occlusion**, baked into the vertex colors when a chunk is built: each corner of a top is darker by how many of its three neighbors there (two sides and the diagonal) stand taller (Mikola Lysenko's voxel occlusion: both sides taller is fully hidden), and the square is split along the diagonal joining its two darker corners, so the shading never shows the triangles. The foot of a wall inside the island sits in a crease (74%).
2. **Water**: colored by depth from the biome's shallow and deep colors (the square root of depth, so the shallows read clear and depth darkens quickly), more opaque where deep; foam at the corners that touch the shore. Waves are a few sines in the vertex shader of water tops: a corner rides by the smallest weight of the four cells around it, so two tops that share a corner move it the same way and never open a gap (checked by `npm test`), and water against the shore, a wall or the island's edge stays still. The water's program is named apart (`customProgramCacheKey`): three otherwise reused the land's, whose wrappers read the same.
3. **Weather**: rain, snow and fog, a spell of two minutes easing in and out, picked from the island's seed and the time by the biome's odds (the jungle rains, the tundra snows, the swamp is foggy, the desert almost never rains). It is the view's only: the simulation never knows it rains, so challenges, test runs and spells play the same under any sky, and nothing is saved; two devices with the same island see the same sky. Islands with no land (challenges, the Spell Lab, the test run) have none, so the judge's frames are unchanged. Rain and snow are 2,400 points in a box around the camera's target that fall in the vertex shader (no work per frame on the CPU); rain greys the day and the sky, fog brings the fog in and greys the sky.
4. **Sun, moon and stars**: the sun crosses the day from dawn to dusk and the moon the night, on a low path a little to the south; 700 stars, more of them low, fade in at night and behind clouds. The camera mostly looks down at the island and even turned level sees only the first few degrees of sky, so a body is drawn no higher than the top of what is on screen: turn toward it and it sits above the horizon. The sky follows the camera inside its far plane, which grows with the island.

Flowing rivers changed the water's level by hundredths and wetted and dried thin films at their edges every tick; each change rebuilt its terrain chunks, and the first version drew in 6.2 ms instead of 2.5. A cell is now drawn wet from a depth of 0.06 and dry below 0.005, a level redrawn when it moved 0.15, and chunks dirtied only by flowing water wait in a slow queue (one every third frame, so an edge may lag a second or two). A spell's flood, lava or new land is drawn at once.

## Challenges

Hand-made islands with a hazard and a goal (`src/sim/scenarios.ts`, titles in `scenario-list.ts` so the game page does not load the engine to list them). A challenge builds its own world, runs a `tick` every frame (a volcano vent, a rising sea, the sun drying fields) and a `check` twice a second that returns progress text and playing, won or lost. It never touches the player's island: the iframe keeps the sandbox save in memory and restores it on leaving.

Balance is measured, not guessed: `npm test` plays each challenge with nothing over eight seeds and with a plain solution spell from `lab/solutions`, and the parameters were tuned until the replays agree. A loss is decided the moment it happens, not at the end: villagers rebuild ruins, so a village that burned and was rebuilt would otherwise count as saved.

## World

1. **Simulation** (`src/sim`): a grid of columns, each with a height, a ground, a fluid and its depth, a cover (tree, house...), fire, temperature and a gas. 30 ticks per second.
2. **Rules of the land** (`physics.ts`): water runs downhill, freezes below 0 and boils above 100; lava flows slowly, burns and hardens into basalt, and makes steam with water; acid eats covers and soil; oil burns fast; mud dries; snow melts; fire spreads through forests, fields and houses with the wind and leaves ash and stumps; steam rains back down; powder explodes; grass and forests grow back.
3. **People** (`creatures.ts`): villagers live near their houses, rebuild rubble, flee fire, panic and run for water when burning, drown in deep water; a new villager appears now and then while houses stand and the village has food. Spirits fly and glow, golems are strong and fireproof. Since 3.5, deer, rabbits, wolves, boars, bears, birds and fish live in their own habitats; since 3.6 everyone has a goal, needs and a job (above).
4. **Generation** (`world.ts`): fractal hills rescaled from their own distribution so every map gets about a fifth of water and a few snowy peaks, a river, forests, and villages on the flattest dry land.
5. **View** (`voxel/`): a floating voxel island in three.js, with layered cut sides and water spilling off the edges. No two faces share a plane (3.4, `docs/visual-checks`): a waterfall hangs 0.06 cells in front of the cut side, a water wall starts on its own floor, spell blocks are never placed inside the land and take the place of a cover they are put on, and spell drawings are projected only on dry land tops and fluid tops, never on walls or on land under water. Built for phones: lighting is baked into vertex colors and every material is unlit, terrain chunks are rebuilt only where a column changed, each kind of object is one instanced draw call, and the pixel density drops when frames are slow. A medium island is about 60 draw calls and 140k triangles. Chunks are built with a reusable typed array writer under a 3 ms per frame budget.
6. **Day and night** (`voxel/daylight.ts`): a six minute cycle that tints every unlit material and the sky; fire, lava and spell light are untouched, house windows light up at night and chimneys smoke.
7. **Saving**: the iframe sends a compact save (each layer quantized to bytes) every 10 seconds; the parent keeps it in localStorage. Materials and creatures that spells defined are saved by name with the spell that owns them, and that spell's rules are loaded again before the world.
