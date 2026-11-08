# Skills

Third party skills kept in `.claude/skills`, loaded by every Claude Code session on this repository. They are instructions an agent follows, so each one was reviewed before it was added (below), and any new one must be too.

## Where they come from

The built-in skills of [iflytek/skillhub](https://github.com/iflytek/skillhub) (commit `81a48b4`, 5 November 2026), copied as published with their licenses. SkillHub itself is a self-hosted skill registry (a Java server and a web app); only five of its 24 built-in skills fit this project.

| Skill                | License      | Why it is here                                                                                                                                                                                                                                                          |
| -------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend-design`    | Apache-2.0   | Interfaces and pages with a point of view instead of the three looks AI design falls into; a plan, a self-critique, then the build.                                                                                                                                     |
| `zero-slop`          | MIT          | Text players read and docs: finds formulaic wording with an offline standard library scorer (`scripts/slopscore.py`), then rewrites without inventing facts.                                                                                                            |
| `adversarial-review` | MIT          | Review by fresh subagents in three roles (a hostile reviewer with evidence, an independent auditor, a neutral judge) before merging; `scripts/check-report.mjs` checks that high severity findings carry a command that was run. Written in Chinese; it works the same. |
| `decision-matrix`    | MIT          | Weighted options, pre-mortems and ICE scores, for the planner and for choices in a version.                                                                                                                                                                             |
| `ai-claim-checker`   | CC-BY-SA-4.0 | Treating fluent text as claims to verify, for audits.                                                                                                                                                                                                                   |

## What was checked

1. The five `SKILL.md` files and `adversarial-review/references/prompt-templates.md` (what its subagents are told) read in full: no instruction to read secrets, send data out, install anything or call a remote service; `frontend-design` forbids reading hidden memory or earlier conversations, `zero-slop` forbids remote calls and persistent profiles, and `decision-matrix` forbids keeping a decision without being asked.
2. The other reference files, examples and the two data files (`zero-slop/data/*.json`, word and pattern lists) searched rather than read line by line, for links, secrets, tokens, install or delete commands and instructions to ignore earlier rules: only the upstream source links in each `NOTICE.md` came up.
3. The two scripts: `check-report.mjs` imports only `readFileSync` and reads the report it is given (its list of command names is what counts as evidence in a report, not something it runs); `slopscore.py` (about 2,000 lines) was searched for network, process and file writing calls and has none.
4. Left out: `plugin-scanner` (it installs a package from PyPI), and skills with no use here (weather, NDA triage, study planning, LinkedIn posts, meeting notes and others).

Linting and formatting skip `.claude/skills` so the files stay as published.

## Game design: adapted from Claude Code Game Studios

[Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) (commit `05ad7c8`, 19 October 2026, MIT, kept as `.claude/skills/game-design/LICENSE`) is a project template with 49 agents, 74 skills, 15 hooks and 14 rules for Godot, Unity and Unreal projects. Four files here are adapted from it, rewritten rather than copied:

| File                              | Adapted from                                         | Why it is here                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.claude/skills/game-design`      | `game-designer`, `systems-designer`, `balance-check` | The frameworks (MDA, the three loops, Self-Determination Theory, flow, Sirlin's degenerate play, tuning knobs) in this game's terms.             |
| `.claude/agents/game-designer.md` | `game-designer`                                      | A fresh context that designs a version or feature, scores ideas and challenges a plan before anything is built.                                  |
| `.claude/agents/playtester.md`    | `qa-tester`, `playtest-report`                       | Habit 1 of `CLAUDE.md` as a procedure: play at 390 by 844 on mock mode or a preview, check items' promises, report bugs with steps to reproduce. |
| `.claude/agents/ux-designer.md`   | `ux-designer`, `accessibility-specialist`            | A measured phone and accessibility checklist (tap targets, contrast, flashing, reduced motion, color alone) for screens and for 5.3.             |

### Why adapted, not installed

1. **It contradicts how this repository works.** Every agent's protocol is "ask the user before proposing, ask again before writing any file, the user makes every decision". Here the AI drives and the owner answers only the questions in `CLAUDE.md`. Installed as is, each agent would turn into a stream of questions for the owner.
2. **It is a whole project, not a plugin.** Its own `CLAUDE.md`, `settings.json` hooks (on every commit, push, read and write), path rules and `project.yaml` would collide with this repository's; all 74 skills read `project.yaml` through a hook script injected at load, and most write to `production/` and `design/gdd/`, folders this game does not have.
3. **Its engine assumptions do not apply**: Godot, Unity and Unreal specialists, gamepads, consoles. This is TypeScript, a Cloudflare Worker and a phone browser.
4. **Its own measurement argues for less process**: in its README, of four games built from one brief, the one built after writing 30 documents ranked last with two blind reviewers and a human playtest. What it had worth taking is the game design knowledge and the playtest method, not the studio hierarchy.
5. **This repository already has the rest**: a planner, risk classes, a reviewer and a Gate (`docs/DAILY.md`, `docs/REVIEWER.md`), the `adversarial-review` and `decision-matrix` skills.

### What was checked

The four source agents and the two source skills were read in full: no network calls, no secrets, nothing installed. The upstream skills begin with a shell command run at load (`!` + `bash .../yaml-helper.sh`); none of that is carried over, and the adapted files run no command when loaded. The agents use only the tools their frontmatter lists; `game-designer` cannot run commands or write files, and the other two may run commands but are told never to edit the repository, push or touch production.

Left out, with the reason: the directors and producer (the owner and the planner fill that role), the engine specialists (wrong stack), `economy-designer` and the combat and loot parts of `balance-check` (the game has no currency, combat stats or loot tables), the sprint, story, epic and release skills (`docs/DAILY.md` and the Gate do this), the hooks and rules (they would fire on every command and conflict with `scripts/risk.mjs`). Worth a second look later: `live-ops-designer` when daily challenges grow, `performance-analyst` for 5.2, `writer` for grimoire entries.
