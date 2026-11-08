# One file per pull request

A pull request adds its ideas, and its line for "Built", here as its own file, never by editing `docs/IDEAS.md`. Two pull requests then never touch the same lines. The planner's night run folds them in (`node scripts/fold-ideas.mjs`).

Name: `YYYY-MM-DD-<short-slug>.md`, one file per section. The first line names the section exactly as its heading in `docs/IDEAS.md`; the rest is added as written, at the end of that section, or at the top of "Built".

```
section: Quality of life
- **Search the inventory** by name and emoji (the designer's idea, 2026-11-08; lens: ...). What the player feels: ... Claude.
```

"Declined" is the owner's and never written from here. Moving an idea out of the backlog once it is built is still an edit of `docs/IDEAS.md` itself.
