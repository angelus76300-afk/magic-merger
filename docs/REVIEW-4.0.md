# Review before 4.0: the game as it stood on 2026-11-03

An independent read of the code written over PRs #1 to #20, by a session that wrote none of it, before the invite link goes beyond close friends. Every finding below was proved: a failing or passing check in `npm test` or `npm run test:worker`, a script in `scripts/` or in the session's scratchpad whose output is quoted, a run in a phone sized headless browser, or a path traced to a file and line. Where a claim could not be proved it says "not verified". Line numbers refer to `main` at `cebe0cf` (PR #20) unless a fix commit is named, in which case they refer to the code before it.

The second half of 4.0, accounts, is built on this review (part G revises the plan; the attacks on the accounts code are appended at the end).

## 1. Baseline, measured on this branch before any change

| What                                                                           | Measured                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                     | 142 checks, 92 s wall, 3 min 20 s CPU on 4 cores (SETUP.md said about 20 s; the five minute scene on three streams is most of it)                                                                                                                     |
| `npm run test:worker`                                                          | 100 checks, 23 s                                                                                                                                                                                                                                      |
| `npm run lint`, `format:check`                                                 | clean, 0.8 s and 5.5 s                                                                                                                                                                                                                                |
| `npm run build`                                                                | 11 s; `world` chunk 581 kB (159 kB gzip), `runtime` 297 kB (100 kB), `main` 71 kB (23 kB), `check` 11 kB, css 20 kB; 285 kB gzip in all                                                                                                               |
| `scripts/prof-life.ts`, large island, 120 s                                    | whole tick p50 / p95 / max: 2.50 / 4.02 / 85.9 ms as generated; 2.60 / 4.21 / 25.4 with the guests (physics 2.0 / 3.4, creatures 0.24 / 0.67)                                                                                                         |
| `scripts/prof-spell.ts`, 20 s                                                  | idle 1.41 / 2.53; world tree 1.34 / 1.85; burning forest 1.56 / 4.94 (max 44); crowd of 300: 1.86 / 4.01                                                                                                                                              |
| Heap over 30 simulated minutes (large island, a spell a minute, `--expose-gc`) | 9.0 to 9.1 MB from minute 3 to 30, rss 83 to 98 MB: no growth in the simulation (the view was not measured)                                                                                                                                           |
| `/api/spend`, November so far                                                  | $10.50; Opus spells $5.86 (96 calls, the 3.1 version bump on 11-02), refresh $2.91 (170 batch items), batch spells $0.47, merges $0.31 (252), Haiku spells $0.30 (197), tiers $0.14, judge $0.08 (312), design $0.09 (1), everything else under $0.03 |
| `/api/perf`, 6 samples from one Android phone (8 cores, 2.25 dpr)              | large island (208): sim p50 / p95 4.2 to 6.0 / 11.7 to 17.5 ms, render p95 8.6 to 12.4 ms, 100 to 105 draw calls, 200k to 430k triangles, one sample at 12.7 fps; medium (112): sim p95 4.0, render p95 6.3, 45 calls                                 |
| Live database                                                                  | 258 elements, 433 recipes, 171 spells, 334 programs, 3 invites (one revoked test; two invited players never came), 13 votes, 26 casts, 1 idea, 0 wins, 19 verified solvers, 88 refresh candidates still to decide                                     |

## 2. Findings, by severity

No critical finding. Nothing found lets a player spend past the caps, read another person's data, or run code outside the sandbox. What follows is what a determined friend could do, what a lost request could break, and what the first ten minutes feel like.

### High

**H1. A player's idea reached the code writing routine as the task itself.** Fixed in `d3d3e7d`.
Evidence: `src/feedback.ts:243` prefilled the admin's brief with the player's title and body, so "Send to Claude" with no edit sent the player's words as "BRIEF FROM THE ADMIN (this is the task)"; `worker/feedback.ts:261` appended the player's text raw under its heading, so an idea containing the line `BRIEF FROM THE ADMIN (this is the task):` produced a second brief at column zero. The routine's saved prompt distinguishes the two parts by those headings only.
Impact: the admin's gate, the one human between a player and an agent with push access, was a rubber stamp by default, and could be forged past even when used. What stood behind it: FEEDBACK.md's rules (prompt level), the draft pull request, CI and the admin's merge. Nothing merges or deploys by itself, which is why this is high and not critical. Not verified: what credentials the routine's cloud environment holds (if it holds `CLOUDFLARE_API_TOKEN` or `ADMIN_TOKEN` as this session does, a hostile brief could deploy or read the database without a merge; see decision 1 in the pull request).
Fix: the draft brief is the title and an empty "Done when" list, with the player's words shown beside it to read; every line of the player's text is quoted (`> `) between a heading and an `END OF THE PLAYER'S WORDS` marker in both the routine payload and the issue (`worker/feedback.ts`, `shared/feedback.ts`). Checked: `npm run test:worker` "a fake brief in an idea is quoted, never a second brief"; `npm test` "the draft brief is the title and a list". Size S.

**H2. A challenge win could set par to 0 for everyone.** Fixed in `4b0745a`.
Evidence: `worker/challenges.ts:94` accepted any integer 0 to 500 as the merge count and `:117` lowered par to it for all players; the spell only had to exist and be strong enough, not be reachable from the start set. The client counted every merge, not distinct pairs as par does (`src/challenges.ts:189`), so an honest player merging the same pair twice was scored one star lower. One `curl` with an invite was enough.
Fix: the Worker refuses a spell the start set cannot reach and a count below the fewest merges the recipe graph needs for it (`fewestMerges`); the client counts distinct pairs (`countMerge` in `shared/challenges.ts`). Checked: `npm run test:worker` "a win below the graph's fewest merges, or with an unreachable spell, is refused"; `npm test` "an attempt counts each distinct pair once". Size S.

