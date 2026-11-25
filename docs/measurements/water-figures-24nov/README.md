# Figures on the water as drawn (24 November)

Close frames from `scripts/water-figures-frames.mjs`: the Perf Lab, medium temperate island of seed 7, 700 by 830, high, the simulation stopped. A villager is put in shallow water at cell (120, 99), 0.77 deep, and a dock of two planks is laid at (119, 97) and (120, 97). `before` is `main` at 4e4e18e, `after` is this branch. Both runs use `SPOT=119,99`.

|                                                   | before | after  |
| ------------------------------------------------- | ------ | ------ |
| villager's feet over the water drawn              | 0.188  | 0.000  |
| dock planks' underside over the water, west plank | 0.167  | -0.020 |
| dock planks' underside over the water, east plank | 0.203  | 0.006  |

The dock is meant to sit with its planks' underside 0.02 in the water (`afloat.ts` `DOCK_SINK`), as it did when the water was drawn at the cells' level. The east plank's 0.006 is not explained yet. Both planks read the same height (6.544), so the frames script may have matched the east cell to the west plank's instance (it takes the instance nearest each cell's middle). In the island-wide check, `dockBase` is within 0.05 of the water on 99.8% of cells.

- `wading-before.png`: the feet float over the water.
- `wading-after.png`: the feet are on the water.
- `dock-before.png`: the posts show in the air under the planks.
- `dock-after.png`: the planks lie on the water.

The numbers over whole islands are in `scripts/water-figures-test.ts`, which runs in `npm test`.
