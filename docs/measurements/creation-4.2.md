# From the drop to the first cast, before and after 4.2 (2026-11-04)

Every number here was measured on the live Worker or its preview versions (same D1, same API key), in a phone sized headless Chromium (390 × 844, touch) or in Node, with the scripts named. Players' money: the browser runs used throwaway invites capped at $1 and revoked at the end, and cost $0.142 (before) and $0.149 (after).

## 1. Where the 27 s went (before any change)

`scripts/creation-timing.mjs` on a preview of `main` with the timing added and nothing else changed (`abf97377`): nine merges in a row on a fresh browser (seven known items with no program, of each kind and size, and two new pairs), then the World, every item selected in turn once ready and cast. Milliseconds from the drop; "server" is what the Worker said it spent (Server-Timing).

| Item                 | Kind, tier         |   Asked | Arrived |  Tested |          Ready | Test run         | Server                       |
| -------------------- | ------------------ | ------: | ------: | ------: | -------------: | ---------------- | ---------------------------- |
| Cryostasis           | spell cantrip      |     375 |  17,229 |  44,918 |         45,839 | 27,688 (protect) | describe 2,241, spell 13,585 |
| Dark Meteor          | spell major        |  45,107 |  65,570 |  67,216 |         67,921 | 1,646            | describe 2,159, spell 17,382 |
| Dragon Breath        | spell major        |  67,239 |  82,406 |  82,566 |         93,814 | 1,281, rewritten | spell 14,290, rewrite 8,268  |
| Black Ice            | artifact major     |  93,165 | 106,979 | 167,050 |        168,187 | 60,070 (timeout) | intent 1,469, spell 11,490   |
| Cloud Giant          | artifact major     | 167,403 | 187,368 | 247,385 |        248,613 | 60,017 (timeout) | describe 2,068, spell 16,870 |
| Apotheosis           | spell legendary    | 249,272 | 275,626 | 335,698 |        336,717 | 60,073 (timeout) | spell (Haiku draft) 25,016   |
| Aegis                | artifact legendary | 348,292 | 364,056 | 424,147 |        424,862 | 60,091 (timeout) | spell (Haiku draft) 14,552   |
| Fire Staff, Blizzard | (new pairs)        |         |         |         | never in 420 s |                  | merge 1,817 and 2,007        |

Where the time goes, per item: the merge answers in 0.5 s (known) to 2.5 to 3.8 s (new); writing the program is 12 to 17 s of Haiku (25 s for a big item's Haiku draft) plus 2 s of grimoire entry and 1.5 s of intent when they do not exist yet; the test run in the hidden frame took **7 times its work** (Cryostasis: 3.7 s of simulation, 27.7 s in the frame, sliced 8 ms at a time between the page's frames, with the World drawing on the same thread) and **every artifact hit the 60 s timeout** (their five minute test is 6 to 8 s of work, but never finished: they passed by timeout, so the test decided nothing for them); and everything went **one item at a time**: Black Ice was asked for 93 s after its merge because six items waited in line before it, each through its test. The verdict round trip added 0.7 to 1 s, 9 s more with a rewrite.

The test run alone, in Node, on all 193 live programs (`scripts/test-run-timing.ts`, warm, ms):

| Group                  |   n | p50 before | p90 before | p50 after | p90 after |
| ---------------------- | --: | ---------: | ---------: | --------: | --------: |
| spell up to grand      |  47 |        227 |        351 |       239 |       384 |
| spell, protect         |  10 |      1,475 |      1,599 |     1,640 |     1,852 |
| spell legendary/cosmic |  30 |        460 |        695 |       455 |       668 |
| artifact up to grand   |  43 |      6,470 |      7,043 |       519 |     5,566 |
| artifact, protect      |  27 |      7,556 |      8,277 |     1,816 |     6,571 |
| artifact big           |  21 |      6,802 |      7,443 |       694 |     6,521 |
| artifact big, protect  |  12 |      8,409 |      8,640 |     2,160 |     2,621 |

The five minute test stops once the artifact has acted: **103 of 103 verdicts identical** to the full run (`COMPARE=1`). Spells did not change (their run already stops two seconds after the spell is over); the control island costs 0.4 s once per worker.

