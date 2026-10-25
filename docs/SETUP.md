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
npm run preview                                    # builds, then serves everything on http://localhost:8787
```

For hot reload while editing the frontend, run `npm run dev:api` in one terminal and `npm run dev` in another, then open the Vite URL.

Without an API key the Worker answers with fake, clearly labelled results and stores nothing.

## 3. Deploy to Cloudflare (free tier is enough)

```bash
npx wrangler login
npx wrangler d1 create magic-merger          # copy the database_id it prints into wrangler.jsonc
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_TOKEN         # any long random string, the game asks for it once per device
npm run deploy
```

The game is then at `https://magic-merger.<your-subdomain>.workers.dev`. It is a normal web page, so on a phone you can use "Add to Home Screen".

`ACCESS_TOKEN` matters: the Worker URL is public, and without the token anyone who finds it could spend your credit.

## 4. Models and cost

Both calls use `claude-opus-5-5` at low effort by default, set in `wrangler.jsonc`:

| Variable | Used for | Called |
| --- | --- | --- |
| `MERGE_MODEL` | deciding what two items make | once per new pair, ever |
| `DESCRIBE_MODEL` | the grimoire text on a card | once per element, ever |

Rough cost per new merge with Opus 5.5 ($4 / $20 per million tokens): about one cent at most, mostly thinking tokens. `claude-haiku-5-5` ($0.10 / $0.50) is about 40 times cheaper and faster, at some cost in creativity. Switching is a one line change in `wrangler.jsonc`, then `npm run deploy`. Track real spend on https://platform.claude.com/cost.
