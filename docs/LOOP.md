# The loop, measured

How much the owner still has to drive, week by week (4.5.2). The rules are in [DAILY.md](DAILY.md); this file keeps the definitions, the baseline before 4.5.2, and the dry run that showed what the new rules would have done.

## What is measured

| number                                                             | how                                                                                                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| share of merged pull requests that needed no action from the owner | merged in the week without the label `owner-ok`, `owner-yes` or `owner-action` (a session adds `owner-action` when the owner had to step in any other way) |
| the owner's minutes per week                                       | estimated: 1 per OK, 3 per yes, 2 per other action, plus 1 per message the owner sent to a session, which the planner counts in the sessions on Sundays    |
| rollbacks and refused deploys                                      | issues labelled `rollback`, opened by the Deploy workflow, with their cause                                                                                |
| bugs found first by the owner, by the AI                           | `Found by: owner` or `Found by: ai` in the body of the pull request that fixes the bug                                                                     |
| red merged without a yes                                           | the Deploy workflow's refusals for that reason: each one is a failure of 4.5.2                                                                             |

`scripts/loop-metrics.mjs` computes the GitHub part (the Night workflow runs it on Sundays and when started by hand); the planner adds the owner's messages and puts the table in the Sunday brief. Counting starts on 5 November 2026 at noon UTC, when the labels began to exist.

## The baseline, before 4.5.2

From the audit of 5 November (`docs/AUDIT-2026-11-05.md`, section 4), over the eight build sessions of #29 to #41:

| number                                     | before                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| owner messages                             | 35: 10 said merge, 12 said deploy, 2 checked where things stood, 12 reported a bug the owner found in play |
| pull requests merged with no owner action  | 3 of 9 code pull requests (the ones whose prompt said "merge without my ask")                              |
| reviews                                    | 0 on 16 pull requests                                                                                      |
| production deploys made before their merge | 6 of the last 10                                                                                           |
| rollbacks                                  | 0 (none was ever possible: no smoke test, no rollback step)                                                |
| bugs found first                           | owner 12, AI 0                                                                                             |

## Dry run on the three newest pull requests

`node scripts/risk.mjs --base <commit>^ --head <commit>` on each squash commit of `main`, the gate's rules applied to what happened that day. Run on 5 November 2026.

| pull request                                        | class | rules                                                                                                                                                                                                                                                                                                                                                                                             | what would have happened                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #42 Roadmap 4.5.1 and 4.5.2; CLAUDE.md; five skills | red   | R11 (29 files: 27 under `.claude/skills`, `CLAUDE.md`, `docs/DAILY.md`)                                                                                                                                                                                                                                                                                                                           | CI in full (it also changed `eslint.config.js` and `.prettierignore`), preview and smoke test, a reviewer session. Then waits: the agreements every session reads are the owner's to change. One question in the brief, merged after "yes #42". Today it merged with no review and no question.                                                                                                                                                                                                                               |
| #41 Production budget at $48                        | red   | R1 (`wrangler.jsonc`: `BUDGET_USD` 50 to 48)                                                                                                                                                                                                                                                                                                                                                      | Waits for "yes #41". The owner had asked for it in the session, so the builder would have recorded the yes from that message (label `owner-yes`, a comment quoting it) and the Gate merged it: no extra tap, and a trace of who decided.                                                                                                                                                                                                                                                                                      |
| #40 Magic Merger 4.5                                | red   | R1, R2 (`worker/oracle.ts`, `worker/prompts.ts`), R3 (a new merge call for the daily challenge), R14 (money knobs in `worker/index.ts`), R6 (`worker/accounts.ts`, `src/account.ts`), R7 and R8 (`scripts/staging-copy.mjs`), R11 (three workflows, `docs/DAILY.md`); amber A1 (migration 0016), A3 (rows of `invites`, `votes` and others written), A5 (an admin route), A8 (a scheduled runner) | One pull request for everything means one red pull request. Under the new rules the builder splits it: (a) staging, previews and the staging copy (red, R1, R7, R8, R11); (b) the daily challenge's paid call with its prompt (red, R2, R3, with the cost: about $0.003 a night); (c) the account page's favorite and hide switch (red, R6); (d) the Daily, Community and What's new tabs and migration 0016 (amber, A1, A3, A5). Four questions in one brief, each a tap; (d) merges on "OK" and goes live the same morning. |

For contrast, two older ones: #38 (ideas in `docs/IDEAS.md`) is green and would have merged itself after its review; #37 (the account chip and a resizable spell bar) is amber through A4, because it changed `src/sync.ts`, which merges two devices' progress.

What the dry run teaches: until now every version pull request mixed game code with infrastructure, so every one comes out red. The class is only cheap for the owner if builders keep the red part small and separate (DAILY.md, "Keep the red part small").

### The brief the owner would have received

On the morning of 5 November, had #40 been built the night before under these rules, split as above:

```text
Overnight: 4.5 built in four pull requests; one merged, three wait for you. Deploy
of #48 green (smoke test 13 of 13, no errors), live as version 3f2a.... Nothing
rolled back. Spend $15.41 of $48 this month.

Waiting for you
1. OK? #48 Daily, Community and What's new tabs (amber: new migration 0016, adds
   two tables; writes the votes table). Preview: pr-48-...workers.dev. Frames: the
   Daily tab, the Community tab. Recommendation: OK.
2. Yes? #47 The daily challenge (red: a new Claude call each night, about $0.003,
   $0.09 a month, inside the $48). Options: yes / yes with a cap of one try a night
   / not now. Recommendation: yes with the cap.
3. Yes? #46 Previews for each pull request (red: wrangler.jsonc gets a staging
   Worker with $2 a month; CI gets the Cloudflare token; a nightly copy of the live
   database with accounts stripped). Risk: pull request code runs with the token.
   Recommendation: yes, with previews from the Ideas routine waiting for your OK.
4. Yes? #45 Favorite spell and hide switch on the account page (red: account
   code). Recommendation: yes; the reviewer reproduced the hide switch on the
   preview.

Try this: the Daily tab after "OK 1": the first daily challenge is Frozen Tomb.

Found before you: the night play test saw a toast drawn over the tab bar on the
World; tonight's fix, with a test.

Tonight, probably: 4.5.1, the audit.
```

## The night play test, first run

Run by hand on 5 November against staging (`scripts/nightly-play.mjs`, seed 4242, 2 minutes; `scripts/smoke.mjs preview`), then looked at as the planner will: the newcomer's path passed 19 of 19 checks once a browser warning about the `webrtc` directive of the content security policy was set aside (the warning is not a fault players see). The frames showed two things a person would notice: the base spell Fire answered "still being made" for more than a minute after the cast, so nothing happened on the island; and that message is drawn over the tab bar, text over text. Frame times in the headless browser: p50 50 ms, p95 83 ms (software WebGL, compared night to night, not with phones). Both findings are in `docs/IDEAS.md` ("No dead tap on a cast") and are the kind the next night's builder takes.