## 2. After (preview `b1f3345b`, without the queue)

The preview cannot run the queue (its consumer is attached by a production deploy) nor the `writes` table (migration 0013 is not applied), so this run measures the page's part: the test run in a Web Worker, three programs asked at once, castable on a local pass; big items still on first use (a Haiku draft, as before). Same script, seven other known items with no program and two new pairs.

| Item             | Kind, tier         |  Asked | Arrived |  Tested |   Ready | Test run                       | Server                               |
| ---------------- | ------------------ | -----: | ------: | ------: | ------: | ------------------------------ | ------------------------------------ |
| Frost Nova       | spell minor        |    683 |  15,643 |  19,316 |  19,318 | 3,672                          | spell 13,855                         |
| Flame Dash       | spell cantrip      |    623 |  19,305 |  21,052 |  21,053 | 1,747                          | describe 1,881, spell 15,538         |
| Ember Swarm      | spell minor        |    400 |  19,118 |  22,378 |  22,379 | 3,260                          | describe 2,042, spell 15,348         |
| Frost Giant      | artifact major     | 15,482 |  31,637 |  32,710 |  32,712 | 1,073                          | merge 3,118, spell 15,201            |
| Crater           | artifact major     | 18,285 |  33,802 |  34,432 |  34,433 | 630                            | describe 1,791, spell 12,543         |
| Dragon Egg       | artifact minor     | 17,856 |  29,351 |  36,201 |  60,411 | 18,155, failed idle, rewritten | spell 10,551, rewrite 11,875         |
| Arcane Cataclysm | spell legendary    | 62,088 |  80,634 |  81,129 |  81,130 | 495                            | describe 2,033, spell (draft) 14,890 |
| Ambrosia         | artifact legendary | 81,157 | 102,994 | 103,704 | 103,705 | 710                            | spell (draft) 20,861                 |
| Maelstrom        | spell grand        | 26,034 |  26,814 |       – |  26,814 | (already live)                 | merge 1,670                          |

