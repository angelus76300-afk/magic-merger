# Magic Merger

An Infinite Craft style game about merging magic. Start with eight primal forces, drop one onto another, and Claude decides what they make. Every answer is frozen the first time, so the world has stable rules.

Every spell can then be cast in the World tab: a falling sand pixel world with tiny villagers, where Claude designs how each spell looks and what it does, once.

1. Setup, API credit and deployment: [docs/SETUP.md](docs/SETUP.md)
2. Design decisions, the spell format and the world rules: [docs/DESIGN.md](docs/DESIGN.md)

## Layout

| Path          | What                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| `src/`        | Browser game: board, inventory, spell card                                            |
| `src/world/`  | World tab: terrain physics, creatures, spell casting, renderer                        |
| `worker/`     | Cloudflare Worker: `/api/merge`, `/api/describe`, `/api/spell`, prompts, Claude calls |
| `shared/`     | Types and primitives used by both                                                     |
| `migrations/` | D1 schema                                                                             |
