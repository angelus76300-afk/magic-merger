# Program shapes of today (World API versions 4 to 6)

Programs written the way the spell writer writes them now, kept so `npm test`
casts them on every change (`scripts/programs-test.ts`) and checks what each
one visibly does, not only that it runs. `lab/legacy` holds versions 2 and 3.

Written by hand from the shapes of `lab/creatures`, `lab/artifacts` and the
examples in `worker/prompts.ts`, never copied from the production database.
Between them they call the 11 members of `w` that no other fixture or test
touched on 11 November 2026: `tier`, `dt`, `angle`, `noise`, `drain`,
`unvoxel`, `tower`, `wall`, `island`, `artifacts` and `draw`.

The first line of each file says its version and what the test expects.
