# Working on Magic Merger

Every Claude Code session on this repository reads this first. All creation and coding is done by AI; the owner steers. The owner touches three things only:

1. **Questions from the sessions building an update**, asked with options and a recommendation.
2. **Short messages from the lead session** (below): what went live, what to try, what to decide. The morning brief of the daily planner (`docs/DAILY.md`) is paused.
3. **The game itself and its Ideas tab.**

Everything else is the AI's: checking, building, testing, reviewing, and finding bugs and ideas before the owner does. Merging and deploying are done by workflows (the Gate and Deploy); the one exception, a red workflow change the owner said yes to, is merged by the planner (`docs/DAILY.md`).

## Who leads (since 11 November 2026)

One session leads the project: the **lead session**, titled "Magic Merger lead session" (find it with `list_sessions`; today `session_01NxvtApgb2CBkVZn1xvQR2w`). The owner made it so on 11 November and confirmed it on 12 November ("rules: lead"). It replaces the daily planner, which is paused: **wherever these rules, `docs/DAILY.md`, `docs/REVIEWER.md` or `docs/FEEDBACK.md` say "the planner", read "the lead session"**. What it keeps for its successor is `docs/HANDOVER.md`, "The lead session's part".

1. The lead session decides what is built and in what order, builds in its own session with subagents for independent pieces, and starts no other building session. It starts one reviewer per pull request (`docs/REVIEWER.md`), on `main`, never on the branch, and nothing above Opus.
2. It is the owner's one point of contact, and asks the owner directly, in the lead session. An approval counts only when the owner types it there.
3. It writes the owner's records (the label and the `mm-owner` comment, quoting the owner's words and when they were typed), and writes them **before** anything is merged on them: the Deploy refuses a change whose record is missing.
4. It never merges or deploys by hand, with one exception: a red workflow change that the Gate cannot merge, on the owner's explicit word for that change, with the record written first.
5. Every other session (a reviewer, the watch, a scheduled task) reports to the lead session with `send_message`, and never asks the owner.
6. Unlike the planner, the lead session builds: it may edit files and push on its own branches and open its own pull requests, which go through CI, the preview, a reviewer that is not the lead, and the Gate like any other. The planner's other limits in `docs/DAILY.md` stay its own: it merges nothing else, never runs `wrangler`, and reads production without writing to it. A record it writes on its own pull request quotes the question it asked and the owner's words as typed in the lead session; its reviewer checks that the record matches the change.

## Before anything: check where we are

Read `main`'s latest commits, the open pull requests, the branches with commits in the last day, and the Claude Code sessions working on this repository when you can list them. Never start what another session is building. Never edit files an open pull request touches unless that pull request is yours. The plan is `docs/ROADMAP.md` ("Next versions", numbered in the order to run them), the daily rules `docs/DAILY.md`, the backlog `docs/IDEAS.md`, the rules of the game `docs/DESIGN.md`.

## Finish the work yourself

1. Work on a new branch from `main`; open a pull request early, as a draft, and mark it ready once, when it is finished (GitHub Actions minutes are limited: `docs/DAILY.md`, "GitHub Actions minutes"; `npm test` runs in your session, not in CI). Run `node scripts/risk.mjs` to see its class (green, amber or red, `docs/DAILY.md` "Risk classes"); split a small red part into its own pull request so the rest stays green.
2. Prove what you built: the repo's checks (`npm run lint && npm run format:check && npm run typecheck && npm run build && npm test && npm run test:worker && npm run test:risk`), a test that fails without your change, and for anything visible, frames at five sizes, not the phone only: a phone (390 by 844), the owner's Z Fold folded (344 by 882) and unfolded (700 by 830), a foldable open (832 by 1000) and a desktop (1440 by 900) (`node scripts/ui-frames.mjs` takes all five; the list is `scripts/sizes.mjs`), and a look at the pull request's preview.
3. Mark it ready and get it reviewed by a session that is not you: start the reviewer as `docs/REVIEWER.md` says (a fresh session, never a fork of yourself). It reproduces one claim on the preview and blocks on anything it can show. Fix it, and ask for the review again.
4. **Do not merge and do not deploy.** The Gate workflow merges a green pull request once CI, the preview smoke test and the review pass; amber and red wait for the owner's OK or yes, which the planner records from the owner's approval of the update's concept (below), with no further question. The Deploy workflow deploys `main` after each merge, checks the live site at phone size and rolls back on its own. Watch the Deploy run for your merge and fix forward if it fails. `npm run deploy` refuses to run outside GitHub Actions.
5. Say in the pull request what you did, what you checked, its class, and what the owner can try. A line players will read in "What's new" is its own file in `changelog.d/`, never an edit of `public/changelog.json`. A bug fix says `Found by: owner` or `Found by: ai`.