**H3. A trial program whose test verdict never reached the Worker stayed a trial for good.** Fixed in `2cafebf`.
Evidence: `src/worldhost.ts:322` swallows a failed `POST /api/spell/check` and stores the trial; on the next visit `:176` refetches only when the ids differ, and the Worker reported the same id; worse, `worker/index.ts:1184` (`handleLive`) listed only elements with a row in `spells`, which a trial-only element has not, so the browser was told nothing at all. Reproduced with `scripts/local-verify.mjs` scenario B: with `/api/spell/check` blocked on the first visit, nine programs (the new spell and the eight primitives written ahead) stayed trials; the next visit posted nothing.
Impact: for a player alone on a spell (every friend at first), one dropped request leaves a program cast and voted on that never passed its test run, and the rewrite-once path never runs. Phones on flaky networks drop requests.
Fix: `/api/spells/live` reports trial-only elements; `shared/sync.ts` fetches and tests again the trial the browser holds. Checked: `npm run test:worker` "a trial with no live program yet is reported", `npm test`, and scenario B now posts the nine verdicts and the program goes live. Size S.

### Medium

**M1. The check frame had no load timeout.** Fixed in `2cafebf`.
Evidence: `src/checker.ts:15` resolved only on `check-ready`; `:44` awaited it before arming the 60 s timer. Scenario A of `scripts/local-verify.mjs` with `/check` blocked: before the fix the status read "Testing… on a practice island" for the whole session and the shared `inflight` promise never settled, so the spell could not be prepared again; after the fix the spell is castable after 16 s with one verdict posted ("The test run could not start"). Impact: one bad deploy of `check.html` would have blocked every new spell for every player with no message. Size S.

**M2. Any request body of any size was parsed.** Fixed in `41c0f7f`.
Evidence: `worker/index.ts:1613` called `request.json()` with no limit on every route. Impact: one invite could send bodies of many megabytes and tie up the Worker's CPU and memory (Cloudflare's own limit is 100 MB). Fix: 128 KB for players, 8 MB for the admin's judge frames. Checked: "a 300 KB body is refused with 413, the admin's judge frames are not". Size S.

**M3. Spell code can freeze a frame without a loop.** Not fixed; a design limit.
Evidence: the loop guard (`shared/spellcode.ts`, `src/sim/runtime.ts:87`) only counts literal `for`, `while` and `do` loops, and the slow cast guard (`:486`) acts after the tick returns. Reproduced in Node with the real `Runtime` (scratchpad `repro/freeze.ts`): `while (true) {}` throws after 10 ms; `/^(a+)+$/.test("a".repeat(26) + "!")` takes 2.4 s with no error; `new Array(3e7).fill(0).map(...).sort()` 24.8 s; three `forEach` passes over 2e7 elements 0.5 s. On a phone the sandboxed frame shares the tab's process, so the whole page freezes until the browser offers to kill it.
Impact: bounded to robustness against Claude's own programs (players cannot submit code); a program that does this fails its test run on the admin's machine first only if the test run itself survives it. Fix: a watchdog in the page that replaces the frame when no message arrives for 20 s while visible (`replaceFrame` exists), which helps on desktop where the frame is out of process; a true fix is the simulation in a Worker thread, which the CSP (`worker-src 'none'`) and the view would have to change for. Size M (watchdog), L (worker thread). Roadmap 4.1.

Fixed in 4.1 (`96569b6`), the watchdog part: the World frame sends a heartbeat every 2 s and the page replaces a frame silent for 20 s while the World is on screen, with a toast. `scripts/verify-4.1.mjs` C: on main a frame stuck 25 s in a busy loop was never replaced; here it is replaced after 26 s, and an idle frame left 30 s is kept. In headless Chromium the frame shares the page's thread, so the page froze too and the watchdog acted as it thawed: the simulation in a Worker thread stays the real answer.

**M4. A challenge win was lost when the Worker could not be reached.** Fixed in `8736b6a`.
Evidence: `src/challenges.ts:241` cleared the attempt before `POST /api/challenge/win`; a network error, a 429 from the burst guard or a 401 left nothing to retry, and the next challenge stays locked by the server's stars. Fix: the win is kept in the browser and sent when the Challenges tab opens; a refusal of the win itself (400, 404) drops it. Checked: scenario C of `scripts/local-verify.mjs` (a pending win is posted once and cleared). Size S.

