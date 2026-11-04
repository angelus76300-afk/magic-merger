# How creatures move, before and after 4.3 (2026-11-04)

Players see deer going back and forth. Everything here is measured in Node by `npm test` (section "motion") and `scripts/motion-run.ts`, on an island of 112 cells as a new player gets it, two simulated minutes from the start of the day, seeds 3, 6 and 9, with the meter of `src/sim/motion.ts`. No API call, no prompt involved.

## What is counted

1. **A sharp turn**: the heading of the creature's step (where it actually went this tick) changes by more than 150 degrees within half a second. A creature shaking on the spot reverses every tick; it counts once per half second, so the count is of half seconds with a reversal in them.
2. **Natural or flip-flop**: a turn is natural when the creature finished something in that half second (a task done, a wander point reached, a catch, a load delivered, treasure taken). Any other sharp turn is a flip-flop: a decision taken back, or steering that cannot make up its mind.
3. **Where it comes from**: the branch of `updateCreature` that drove the step (`flee` is the declared behavior of deer and rabbits, `social:fear` the threat seen by `social.ts`, `pursue:<task>` a goal of `goals.ts`, `plan` the old wandering), written `a>b` when the drive changed within the half second.
4. **Intent flips**: the same count on the direction the mind asked for, before any obstacle. It tells a dithering mind from dithering steering, and it cannot be hidden by smoothing the motion.
5. **Stuck**: seconds in which a creature wanted to walk and moved less than a quarter of its step. **Action changes**: changes of the drive, per minute.

All rates are per minute of creature life awake. The first reading the owner had (deer 15.5, rabbits 9.3, birds, villagers and boars about 6.5) came from a coarser counter; this one counts the same thing per tick, and lands in the same order: deer first, rabbits second, then the rest.

## 1. Before any change (`main` at 7d8e475, meter only)

| Kind     | Sharp turns | Natural | Flip-flops | Intent flips | Stuck, s/min | Action changes |
| -------- | ----------: | ------: | ---------: | -----------: | -----------: | -------------: |
| deer     |        20.4 |     3.4 |       16.9 |         14.9 |         15.2 |           57.2 |
| rabbit   |        17.6 |     6.4 |       11.2 |         10.0 |          9.0 |           63.6 |
| bird     |        11.4 |    10.3 |        1.1 |          1.1 |          0.0 |           73.2 |
| boar     |         8.8 |     4.9 |        3.8 |          1.7 |         14.1 |           39.6 |
| bear     |         7.8 |     4.9 |        2.9 |          1.4 |         15.8 |           35.5 |
| villager |         5.4 |     1.3 |        4.1 |          3.0 |         11.8 |           23.5 |
| fish     |         0.2 |     0.2 |        0.1 |          0.3 |          1.0 |           13.7 |

### Where the deer's 16.9 flip-flops a minute come from

| Family                                                 | Per minute | Share | Main keys                                                               |
| ------------------------------------------------------ | ---------: | ----: | ----------------------------------------------------------------------- |
| Fear switching on and off at one distance              |        8.3 |   49% | `pursue:roam>flee` 3.1, `flee>pursue:roam` 1.6, `pursue:graze>flee` 1.2 |
| Within a flight: the way out chosen again every tick   |        3.7 |   21% | `flee` 2.6, `social:fear` 1.1                                           |
| Within one action: the side step around obstacles      |        3.5 |   20% | `pursue:roam` 2.4, `pursue:herd` 0.6                                    |
| Two decisions in one breath (a goal done, then `plan`) |        1.3 |    7% | `plan>pursue:roam` 0.6, `pursue:roam>plan` 0.5                          |

Rabbits split the same way (44% fear thresholds, 26% steering, 16% within a flight). Villagers, boars and bears are the other way round: two thirds of their flip-flops are steering (`plan`, `pursue:plant`, `pursue:roam` against a wall), the rest two decisions in one breath. Birds' turns are 90% natural by this definition: they reach a random roam point every few seconds and pick the next one anywhere around them, which is natural by the letter and still looks like a bird changing its mind.

### The mechanisms, read in traces (`TRACE=deer`)

1. **One distance for fear and calm.** `behave` (flee) looks every 0.3 to 0.5 s for a villager, a wolf or a bear within 8 cells and lets go at the next look once none is; `social.ts` sees a threat within 9 cells and forgets it as soon as it is past 9. In between, the deer's goal (a roam point, a bush) is usually on the far side of what scared it, so it walks straight back into range: roam, flee, roam, flee, every second or so. Seed 6, deer #38, by the bear: `pursue:roam>social:fear` twelve half seconds in a row at 8.8 cells.
2. **The way out is chosen every tick.** `fleeFrom` scores eight directions from where the deer stands; a step of 0.2 cells changes which one wins, and near trees two opposite directions win in turn. The deer shakes in place.
3. **The side step.** When the cell three steps ahead is blocked, the creature steps sideways at a right angle for one tick, then forward again: a zigzag of 90 degree steps, and when both are blocked, it does not move at all until `unstick` teleports it after 3 s. That is most of the stuck time (deer 15 s a minute, a quarter of their life).
4. **A gap between two decisions.** A finished task leaves the mind with nothing until its next thought (0.5 to 0.85 s later); for that gap `updateCreature` falls through to `plan`, which walks toward a random point, then the new goal points elsewhere.
5. **Nothing has inertia.** Position is moved by speed times direction each tick with no velocity, so any change of decision is an instant change of heading: there is nothing between a deer's mind and its legs that would make a reversal take time.

## 2. After 4.3

Same meter, same islands and seeds (`npm test`, section "motion"):

