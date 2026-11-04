# A library of nature that keeps growing, measured (4.4.5, part C)

With the owner's report of 4 November on the land and the water (too much water, bad waves, land too elongated, too many cliffs, a weird sea), fixed in the same pull request. Rules in DESIGN.md, "A library of nature that keeps growing" and "The owner's report on the land and the water".

## The prompt and the three wonders it wrote

No Claude API key in the session's container, so the production call could not run there: the three wonders were written by stand-in writers on the models the rarity picks (Haiku for the uncommon one, Opus for the rare and the legendary), each given only the system prompt and the user message, and tested in Node.

| Draw                        | First prompt                                                                      | Second prompt (stored)                                             |
| --------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| uncommon, desert, drought   | rain spires: declared its artifact, never placed it: idle                         | dew towers: 226 to 242 voxels, acted on 2 islands of 3 (see below) |
| rare, tundra, night         | aurora spires: passed, but set "calm" on every creature near it (freezes them)    | aurora ice spires: 185 to 195 voxels, passed on 3 of 3             |
| legendary, swamp, full moon | moon lotus mire: about 7,700 voxels (six kit willows), full moons counted by hand | moon mire: 405 to 425 voxels, passed on 3 of 3                     |

The second prompt adds what things cost in voxels (measured below), that `spell.artifacts` places nothing without `w.artifact`, and that calm freezes creatures. Both Opus writers asked in both rounds for a full moon trigger ("missing"), which this part adds; the stored moon mire uses it (its moonbeam waited on "night, every 300" before, a one word change).

The dew towers act only where a field lies within their six cells or a villager comes for water: on island 41 neither happened in a day. Stored rejected, for the owner to judge (People, Wonders, "Put live").

What the kit costs, in voxels (`w.tree` and the rest cast on the Spell Lab island): oak of 12 301, willow of 18 1,558, giant tree of 30 3,394, crystal tree of 14 60, spire of 20 76, tower of 16 485, arch 10 cells wide 25, sphere of radius 3 123, box of 4 64, a disc of radius 5 of voxels 81.

The wonder test on the stored examples (a day and night from the morning of a full moon, size 152): aurora ice spires on tundra 3, 17, 41: +0.04 to +0.10 ms a tick, 13 to 15 deeds; moon mire on swamp 3, 17, 41: +0.06 to +0.08 ms, 2 to 8 deeds; villagers and animals within a few of the island without it. The broken first draft fails as idle.

## Cost, from the ledger

The live `spend` table on 4 November, the comparable calls: Opus programs through the Batch API mostly alone (`refresh`) 62 calls, $0.045 average, $0.058 at most; Opus big spells through the batch 39 calls, $0.039 average, $0.077 at most; Haiku programs 389 calls, $0.0017 average, $0.0043 at most. A wonder's input is about 2,800 tokens more than a spell's (its section and the list of wonders), $0.006 more on Opus at batch price: about $0.051 an Opus wonder ($0.083 at worst), $0.002 a Haiku one.

With the draw (common 35, uncommon 30, rare 25, legendary 10) and Opus from uncommon up: about $1.03 a month expected, $1.69 in a month where every Opus wonder costs its worst. The sort of a day's artifacts is about $0.001 (Haiku, one call). The cap holds $0.10 an Opus wonder and $0.01 a Haiku one before sending, so the month never passes `WONDER_BUDGET_USD` ($2).

## The HUD and the bench, before and after

Part B's setup (`scripts/perf-phone.mjs`, Pixel 7 sized headless Chromium, software WebGL, pixel density 1, two runs per line, `mixed=1`). Before: main at edcae27 (part B); after: this branch. Raw lines: `wonders-4.4.5-c-before.jsonl` and `wonders-4.4.5-c-after.jsonl`.

| Island           | HUD sim p50 / p95 | HUD calls | HUD triangles | bench tick p50 / p95 | bench draw p50 / p95 | parts   |
| ---------------- | ----------------- | --------- | ------------- | -------------------- | -------------------- | ------- |
| Medium 7, before | 1.6-1.7 / 3.5-4.7 | 41-48     | 62-79k        | 1.6 / 1.9-2.0        | 1.7-2.0 / 3.1-3.5    | 228-436 |
| Medium 7, after  | 1.5 / 3.1-3.8     | 44-50     | 64-77k        | 1.5-1.6 / 1.9-2.4    | 1.7-1.9 / 3.0-3.3    | 223-369 |
| Medium 3, before | 1.4-1.5 / 1.8-2.7 | 49-55     | 86-96k        | 1.4 / 2.1-2.3        | 2.1-2.5 / 3.4-4.4    | 196-212 |
| Medium 3, after  | 1.3-1.4 / 2.3-2.9 | 44-53     | 76-95k        | 1.2 / 1.6-1.9        | 2.0-2.6 / 3.6-4.9    | 200-227 |
| Large 7, before  | 5.6-5.9 / 13-15   | 52-70     | 118-140k      | 3.1-3.2 / 3.7-4.7    | 2.8-3.1 / 5.5-5.7    | 206-326 |
| Large 7, after   | 5.3-5.6 / 12-14   | 52-67     | 121-137k      | 2.8-3.0 / 3.5-3.8    | 2.6-3.4 / 4.9-6.0    | 328-367 |
| Large 3, before  | 7.3-9.5 / 14-15   | 65-80     | 232-274k      | 2.7-2.8 / 3.3-4.7    | 3.6-3.9 / 7.6-8.5    | 269-382 |
| Large 3, after   | 6.8-8.2 / 15-16   | 62        | 251-264k      | 2.9 / 3.8-4.9        | 3.7-4.1 / 7.2-7.6    | 291-366 |

