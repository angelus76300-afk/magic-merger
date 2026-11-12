# Handover

So the project can stop and restart from fresh sessions with nothing lost. Two parts: the director's (the session that reviewed the project on 10 November and led it for a while) and the planner's. Keep it current: a session that takes a decision the next one must know adds a line here.

## The lead session's part (from 11 November 2026, 13:00 UTC)

An experiment the owner asked for: one session leads and builds, instead of a planner starting builders and reviewers. The lead is "Magic Merger lead session" (session_01NxvtApgb2CBkVZn1xvQR2w). The owner talks to it directly. It builds updates, not fixes: something seen within thirty seconds of opening the game, shipped whole under a name. One fresh Sonnet reviewer per pull request, one round unless it finds something real. The planner and its night run stay paused meanwhile.

### The order, and why

1. **The island tells its stories** (the camera goes to what is happening). First, because the content exists and was not shown: an untouched island tells about sixty story lines in ten minutes and the screen showed none. Everything after stands on its happenings and its camera.
2. **One game instead of two**: troubles on the home island that only magic not yet made can answer, and tiers that climb. Needs 1, since a drought nobody sees is not a need. No hints (declined by the owner).
3. **Become anything** (take control): the follow camera of 1 is half of it.
4. Items worth showing a friend: needs the owner's yes with a cost (prompts, money, stored spells).
5. Towns read from the sky, then speed measured on the real Fold.

### Where each piece is

