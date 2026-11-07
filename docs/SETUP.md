# Setup

## 1. Claim the monthly API credit (Max plan)

1. Create a Console organization at https://platform.claude.com if you do not have one.
2. On claude.ai, open **Settings > Billing**. In the **API credits** section, pick that Console organization and accept the terms.
3. The credit shows up under **Promotional credits** on https://platform.claude.com/settings/billing.

Things to know:

1. Max 5x gives $100 a month and Max 20x gives $200. Unused credit expires at the end of each billing cycle.
2. The link is permanent. You cannot change the organization yourself, only through support.
3. The credit covers the Claude API, not Claude Code.
4. With no card on the Console, requests simply stop when the credit runs out. Nothing is charged to your plan.
5. Create a dedicated **workspace** for this game and set a spend limit on it, then create the API key inside that workspace. If the key ever leaks, the damage is capped.

Source: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers

## 2. Run it locally

```bash
npm install
npx wrangler d1 migrations apply magic-merger --local
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars   # optional, without it the game runs in mock mode
echo 'ADMIN_TOKEN=pick-something' >> .dev.vars    # needed with an API key: you invite players from the admin badge
npm run preview                                    # builds, then serves everything on http://localhost:8787
```

For hot reload while editing the frontend, run `npm run dev:api` in one terminal and `npm run dev` in another, then open the Vite URL.

Without an API key the Worker answers with fake, clearly labelled results and stores nothing. Mock spells are built from keywords in the name (fire, water, ice, stone, wind, light, shadow, life, crystal...), so the World tab can be played fully offline.

## 3. Deploy to Cloudflare (free tier is enough)

```bash
npx wrangler login
npx wrangler d1 create magic-merger          # copy the database_id it prints into wrangler.jsonc
npx wrangler queues create magic-merger-writes   # 4.2: the queue that writes new items at the merge
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_TOKEN          # a long random string, only for you
npm run deploy
```

Since 3.4 there is no shared `ACCESS_TOKEN` (delete it with `npx wrangler secret delete ACCESS_TOKEN` if it is still set; it is ignored). Players come in with their own invite link, below.

`npm run deploy` also applies the D1 migrations and sets the cron trigger (every ten minutes) that collects the spells the Batch API has written.

The game is then at `https://magic-merger.<your-subdomain>.workers.dev`. It is a normal web page, so on a phone you can use "Add to Home Screen".

The Worker URL is public: without an invite link or the admin token, the API answers nothing but "invite only", so nobody who finds it can spend your credit.

### Invites (3.4)

Tap the admin badge: the People view lists everyone you invited, with what they spent this month, how many things they discovered first, when they last came and how often the bug guard refused them, plus what is left of `BUDGET_USD` and the reported names. Type a name and **Create invite**: you get a link like `https://magic-merger.<your-subdomain>.workers.dev/#invite=...` to send to that person only. Their browser keeps it (and removes it from the address bar); whoever opens it plays as that name. Per person: **Pause** (they keep playing the shared library, nothing new is asked of Claude), **Top up** (dollars added for this month only), **New link** (the old one stops working, the history stays) and **Revoke** (for good). Only a hash of each link is stored, so a lost link is replaced, never shown again.

Each invite may spend `INVITE_CAP_USD` ($5) a month, shown to players as 500 credits (100 credits to the dollar; the top-up asks in credits). Past it, new merges and new spells say "Your magic is spent for now"; known recipes and every spell already in the library stay free. Your own plays (with the admin token, or since 4.4.6 signed in to your own account) count toward `BUDGET_USD` but have no allowance of their own.

### Accounts (4.0)

Nothing to set up for passkeys. A friend who opens their link reads the welcome and is offered an account: a passkey made on their phone or computer (its own lock, no password) turns the invite into an account with the same id, uploads their discoveries, board and island, and the link stops working for anyone else. On another device, the gate page has "Sign in with a passkey" (a passkey synced by the platform, or one added from the account page). The admin's **New link** on an invite that is an account makes a one use sign in link instead: it signs the person in on the device that opens it, for a lost phone. The People view marks who has an account and who deleted theirs; on a revoked invite, **Delete account data** removes everything the account held (as the person's own Delete does), for a test account or a friend who asked.

