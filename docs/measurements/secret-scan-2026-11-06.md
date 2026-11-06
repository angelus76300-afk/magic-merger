# Secret scan of the whole history, 6 November 2026

Before the repository goes public. Run in a Claude Code session with gitleaks 8.28.0 (the release binary from github.com/gitleaks/gitleaks), its default rules, on a full clone.

## What was scanned

- The clone unshallowed (`git fetch --unshallow`), then every branch and every pull request head fetched: `+refs/heads/*` and `+refs/pull/*/head`. 71 refs, 270 commits, 243 of them not merges.
- `gitleaks git --log-opts="--all"`: every commit's own diff.
- `gitleaks git --log-opts="--all -m"`: the same plus each merge's diff against each parent, so a key added while resolving a conflict is seen too.
- `gitleaks dir .`: the working tree of the branch, untracked files included.
- A second pass by pattern over `git log --all -p -m`: Anthropic keys (`sk-ant-`), GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), private key headers, AWS key ids.

## Result

```text
gitleaks git --log-opts="--all"     242 commits scanned, ~8.38 MB, no leaks found
gitleaks git --log-opts="--all -m"  269 commits scanned, ~11.94 MB, no leaks found
gitleaks dir .                      ~3.85 MB, no leaks found
```

The pattern pass found one distinct value, 6 times: `sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123`, the fake key `scripts/risk-test.mjs` uses to check that rule R13 catches a key in a diff (added in #44). It is not a key. gitleaks does not flag it because its entropy is too low.

## What a scan cannot see

- Secrets that were never committed: the Worker's secrets, the Actions secrets and the sessions' environment live outside git, which is why `docs/SETUP.md` section 7 asks to rotate the admin token anyway (it was reachable from preview code, ROADMAP 4.5.1a item 3).
- Text outside git: issue and pull request comments, and Actions logs, were not scanned. Actions masks the value of a registered secret in its logs; comments were not checked. GitHub's own secret scanning, once on (`docs/SETUP.md` section 7), scans issues and comments of a public repository too.
- Images in `docs/` were not read for text.
