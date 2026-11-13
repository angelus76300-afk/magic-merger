# The land's looks, fourth pass (5.2.5), 13 November 2026

This pass answers the owner's notes on pass 3:

- "we also need more details/shadows, since if we move to smoother terrain shapes instead of big blocks, we still need to be able to understand elevation"
- "the look of the first one is good in terms of shadow but the refinement and curves of the elevation are a bit too steep"
- "we still want that voxel look of lots of little cubes"

It stopped at a dev break, so only the hill and the shore have frames.

## What changed from pass 3

- **Gentler slopes.** A rise of one voxel now climbs evenly from a cell's middle to its side, with only a sliver of flat ground at the middle, so the slope is steady instead of steep.
  - Plants and houses still stand within an eighth voxel of their cell's height. The test measured 0.000 on three islands.
- **Pass 1's contrast on gentle slopes** (switch `relief`).
  - A slope of one voxel per cell is lit almost like a wall facing the same way. Those were the light and dark sides that made height easy to read with whole steps.
  - Hollows and the foot of a slope are in shade, with a thin darker line where a slope meets flat ground.
  - The ground is tinted by its height: low ground warmer and darker, high ground lighter and cooler.
- **Little cubes show.** A slope's tiny risers take the ground's colour but 60% of a wall's darker side, so every small cube's edge catches light and shade.
- **Rock cliffs** (switch `rocks`): strata one voxel thick in three tones, each band with a darker seam; a crack here and there; small ledges; a few boulders fallen at the foot. Cliffs of two or more voxels stay cliffs.

With every switch off, the land and water are main's, byte for byte.

## Frames

`*-390x844-pass1-pass3-pass4.jpg`: pass 1 (#151) on the left, pass 3 in the middle, this pass on the right. Views are the hill and the shore at 390 by 844, seed 7, the same spots for all three. Each pass was served from its own commit.

## Not done

The pass stopped at the owner's dev break, so these are still to do:

- triangle and draw-time numbers;
- the cliff and village frames;
- the frame at low sun with #149's shadows;
- the full `npm test`.