Passkeys are bound to the site's host name: a credential made on `magic-merger.<your-subdomain>.workers.dev` does not work on another domain. Decide the domain before the first friend makes a passkey, or every friend registers again after a move.

Sign in links by email are optional and need a sender. The Worker posts JSON (`from`, `to`, `subject`, `text`, with a bearer key) to a Resend compatible endpoint:

```bash
npx wrangler secret put EMAIL_API_KEY
```

and in `wrangler.jsonc` `vars`: `EMAIL_API_URL` (for Resend, `https://api.resend.com/emails`) and `EMAIL_FROM` (an address on a domain the provider verified for you). With all three set, the account page lets a person save an address, and the gate page sends a one use link to it (20 minutes, three an hour, the same answer whether the address is known or not). Without them nothing is offered and the admin's new link is the way back in.

The account page (the `?` button, "Your account") lists passkeys, signed in devices (each can be signed out), what is saved and when, and has **Export** (one JSON file of everything the account holds) and **Delete my account** (passkeys, devices, saved progress, votes, casts, ideas, wins and reports; what the person found first stays in the shared library without their name; the month's spend keeps the invite's random id so the budget stays whole; the invite row stays as deleted so the id is never reused).

`node scripts/account-verify.mjs` (needs `dist/` and Playwright) runs the whole thing in a phone sized headless browser with a virtual authenticator against `wrangler dev`: a link into an account, a second device signing in with the same passkey and receiving the island, one link opened on two devices at once, deletion from one device signing out the other; since 4.4.6 also the owner on a computer and a phone, and a second account signing in on a phone that held the first one's progress.

### Your own account (4.4.6)

You are an account too, and admin is a role of it. Once, on the device you play on most: five taps on the title, the admin token, then **Make the owner's account** (offered at once, and in the `?` menu). That passkey makes the account whose id your admin rows already use (`admin`: your spend, First Discoveries, ideas and wins stay yours, nothing moves), uploads that device's progress, and drops the token from the browser. On every other device: the `?` menu or the gate, **Sign in with a passkey**; the admin powers follow the account, with no token to type, and the device's own progress from before is offered once for your account. No allowance of your own, as before. A lost passkey: **New link** on your own row of the People view (from a device that still has the token, or one signed in) signs a device in once; the row cannot be paused, revoked or deleted. The account is named `admin` at first; its name (shown in the menu, on your ideas, wins and First Discoveries) is one statement: `npx wrangler d1 execute magic-merger --remote --command "UPDATE invites SET name = 'Your name' WHERE id = 'admin'"`. A passkey keeps the name it was made with on your device. The token itself stays for scripts and the nightly Action (`MM_TOKEN`), and works alone exactly as before; next to a session it never hides it.

### Admin mode

Tap the "Magic Merger" title five times quickly and enter your `ADMIN_TOKEN`. An admin badge appears with this month's Claude spend; tap it for the People view and the detail by call and model. Every card gets an admin row: which API version and model wrote its program, **New description**, **Rewrite this spell**, which says what it will cost before it spends, and every version of the program with its status, origin, votes, test run and judge score. Spells are never rewritten in bulk: only this button, players' votes and the judge (once it is trusted, see DESIGN.md) rewrite a spell, one at a time.

### Votes and the judge (3.3)

Players vote after a cast; nothing to set up. Two knobs in `wrangler.jsonc`: `REWRITE_BUDGET_USD`, dollars a day that rewrites may spend (votes, the judge and failed test runs), and `BIG_SPELLS_BATCH`.

The judge needs eyes: a computer with Playwright that casts each new live program in the Spell Lab and sends three frames to the Worker.