All nine were cast by 118 s; before, the seventh was ready at 425 s and two never were. The first ready item: 19.3 s against 45.8 s. Dragon Egg failed its five minute test for real and was written again: before 4.2 it would have passed by timeout. With the queue on production, the big items start at the merge instead of when picked (Arcane Cataclysm was asked at 62 s, Ambrosia at 81 s) and come back from the Batch API in 2.5 to 4.7 minutes (November's batches), with no draft.

Left in each item's time: Claude (12 to 17 s for a small program), which no change here can shorten without a weaker model or effort, and that is not allowed.

The same programs in the check frame of a local `wrangler dev` with the production headers: Fire 1.3 s, Arcane 0.3 s, Corona (legendary, protect) 4.7 s, Halo (artifact) 1.4 s, Angel (artifact, protect) 8.1 s, Ley Lines 0.4 s; the frame starts two workers. Chromium's CPU throttling does not slow Web Workers, so a phone's numbers need a real phone: the HUD's perf sample now carries the last four creations step by step (`creation`).

## 2b. After, on production (with the queue)

Deployed on 2026-11-04 (versions `6ea660f0`, then `2880fc54` with the two fixes below). Same script, seven known items with no program and two new pairs; the jobs' own times from the `writes` table.

| Item             | Kind, tier         | Job waited |         Job ran |                          Ready (from the drop) | Cost    |
| ---------------- | ------------------ | ---------: | --------------: | ---------------------------------------------: | ------- |
| Illusion         | spell cantrip      |      2.9 s |          15.7 s |                                         21.9 s | $0.0016 |
| Fireflies        | artifact minor     |      0.9 s |          15.7 s |                                         21.1 s | $0.0016 |
| Inferno          | spell major        |      1.8 s |          18.8 s |                                         22.5 s | $0.0020 |
| Hellfire         | spell major        |      4.1 s |          16.5 s |                                         22.7 s | $0.0017 |
| Glacier          | artifact grand     |     19.6 s |          20.2 s | 20.8 s after it was asked, 40 s from its merge | $0.0021 |
| Moraine (new)    | artifact grand     |     11.1 s |          16.7 s |                                         35.6 s | $0.0018 |
| Book of the Dead | artifact legendary |     18.1 s | 142.8 s (batch) |                                        166.6 s | $0.0271 |
| Blood Moon       | spell cosmic       |     18.9 s | 143.9 s (batch) |                                        167.9 s | $0.0201 |

Every small item was castable 21 to 36 s after its drop, without anyone asking; the big ones came back from the Batch API in about 2.5 minutes with no draft (the first production run: 1.6 to 3.1 minutes; Ascension failed its test and was written again by Opus in 14 s). Opus programs written ahead cost $0.020 to $0.029, against $0.0476 before (the hour's cache).

Two fixes came from the first production run: Healing Rain had a version 1 spec from before programs and was not written ahead (`hasProgram` counted it); and the fifth to seventh items of a burst waited 32 to 36 s before their job started, with four messages a batch. With ten a batch they wait about 19 s: Cloudflare Queues adds a consumer only after a whole batch is done, so a burst's later items still wait for the first batch's slowest job. Per item parallelism needs Cloudflare Workflows (one instance per item, keyed by the item), a change of the job runner left for after this pull request.

## 3. Cost per spell

`scripts/quality-20.ts` on the 20 spells of `scripts/eval-set.ts`, written as a player's write is (intents, the API's library, library examples for Haiku), big ones by Opus with their cost counted at batch price (half).

|                                  | Before                  | After                          |
| -------------------------------- | ----------------------- | ------------------------------ |
| Small spell, first write (Haiku) | $0.00186                | $0.00196                       |
| Small spell with test rewrites   | $0.0020                 | $0.0022 (2 rewrites against 1) |
| Big spell (Opus, batch price)    | $0.0476                 | **$0.0363**                    |
| Big spell as served before 4.2   | $0.0019 draft + $0.0476 | $0.0363, no draft              |

The writer's system prompt is 8,422 tokens. Cached for an hour it is read at a tenth of Haiku's price and a twentieth of Opus's: an Opus program went from about $0.034 of uncached prompt (direct) to $0.0017. The first program of an hour pays the write at twice the input price (Great Flood: $0.070). The small spell's 5% difference is output length (2,000 to 3,600 tokens a program, unchanged prompt) and one more test rewrite; its cached part is the same as before within a burst.

## 4. Quality on the same 20 spells

| Spell            | Kind, tier         | Judge before | Test before          | $ before | Judge after | Test after                          | $ after |
| ---------------- | ------------------ | -----------: | -------------------- | -------- | ----------: | ----------------------------------- | ------- |
| Water            | spell minor        |            3 | pass                 | 0.0018   |           2 | pass                                | 0.0019  |
| Withering        | spell cantrip      |            2 | pass                 | 0.0020   |           2 | pass                                | 0.0021  |
| Gold             | artifact cantrip   |            3 | pass, saved 0.8      | 0.0017   |           3 | promise after a rewrite, saved 0.16 | 0.0031  |
| Fireball         | spell minor        |            4 | pass                 | 0.0017   |           3 | pass                                | 0.0013  |
| Darkness         | spell minor        |            2 | pass                 | 0.0014   |           3 | pass                                | 0.0015  |
| Vampire          | artifact minor     |            2 | pass                 | 0.0016   |           2 | pass                                | 0.0020  |
| Golem            | artifact minor     |            2 | pass, saved 0.87     | 0.0023   |           4 | pass, saved 0.91                    | 0.0023  |
| Tornado          | spell major        |            3 | pass                 | 0.0021   |           2 | pass after a rewrite                | 0.0049  |
| Necromancy       | spell major        |            2 | pass                 | 0.0016   |           2 | pass                                | 0.0019  |
| Holy Light       | spell major        |            2 | pass                 | 0.0015   |           3 | pass                                | 0.0015  |
| Sanctuary        | artifact major     |            2 | pass, saved 0.9      | 0.0016   |           3 | pass, saved 0.89                    | 0.0018  |
| Earthquake       | spell grand        |            2 | pass                 | 0.0017   |           3 | pass                                | 0.0020  |
| Tidal Wave       | spell grand        |            2 | pass after a rewrite | 0.0047   |           2 | pass                                | 0.0021  |
| Eclipse          | spell grand        |            4 | pass                 | 0.0021   |           2 | pass                                | 0.0026  |
| Enchanted Forest | artifact grand     |            3 | pass                 | 0.0018   |           3 | pass                                | 0.0018  |
| Great Flood      | spell legendary    |            4 | pass                 | 0.0624   |           4 | pass                                | 0.0700  |
| Meteor Strike    | spell legendary    |            3 | pass                 | 0.0432   |           4 | pass                                | 0.0310  |
| Excalibur        | artifact legendary |            2 | pass, saved 0.88     | 0.0370   |           3 | pass, saved 0.88                    | 0.0208  |
| Black Hole       | spell cosmic       |            3 | pass                 | 0.0527   |           2 | pass                                | 0.0370  |
| World Tree       | artifact cosmic    |            2 | pass                 | 0.0427   |           2 | pass                                | 0.0227  |

|                                          | Before      | After       |
| ---------------------------------------- | ----------- | ----------- |
| Judge, mean of 20                        | 2.60        | 2.70        |
| Judge 3 or more                          | 9           | 11          |
| Judge, up to grand / big                 | 2.53 / 2.80 | 2.60 / 3.00 |
| Test run passed first time               | 19          | 18          |
| Test run passed in the end               | 20          | 19          |
| Probes passed (protection, five minutes) | 7 of 7      | 6 of 7      |

The one probe that failed after is Gold, a cantrip whose intent is "protect". Written four times on each build: the old build passed it 2 times in 4, the new one 0 in 4 (Fisher p = 0.43). The request is the same bytes on both builds (no prompt changed; the cache lifetime cannot change an answer), so this is the spread of Haiku's writes, not the change; Gold's promise is hard for a cantrip and fails about half the time either way. The judge's spread is as wide (Eclipse 4 then 2, Golem 2 then 4), which is why 20 spells can only say that nothing fell by a full point.

The Haiku drafts big spells were served before 4.2: 2.6 with the judge (4, 2, 2, 3, 2), against 2.8 for Opus before and 3.0 after. Votes: 40 in all since 3.3; the 2 votes on drafts were down, 12 of 21 on new Haiku programs up. Programs written in these runs are never served, so they have no votes; votes on the 20 cannot be compared before and after.

## 5. What writing every item at the merge costs

From November's ledger: 43% of new items are legendary or cosmic. A small item's program costs about $0.002 (with its grimoire entry, intent and the odd test rewrite), a big one $0.036 to $0.048 through the Batch API with the cached prompt. About **$0.018 per new item**.

| New items a day | Writes ahead a day |     A month |                                               Of which items nobody would have cast |
| --------------: | -----------------: | ----------: | ----------------------------------------------------------------------------------: |
|      54 (Nov 3) |              $0.97 |         $29 | about $25 (76 of 315 items were ever cast; 3 of 23 big items were written on Nov 3) |
|    100 (launch) |    $1.50 (the cap) | $45 at most |                                                                                     |

Writes ahead stop at 80% of the month's budget ($40 of $50), so merges and first uses keep the last $10. November spent $11.38 in its first three days (mostly the one-off refresh and the 96 Opus rewrites of Nov 2); at Nov 3's rate the 80% is reached around Nov 23, and items are written on first use after that. `AHEAD_DAILY_USD` = "0" turns it off.

## 6. Live programs whose failed probe was promoted

The check frame's answer lost "promise" and "idle" until 4.2 (`src/checkresult.ts`): these 15 live programs failed a probe in a player's browser and were promoted or kept as if they passed. Left as they are (never rewrite in bulk); each can be rewritten from its admin card.

Light (27), Golem (37), Crystal Cavern (68), Sanctuary (84), Holy Sword (85), Holy Grail (89), Tree of Life (95), Divine Intervention (114), Fountain of Youth (115), Phoenix Flock (120), Void Familiar (126), Wormhole Network (131), Protection Spell (155), Volcano (377), Fire Opal (386). Program ids in brackets. In Node, 27 of the 193 live programs fail today's probes (`scripts/test-run-timing.ts`).

## 7. Not measured yet

1. A real phone: turn the HUD on (long press on the title), merge a few new items, open the World; `GET /api/perf` then shows `creation` with every step.
