# Magic Merger

An Infinite Craft style game about merging magic. Start with eight primal forces, drop one onto another, and Claude decides what they make. Every answer is frozen the first time, so the world has stable rules.

Every spell can then be cast in the World tab: a floating voxel island with villages, wildlife and wonders, where Claude writes each spell as a small program, tested before anyone casts it.

1. Setup, API credit and deployment: [docs/SETUP.md](docs/SETUP.md)
2. Design decisions, the spell format and the world rules: [docs/DESIGN.md](docs/DESIGN.md)
3. How ideas from the Ideas tab become pull requests: [docs/FEEDBACK.md](docs/FEEDBACK.md)

## Layout

| Path          | What                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`        | Browser game: board, inventory, spell card                                                                                                                     |
| `src/sim/`    | World tab: terrain physics, creatures, goals, spell casting, the voxel renderer (`src/sim/voxel/`)                                                             |
| `lab/`        | The Spell Lab and the bestiary pages, reference spells, legacy programs and solutions cast by `npm test`                                                       |
| `worker/`     | Cloudflare Worker: merges, descriptions, spell programs and their versions, votes, the judge, invites and the ledger, feedback, the API's growth, Claude calls |
| `scripts/`    | `npm test`, `npm run test:worker`, `npm run evolve`, the Spell Lab, the judge runner, measurements                                                             |
| `shared/`     | Types and primitives used by both                                                                                                                              |
| `migrations/` | D1 schema                                                                                                                                                      |