```bash
MM_URL=https://magic-merger.<your-subdomain>.workers.dev MM_TOKEN=<ADMIN_TOKEN> node scripts/judge-runner.mjs 30
```

Or let GitHub do it every night: add the repository secrets `MM_URL` and `MM_TOKEN` (Settings > Secrets and variables > Actions) and the `Judge` workflow runs at 04:17 UTC, or by hand from the Actions tab. Without the secrets it does nothing. `GET /api/admin/judge-stats` says how well the judge agrees with votes.

### Feedback (3.4.1)

The Ideas tab works with nothing to set up: invited players post ideas and vote for them, and the admin can decline, reopen or delete one. **Send to Claude** needs three secrets more. The flow and the rules Claude follows are in [FEEDBACK.md](FEEDBACK.md).

1. **The routine** (a Pro, Max, Team or Enterprise plan with Claude Code on the web). At https://claude.ai/code/routines, create one named "Magic Merger feedback" with the repository `angelus76300-afk/magic-merger` and, as its instructions, the prompt in FEEDBACK.md ("The routine's saved prompt"). Pick the model the features deserve. In **Connectors**, remove every connector: they are all included by default, with write access, and this routine needs none. Under **Select a trigger** choose **API**, then **Create**: copy the token at once (it is shown once) and the URL.
2. **A GitHub token** for the Worker: https://github.com/settings/personal-access-tokens/new, fine-grained, **Only select repositories** with this one, permissions **Issues: read and write** and **Pull requests: read**. Nothing else. Put a reminder in your calendar for its expiry.
3. **The secrets:**

```bash
npx wrangler secret put GITHUB_TOKEN
```

```bash
npx wrangler secret put ROUTINE_URL
```

```bash
npx wrangler secret put ROUTINE_TOKEN
```

4. `npm run deploy` (it applies migration 0007). `GITHUB_REPO` is already in `wrangler.jsonc`; a fork sets its own.

Until all of it is set, the admin box at the top of the Ideas tab names what is missing. Locally, the same names go in `.dev.vars`.

Things to know:

1. Each run is a Claude Code cloud session on your plan and counts against its usage, not against `BUDGET_USD`. A routine accepts 30 fires an hour; past that the Worker says so and nothing changes.
2. The run works on GitHub as you, on a `claude/` branch. If you want `main` to refuse its pushes even by mistake, add a ruleset on `main` that requires a pull request with no bypass: a rule your own access can bypass does not stop a run.
3. The issue is public if the repository is. It holds the brief and the idea's text, never the player's name.
4. Statuses follow GitHub every ten minutes (the cron); **Check GitHub now** in the admin box reads it at once. The pull request must say `Closes #<issue>` for the game to find it; the routine's rules ask for it.
5. The routine API is experimental. If it changes, Send to Claude shows the error it returns and the rest of the tab keeps working.

### Previews (4.5)

Every pull request gets its own address to try on a phone before merging, `https://pr-<n>-magic-merger-staging.angelus76300.workers.dev` (the "View deployment" link on the pull request). It runs on a separate Worker, `magic-merger-staging` (`wrangler.jsonc`, `env.staging`), with its own D1 (`magic-merger-staging`) and queue, and $2 a month for everyone together. Nothing it does reaches production.

