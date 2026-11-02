# Spell quality before and after 3.3 (2026-11-02)

20 spells already in the game, picked across tiers and kinds: 15 up to grand (Haiku territory) and 5 legendary or cosmic (Opus). Each was measured three ways:

1. **Before**: the program stored today.
2. **After**: what 3.3 writes for the same spell as a new one. Small spells: Haiku with two library examples, the test run, and one Haiku rewrite if it fails. Big spells: the Opus program from a real Batch API batch, with the test run. For big spells the Haiku **draft** a player gets first is also measured; for small spells, a version **without the library**, to tell its effect apart.
3. Through `/api/admin/spell-trial`, `/api/admin/batch-trial` and `/api/admin/judge-trial` on an uploaded preview version of the Worker: nothing was stored, production stayed on 3.2. Script: `scripts/eval-spells.ts`.

Every version was cast in the Spell Lab on the same seeded island near a village, with frames at 1, 3 and 6 s. Two scores out of 5:

1. **Judge**: the 3.3 Haiku judge, uncalibrated (no votes yet).
2. **Blind**: a separate Claude grader that saw only the frames, the tier and the grimoire entry, with the versions of each spell shuffled under letters. This is the score to trust.

There are no votes yet, so the library was seeded with stand-ins: the 10 stored programs up to grand, outside the 20, that the judge scored best (Meteor, Mana Storm, Fire, Dryad, Halo, Angel, Healing Light, Mana Crystal, Elixir of Life, Crystal; all 4 out of 5, none got 5).

## Results

| Spells              | Version                | Blind | Judge | Better / worse than before (blind) | Passes the test run    |
| ------------------- | ---------------------- | ----- | ----- | ---------------------------------- | ---------------------- |
| 15 up to grand      | before                 | 2.73  | 2.73  |                                    | 15                     |
|                     | after, with library    | 3.00  | 2.80  | 8 / 4 (3 same)                     | 15 (2 after a rewrite) |
|                     | after, without library | 2.80  | 2.73  | 7 / 6 (2 same)                     | 14 (2 after a rewrite) |
| 5 legendary, cosmic | before (Opus, direct)  | 3.80  | 2.80  |                                    | 5                      |
|                     | Haiku draft            | 2.80  | 2.80  | 1 / 4                              | 5                      |
|                     | after (Opus, batch)    | 3.00  | 3.00  | 1 / 2 (2 same)                     | 5                      |

Per spell (blind score; judge in brackets):

| Spell            | Tier      | Before | No library | Draft | After | Cost of after |
| ---------------- | --------- | ------ | ---------- | ----- | ----- | ------------- |
| Water            | cantrip   | 2 (2)  | 3 (2)      |       | 3 (2) | $0.0028       |
| Withering        | cantrip   | 2 (3)  | 3 (3)      |       | 3 (3) | $0.0019       |
| Gold             | cantrip   | 1 (3)  | 3 (3)      |       | 3 (4) | $0.0009       |
| Fireball         | minor     | 2 (3)  | 4 (4)      |       | 4 (4) | $0.0007       |
| Darkness         | minor     | 3 (3)  | 4 (2)      |       | 3 (3) | $0.0017       |
| Vampire          | minor     | 2 (2)  | 2 (2)      |       | 3 (2) | $0.0010       |
| Golem            | minor     | 3 (3)  | 4 (3)      |       | 3 (3) | $0.0014       |
| Tornado          | major     | 3 (2)  | 2 (2)      |       | 4 (3) | $0.0020       |
| Necromancy       | major     | 2 (3)  | 2 (3)      |       | 2 (2) | $0.0049       |
| Holy Light       | major     | 3 (3)  | 2 (3)      |       | 2 (2) | $0.0025       |
| Sanctuary        | major     | 3 (3)  | 2 (3)      |       | 4 (3) | $0.0020       |
| Earthquake       | grand     | 4 (2)  | 3 (3)      |       | 2 (2) | $0.0042       |
| Tidal Wave       | grand     | 4 (4)  | 3 (2)      |       | 3 (2) | $0.0026       |
| Eclipse          | grand     | 5 (3)  | 2 (3)      |       | 3 (4) | $0.0036       |
| Enchanted Forest | grand     | 2 (2)  | 3 (3)      |       | 3 (3) | $0.0020       |
| Great Flood      | legendary | 4 (4)  |            | 2 (2) | 5 (4) | $0.0380       |
| Meteor Strike    | legendary | 5 (3)  |            | 4 (3) | 1 (2) | $0.0442       |
| Excalibur        | legendary | 3 (3)  |            | 4 (4) | 3 (4) | $0.0327       |
| Black Hole       | cosmic    | 3 (2)  |            | 2 (2) | 2 (2) | $0.0484       |
| World Tree       | cosmic    | 4 (2)  |            | 2 (3) | 4 (3) | $0.0268       |