What it says: everything is within the runs' spread (about 10%), the simulation a little lighter on most lines (less water to move). The new waves are a few operations per water pixel, with no geometry, texture or draw call; the sea's color per corner and its new clearness are computed when a chunk is built, not each frame.

An island with a program wonder (medium 20, tundra, with the aurora ice spires from the pool, against the same seed without the pool, where a built-in wonder stands instead): 187 voxels; HUD calls 34-40 against 41-46 and triangles 56-64k against 69-74k (a program wonder has no box model); bench tick 1.4 / 2.0-2.1 against 1.4-1.5 / 2.1-2.4.

## The land, before and after

Twelve mixed islands per size (seeds 7 to 18, warmth and water going round, as `land-gallery.ts` makes them). Water: every cell under water; inland: water not joined to the sea; cliffs: land cells with a neighbor (its surface, water included) two voxels or more lower.

| Size   | Water, before / after | Inland water | Cliffs of 2+ | Cliffs of 4+ | Rock          |
| ------ | --------------------- | ------------ | ------------ | ------------ | ------------- |
| Medium | 31.1% / 26.6%         | 2.7% / 2.5%  | 12.8% / 4.8% | 1.8% / 1.0%  | 15.0% / 10.1% |
| Large  | 32.2% / 26.1%         | 3.7% / 2.8%  | 12.0% / 2.5% | 2.1% / 0.3%  | 13.5% / 6.9%  |
| Huge   | 34.2% / 25.8%         | 5.4% / 3.4%  | 12.6% / 1.6% | 2.3% / 0.1%  | 14.9% / 6.4%  |

The Huge islands seen from above show what the numbers do not: before, the ridge islands (four of twelve) were bands of land and sea, worm shaped, with dozens of inland seas; after, they are lands with ranges, a few lakes and their rivers.

## The frames

`docs/visual-checks/4.4.5-c/`:

- `seed3-`, `seed7-` and `seed21-before-after.jpg`: up close, then from above, before on the left (medium, as the game makes them).
- `ten-islands-before.jpg` and `ten-islands-after.jpg`: seeds 1 to 10, medium, from above at an angle.
- `huge-from-above-before-after.jpg` and `medium-from-above-before-after.jpg`: twelve mixed islands seen straight down, before on top.
- `sea-before-after.jpg`: the sea and a beach up close: the seabed's steps showed through the open sea as a grid and depth changed by tile; now the open sea is one smooth body, clear only in the shallows.
- `waves-lake.jpg`: the new waves on a Huge island's lake: thin curved crests broken by a mask, read on a quarter-cell grid.
- `program-wonders.jpg`: the aurora ice spires (tundra 20) and the moon mire (swamp 28), by day and by night.

What the frames say, honestly: the land now reads as land at every size, and the sea as water rather than glass over a staircase. The two program wonders hold up from a distance but up close are clusters of tall voxel pillars, chunkier than the built-in box models: the kit's `w.spire` is coarse. The judge's advice on them comes with the first nightly run; if it agrees, the next prompt change should steer wonders toward shaping the land and fewer, finer voxels.

## Found on the way

- Water tops on a gently sloping river (0.03 a cell, common on the softened land) judged their waves against their own level: two tops sharing a corner disagreed and opened a hairline gap (18 corners on the test lake). A corner is now judged from its four cells only (`npm test` checks it).
- The frozen waterfall's check heated a 5 by 5 square, which thawed it only while the land round it was already warm; on the softer land it stood in colder air. The check now heats a disc of radius 4, most of the cold it keeps; the wonder's rule is unchanged.

## How to measure again

```bash
npx vite --port 5174 &
RUNS=2 node scripts/perf-phone.mjs medium 8 "dpr=1&mixed=1&seed=7"
RUNS=2 node scripts/perf-phone.mjs large 8 "dpr=1&mixed=1&seed=3"
RUNS=2 node scripts/perf-phone.mjs medium 8 "dpr=1&mixed=1&seed=20&pool=1"
MIXED=1 node node_modules/.cache/land-gallery.mjs huge.rgb 288 7
node scripts/perf-shots.mjs /tmp/shots "aurora:mixed=1&seed=20&pool=1&dpr=1&time=265&tx=29&ty=51&dist=0.16&phi=0.8"
```

`pool=1` (part C) hands the Perf Lab's new island the live wonders of `lab/wonders`.
