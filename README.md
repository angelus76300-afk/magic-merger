# Magic Merger

An Infinite Craft style game about merging magic. Start with eight primal forces, drop one onto another, and Claude decides what they make. Every answer is frozen the first time, so the world has stable rules.

Coming in v1: a World tab where spells are cast on a tiny pixel world with tiny people.

1. Setup, API credit and deployment: [docs/SETUP.md](docs/SETUP.md)
2. Design decisions and the spell format proposal: [docs/DESIGN.md](docs/DESIGN.md)

## Layout

| Path | What |
| --- | --- |
| `src/` | Browser game: board, inventory, spell card |
| `worker/` | Cloudflare Worker: `/api/merge`, `/api/describe`, prompts, Claude calls |
| `shared/` | Types and primitives used by both |
| `migrations/` | D1 schema |