| Work                                                   | State                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The island tells its stories (#121)                    | Live since 18:27 UTC on 11 November. `docs/DESIGN.md`, "The island tells its stories"                                                                                                                                                                                                                                            |
| The tour of a new island plays when the island appears | In #121, at the owner's word of 11 November (it waited for the first cast for a day, #110)                                                                                                                                                                                                                                       |
| The island needs you: the wildfire (#123)              | Built on the stories branch: engine, save field, camera, lines, Craft line, switch, stone, card line; 14 checks. The owner: "troubles: on", "size: village", "tiers: keep". Design page https://claude.ai/artifact/Lxi1Le5vyN38PVdzXxrmCL. Next troubles in order: drought, high water; a raid needs boats and raiders that live |
| Production deploys                                     | Failed from 06:08 to 17:54 UTC on 11 November: the environment `production` held a wrong `MM_TOKEN`, then a Cloudflare token without D1. The owner fixed both; the Deploy of 17:54 passed. Issues #118 and #120 can be closed                                                                                                    |
| Smoke fix (#122)                                       | Merged by the lead session on the owner's "smoke fix: yes" and "smoke fix: merge": the browser install falls back when Ubuntu's package servers are out of reach                                                                                                                                                                 |
| Lighter pipeline (#117)                                | Merged by the lead session on the owner's "lighter pipeline: go": tests in CI on the merge result, a review valid across a merge of main, the Gate follows the checks it starts. Not yet seen live: the Gate's re-test of a reviewed pull request against a newer main                                                           |
| Weather that crosses the island (#124)                 | Draft behind #123: rain and snow as fronts, rain puts out fire, a big spell redraws the land in one frame; 9 checks. Owed before ready: measure the long frame of a real grand spell on the preview                                                                                                                              |

### Decisions taken, and why

| Decision                                                                         | Why                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Happenings are not saved                                                         | A happening is of the moment; the saved story and the golden save stay as they are, and the update is green         |
| What is going on beats what just happened                                        | A story line is told after the kill; a camera that leaves then arrives at a body (the game designer's challenge)    |
| A tap during the watch returns the view and casts nothing; a drag keeps the view | The camera forgetting where the player was is a bug of the review; a cast under a moving camera would land anywhere |
| The watch starts by itself after 15 s (40 s with a spell in hand)                | The owner's test is an untouched island that is never boring; looking for where to cast is not idleness             |
| Villager names come from the look and the home                                   | Both are saved, ids are not stable across a reload                                                                  |

### How the lead session works the pipeline while the planner is paused

- The Gate does not wake by itself: start it with `actions_run_trigger` (`run_workflow`, `gate.yml`, ref `main`) once a pull request is green and reviewed.
- After a workflow change lands on main, the Gate cannot bring a branch up to date: merge main into the branch by hand and ask the same reviewer session for its verdict on the merge commit.
- The owner's yes is recorded by the lead session as the planner did (label and an `mm-owner` comment quoting the owner), saying it was typed in the lead session. A red workflow change is merged by the lead session only on the owner's explicit "merge" for it.
- The dashboard: write `scripts/planner/planner.json`, run `node scripts/planner/to-dashboard.mjs <dir>`, upload `glance.json` as an asset of the dashboard, point the eleven datasets at it in one batch, delete the old asset.
- The Gate tells a workflow run by its file, not its name (fix of 11 November, merged by hand on the owner's "gate fix: merge"): `ci.yml` has a `run-name`, and GitHub gives that as the run's `name`. The lighter pipeline shipped with a filter `name === "CI"` that matched no run, and held the wildfire and the budget fix for two hours on a CI that had passed. The test fed the Gate runs named "CI"; it now feeds it what GitHub really lists.
- The watch is a standing session, "Magic Merger watch" (Haiku, `session_01NxvtAmhn8EGzccCG6kMaC9`, the repository attached), woken every two hours by the scheduled task `trig_01MwWarNDq192dYbh5wFWacD`. It reports to the lead session only when something is wrong. A scheduled task that starts a fresh session each time has no GitHub access at all (tried, 403 on every read): do not go back to that.
- Record the owner's yes before a merge by hand, not after: the Deploy reads the label and the `mm-owner` record of every pull request since the last deploy, and refused three times on 11 November because the Gate fix was merged on the owner's word with no record. Writing the record afterwards and starting the Deploy by dispatch repaired it.
- Database reads, measured by hour on the live database (11 November): a baseline of about 17,000 rows an hour until 20:00 UTC, about 1,700 from 21:00. The day's total (2.49M) still carries the midnight hour (868,000) and the paid calls before the running totals landed. The first full day to judge is 12 November: expect well under 100,000.
- Local `main` in the lead session's checkout is an old, diverged branch: work from `origin/main` (`git checkout --detach origin/main` or a new branch from it).
- `test:worker` has one check that can read a row before the Worker's queue wrote it ("votes: the rewrite is recorded, and paid by the voter"): it failed once in CI on a merge commit and passed on a re-run. Make it wait for the row when next in the Worker.

### Next to build: "Become anything", first version (designed and challenged, 11 November)

What the player gets: tap a creature, press Become on its card, and play as it. Decided after the game designer's challenge, so that it is built once:

1. **Become, chase camera, fixed stick, Let go, the line "You are Mira the fisher".** The camera needs its own mode, `orbit.chase(x, y, z, heading)`: `watch` takes no heading or height and lets go at a touch. The stick is fixed at the bottom left, in the Watch button's place while possessed, and captures its own pointer; a floating stick would eat the tap that casts.
2. **Walkers and swimmers steer through the engine's own steering** (`steer.ts`, `motion.ts`); the possessed creature's thinking is paused, everything else unchanged. **Flyers hold their altitude and the stick only banks**: altitude is a constant per kind, there is no climb or glide.
3. **The creature's own abilities as buttons, two at most at 344 px**, calling the ability with its trigger skipped and the same `m.ready` cooldown and the creature cast cap as they are. No hold to repeat.
4. **Cut from the first version**: the context action ("Do"), climb and glide, a death camera, road laying, casting spells while possessed (the tools are hidden; Let go first).
5. **Guards**: at 0 health the player is thrown out and the creature lives or dies by the simulation's own rules. Fighting a trouble by hand slows it and never ends it: the right item must still matter.
6. **Its thought line stays on screen** while you are it ("hungry", "afraid of the wolf"): a point without a goal system (`lifeLine` exists).
7. **The number**: median seconds possessed per Become. Under 20 it is a toy tried once; over 60, add the Do button next (one unlabelled button that sets the creature's own task on what is in front, `setTask`, with an icon of the target and no words). The simulation's p95 stays unchanged.
   No paid call, no save change, stored spells untouched: green.

### The owner's words of 11 November, and what follows from them

- "troubles: on", "size: village", "tiers: keep (but we could imagine reworking the classification system)": the wildfire. A proposal for what tiers should mean is owed after its numbers.
- "smoke fix: yes", "smoke fix: merge", "lighter pipeline: go", "branches: yes" (one branch per update).
- "Reuse sessions that would be useful and archive the rest": the planner ("Magic Merger Main"), the Director and Roadmap Planning are archived, with every finished builder and reviewer. Only the lead session remains. The planner's hourly guard, its morning brief and its one-shot database check are paused (not deleted).
- "make sure we keep what you would consider good behaviors (... making sure everything is working properly every 15 min or updating the dashboard, even doing some of the work at night)": the scheduled task "Magic Merger watch" (every two hours, a fresh small session, read only: live health, last deploy, main deployed, rollback or pause issues, stuck pull requests; silent when fine, a push to the owner and a message to the lead when not). It names the lead's session id: change it when a fresh lead takes over. The dashboard is refreshed by the lead at each merge and each "live".
- "you are the boss and know what is best": the lead decides the order and the method, and says why.
- "don't worry about usage, I'll reset fable usage as soon as you reach it this week (won't be applicable for the next weeks so we'll have to find a smart way to reduce usage. maybe switch you to opus and call fable in certain specific cases": from next week, an Opus lead, Fable for choosing what to build, the design before an update and the look at frames after. Measure one update each way before believing a claim about effort settings.
- Asked of the owner and not answered yet: "rules: lead" (CLAUDE.md still names the planner), "watch: haiku" (the watch's model), "fresh: yes" (the lead starts its own successor when its history is heavy).
- On the owner's list (#51) only, from before: "autonomy: yes" and "guard: drop".
- The owner plays on a Z Fold and reports by playing: the island's presentation at arrival, rain over a whole land, big spells drawn by sections. Each became work the same day.

### Found by the audit of the archived sessions (11 November)

- Database reads: 2.79M of the 5M free daily limit at 20:18 UTC on 11 November (2.47M live). Past the limit the database refuses requests until midnight UTC. The cause the planner named is the budget check reading the month's ledger on every paid call: it is in the approved "spend" work, which is now third in the order, after the wildfire and the weather. A check fires into the lead session at 01:30 UTC on 12 November.
- The weekly limit: 31% used at 12:37 UTC on 11 November, on pace to run out on Friday.
- Only the owner can do: delete the two old repository-level secrets (after the preview has its own token, docs/SETUP.md steps 12 to 14); a ruleset on main.
- Unowned: the draft "Feedback: the Sound button" (#94, amber, waits for the owner), issues #90, #69, #91 (feedback), #46 and #28 (API proposals). The owner's list (#51) is stale and is the lead's to bring up to date.
- "Discoveries worth reading" (the owner's idea, 8 November) is listed on #51 as being built and has no open pull request: check whether it merged.

### The experiment's tally

| Measure                               | Lead session                                                                                                                                                        | Old setup, 5 to 10 November                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Updates live, by name                 | 3: The island tells its stories (11 November, 18:27 UTC), The island needs you (wildfire, 12 November, 00:10), Weather that crosses the island (12 November, 01:15) | 35 pull requests merged, almost all small            |
| Pull requests that needed a later fix | 1 of 4: the lighter pipeline broke the Gate's reading of CI (fixed the same day)                                                                                    | 6 of 35                                              |
| Sessions started                      | 0 so far (1 reviewer to come)                                                                                                                                       | about 95 review rounds, 40 re-reading merges of main |
| Subagents                             | 2 (game designer, playtester)                                                                                                                                       |                                                      |
| The owner's time asked for            | 0 questions                                                                                                                                                         |                                                      |
| Usage                                 | The weekly limit read "warning" at 17:49 UTC on 11 November. Two reviewer sessions cost $0.38 and $1.47                                                             | paused 78 of 130 hours by limits                     |

## The director's part (written 11 November 2026, 03:55 UTC)

### What was observed

The full review is `docs/REVIEW-2026-11-10.md`; its short page for the owner is https://claude.ai/artifact/SNPuaahkAtn9j8gk8AjEaq. Since then:

1. A placed monster dies fast for two reasons, measured on the 115 library programs that place a creature: daylight on creatures written weak to light (39 deaths) and villagers (18). The villagers' mob counted every villager near each other, not near the creature, so a village killed anything (a Troll of 300 health in 5 seconds).
2. The usage limits are the project's real bottleneck. The five hour limit stopped every session at 02:30 UTC on 11 November with about seven running; the weekly limit read "warning" six hours into its week. The review's finding stands: about four review rounds in ten re-read merges of main.
3. A workflow change merged to `main` stops the Gate from catching branches up (seen after the Gate schedule change): every open branch then needs a merge of `main` by hand.
4. Items that already exist keep their stored intents. An old item whose main intent is `protect` (Meteorite) would still be told to raise a dome if rewritten.
5. `src/sim/sound.ts` reads `localStorage` inside the sandboxed frame and logs an error at every World opening (found by the first cast builder, not fixed).

### Decisions taken, and why

| Decision                                                                                                                                                  | Why                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| The play session ran on staging, never production                                                                                                         | Production with the admin token risks writing the owner's account; staging is the same commit with a copy of the library                     |
| Protection is promised by a name or a main intent only                                                                                                    | As a second intent `protect` was wrong 62 times in 64, and it is why 127 programs raise a dome                                               |
| Bows and guarding are not an item's deeds; being carried still is                                                                                         | An object is made to be carried and used (4.7); an existing check showed the stricter rule was wrong                                         |
| Monsters: an exchange of blows, a mob of those near the creature, no fight against a sleeper that struck no one, shade by day with a first minute unburnt | Scaling a villager's damage by the creature's attack would make harmless things unkillable; a weakness to light must still matter afterwards |
| The pipeline builder was not started                                                                                                                      | The permission classifier refused it in the director's session; it was not worked around. It waits for the owner                             |
| A trial write on production was not made                                                                                                                  | Refused by the classifier; not worked around                                                                                                 |
| The 4.9 builder holds "plan from needs"                                                                                                                   | The recommended order puts the first session and living monsters first; the owner has the choice                                             |

### Where each piece stopped

| Work                                              | State at 03:55 UTC, 11 November                                                                                                                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Items keep the promise of their name (#106)       | Merged and live. Owed: look at the first real new item (a plan first, no dome on a name not about protection)                                                                                                                                                         |
| Guards for stored spells and saves (#112)         | Merged: `scripts/api-surface.json`, fixtures of versions 4 to 6, a golden save, a save newer than the code set aside                                                                                                                                                  |
| A first cast the newcomer sees (#110)             | Ready and reviewed, waits to merge. 0 of 3 first taps seen before, 3 of 3 after, at 344 by 882                                                                                                                                                                        |
| Monsters that live through their first day (#111) | Draft, builder session_01NxvtAnXcy3A5pWcZ5HvZJs finishing its tests and playtest                                                                                                                                                                                      |
| Risk class sees the spell API and the save        | Builder session_01NxvtAnNpe1a6iYCC1aSB5Y (Sonnet). Red; the planner asks the owner "risk rules: yes" when it is ready                                                                                                                                                 |
| Lighter pipeline (approved)                       | Not started. The brief: tests back in CI on the merge result; a review stays valid across merges of main when CI passes; a workflow change on main must not stall branches; a cap on running sessions in the session guard; the owner's steps for a ruleset on main   |
| Spend (approved)                                  | Not started; waits for the database reads pull request (#101) and for the pace. The brief: big items written at their first cast, the design call weekly, running totals for the budget check                                                                         |
| Credentials (approved)                            | The owner's steps are with the planner: a second environment for builders and reviewers without the production keys; a GitHub environment "production" limited to main. Then a pull request so the workflows use it, and the session guard allows the new environment |

### What is next, in order

1. Land #110 and #111, then look at the first new item written by the new writer.
2. Lighter pipeline, as soon as its builder can be started: it is what stops the limits from being burnt on repeats.
3. Credentials, once the owner has done the two settings steps.
4. Spend.
5. The 4.9 builder's next piece, after #111: the island's life seen from the default zoom (a birth, a hunt, a building going up).
6. Re-derive intents for old items and repair the first generation one at a time (a concept for the owner).
7. Tiers that climb and one trouble a session on the home island (a question for the owner), then look closer, reduced, with a morning card.

Pace rules in force: at most 2 builders while the weekly limit reads "warning", reviewers on Sonnet, no session above Opus except the director's.

## The planner's part

The planner is the session "Magic Merger daily planner" (session_01NxvtApFG2JjVSbpSNYmAKn, Opus, permission mode auto). It is the owner's one point of contact: the owner types answers there (or "Send to Claude" from their own account), and only the planner records approvals, as the label owner-ok or owner-yes plus a comment whose first line is `<!-- mm-owner ok -->` or `<!-- mm-owner yes -->`, quoting the owner and naming the files read. A GitHub comment never counts as the owner's. The planner never edits repository files itself; builders do.

### The owner's list and what they approved

Issue #51 is the owner's list ("## Open" is what waits for them; "## Approved concepts" is every yes, with the owner's words and date). Read it first. Approvals given on 10 and 11 November: wonders review 4.9.5 ($3 to $6, back to the owner only past $12), Z Fold sizes in every check ("folds: yes"), the hours rule ("hours: fill"), "carry: as is", "d1: Tuesday", "credentials: yes" (owner's settings done 11 November), "promise: yes", "spend: yes", "lighter pipeline: yes", "gate schedule: yes", "pipeline: planner starts it", "order: first session first", "risk rules: yes".

### Owner preferences

Toronto time; the weekly Claude limit resets Tuesday 5 PM Toronto (22:00 UTC in winter), and the last hour before it is used, not saved. Messages to the owner: a few short paragraphs, goal, what was done, a choice with the recommended option first, answers by name ("x: y"), never by pull request number. Reviews and audits are artifact pages. At most 5 sessions running at once (3 builders plus reviewers); at the weekly warning, 2 builders. Reviewers and small fixes on Sonnet, big work on Opus, nothing above Opus except a director the owner names. Archive sessions when their work is live.

### Scheduled tasks (claude-code-remote triggers)

| Name                               | Id                            | When                   | State on 11 Nov | Does                                                                                |
| ---------------------------------- | ----------------------------- | ---------------------- | --------------- | ----------------------------------------------------------------------------------- |
| Magic Merger usage guard           | trig_01Tggcc9Enezm8EpZUGnkPX4 | 5 past each hour       | on              | usage guard, starts the Gate by dispatch, stuck queue, archiving, dashboard refresh |
| Magic Merger: night run            | trig_01AcQLWkxcWTUteMnfxqKoKz | 1:13 AM Toronto        | paused 11 Nov   | night checks and the night's builders (DAILY.md)                                    |
| Magic Merger: today's prompt       | trig_01ApquU2rkgAU91wVpvEXBrm | 7:36 AM Toronto        | on              | morning brief                                                                       |
| 20 items rebuilt for their kind    | trig_01HRc4vbeXeuFqGFUuSAgbzX | 00:07 UTC              | paused 11 Nov   | the library rebuild by kind, 20 a day, cost guard $5.30                             |
| Check database reads after the fix | trig_019dYQJYTpCQZ4xhNyYNyQtE | 12 Nov 01:30 UTC, once | on              | rows read for 11 November after PR #101                                             |

A fresh planner recreates them from this table and the prompts kept in each trigger (get_trigger shows them).

### The dashboard

"Magic Merger Glance", https://claude.ai/artifact/RFaACWNCA4PnbThqVFJXef, pinned in the owner's sidebar, made from the Dashboard Artifact type. Its page is the store document files/index.html (the game's Lantern night look, numbers in the reading font). Eleven datasets (status, spend, d1, queue, live, next, choices, calls, rebuild, updates, roadmap) point at one uploaded glance.json. To refresh: run `node scripts/planner/to-dashboard.mjs <dir>` (it runs collect.mjs: GitHub, the live game's /api/spend and /api/admin/refresh-report with ADMIN_TOKEN, Cloudflare D1 analytics with CLOUDFLARE_API_TOKEN, issue #51's Open section) to write glance.json, upload it as an asset of the dashboard, update the eleven datasets' source.url in one batch, delete the old asset. scripts/planner/planner.json is the planner's own snapshot (mode, usage, working, next, roadmap, updates). These scripts read the live game's admin report with the production token, so a change to them is amber (rule A8 of `docs/DAILY.md`): they run only in the session that holds that token.

### Known traps

- GitHub runs this repository's schedules 6 to 10 hours late: the Gate's 15 minute schedule is a bonus; the hourly guard dispatches the Gate (`gh api -X POST repos/angelus76300-afk/magic-merger/actions/workflows/gate.yml/dispatches -f ref=main`; `gh workflow run` fails through the session proxy because GraphQL is blocked).
- A workflow change on main stops the Gate from catching branches up; each builder merges main once by hand (the lighter pipeline builder is fixing this).
- A red workflow change is merged by the planner by hand after review and the recorded yes.
- Seven sessions at once hit the 5-hour limit on 10 November; the weekly limit reached warning six hours into the week.
- The safety check refuses some actions (starting a pipeline builder from the director, a test write on production, recording a yes the owner did not give): stop and ask the owner, never route around it.

### State at handover (11 November, 04:40 UTC)

Paused for the owner's experiment (a fresh Fable session leading the roadmap): no new builders; night run and daily rebuild off. Finishing: monsters (#111), the lighter pipeline and credentials workflows (session_01NxvtAnFb4NaPuHZVs1BFBx), first cast (#110), Phoenix (#108), risk rules (#113, yes recorded). Waiting for the owner after the credentials PR: delete the two repository-level secrets. Next in order: a newcomer's first minutes, spend, Builders 4.9 part 3 (island life seen from the normal zoom), wonders review 4.9.5.