## Cost per spell

| What                                     | 3.2                                           | 3.3                                                           |
| ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| New spell up to grand                    | $0.0014 (Haiku)                               | $0.0024 (Haiku, library, test rewrite when needed)            |
| New legendary or cosmic spell            | $0.061 (Opus at once, 96 calls in the ledger) | $0.040 ($0.0023 Haiku draft at once, $0.038 Opus batch later) |
| Rewrite after votes, up to grand         |                                               | about $0.002                                                  |
| Rewrite after votes, legendary or cosmic |                                               | about $0.038 (batch)                                          |
| Judge, once per program                  |                                               | $0.0002                                                       |
| Test run                                 |                                               | free (the player's browser)                                   |

The library adds about $0.0009 per small spell: two example programs in the prompt. The whole measurement cost $0.28 (the spend ledger shows $0.47: the restarted script read the finished batch twice and each read was logged; fixed in the script and in the Worker).

## What this says

1. **Rewriting without a reason does not make spells better.** Small spells moved from 2.73 to 3.00 with the library and to 2.80 without it; 8 better against 4 worse is not significant on 15 spells (a sign test gives p = 0.39). Big spells got worse: the existing Opus programs scored 3.80, fresh Opus ones 3.00. The spread is wide (Meteor Strike went from 5 to 1, Eclipse from 5 to 3, Great Flood from 4 to 5), so any one rewrite is close to a coin toss. That is why 3.3 rewrites only on votes, gives the model the reasons, and goes back to the old version when the new one is voted worse: votes pick, the model only proposes.
2. **The library may help a little.** With it, small spells scored 3.00 against 2.80 without; on 15 spells that is a hint, not a result. Its real test is with programs that you voted up.
3. **The Haiku draft is a weaker first impression for big spells** (2.80 against 3.80 for the programs written by Opus directly; Great Flood's draft drew a sigil and did nothing). It costs a fortieth and arrives at once; the Opus version replaces it within minutes. Worth watching how often a draft gets voted down before its Opus version lands.
4. **The judge is not ready to act alone.** Against the blind grader: 29 of 60 identical scores, 54 within one point, correlation 0.42. It never gives 5 or 1 and missed Gold's empty "before" (grader 1, judge 3). It only advises until your votes calibrate it, as designed.
5. **Three frames at 1, 3 and 6 s are too early for big spells.** Meteor Strike's new version passed the test run but showed only a glow by 6 s: its impact came later. The judge runner now takes frames at 2, 6 and 12 s for legendary and cosmic spells.

## What the test run found

Over all 132 stored programs, with the final checks: 131 pass, and Earth crashes (`ps is not iterable`, known since 3.2). Getting there fixed two false failures and one real bug:

1. **The practice island had nothing to heal or raise.** Holy Light (heals the nearest villager within 3 cells), Resurrection and Necromancy did nothing visible and failed. The island now has a corpse and a wounded villager next to the target.
2. **The floor was too high.** A cantrip of Gold lays 6 cells; the floor is now 3 cells (the control comparison measured 0 cells of noise).
3. **A real bug in the game: raised creatures died again at once.** While a creature lay dead its falling speed kept growing, even on the ground; a creature revived by a spell hit the ground at that speed and died of the fall (a villager dead for 3 seconds came back at 60 hp and dropped to -60). Resurrection never worked. Fixed in `creatures.ts` and `revive()`, with a check in `npm test`.

Of the fresh programs, the test run sent 2 small spells of 15 back for a rewrite in each variant (Necromancy and Holy Light, before the island fix above).

## Limits

20 spells, one sample each, graded by one blind grader per spell from three frames. Differences of a few tenths are within noise. The library was seeded by the judge, not by votes. Big spells were measured on 5 spells.
