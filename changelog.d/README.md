# One file per pull request

A pull request that players will notice adds its line for "What's new" here, as its own file, never by editing `public/changelog.json`. Two pull requests then never touch the same lines, and neither waits for the other.

Name: `YYYY-MM-DD-<short-slug>.json`. Content: one entry, on as many lines as you like.

```json
{ "date": "2026-11-08", "text": "Shields now hold against meteors of their own strength.", "idea": 2 }
```

Fields: `date` and `text` are required; `version` and `idea` (the Ideas tab id it built) are optional. The build joins these files with `public/changelog.json`, newest first (`joinChangelog` in `shared/changelog.ts`, run by `vite.config.ts`); a file that is not a valid entry stops the build.
