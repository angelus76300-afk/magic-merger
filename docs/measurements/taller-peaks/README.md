# Taller peaks (5.2.5), 14 November 2026

The owner: "Terrain generation should also allow more verticality, volcanoes and mountains should go higher."

## What changes

Only islands made from now on change. They get `peaks: true` in their land options (`src/sim/frame.ts`, `freshIsland`).

- **Mountains.** The upper half of the island's relief is raised, more the higher it stands (`uplift` in `src/sim/land.ts`). Summits rise by up to half the island's peak again, and their upper slopes grow steeper. The lower half (shores, villages' ground, river valleys) is untouched. Mesas, plateaus and swamps are left as they were.
- **Volcanoes.** The cone rises to 1.6 of the peak (was 1.15) with steeper upper slopes. The crater is wider (0.22 of the cone, was 0.18) and its floor lies 5 below the rim (was 2.2).

| Island (seed)     | Highest dry ground, before → with taller peaks | Crater floor below the summit |
| ----------------- | ---------------------------------------------- | ----------------------------- |
| ridges (7)        | 37.7 → 53.6                                    |                               |
| tundra coast (11) | 41.1 → 59.9                                    |                               |
| volcanic (5)      | 33.1 → 46.9                                    | 8.3 → 22.2                    |

Heights are in height units; the land is drawn at half a scene unit per unit.

## What stays exactly as it was

- **Saved islands.** A save keeps its heights in the save itself, so a change to the generator cannot touch it. The golden save's heights hash the same.
- **Every challenge island** (the six of `src/sim/scenarios.ts`), **every lab**, and **every island made without `peaks`**: their heights hash byte for byte as on main before the change. That covers 51 islands: the six challenges, the golden save, an island of each of the 7 lands in each of the 6 shapes, and 3 mixed islands (`scripts/peaks-test.ts`, run by `npm test`).
- **The simulation's rules.** No tick, reaction or challenge code changed.

## Checked on islands with taller peaks

- **Villages still find flat ground.** Ridges seed 7 has 44 house cells with taller peaks (48 before), none on a step of two voxels or more. Rivers may run elsewhere off the taller summits, and villages move with them.
- **The director's shots frame the island.** Over 120 seconds of seed 7 with taller peaks there were 11 shots, with no empty air and no shot off the island.
- **Frames.** `*-390x844-before-taller.jpg`, left to right: the whole island before, then with taller peaks; the summit at the sky view's closer zoom before, then with taller peaks. The camera frames the taller summits at both zooms.
- **Perf Lab.** `peaks=1` makes an island as new islands are now made.