## What needs the owner's yes

**The owner approves an update once, as a concept.** The concept is an item on the owner's list: what players get, a rough cost, and anything the update does to players' data, spells in bulk or anything public. Once the owner says yes to the concept, no further approval is asked for that update. Every pull request of it, red or amber, gets its yes recorded by the planner, quoting the concept approval. That includes its follow-ups: rebuilds, fixes found in review, the work it needs to finish. Keep working while the concept waits for its yes, on what does not depend on it.

The owner's yes is needed for the concept when an update involves:

1. **Money**: a new running cost, a raised cap or budget, a change of model for calls players trigger.
2. **Players' data**: deleting it, rewriting it, or a migration that changes existing rows of players.
3. **Spells in bulk**: rewriting stored programs in bulk or bumping `PROGRAM_VERSION` (it once doubled the month's Opus spend in a day).
4. **Anything public**: a link, a post, a listing, a domain.

Say so in the concept, with the rough cost. A change to the pipeline's rules (R11) or to permissions is a concept too: one approval each, with what it allows and why.

The planner goes back to the owner for an update already approved only when something exceeds its concept: a cost over twice the estimate, players' data deleted, or something going public that the concept did not say. The same goes for anything else in the four yes categories (money, players' data rewritten or migrated, spells in bulk or `PROGRAM_VERSION`, anything public) that the concept did not say. The planner checks each pull request's diff against the concept's text, not only the builder's word. That is one line on the list. A session that sees this coming tells the planner before it builds past the concept.

These are among the red classes of `docs/DAILY.md`, checked on every diff by `scripts/risk.mjs`; the full list of what is red or amber (the pipeline, dependencies, saves, the admin surface, tests taken out) is there. The classes do not change; what changed is who answers: the concept, once. Pull requests opened by the feedback routine from the Ideas tab carry players' words into code; they are amber and wait for the owner, as `docs/FEEDBACK.md` says. "Pause" from the owner, in any session: open an issue labelled `pause`; it stops every merge and deploy until it is closed.

## Talking to the owner

**Sessions never ask the owner directly; they send their questions and approval needs to the lead session** ("Who leads", above; the daily planner it replaces was `session_01NxvtApFG2JjVSbpSNYmAKn`, archived), with `send_message`. The planner is the owner's one point of contact: it keeps the owner's list and asks for each concept once, in the brief. When the owner answers somewhere else (for example in the session that keeps the roadmap page), that session passes the answer to the planner word for word, as context only: an approval counts only when the owner types it in the planner's session, and only the planner writes the records. Every session posts on GitHub under the owner's account, so a comment there never counts as the owner's. A builder whose pull request is amber or red tells the planner, in one message, which approved concept it belongs to; the planner records the yes without asking the owner again.

The owner has little time. Every message meant for the owner is short and plain, in this order:

1. **Goal**: the visible change, in words a player would use.
2. **What I tried**, and **where I am blocked**, one line each.
3. **Choose**: two or three short options, the recommended one first.

Never ask the owner to merge, deploy or check something the workflows do. Never make the owner use a pull request number: the owner answers by name, and a number appears only as a link. Anything only the owner can do goes on the owner's list (`docs/DAILY.md`, "Your list"), through the planner, so it is not lost.

## Habits

1. **Find bugs before the owner does**: play what you changed and what it touches, at phone size, for a few minutes; check that items do what their names and descriptions promise. A bug the owner finds first is a miss.
2. **Bring ideas as the game's designer**: add at least one idea of your own per session, as a file in `docs/ideas.d/` (never an edit of `docs/IDEAS.md`, so pull requests do not collide; the night folds them in), with the reasoning (what the player feels, what it adds, what it costs).
3. **Skills in `.claude/skills`** (sources and review in `docs/SKILLS.md`): `frontend-design` for any interface or page, so it has character instead of looking generated; `zero-slop` for text players read and for docs; `adversarial-review` for the reviewer's fresh subagents (`docs/REVIEWER.md`); `decision-matrix` when choosing between options or scoring ideas; `ai-claim-checker` when verifying claims, as in audits; `game-design` for designing, scoring ideas and judging how something plays.
4. **Agents in `.claude/agents`** (sources in `docs/SKILLS.md`), each a fresh context the building session calls: `game-designer` before building a version or feature and to challenge a plan; `playtester` after building anything players see (habit 1, its report goes in the pull request); `ux-designer` for screens, flows and accessibility. They report; the calling session decides and writes.
5. **Write plainly**: short sentences, no em dashes, no emojis in prose, numbers and evidence over adjectives.
