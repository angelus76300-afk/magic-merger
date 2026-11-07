# Working on Magic Merger

Every Claude Code session on this repository reads this first. All creation and coding is done by AI; the owner steers. The owner touches three things only:

1. **Questions from the sessions building an update**, asked with options and a recommendation.
2. **The morning brief** of the daily planner (`docs/DAILY.md`): what happened, what to try, what to decide.
3. **The game itself and its Ideas tab.**

Everything else is the AI's: checking, building, testing, reviewing, and finding bugs and ideas before the owner does. Merging and deploying are done by workflows (the Gate and Deploy); the one exception, a red workflow change the owner said yes to, is merged by the planner (`docs/DAILY.md`).

## Before anything: check where we are

Read `main`'s latest commits, the open pull requests, the branches with commits in the last day, and the Claude Code sessions working on this repository when you can list them. Never start what another session is building. Never edit files an open pull request touches unless that pull request is yours. The plan is `docs/ROADMAP.md` ("Next versions", numbered in the order to run them), the daily rules `docs/DAILY.md`, the backlog `docs/IDEAS.md`, the rules of the game `docs/DESIGN.md`.

## Finish the work yourself

1. Work on a new branch from `main`; open a pull request early, as a draft, and mark it ready once, when it is finished (GitHub Actions minutes are limited: `docs/DAILY.md`, "GitHub Actions minutes"; `npm test` runs in your session, not in CI). Run `node scripts/risk.mjs` to see its class (green, amber or red, `docs/DAILY.md` "Risk classes"); split a small red part into its own pull request so the rest stays green.
2. Prove what you built: the repo's checks (`npm run lint && npm run format:check && npm run typecheck && npm run build && npm test && npm run test:worker && npm run test:risk`), a test that fails without your change, and for anything visible, frames at phone size (390 by 844) and a look at the pull request's preview.
3. Mark it ready and get it reviewed by a session that is not you: start the reviewer as `docs/REVIEWER.md` says (a fresh session, never a fork of yourself). It reproduces one claim on the preview and blocks on anything it can show. Fix it, and ask for the review again.
4. **Do not merge and do not deploy.** The Gate workflow merges a green pull request once CI, the preview smoke test and the review pass; amber waits for the owner's OK and red for the owner's yes, both asked in the morning brief. The Deploy workflow deploys `main` after each merge, checks the live site at phone size and rolls back on its own. Watch the Deploy run for your merge and fix forward if it fails. `npm run deploy` refuses to run outside GitHub Actions.
5. Say in the pull request what you did, what you checked, its class, and what the owner can try. A bug fix says `Found by: owner` or `Found by: ai`.

## Ask the owner first, only for these

Keep working on everything that does not depend on the answer while you wait.

1. **Money**: a new running cost, a raised cap or budget, a change of model for calls players trigger.
2. **Players' data**: deleting it, rewriting it, or a migration that changes existing rows of players.
3. **Spells in bulk**: rewriting stored programs in bulk or bumping `PROGRAM_VERSION` (it once doubled the month's Opus spend in a day).
4. **Anything public**: a link, a post, a listing, a domain.

They are among the red classes of `docs/DAILY.md`, checked on every diff by `scripts/risk.mjs`; the full list of what is red or amber (the pipeline, dependencies, saves, the admin surface, tests taken out) is there. Pull requests opened by the feedback routine from the Ideas tab carry players' words into code; they are amber and wait for the owner, as `docs/FEEDBACK.md` says. "Pause" from the owner, in any session: open an issue labelled `pause`; it stops every merge and deploy until it is closed.

## Habits

1. **Find bugs before the owner does**: play what you changed and what it touches, at phone size, for a few minutes; check that items do what their names and descriptions promise. A bug the owner finds first is a miss.
2. **Bring ideas as the game's designer**: add at least one idea of your own to `docs/IDEAS.md` per session, with the reasoning (what the player feels, what it adds, what it costs).
3. **Skills in `.claude/skills`** (sources and review in `docs/SKILLS.md`): `frontend-design` for any interface or page, so it has character instead of looking generated; `zero-slop` for text players read and for docs; `adversarial-review` for the reviewer's fresh subagents (`docs/REVIEWER.md`); `decision-matrix` when choosing between options or scoring ideas; `ai-claim-checker` when verifying claims, as in audits; `game-design` for designing, scoring ideas and judging how something plays.
4. **Agents in `.claude/agents`** (sources in `docs/SKILLS.md`), each a fresh context the building session calls: `game-designer` before building a version or feature and to challenge a plan; `playtester` after building anything players see (habit 1, its report goes in the pull request); `ux-designer` for screens, flows and accessibility. They report; the calling session decides and writes.
5. **Write plainly**: short sentences, no em dashes, no emojis in prose, numbers and evidence over adjectives.