1. **One repository secret**, `CLOUDFLARE_API_TOKEN` (Settings > Secrets and variables > Actions): a Cloudflare API token with Workers Scripts Edit, D1 Edit and Queues Edit on your account (the "Edit Cloudflare Workers" template plus D1 Edit). The account id is in `wrangler.jsonc`.
2. **Optional**, `STAGING_ANTHROPIC_API_KEY`: a key for the previews. The live game's own key works: production's `BUDGET_USD` is $48 so that it and the previews' $2 stay within the Console's $50 together (a separate Console workspace with its own $2 limit works too). Without it the previews run in mock mode (fake merges, free), which is enough to try anything that is not a new merge or a new spell.
3. `MM_TOKEN` (the Judge's secret, your admin token) is copied to the staging Worker by the `Staging` workflow, so you get in with the same five taps on the title. Staging lets nobody in without it: the copy of the library is not public, even in mock mode.

The `Staging` workflow runs every night at 07:41 UTC and on every merge: it copies the live database to staging with accounts, passkeys, sessions, sign in links, invites, emails, saved progress, reports and devices stripped (`scripts/staging-copy.mjs`; the owner's row stays, with no link or email), keeps staging's own spend of the month so the $2 holds, and deploys `main` there. The `Preview` workflow uploads each pull request as a version of that Worker with its own address. A pull request's migrations run on the staging D1 only; the next night's copy resets it. To refresh by hand: Actions > Staging > Run workflow, or `node scripts/staging-copy.mjs` (`--dry` writes the SQL without loading it).

### Frame HUD

A long press on the title shows a small panel in the World: frame time p50 and p95, simulation and draw milliseconds, draw calls, triangles, pixel density, voxels, creatures and the boxes drawn for them (3.5), and frames skipped because nothing changed. While it is on, a summary is sent every 30 seconds to `/api/perf` (kept 30 days); the admin reads them back with `GET /api/perf`. A long press again hides it.

## 4. Models and cost

Set in `wrangler.jsonc`:

| Variable             | Default                        | Used for                                                                                                                |
| -------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `MERGE_MODEL`        | `claude-opus-5-5`              | what two items make, and their power tier; once per new pair, ever (DESIGN.md has the comparison with Haiku and Sonnet) |
| `MERGE_EFFORT`       | `low`                          | how long the merge model thinks                                                                                         |
| `DESCRIBE_MODEL`     | `claude-haiku-5-5`, low effort | the grimoire text on a card; once per element, ever                                                                     |
| `SPELL_MODEL_SMALL`  | `claude-haiku-5-5`             | writing spells up to `SPELL_SMALL_UP_TO` (grand)                                                                        |
| `SPELL_MODEL`        | `claude-opus-5-5`              | writing legendary and cosmic spells                                                                                     |
| `REPAIR_MODEL`       | `claude-haiku-5-5`             | mending a program that crashed, whatever its tier                                                                       |
| `SPELL_EFFORT`       | `medium`                       | how long the spell writer thinks                                                                                        |
| `BUDGET_USD`         | `48`                           | Claude spend allowed per calendar month, everyone together; the staging Worker has $2 and the Console workspace $50     |
| `INVITE_CAP_USD`     | `5`                            | what each invite may spend per calendar month, unless the admin tops it up (3.4)                                        |
| `JUDGE_MODEL`        | `claude-haiku-5-5`             | scoring three Spell Lab frames of a program (3.3)                                                                       |
| `REWRITE_BUDGET_USD` | `0.5`                          | dollars a day for rewrites by votes, the judge, failed test runs, broken promises and, one a day, evidence              |
| `BIG_SPELLS_BATCH`   | `1`                            | legendary and cosmic spells drafted by Haiku at once, written by Opus through the Batch API at half price; `0` for 3.2  |
| `AHEAD_DAILY_USD`    | `1.5`                          | 4.2: dollars a day that writing every new item at the merge may spend, everyone together; `0` turns it off (DESIGN.md)  |
| `REFRESH_BUDGET_USD` | `8`                            | dollars a month the refresh of the legacy library may spend (3.7 part E), held before each batch is sent                |
| `WONDER_BUDGET_USD`  | `2`                            | 4.4.5 part C: dollars a month a new wonder a day may spend (held before each call), inside `BUDGET_USD`                 |
| `WONDERS`            | unset                          | `0` stops the daily wonder; the admin can still ask with `POST /api/admin/wonder-daily`                                 |
| `DAILY_CHALLENGES`   | unset                          | `0` stops the night's daily challenge; the admin can still set one with `POST /api/admin/daily`                         |
| `EVIDENCE_REWRITES`  | unset                          | `0` stops the daily rewrite of a live program shown broken (DESIGN.md, "Old spells and new promises")                   |
| `DESIGN_MODEL`       | `SPELL_MODEL`                  | who designs how the World API grows from what spells lacked (3.4.2), one call a day at most                             |
| `EVOLVE`             | unset                          | `0` stops the API from growing on its own; the admin can still ask with `POST /api/admin/evolve`                        |
| `ANTHROPIC_BASE_URL` | unset                          | routes Claude calls through a gateway, or the stub in `npm run test:worker`; `GITHUB_API_URL` does the same for GitHub  |
| `EMAIL_API_URL`      | unset                          | 4.0: with the secret `EMAIL_API_KEY` and `EMAIL_FROM`, a Resend compatible endpoint for one use sign in links by email  |

Measured on the live Worker in November 2026:

| Call                             | Average | Time       |
| -------------------------------- | ------- | ---------- |
| Merge (Opus)                     | $0.001  | about 3 s  |
| Description (Haiku)              | $0.0001 | about 2 s  |
| Spell up to grand (Haiku)        | $0.002  | about 6 s  |
| Legendary or cosmic spell (Opus) | $0.076  | 20 to 40 s |
| Sonnet, for reference            | $0.021  |            |

A spell is written for everyone when a merge first makes or reaches it (4.2, written ahead), tested in the first browser that holds it, and written again one at a time: when players vote it down, when the judge scores it low, when its test run fails or its promise breaks, when it crashes in play (a repair), or from the admin's card (DESIGN.md, "Spells that get better"). Never in bulk.

**Budget:** every call is written to the `spend` table in D1 with the invite that triggered it (votes that ask for a rewrite, and Batch API items collected later, included). Before a call, its expected cost is held in `reservations` by one statement that only succeeds while the month and the invite's allowance can afford it, so two requests at the last dollar cannot both pass (DESIGN.md, "Sharing with friends"). When this month's total reaches `BUDGET_USD`, the Worker stops calling Claude and says so in the game; known recipes, descriptions and spells keep working. The admin can read the month and today's totals, grouped by call and model, at `/api/spend`, and in the admin badge. Also set a spend limit on the Console workspace: it is the safety net that does not depend on this code.

Every Claude call also logs one JSON line with its token counts and cost. Watch them live with `npx wrangler tail --search usage`, or later in the Cloudflare dashboard under Workers Logs.

Haiku 5.5 has no server side refusal fallback, so the Worker only sends that option to models that support it.

## 5. Spell Lab

A dev tool to see what spell programs actually do, without playing by hand. It casts each program near a village on the same seeded island in a headless browser, then saves frames as PNG and a JSON report: terrain changes, deaths, statuses, errors, the slowest tick, and draw calls and triangles.

```bash
npx vite --port 5174
```

```bash
node scripts/spell-lab.mjs lab-out lab/spells/*.js
```

`lab/spells` holds hand written reference spells. A `.json` file can also be a saved `/api/spell` response. Environment variables: `LAB_TIER` (default major), `LAB_SHOTS` (seconds, comma separated), `LAB_SIZE` (small, medium, large), `LAB_DIST` (camera distance; 400 shows the whole island).

To compare models, the admin can pass `model` and `effort` in an `/api/spell` request with `regenerate: true`, or, without storing anything, call `/api/admin/spell-trial` (`name`, `model`, `effort`, `examples`, `rewrite`), `/api/admin/batch-trial` and `/api/admin/judge-trial`. `scripts/eval-spells.ts` uses them to measure a fixed set of 20 spells (see its header and `docs/measurements/spell-quality-2026-11.md`); point it at a version uploaded with `npx wrangler versions upload`, which gets its own preview URL and leaves production alone.

The bestiary (3.5) draws every body plan, feature, wild animal, villager look and sample model with the game's own figure code: open `http://localhost:5174/lab/bestiary.html` while Vite runs (`?pose=walk|idle|fly|dead|frozen`, `&only=<section>`, `&cols=4` for close-ups, `&t=<seconds>` to stop the clock). `node scripts/bestiary.mjs` saves its screenshots in `docs/visual-checks`. `node scripts/prof-view.mjs crowd` measures 375 creatures.

`node scripts/scenario-lab.mjs out plan.json` plays challenges with spells cast at given times and saves frames and the objective's timeline (see the comment at the top of the script for the plan format).

## 6. Tests

```bash
npm test
```

```bash
npm run build
```

```bash
npm run test:worker
```

`npm run test:worker` (3.4) runs the Worker itself with `wrangler dev` on a fresh local D1, with a stub in place of Claude that counts calls: no invite, a made up link, a capped invite (new merges refused, known ones free, other people unaffected, a top-up, a pause), a revoked invite and a new link, two calls at the last dollar in five rounds (exactly one passes), four calls with room for two, the same merge three times in flight (one Claude call) and twelve new merges at once from one person (ten pass, two refused and logged). It needs `dist/` to exist (the build makes it). CI runs it after `npm test`.

`npm run test:worker` also covers 3.4.2: a spell gets its promise before its program and its writer is told the test, gaps are recorded, three spells lacking the same thing grow a helper on trial that writers do not see until its example passes, a live helper joins the prompt and is appended to the program that calls it, and a broken promise is written again with what the test found.

`npm run evolve` (3.4.2), with `MM_URL` and `MM_TOKEN` set, tests the helpers waiting for their test run and opens a GitHub issue for each engine proposal when `GITHUB_TOKEN` and `GITHUB_REPOSITORY` are set (the daily Judge workflow sets both). No Claude call.

`node scripts/overlap-lab.mjs <out-dir>` casts the cases of 3.4's overlap fixes in the Spell Lab (a waterfall over the cut side, water on terraces, blocks in the land and through houses, a drawing over cliffs and water); compare with `docs/visual-checks`.

`npm test` runs the simulation in Node, without a browser, in about 4 to 6 minutes on four cores and 13 to 23 minutes on a CI runner (measured on 2026-11-05; the half hour balance scenes are most of it): map generation, the reference spells, the loop guard, a save round trip, every challenge with its solution and, over eight seeds in worker threads, with nothing, the test run on good and bad programs, the five minute scene and the vote rules. GitHub Actions runs lint, the format check, `npm run build`, `npm test` and `npm run test:worker` on every pull request and on every push to `main`.

Both test commands take environment knobs since 4.1: `SLOW_MS=40 npm test` turns the slow cast guard back on at the browser's value (it is off by default, so no verdict depends on the machine), and the Worker test drives a software passkey through the real routes. `npm run typecheck` checks `scripts/` too (`scripts/tsconfig.json`), and `npm run lint` covers the `.mjs` scripts.

`npm run build && node scripts/verify-4.1.mjs` (4.1) runs the 4.0 review's browser findings in a phone sized headless browser against `wrangler dev` with a stub Claude: two tabs of one browser signed in (discoveries, the island, the upload), a full storage, a World frame stuck in spell code, the vote bar over a live challenge (with `shots=<dir>` for the screenshot), Restart and Retry keeping the head start, a spell mended too often. `node node_modules/.cache/drum.mjs` after `npx esbuild scripts/drum-count.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/drum.mjs` counts the sounds a busy island plays by itself.

`node scripts/local-verify.mjs` (4.0 review) runs the built game in a phone sized headless browser against `wrangler dev` with a stub Claude and checks what no Node test can: a check frame that never loads, a test verdict that never reaches the Worker, a challenge win kept for the next visit. It needs `dist/` and Playwright.

## 7. Going public (2026-11-06)

A public repository gets unlimited GitHub Actions minutes on standard runners, and branch protection for free. It also lets anyone read the code, fork it, open pull requests and comment. The pipeline was hardened for that first (the pull request "Public repository: the pipeline holds against strangers"):

- the Gate reads `mm-review` and `mm-owner` markers only from comments written by your account (its login and GitHub's `author_association` OWNER), and never merges a pull request from a fork;
- a stranger's comment, a fork's pull request or a fork's finished CI run does not wake the Gate at all, so they cost no minutes;
- the Preview and Ideas jobs, the only ones that hold secrets on a pull request, run only for branches of this repository; CI runs a fork's code with no secret and a read only token;
- `scripts/workflows-test.mjs` (in `npm run test:risk`) fails if a later change undoes any of this;
- the whole history was scanned with gitleaks: no secret (`docs/measurements/secret-scan-2026-11-06.md`).

Your checklist, in this order. Each line is a setting only you can change.

**Before the switch**

1. Actions > Gate > the "..." menu > **Disable workflow**, so nothing merges while settings change.

**The switch**

2. Settings > General > Danger Zone > **Change repository visibility** > Public.

**Right after, before anyone forks**

3. Settings > Actions > General > "Approval for running fork pull request workflows from contributors": **Require approval for all external contributors**. A fork's pull request then runs nothing until you press "Approve and run" on it. (`pull_request_target` workflows run without approval whatever this says; the Gate's own guard covers that.)
4. Same page, "Workflow permissions": **Read repository contents and packages permissions**, and leave **Allow GitHub Actions to create and approve pull requests** unticked. Each workflow already asks for the permissions it needs.
5. Settings > Code security: turn on **Secret scanning** and **Push protection** (free on a public repository). Push protection refuses a push that contains a known kind of key.
6. Settings > Rules > Rulesets > New branch ruleset, named `main`, enforcement Active, target the default branch: tick **Restrict deletions** and **Block force pushes**. Leave the bypass list empty: every session acts as your account, so a rule you can bypass does not stop a session. Optional and recommended: **Require a pull request before merging** with 0 approvals; every merge already goes through a pull request (the Gate, and the planner's squash of a workflow change), so it blocks only a direct push to `main`.

**After the hardening pull request merges**

7. Actions > Gate > **Enable workflow**.

**Soon, the credentials** (ROADMAP 4.5.1a items 2 and 3)

8. Make two new random values, for example with `openssl rand -base64 32` twice: one for production, one for staging.
9. Production's admin token: Cloudflare dashboard > Workers & Pages > `magic-merger` > Settings > Variables and Secrets > `ADMIN_TOKEN`, the first value. Then GitHub Settings > Secrets and variables > Actions > `MM_TOKEN`, the same value. Then the cloud environment of the Claude Code sessions: `ADMIN_TOKEN`, the same value. The old one stops working at once, on every device that held it; five taps on the title with the new one let you back in.
10. Staging's own admin token: a new Actions secret `STAGING_ADMIN_TOKEN`, the second value, and the same name and value in the sessions' environment. The Staging workflow copies it to the staging Worker on its next run (Actions > Staging > Run workflow to do it now); previews, the reviewer and the night's checks then use it instead of production's.
11. On the account page, signed in as yourself: check that the passkeys listed are all yours.

**Things to know**

- Your email address is the author of the squash merges made on github.com (46 commits today). It becomes visible in the history; rewriting history to remove it is not worth the risk. To keep it out of future merges: GitHub Settings > Emails > **Keep my email addresses private**. Session commits use `noreply@anthropic.com`.
- Issues become public, the Ideas routine's included. They hold the brief and the idea's text, never a player's name. The only one today, #14, is your own test.
- The game's addresses, the Cloudflare account id in `wrangler.jsonc` and the names of the secrets are public from now on. None of them lets anyone act: every admin route needs the token's value, and staging lets nobody in without it.
- A GitHub environment with a required reviewer is free on a public repository, so previews could wait for your approval (ROADMAP 4.5.1a item 1). Not set up: your answer of 5 November was to keep previews as they are, and a required reviewer would also stop the Gate from merging green work at night.
