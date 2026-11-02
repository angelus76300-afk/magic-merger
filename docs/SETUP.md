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
echo 'ADMIN_TOKEN=pick-something' >> .dev.vars    # optional, unlocks regeneration
npm run preview                                    # builds, then serves everything on http://localhost:8787
```

For hot reload while editing the frontend, run `npm run dev:api` in one terminal and `npm run dev` in another, then open the Vite URL.

Without an API key the Worker answers with fake, clearly labelled results and stores nothing. Mock spells are built from keywords in the name (fire, water, ice, stone, wind, light, shadow, life, crystal...), so the World tab can be played fully offline.

## 3. Deploy to Cloudflare (free tier is enough)

```bash
npx wrangler login
npx wrangler d1 create magic-merger          # copy the database_id it prints into wrangler.jsonc
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_TOKEN         # any long random string, the game asks for it once per device
npx wrangler secret put ADMIN_TOKEN          # a different long random string, only for you
npm run deploy
```

The game is then at `https://magic-merger.<your-subdomain>.workers.dev`. It is a normal web page, so on a phone you can use "Add to Home Screen".

`ACCESS_TOKEN` matters: the Worker URL is public, and without the token anyone who finds it could spend your credit.

### Admin mode

Tap the "Magic Merger" title five times quickly and enter your `ADMIN_TOKEN`. An admin badge appears with this month's Claude spend; tap it for the detail by call and model. Every card gets an admin row: which API version and model wrote its program, **New description**, and **Rewrite this spell**, which says what it will cost before it spends. They throw away the stored text or program and ask Claude again. Everyone else gets the stored version forever. Spells are never rewritten in bulk: this button is the only way. The admin token also works as an access token.

### Frame HUD

A long press on the title shows a small panel in the World: frame time p50 and p95, simulation and draw milliseconds, draw calls, triangles, pixel density, voxels, creatures and frames skipped because nothing changed. While it is on, a summary is sent every 30 seconds to `/api/perf` (kept 30 days); the admin reads them back with `GET /api/perf`. A long press again hides it.

## 4. Models and cost

Set in `wrangler.jsonc`:

| Variable            | Default                        | Used for                                                                                                                |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `MERGE_MODEL`       | `claude-opus-5-5`              | what two items make, and their power tier; once per new pair, ever (DESIGN.md has the comparison with Haiku and Sonnet) |
| `MERGE_EFFORT`      | `low`                          | how long the merge model thinks                                                                                         |
| `DESCRIBE_MODEL`    | `claude-haiku-5-5`, low effort | the grimoire text on a card; once per element, ever                                                                     |
| `SPELL_MODEL_SMALL` | `claude-haiku-5-5`             | writing spells up to `SPELL_SMALL_UP_TO` (grand)                                                                        |
| `SPELL_MODEL`       | `claude-opus-5-5`              | writing legendary and cosmic spells                                                                                     |
| `REPAIR_MODEL`      | `claude-haiku-5-5`             | mending a program that crashed, whatever its tier                                                                       |
| `SPELL_EFFORT`      | `medium`                       | how long the spell writer thinks                                                                                        |
| `BUDGET_USD`        | `20`                           | Claude spend allowed per calendar month                                                                                 |

Measured on the live Worker in November 2026:

| Call                             | Average | Time       |
| -------------------------------- | ------- | ---------- |
| Merge (Opus)                     | $0.001  | about 3 s  |
| Description (Haiku)              | $0.0001 | about 2 s  |
| Spell up to grand (Haiku)        | $0.002  | about 6 s  |
| Legendary or cosmic spell (Opus) | $0.076  | 20 to 40 s |
| Sonnet, for reference            | $0.021  |            |

A spell is written once, for everyone, the first time a player picks it in the World tab.

**Budget:** every call is written to the `spend` table in D1. When this month's total reaches `BUDGET_USD`, the Worker stops calling Claude and says so in the game; known recipes, descriptions and spells keep working. The admin can read the month and today's totals, grouped by call and model, at `/api/spend`, and in the admin badge. Also set a spend limit on the Console workspace: it is the safety net that does not depend on this code.

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

To compare models, the admin can pass `model` and `effort` in an `/api/spell` request with `regenerate: true`.

`node scripts/scenario-lab.mjs out plan.json` plays challenges with spells cast at given times and saves frames and the objective's timeline (see the comment at the top of the script for the plan format).

## 6. Tests

```bash
npm test
```

Runs the simulation in Node, without a browser, in about 20 seconds on four cores (35 on two): map generation, the reference spells, the loop guard, a save round trip, and every challenge with its solution and, over eight seeds in worker threads, with nothing. GitHub Actions runs `npm run build` and `npm test` on every pull request.