**M5. A save of the wrong shape made the page blank at startup.** Fixed in `617e53c`.
Evidence: `src/store.ts` `load()` only checked `version === 1`; `{"version":1}` in `magic-merger.save` threw in the constructor before any UI existed (reproduced by the client audit's script and by the new `npm test` check). Size S.

**M6. Two tabs of the same browser overwrite each other's saves.** Not fixed.
Evidence: `src/store.ts:133` writes the whole save from this tab's memory, no `storage` listener anywhere (`grep -rn '"storage"' src` is empty); the world save from each tab's frame every 10 s, last writer wins (`src/worldhost.ts:376`). A discovery made in tab A is gone after tab B's next chip move. Impact: silent loss of progress; accounts (4.0) make it worse unless the upload is a merge. Fix: for discoveries, merge by key on every write (reload the stored object first); for the world, one tab at a time (a `BroadcastChannel` lock) or a timestamp that refuses to overwrite a newer save. Size M. Roadmap 4.0.

Fixed in 4.1 (`96569b6`). Discoveries are merged by key on every write (the stored save read again first) and a `storage` listener shows the other tab's finds; the island is written by the tab that last showed the World while visible, claimed over a `BroadcastChannel`, and a tab that takes it back reloads it first if another tab saved since (without `BroadcastChannel`, a write is refused over a newer save); the account upload reads the shared "seen" again before each push. `scripts/verify-4.1.mjs` A, two signed in tabs: on main tab 1's discovery was erased, both tabs wrote the island and tab 2's upload got 409 with a warning; here nothing is lost, only the owning tab writes, tab 1 is told, both uploads pass.

**M7. `scripts/` is neither typechecked nor linted; nine Worker routes and twelve admin routes have no test.** Not fixed.
Evidence: `tsconfig.json:16` includes `src`, `shared`, `lab`; `worker/tsconfig.json` the Worker; `scripts/*.ts` (13 files, the 1,300 line `npm test` included) go through esbuild only; `eslint.config.js:12` ignores `**/*.mjs`, which is the 965 line Worker test and seven lab scripts. Untested routes, by grep of the test against the router: `POST /api/spell/repair`, `/api/report`, `/api/cast`, `/api/vote` (the vote, rewrite and rollback path, `worker/index.ts:1221` to `:1360`, is covered only by the pure rules in `shared/votes.ts`), `GET /api/spell/info`, `/api/spend`, `/api/perf`, `/api/admin/merge-trial`, `/api/admin/backfill-tiers`, and the admin's `programs`, `judge`, `judge-trial`, `judge-stats`, `spell-trial`, `batch-trial`, `report`, `trim-scan`, `evolution`, `proposals`, `extension`. Impact: a type error in a test or runner shows at run time; a regression in votes shows in play. Fix: `@types/node` plus a `scripts/tsconfig.json` in `npm run typecheck` (M), Node globals for `.mjs` in ESLint (S), one Worker test section each for votes and repairs (M). Roadmap 4.1.

Fixed in 4.1: `scripts/` typechecked in `npm run typecheck` and `.mjs` linted with Node globals (`019f5b8`; turning them on found a real latent bug, a check's detail that would have thrown the day a population exploded); Worker test sections 18 to 25 for votes, rewrites and rollbacks, repairs, casts, reports, spell info, spend, perf and the thirteen admin routes (`3dd7e30`, 151 to 217 checks), which found a repair served after the limit instead of before it (fixed in `78d6966`).

**M8. `npm test` asserts on wall clock time.** Not fixed; no failure observed here.
Evidence: `scripts/sim-test.ts:130` requires the worst tick under 120 ms for each reference spell, and `src/sim/runtime.ts:90` aborts a cast after five ticks over 40 ms, which lands in the `errors` array every spell check asserts on, while two to four worker threads load the same CPU (`sim-test.ts:63`; the CI runner has two cores). Impact: a correct spell can fail CI on a slow runner. Fix: make `SLOW_MS` injectable for tests and print the worst tick instead of asserting on it. Size S. Roadmap 4.1.

Fixed in 4.1 (`d59f78f`). Reproduced after all: on one core shared with two busy loops, `npm test` failed `big-bang.js` on a 180 ms worst tick and nothing else. `Runtime.slowMs` is injectable, off in `npm test` unless `SLOW_MS` is set, the worst tick printed; a new check keeps the guard tested at 40 ms. Same load after the fix: all pass.

**M9. The first spell in the World took 27 s to be castable in the phone sized run; ten of twelve chips were dimmed.** Friction, measured, not fixed.
Evidence: `docs/review-4.0/phone-log.txt`: "spells in the bar: 12, ready: 2", "spell ready after 26904 ms"; `07-world-first.jpg` shows three ready chips of twelve. The wait is the program's write by Haiku plus its test run in the hidden frame, which on this headless Chromium with software WebGL is slow; on a real phone it is CPU bound too. Not verified: the same number on a real phone (the HUD's `/api/perf` samples hold no spell timing). Fix: show a progress state on the chip ("writing", "testing") instead of dimming, and measure the test run's duration in the perf sample. Size S. Roadmap 4.1.

Not in 4.1: left for 4.2 (faster creation), as the roadmap in pull request #23 plans.

**M10. The vote bar covers the challenge banner and its "Back to my island" button on a phone.** Friction, not fixed.
Evidence: `docs/review-4.0/14-challenge-island.jpg`. The bar is positioned over the stage (`src/style.css`, `.vote`), the banner too. Fix: stack them, or hold the vote bar while a banner is shown. Size S. Roadmap 4.1.

Fixed in 4.1 (`def95dd`): the vote bar and the banner share one bottom stack. `docs/review-4.1/m10-before.jpg` and `m10-after.jpg`, from `scripts/verify-4.1.mjs` D at iPhone 14 size.

**M11. A browser can lie about a test run and promote a crashing trial for everyone.** Accepted by design (DESIGN.md "The test run"), recorded here because the sharing circle widens.
Evidence: `worker/index.ts:764` takes `body.ok === true` from any invite for any trial id of that element; `:694` the same for a recheck. Impact: one extra Haiku call per trial and a crashing program served live until the repair loop replaces it; no money past the caps. Fix when strangers come (4.5): the admin's runner, not a browser, decides trials, or two browsers must agree. Size M.

Unchanged in 4.1, by design until strangers come (4.5 in this roadmap, 4.6 in pull request #23).

**M12. The refresh wrote 94 rows as failed before any batch was sent.** Cost finding, nothing to fix in code.
Evidence: `rewrites` with `cause = 'refresh' AND status = 'failed'`: 59 Haiku and 35 Opus rows at 00:11:52 to 00:12:14 UTC on 11-03, all with `batch IS NULL` (the first `submitBatch` threw and `startRefresh` marked and released them, `worker/index.ts:928`), then the same elements succeeded at 00:12:44 and after. They are excluded from the cap (`refreshSpentThisMonth` ignores failed rows) and cost nothing; `/api/admin/refresh-report` counts them under `statuses`, which reads as if 94 programs failed. Fix: say "not sent" for rows with no batch. Size S.

Fixed in 4.1 (`4f46a52`): the live report read `failed 94` before; failed rows with no batch now read "not sent" (Worker test "M12").

**M13. The save quota is silent and `MAX_SAVE_CHARS` cannot protect what its comment says.** Not fixed.
Evidence (client audit script, seed 11): a world save is 211k characters small, 379k medium, 712k large (736k after 120 s), layers being 95% of it; the cap of 3,000,000 characters (`src/sim/protocol.ts:64`) is never reached, and would already exceed the usual 5 MB per origin quota as UTF-16. When `setItem` throws, both saves are swallowed (`src/store.ts:136`, `src/worldhost.ts:381`): the player plays on and loses everything since the last write on reload, with no message. Fix: a toast once on `QuotaExceededError`, and a cap of 1.5M. Size S. Accounts (4.0) store the island on the server, which is the real answer.

Fixed in 4.1 (`96569b6`): one toast per page on `QuotaExceededError` (discoveries or island) and on a save past `MAX_SAVE_CHARS`, now 1.5M. `scripts/verify-4.1.mjs` B with the site's storage filled: no word on main, one toast here.

### Low

**L1.** The admin token is compared with `===` (`worker/index.ts:362`): a timing side channel, impractical across a network with a 64 byte random token, but `crypto.subtle.timingSafeEqual` on two digests costs one line. Size S.

Fixed in 4.1 (`052afe3`): both tokens hashed, `crypto.subtle.timingSafeEqual`. Not reproducible as a timing: in Node, `===` on a 64 character token took 2.4 ns whether the first or the last character differed. The Worker test checks the token still opens the admin routes and one byte off opens nothing.

**L2.** `/api/perf` accepts a row per request from any invite (`worker/index.ts:423` only prunes by age): a client in a loop could write thousands of rows a minute. Fix: one row per invite per 20 s, as the page already does. Size S.

Fixed in 4.1 (`052afe3`): migration 0012 records the invite; one row per invite per 20 s in one statement (Worker test "L2": five samples in a row wrote five rows on main, one here).

**L3.** The sandbox CSP closed `connect-src` but not WebRTC. Fixed in `7f12e50` (`webrtc 'block'`); the frames hold nothing secret, so a path, not a leak. Verified before the fix: the live headers on `/world` and `/check` match `public/_headers` exactly; `/` has no CSP and no `frame-ancestors` (clickjacking of the game page has nothing to take: the invite is in localStorage, not in a form).

**L4.** Dead and duplicated code (quality audit): `hasInvite` (`src/api.ts:53`), `artifactsOf` (`src/sim/artifacts.ts:127`), `SOUND_NAMES` (`src/sim/sound.ts:48`) are exported and never imported; the `api()` fetch helper exists four times in `scripts/` (only `eval-spells.ts` retries), the mulberry32 PRNG four times, the tick loop six times (`engine.ts` does not clear `world.events` in the loop, the others do); `shared/tiers.ts:41` has two identical branches; `scripts/worker-test.mjs:438` a conditional with identical arms. `WorldHost.openChallenges` and `Store.markSolved` are unreachable since `main.ts:58` replaces the handler. Size S each. Roadmap 4.1.

Fixed in 4.1 (`99e9a89`, and `SOUND_NAMES` in `7e5acbd`): one tick loop (`src/sim/tick.ts`; the engine leaves events for its renderer on purpose, headless callers drop them), one PRNG (`seeded` in `src/sim/noise.ts`), one `adminApi` for the TypeScript runners, `artifactsOf` and `WorldHost.openChallenges` removed, the identical branches gone. `hasInvite` was already gone. `Store.markSolved` is not unreachable (a Retry after a win reaches it) and stays. Same seeds before and after: identical `npm test` details, drum count and populations.

**L5.** A permanently broken spell asks for a repair twice every session (`src/worldhost.ts:625` caps per session, the Worker per life at 3 and answers 429 with no code), with the "rewriting it…" toast each time. No cost. Size S.

Fixed in 4.1 (`9ac277d`): the refusal says `mended`, and the page stops asking for the tab's session. `scripts/verify-4.1.mjs` E: three crashing casts asked twice on main, once here.

**L6.** Retry or Reset of a live challenge drops the head start (`src/worldhost.ts:114` restarts with `ahead = 0`): on "racing the lava" a player can lose on purpose, retry with no eruption, and record the same merge count. Size S.

Fixed in 4.1 (`0b1e704`). `scripts/verify-4.1.mjs` D records what the frame is told: on main Restart sent a plain reset and Retry `ahead: 0`; here both send the start's head start.

**L7.** `scheduled()` runs `pollBatches` without a `.catch` (`worker/index.ts:274`), so a batch error reports as the cron's failure instead of a log line like its siblings. Size S.

Fixed in 4.1 (`052afe3`, then `502605b`: every cron job through `cronJobs` in `worker/cron.ts`). Reproduced on main through `/cdn-cgi/handler/scheduled`: the cron answered 500 with an uncaught "404 no batch"; here 200, a "poll batches" log line, and the other jobs still run. The first version of the check called `/__scheduled`, which the assets answer with the page once `dist/` is built (as in CI), so no cron ran at all.

**L8.** The feedback sync treats any pull request in the repository that mentions the issue as the idea's (`worker/feedback.ts:386` matches on the URL only). An unrelated PR that writes "#14" would show as the idea's. Size S.

Fixed in 4.1 (`052afe3`): a pull request is the idea's only when its body says Close(s/d) or Fix(es/ed) #n. The timeline API carries the body (checked on issue #14, which pull request #15 mentions without closing: exactly this case).

**L9.** Month boundaries are UTC everywhere (`monthStart`, `monthKey`, top-ups): the admin in France sees the month roll at 01:00 or 02:00 local, which is consistent and documented here, not a bug.

Unchanged in 4.1: not a bug.

**L10.** The chronicle accepts a digest from any invite as free text (40 lines of 160 characters) into a Haiku prompt that treats it as facts; the output only returns to that player and costs $0.002 at most every 20 minutes. Self harm only.

Fixed in 4.1 (`052afe3`): digest strings lose line breaks and control characters, and each reaches Haiku as a quoted string; the system prompt is unchanged. On main a line of the digest could open its own "The island now:" heading.

**L11.** `npm test` takes 92 s, not the 20 s SETUP.md said (fixed in the docs, `5ef30c4`); the five minute scene is the cost. Consider one stream in CI and three locally.

Not changed in 4.1, measured: `npm test` took 108 s with three scene streams and 105 s with one on four cores here, and in CI's log the worker threads that run the scenes finished 24 s before the main thread. The scenes are not on the critical path, so one stream would cost eight checks for 3 s; CI keeps three. Where the time goes is the main thread's sequential sections (the artifacts' five minute tests alone take about a minute).

## 3. Re-verified claims

1. **The budget hold under concurrent calls.** `worker/ledger.ts:150` is one `INSERT ... SELECT ... WHERE`. Mutation: the hold rewritten as a read, a 20 ms pause and an insert (the 3.2 way) makes seven checks fail ("two calls at the last dollar: 2 passed, month $49.9998" in all five rounds, "four calls with room for two: 4 passed", "12 new merges: 12 passed, 0 refused"); restored, all 100 pass. The test can fail, so it proves something.
2. **The $5 cap.** Same statement, `?8` is the invite's allowance including this month's top-up; the phone run hit it: a $0.03 invite was refused on its sixth new merge with "Your magic is spent for now" (`16-cap-message.jpg`), $0.026 spent.
3. **The bug guard.** Burst counts distinct requests in `reservations` within 5 s (`ledger.ts:161`), refusals are logged; "12 new merges at once: 10 pass, 2 refused and logged" passes, and refused requests insert nothing, so a looping client stays refused for the window only.
4. **The iframe sandbox and CSP.** `sandbox="allow-scripts"` only (`src/worldhost.ts:136`, `src/checker.ts:18`), so no same origin, no forms, no popups, no top navigation, no modals; the parent checks `e.source` and `e.origin === "null"` (`worldhost.ts:351`); a second load of the frame replaces it (`:140`). Live headers on `/world` and `/check`: `default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'; worker-src 'none'; frame-ancestors 'self'` as in `public/_headers`.
5. **Message validation between page and island.** `readFromWorld` (`src/sim/protocol.ts:29`) bounds every field of every message type; the frame accepts only `window.parent` as a source (`src/sim/frame.ts`); the check frame likewise. The save message is the one field passed through as an object, bounded by size when stored (M13).
6. **The loop guard and promise probes.** `guardLoops` inserts `__g()` in every loop body, `LOOP_LIMIT` 4,000,000 per tick: a `while (true)` throws in 10 ms (M3 shows what it does not cover). The protection probe passes Aegis at three reaches and fails the shell of blocks in `npm test`, and failed the live "Protection Spell" in the refresh (`refresh-report`: 2% of lava harm prevented).
7. **The judge.** Advises only until calibrated (`JUDGE_TRUST`, `worker/index.ts`); 13 votes on the live database, so still advising; the refresh runner uses it to compare old and new on the same frames (38 replaced, 23 kept so far).
8. **Replay of stored programs.** `npm test` casts the 20 reference and legacy programs; the refresh runner ran the 61 decided candidates through the test run in Node.
9. **Secrets.** No key, token or private key in the repository or its 65 commits (`git log -p --all` against `sk-ant-`, `ghp_`, `github_pat_`, `AKIA`, `BEGIN ... PRIVATE KEY`, and against the actual `ADMIN_TOKEN` and `CLOUDFLARE_API_TOKEN` values: 0 hits). Invite secrets are 24 random bytes, kept hashed (`ledger.ts:95`), sent in a header, never in a URL or a log line (the burst log prints the invite id); the admin token is in a header too.

## 4. Where the money went, and what could be cheaper

1. **$5.86 of $10.50 is the Opus spell rewrite of 11-02** (96 calls at $0.061), the version bump the roadmap already names as the lesson. Nothing since repeats it: the refresh went through the Batch API at $0.045 an Opus program and $0.001 a Haiku one ($2.91 for 170 programs, under the $8 cap).
2. **The spell system prompt is 20,095 characters, about 5,300 tokens** (`worker/prompts.ts`, 41,503 bytes against 23,528 at 3.4 and 3,306 at the start). Haiku calls cache it (bursts); Opus calls skip the cache on purpose. Each Haiku spell is about $0.0015, two thirds of it that prompt: fine at $0.30 a month. A big Opus spell written directly reads 5,300 tokens at $4/M, $0.02 of its $0.06: the batch halves it. No change recommended; watch it grow.
3. **Spent without a player asking, by design:** the daily design call (one Opus call at high effort, $0.094 today, held at $0.40), intents backfill (done, $0.01), the nightly judge ($0.08 for 312 frames sets), spells written ahead for the ten newest items when the World opens ($0.002 each, once per item for everyone), and the refresh (admin started, capped). All are capped or bounded; none can run away.
4. **Merges stay on Opus** at $0.0012 each (DESIGN.md's measurement holds); the merge prompt is cached and read in bursts.
5. **Descriptions and intents** cost $0.0001 each: nothing to gain.
6. The review itself spent $0.026 on the test invite plus the judge calls the live runner made on its own.

## 5. Phones

The six HUD samples are all from one Android phone, most on the large island: simulation p95 11.7 to 17.5 ms, render p95 up to 12.4 ms, which together leave little of a 33 ms frame; one sample at 12.7 fps. Node's p95 on the same island is 4.0 ms, so the phone runs the simulation about three to four times slower than this machine, as DESIGN.md's 3.6 note said. The medium island sits at 4 ms simulation p95 on the same phone. Physics is 80% of a tick in Node (2.0 of 2.5 ms p50): temperature and fluids, as the roadmap's "what to watch" says. Recommendation: the large island stays opt-in (it is), and 4.1's "bigger islands" should gate on these numbers. The simulation does not leak over 30 minutes (section 1). The view's memory over a long session was not measured (not verified).

## 6. Newcomer's first ten minutes at phone size

`scripts/local-verify.mjs` and the scratchpad script behind `docs/review-4.0/phone-log.txt` ran the live site at iPhone 14 size with a test invite (`Review test`, $0.03, revoked after). Screenshots are in `docs/review-4.0/`.

1. The welcome (`01-welcome.jpg`) is 289 words with the privacy note below the fold; "Start playing" is visible. Readable, long.
2. The first merge answered in 0.8 s (a known pair), the next four in 2.8 to 3.1 s each (new pairs through Opus). The chip animation and the toast make the wait fine (`03-first-merge.jpg`).
3. The card (`06-card.jpg`) reads well; "Place in the World" for an artifact is clear.
4. The World (`07-world-first.jpg`) is the best moment: the island looks right at this size, the bar is one row with a Grid button. Three chips of twelve were ready (M9); the first spell was castable after 27 s. The cast and the vote bar (`08`, `09`) work.
5. Inspect did not open on a tap next to the village (nothing there); the hint toast told the player what to do.
6. Challenges (`11`, `12`): clear, par and stars explained. Casting on the island with the vote bar over the banner (`14`, M10).
7. Ideas (`15`): fine, one declined idea listed.
8. The cap message (`16`) appears as a toast next to "New: Healing Light", and the welcome's month line (`17`) says "0 credits left of 3". Both clear. Everything came back after a reload (3 chips, 14 discoveries, no welcome again).

## 7. What is good, keep it

1. The hold in one statement, and a test that fails when it is written any other way.
2. The sandbox: scripts only, opaque origin checked on both sides, a CSP that is served as written, bounded messages, a second load replaces the frame, programs compiled once per code version.
3. Invite secrets after the `#`, hashed at rest, taken out of the address bar; admin and invite tokens in headers only; no secret in the repository or its history.
4. `npm run test:worker`: the real Worker under `wrangler dev` with every migration and a counting stub, covering the money paths that matter.
5. Seeded, sectioned simulation tests; the five minute scene as a test of the design, which caught real bugs.
6. Cost discipline: estimates held above measured averages, every call recorded with its payer, the batch API for anything slow, prompts cached where calls come in bursts and not where they do not.
7. Programs never deleted, every version kept, rollbacks by votes.
8. The docs name the exact file for every rule, which made this review cheap, and file headers say why.
9. The ESLint rule that keeps `src/sim` free of the view, which is why everything runs in Node.
10. The repair loop bounded on both sides; "did not finish" counts as a pass so a slow phone never gets a good program rewritten.
11. Text nodes everywhere player or Claude text is shown; every `innerHTML` in `src/` carries static markup only (checked by grep).

## 8. Before the link goes beyond close friends

1. The routine's cloud environment holds no Cloudflare token, no admin token and no connectors (decision 1), and `main` has a ruleset that requires a pull request with no bypass (SETUP.md already says so; check it is on).
2. This branch deployed (fixes H1 to H3, M1, M2, M4, M5, L3) and `curl -I /world` shows `webrtc 'block'`.
3. Accounts (part 2) in place, so a friend who loses a phone keeps their island, and two tabs cannot lose a discovery (M6).
4. One real phone session with the HUD on the medium island after accounts, read back from `/api/perf`.
5. The welcome shortened to what a friend reads on a phone, the privacy note one tap away.
6. The vote bar and the challenge banner no longer overlap (M10); chips say "writing" and "testing" instead of dimming (M9).
7. `/api/perf` rate limited per invite (L2); the admin token compared in constant time (L1).
8. The judge still advising only; the refresh finished and its report read by the owner (88 candidates to decide).
9. Nothing public yet: Turnstile, name checks and AI labels stay for 4.5.

## 9. Part G: the accounts plan, revised

The roadmap's 4.0 is right about the goals and silent about four things that decide the design. In order:

1. **Passkeys bind to the domain.** A credential registered on `magic-merger.angelus76300.workers.dev` cannot be used from a custom domain later: every friend would register again. The domain must be chosen before the first passkey (decision 2). The code takes the relying party id from the request's host, so a move is a configuration change plus a re-registration, never a code change.
2. **The Worker cannot send email.** There is no sender; one means a provider key (a new secret), a sending domain and its DNS. Until that exists, the fallback to a passkey is what the roadmap already has for a lost link: the admin reissues a one use link, which signs the person into their existing account and offers a passkey again. The email link is built behind the same `links` table with a sender interface, so turning it on is a secret, not a change (decision 3).
3. **The invite becomes the account, with the same id.** Everything the server holds is keyed by the invite id already (`spend`, `elements.invite`, `suggestions`, `suggestion_votes`, `challenge_wins`, `reports`, `refusals`), so "move everything from the invite to the account" is no move at all: the account id is the invite id, the $5 cap and First Discoveries follow with no gap, and no migration rewrites a table. What changes identity is the vote and cast `player`, a random browser id today: a signed in session sends the account id as its player, so votes are one per person across devices. The invite's link is retired when the account is created (status `claimed`, the hash replaced), so it stops working for anyone else; the admin's "New link" on a claimed invite is the reissue above.
4. **Sessions are bearer tokens in a header, like the invite today**, 32 random bytes hashed at rest, 30 days, rotated on every passkey sign in, revocable per device from the account page. No cookie: nothing on the page uses one, the sandbox cannot read either, and a header token has no CSRF surface. The risk that remains is the one that exists today, script injection on the game page, and the page has no `innerHTML` of untrusted text.
5. **Progress on the server is three documents per account**, not a copy of the browser's save: discoveries (key, when, the pair, small), the board, and the island save gzipped with `CompressionStream` (a large island is 712k characters raw, about 150 kB compressed, under D1's row limit), each with `updated_at` and a device label. Upload has its own body limit (2 MB) apart from the 128 KB of this review. Discoveries merge as a union by key with the earliest time; the island is last saved wins, and the page warns before replacing a server save newer than its own; the board follows the island.
6. **Existing friends**: a browser with a valid invite and no session gets the one time prompt; "later" changes nothing; "save my progress" registers a passkey (or takes the reissued link path), uploads, and from then on the session replaces the invite header. The invite header keeps working for a browser that never answers, so nothing breaks the day accounts ship.
7. **Export and delete** on the account page: export is one JSON of every row keyed by the account; delete removes credentials, sessions, progress, links, votes, casts, ideas and their votes, reports, and sets `elements.invite` to null (the element stays, the First Discovery no longer names anyone); `spend`, `reservations` and `refusals` keep the random id, since the month's budget must stay whole, and the invite row stays as `deleted` so the id is never reused. The privacy note says all of this.
8. **Attacks to write as tests before the flow is shown**: an invite opened twice and by two requests at once (one account, one claim by an atomic `UPDATE ... WHERE status = 'active'`); a reissued link used twice; a registration challenge replayed or used for another account; a session token guessed, reused after sign out, or after deletion; a session from account A reading or writing B's progress; an upload over the limit, of the wrong shape, or with a save that is not version 2; a deleted account's rows in every table; the $5 cap before and after claiming (same id, same sum).

Sizes: the Worker side (tables, WebAuthn with `@simplewebauthn/server`, sessions, progress, export, delete) M; the page (prompt, account page, passkey ceremonies, upload and merge, device warning) M; tests and the attack list M. One session.

## 10. Attacks on the accounts code (part 2)

Written by the same session that wrote the accounts code, so each attack is a test that runs on every `npm run test:worker` (section 16) or in `scripts/account-verify.mjs` (a phone sized browser with a virtual authenticator), not a reading. All pass on this branch.

| Attack                                                        | Where                                                                                                                                                     | Result                                                                                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The link that made the account is opened again                | worker-test "the link that made the account plays nothing any more"; account-verify A                                                                     | 401: its hash was replaced at the claim                                                                                                                                               |
| One invite opened on two devices at once, both make a passkey | account-verify C                                                                                                                                          | one session, one account; the other device keeps its link and sees "used already" (the claim is one `UPDATE ... WHERE claimed_at IS NULL`)                                            |
| A reissued link opened twice at once                          | worker-test "a reissued link opened twice at once signs in once"                                                                                          | 200 and 401: the hash is retired conditionally on the hash it was opened with                                                                                                         |
| A reissued link used to play without signing in               | "a reissued link plays nothing by itself"                                                                                                                 | 401                                                                                                                                                                                   |
| A forged passkey answer, and the same challenge used twice    | "a forged passkey answer is refused, and its challenge is spent"                                                                                          | 400, 400: challenges are deleted when taken                                                                                                                                           |
| A sign in with a made up challenge id                         | "a sign in with no challenge is refused"                                                                                                                  | 400                                                                                                                                                                                   |
| A made up session token                                       | "a made up session token is nobody"                                                                                                                       | invited false                                                                                                                                                                         |
| A token after sign out, after deletion                        | "a signed out token is nobody", "deletion leaves nothing..."                                                                                              | invited false                                                                                                                                                                         |
| Session fixation                                              | by construction: tokens are made by the Worker (`newSecret(32)`), never taken from the client; a new link or a new passkey sign in always makes a new one |
| Session theft at rest                                         | tokens are hashed (`sessions.token_hash`), like invite secrets                                                                                            |
| One account reads or overwrites another's progress            | "one account cannot read or overwrite another's progress"                                                                                                 | Eve sees nothing of Dan's; her island does not touch his                                                                                                                              |
| One account signs out another's device                        | "a session cannot revoke another account's device"                                                                                                        | the row is only deleted when it belongs to the caller's account                                                                                                                       |
| Oversized, malformed or unknown progress                      | "a malformed, oversized or unknown save is refused"                                                                                                       | 400, 413, 400, 400; the upload body is capped at 2 MB                                                                                                                                 |
| An older device overwrites a newer island                     | "an older device is refused with what is newer", account-verify B                                                                                         | 409 with when and where; `force` only after the warning                                                                                                                               |
| The $5 cap before and after claiming                          | "a merge by a session is paid by the account, the invite's id"                                                                                            | the same id pays, so the same sum and the same cap                                                                                                                                    |
| Votes from two devices of one person                          | "a signed in vote is the account's, on every device"                                                                                                      | one vote per account, whatever `x-player` says                                                                                                                                        |
| Email enumeration                                             | "an unknown email gets the same answer and no mail"                                                                                                       | 200 either way, nothing sent for an unknown address                                                                                                                                   |
| Email link replayed, or flooded                               | "the email link signs in once", "at most three links an hour"                                                                                             | 403 on the second use; three an hour                                                                                                                                                  |
| Deletion leaving data behind                                  | "deletion leaves nothing of the person, keeps the library and the month's spend"                                                                          | 0 rows in credentials, sessions, progress, votes, casts, account_links, suggestions, reports, challenge_wins; `elements.invite` null; spend rows kept; invite row deleted and revoked |
| A deleted account reissued a link                             | "a deleted account gets no new link"                                                                                                                      | 400                                                                                                                                                                                   |
| Two tabs of one browser                                       | not covered (review M6)                                                                                                                                   | the local saves still race; the server keeps the island of whichever tab uploaded last, with the device warning                                                                       |

Not verified: the WebAuthn library's own checks beyond what a virtual authenticator exercises (attestation formats, the counter for cloned authenticators); a real phone's passkey dialog; a real email provider.

In 4.1 (`c724661`): Worker test section 26 drives the real routes with a software authenticator. A counter that goes backwards or repeats is refused (403) and leaves the stored counter alone; a counter that stays 0, as synced passkeys keep it, always signs in. Attestation "none" and "packed" self attestation are accepted; a forged packed signature, "none" with a statement, "fido-u2f" without its certificate and an unknown format are refused and claim nothing. Formats with a certificate chain are not exercised. Two tabs (the last row of the table) are covered since 4.1 by `scripts/verify-4.1.mjs` A (M6).

In 4.4.6, every attack above still passes, and section 29 of the Worker test adds the owner's: the admin token alone cannot make a second owner passkey once the account exists (409) nor reach the one use link route, so it never mints a session; the owner's account cannot be paused, revoked or deleted (400); a token beside a session adds the admin powers without hiding the session; an upload tagged with another account is refused (409) and the other account holds nothing of it; an island forced over a newer one is kept as the previous island, never lost. In the browser (`scripts/account-verify.mjs` F), a second account signing in on a phone that held the first one's progress receives nothing of it.

## 11. The accounts flow on the live site

Deployed on 2026-11-03 at 04:36 UTC (migration 0011 applied; the live database exported first to `/tmp/claude-0/magic-merger-live-20261103-0435-before-0011.sql` in the review session's container), after the refresh of the legacy library had finished on the live Worker. Then the scratchpad script behind `docs/review-4.0/accounts-live-log.txt` ran the flow on the live site at iPhone 14 size with a virtual authenticator and a test invite (`Review account`, $0.05), and deleted the account from its own page at the end ($0 spent):

1. The link, the welcome, then the one time offer (`20-account-offer.jpg`); "Make a passkey" made the account; afterwards the link answers `invited: false` with no account offered: dead.
2. One merge and a minute in the World: the server held the board, the discoveries and the packed island (58k characters), all from "iPhone" (`21-account-page.jpg`).
3. A second device with the same passkey and no link: the gate's "Sign in with a passkey" (`22-gate-signin.jpg`) signed in, the nine discoveries came down and the first device's island loaded (`23-second-device.jpg`, `24-second-device-island.jpg`).
4. Deleting the account from the second device signed the first out (`invited: false` with its token) and the People view shows the invite as deleted with its spend kept.

Two earlier runs of the same script failed on a dialog timing in the script itself after the account was made, so two test accounts (`ccf78a03`, `82a0d421`) were revoked but not deleted: each keeps one credential, two dead sessions and three small progress rows. The session's attempt to delete those rows through D1 was refused by its permissions; the statements are in the pull request for the owner to run, or they can stay (a revoked invite signs nobody in, and the rows cost nothing).