| Kind     | Sharp turns | Natural | Flip-flops (before) | Intent flips (before) | Stuck, s/min (before) | Hops, a minute (before) | Action changes (before) |
| -------- | ----------: | ------: | ------------------: | --------------------: | --------------------: | ----------------------: | ----------------------: |
| deer     |         3.3 |     2.9 |      **0.4** (16.9) |            0.3 (14.9) |            0.0 (15.2) |               0.7 (5.9) |             52.8 (57.2) |
| rabbit   |         4.0 |     2.9 |      **1.1** (11.2) |            0.6 (10.0) |             0.3 (9.0) |               0.4 (3.7) |             45.2 (63.6) |
| boar     |         2.0 |     1.4 |       **0.6** (3.8) |             1.9 (1.7) |            0.0 (14.1) |               0.2 (6.4) |             43.4 (39.6) |
| villager |         2.1 |     1.7 |       **0.4** (4.1) |             0.3 (3.0) |            0.3 (11.8) |               1.9 (4.8) |             26.4 (23.5) |
| bird     |         1.2 |     1.0 |       **0.2** (1.1) |             0.2 (1.1) |             0.0 (0.0) |               0.0 (0.0) |             51.1 (73.2) |
| bear     |         0.2 |     0.0 |       **0.2** (2.9) |             0.2 (1.4) |            0.0 (15.8) |               0.2 (6.5) |             34.9 (35.5) |
| fish     |         0.1 |     0.0 |       **0.1** (0.1) |             0.2 (0.3) |             0.1 (1.0) |               0.0 (0.0) |             10.4 (13.7) |

Hops before were measured with the same rule on `main` by a separate script (the meter of the first commit did not count them). The deer's natural turns are now mostly a wander point reached (1.7 a minute), a danger first seen (0.6) and a flight point reached (0.4). The deer's flip-flops on other seeds, the same two minutes: 1.1 (seeds 1, 2, 4), 0.8 (5, 7, 8), 0.6 (10, 11, 12), 0.5 (13, 14, 15); the rule in `npm test` is under 2, so a regression shows and luck does not.

### What fixed what

| Before                                                                | Fix                                                                                                      | Where                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------ |
| Fear on and off at one distance (49% of deer flip-flops)              | Alarmed at its sense, calm past 1.7 times it and after 3 s out of sight, remembered where it was         | `flight.ts`, `social.ts` |
| The way out chosen every tick (21%)                                   | Twelve ways walked in short steps, chosen once a second with points for its heading, trees and the herd  | `flight.ts`              |
| The right angle side step, and stuck against trees (20%, 15 s a min)  | Heading and speed, feelers that read slopes, a sticky side, flow fields when the straight way is blocked | `steer.ts`, `paths.ts`   |
| A random walk between two tasks (7%)                                  | The next task thought of in the same tick                                                                | `goals.ts`               |
| Wandering off alone and pulled back by the herd (found after the fix) | A herd roams ahead of its middle, the way it is going                                                    | `goals.ts`               |
| A field that said "no way" where a step was just climbable            | Fields climb 1.55 at most, creatures 1.6; beyond a field's reach a creature only walks on                | `paths.ts`, `steer.ts`   |

Three dead ends on the way, kept here so nobody tries them again: a separation push straight back turned villagers round in lanes (now sideways only); dropping a task the field could not reach, every tick, made a deer take up and drop its herd thirty times a second (now not more than every half second, and a herd beyond water is not sought for 8 s); and a meter that counted every reversal tick by tick read a deer shaking in place as 30 sharp turns a second (now once per half second).

## 3. The rest of the island

1. **The five minute scene** (`npm test`, three streams): populations hold, every creature that lived five minutes changed something (71 to 72 of 72), and wolves caught 4, 2 and 4 deer (on main 0, 3 and 4, measured by the same count).
2. **Herds, flocks, packs** (`npm test`): five deer by a wolf all take one leader's alarm and run the same way (their headings agree at 0.86, where 1 is all as one); three wolves on one deer spread up to 163 degrees round it; birds on the wing beside another flying the same way 250 of 588 bird-seconds on a medium island in 90 s, against 6 of 589 on main.
3. **Challenges**: every challenge is solved on seeds 101, 202 and 303 by its plain solution, and wins at least half of 12 seeds. The lava challenges win 9 of 12 here; on main, lava road and the great eruption 9, racing lava 6 (lost on 101).
4. **Cost** (`scripts/prof-life.ts`, large island, median of three interleaved runs, ms per tick p50 / p95):

| Scene        | Creatures, main | Creatures, 4.3 | Whole tick, main | Whole tick, 4.3 |
| ------------ | --------------- | -------------- | ---------------- | --------------- |
| As generated | 0.36 / 1.02     | 0.69 / 1.52    | 3.13 / 6.40      | 3.18 / 5.00     |
| With guests  | 0.45 / 1.31     | 0.77 / 1.45    | 3.71 / 7.22      | 3.45 / 5.12     |

Steering and flow fields cost about 0.3 ms p50 of creature time (the flow fields' share is in "life": 0.14 ms p50); `stepTemperature` now reads its material tables by id instead of by name three times a cell, which takes more off the tick than the steering adds. The whole tick's p95 is within the HUD numbers of 3.6 (5.76 and 6.56).

## 4. To see it

`docs/visual-checks/deer-before-after.jpg`: one deer, a bear set down 7 cells away, on main and on 4.3, in the real renderer, a frame every 1.5 s and its trail (`node scripts/deer-clip.mjs`, see the script for the main worktree). Before: a zigzag back and forth, 6 sharp turns in 12 s. After: one straight flight away from the bear, one turn at the lake shore, then it walks on calm: 1 sharp turn. `docs/visual-checks/gaits.png`: walk, run, graze and lie down in the bestiary.
