# Working on Magic Merger

Every Claude Code session on this repository reads this first. All creation and coding is done by AI; the owner steers. The owner touches three things only:

1. **Questions from the sessions building an update**, asked with options and a recommendation.
2. **The morning brief** of the daily planner (`docs/DAILY.md`): what happened, what to try, what to decide.
3. **The game itself and its Ideas tab.**

Everything else is yours: checking, building, testing, reviewing, merging, deploying, watching, rolling back, and finding bugs and ideas before the owner does.

## Before anything: check where we are

Read `main`'s latest commits, the open pull requests, the branches with commits in the last day, and the Claude Code sessions working on this repository when you can list them. Never start what another session is building. Never edit files an open pull request touches unless that pull request is yours. The plan is `docs/ROADMAP.md` ("Next versions", numbered in the order to run them), the daily rules `docs/DAILY.md`, the backlog `docs/IDEAS.md`, the rules of the game `docs/DESIGN.md`.

## Finish the work yourself

1. Work on a new branch from `main`; open a pull request early.
2. Prove what you built: the repo's checks (`npm run lint && npm run format:check && npm run typecheck && npm run build && npm test && npm run test:worker`), a test that fails without your change, and for anything visible, frames at phone size (390 by 844) and a look at the pull request's preview.
3. Get it reviewed by someone who is not you: for anything beyond docs or a small fix, run the `adversarial-review` skill with fresh subagents (never a fork of yourself); fix what they can show.
4. When CI and all of the above are green: **merge it yourself** (squash), then **deploy from up to date `main`** (`npm run deploy`), open the live site at phone size and check what you changed. Never deploy production from a branch. If the live site breaks, roll back (`npx wrangler rollback`), then fix forward.
5. Say in the pull request what you did, what you checked, and what the owner can try.

## Ask the owner first, only for these

Keep working on everything that does not depend on the answer while you wait.

1. **Money**: a new running cost, a raised cap or budget, a change of model for calls players trigger.
2. **Players' data**: deleting it, rewriting it, or a migration that changes existing rows of players.
3. **Spells in bulk**: rewriting stored programs in bulk or bumping `PROGRAM_VERSION` (it once doubled the month's Opus spend in a day).
4. **Anything public**: a link, a post, a listing, a domain.

Pull requests opened by the feedback routine from the Ideas tab carry players' words into code; they still wait for the owner, as `docs/FEEDBACK.md` says.

## Habits

1. **Find bugs before the owner does**: play what you changed and what it touches, at phone size, for a few minutes; check that items do what their names and descriptions promise. A bug the owner finds first is a miss.
2. **Bring ideas as the game's designer**: add at least one idea of your own to `docs/IDEAS.md` per session, with the reasoning (what the player feels, what it adds, what it costs).
3. **Skills in `.claude/skills`** (sources and review in `docs/SKILLS.md`): `frontend-design` for any interface or page, so it has character instead of looking generated; `zero-slop` for text players read and for docs; `adversarial-review` before merging anything beyond docs; `decision-matrix` when choosing between options or scoring ideas; `ai-claim-checker` when verifying claims, as in audits.
4. **Write plainly**: short sentences, no em dashes, no emojis in prose, numbers and evidence over adjectives.
