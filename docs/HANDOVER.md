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

To be added by the planner: its routines and triggers, the approvals log, the dashboard and its scripts.
