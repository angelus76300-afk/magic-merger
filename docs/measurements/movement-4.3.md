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
