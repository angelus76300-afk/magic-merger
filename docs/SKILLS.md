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
