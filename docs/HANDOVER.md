# Handover

So the project can stop and restart from fresh sessions with nothing lost. Two parts: the director's (the session that reviewed the project on 10 November and led it for a while) and the planner's. Keep it current: a session that takes a decision the next one must know adds a line here.

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
