# Quarter cubes for the shadow pass: measured and dropped (16 November)

The owner: "shadows: coarser far but shouldn't be observable".

## What was tried

The land cast the sun's shadow from its own mesh of quarter cubes, built in the background. The screen still drew eighths.

## How it was measured

- The Perf Lab on high at 700 by 830, dpr 1.
- The same frame drawn three ways: casting in eighths, eighths again (the noise), and quarters.
- Mid and whole views, by day (time 60) and with a low sun (time 194).
- The quarters were forced on at every texel size. At 700 by 830 a texel of the shadow map on the ground is only 0.09 to 0.19 cells, so a rule of "quarters only where a texel is a quarter cell or more" never switched on at all.

## Results

Differences are per channel, on a 0 to 255 scale.

| View, light | Mean diff | Noise mean | Max | Pixels off by more than 8 | Shadow pass triangles |
| ----------- | --------- | ---------- | --- | ------------------------- | --------------------- |
| mid, day    | 0.096     | 0.009      | 91  | 0.55%                     | 401k → 310k           |
| whole, day  | 0.128     | 0.008      | 134 | 0.69%                     | 923k → 697k           |
| mid, low    | 0.219     | 0          | 114 | 1.26%                     | 602k → 470k           |
| whole, low  | 0.124     | 0.010      | 159 | 0.62%                     | 844k → 667k           |

The mean difference is 10 to 20 times the noise. In the enlarged crops at the worst spots (`*-worst.jpg`: eighths on the left, quarters on the right), shading moves along shores and slopes. It fails #165's bar, so it was not shipped. The saving would have been 0.13 to 0.23M triangles a frame.
