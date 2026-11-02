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

Each invite may spend `INVITE_CAP_USD` ($5) a month, shown to players as 500 credits (100 credits to the dollar; the top-up asks in credits). Past it, new merges and new spells say "Your magic is spent for now"; known recipes and every spell already in the library stay free. Your own plays with the admin token count toward `BUDGET_USD` but have no allowance of their own.

### Admin mode

Tap the "Magic Merger" title five times quickly and enter your `ADMIN_TOKEN`. An admin badge appears with this month's Claude spend; tap it for the People view and the detail by call and model. Every card gets an admin row: which API version and model wrote its program, **New description**, **Rewrite this spell**, which says what it will cost before it spends, and every version of the program with its status, origin, votes, test run and judge score. Spells are never rewritten in bulk: only this button, players' votes and the judge (once it is trusted, see DESIGN.md) rewrite a spell, one at a time.

### Votes and the judge (3.3)

Players vote after a cast; nothing to set up. Two knobs in `wrangler.jsonc`: `REWRITE_BUDGET_USD`, dollars a day that rewrites may spend (votes, the judge and failed test runs), and `BIG_SPELLS_BATCH`.

The judge needs eyes: a computer with Playwright that casts each new live program in the Spell Lab and sends three frames to the Worker.

```bash
MM_URL=https://magic-merger.<your-subdomain>.workers.dev MM_TOKEN=<ADMIN_TOKEN> node scripts/judge-runner.mjs 30
```

Or let GitHub do it every night: add the repository secrets `MM_URL` and `MM_TOKEN` (Settings > Secrets and variables > Actions) and the `Judge` workflow runs at 04:17 UTC, or by hand from the Actions tab. Without the secrets it does nothing. `GET /api/admin/judge-stats` says how well the judge agrees with votes.

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
| `BUDGET_USD`         | `50`                           | Claude spend allowed per calendar month, everyone together (set the Console workspace limit to the same)                |
| `INVITE_CAP_USD`     | `5`                            | what each invite may spend per calendar month, unless the admin tops it up (3.4)                                        |
| `JUDGE_MODEL`        | `claude-haiku-5-5`             | scoring three Spell Lab frames of a program (3.3)                                                                       |
| `REWRITE_BUDGET_USD` | `0.5`                          | dollars a day for rewrites asked by votes, the judge and failed test runs                                               |
| `BIG_SPELLS_BATCH`   | `1`                            | legendary and cosmic spells drafted by Haiku at once, written by Opus through the Batch API at half price; `0` for 3.2  |

Measured on the live Worker in November 2026:

| Call                             | Average | Time       |
| -------------------------------- | ------- | ---------- |
| Merge (Opus)                     | $0.001  | about 3 s  |
| Description (Haiku)              | $0.0001 | about 2 s  |
| Spell up to grand (Haiku)        | $0.002  | about 6 s  |
| Legendary or cosmic spell (Opus) | $0.076  | 20 to 40 s |
| Sonnet, for reference            | $0.021  |            |

A spell is written for everyone the first time a player picks it in the World tab, tested in that player's browser, and written again only when players vote it down (DESIGN.md, "Spells that get better").

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

`node scripts/overlap-lab.mjs <out-dir>` casts the cases of 3.4's overlap fixes in the Spell Lab (a waterfall over the cut side, water on terraces, blocks in the land and through houses, a drawing over cliffs and water); compare with `docs/visual-checks`.

Runs the simulation in Node, without a browser, in about 20 seconds on four cores (35 on two): map generation, the reference spells, the loop guard, a save round trip, every challenge with its solution and, over eight seeds in worker threads, with nothing, the test run on good and bad programs, and the vote rules. GitHub Actions runs `npm run build` and `npm test` on every pull request.
