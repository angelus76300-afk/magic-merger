---
name: game-design
description: "Game design lenses for Magic Merger: what the player feels (MDA), the three loops, the needs a feature serves (SDT), flow and the first ten minutes, degenerate play, tuning knobs, and the promise an item's name makes. Use when designing a version or a feature, scoring or writing an idea for docs/IDEAS.md, judging whether a change makes the game better, or reviewing how a spell or item feels."
---

# Game design lenses

A short kit of proven game design frameworks, stated in Magic Merger's terms so a session does not start from a blank page. It never replaces the owner's taste: "What the owner likes" in `docs/IDEAS.md` is the list of pillars, and `docs/DESIGN.md` holds the rules already decided. Read both first. When a lens and a pillar disagree, the pillar wins and the tension goes to the owner as a question.

Adapted from the `game-designer`, `systems-designer` and `balance-check` files of [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) (commit `05ad7c8`, MIT, `LICENSE` in this folder). Its studio process (stories, sprints, director gates, `project.yaml`) is left out: this repository has its own (`CLAUDE.md`, `docs/DAILY.md`).

## 1. What should the player feel? (MDA)

Hunicke, LeBlanc and Zubek (2004): design backwards from the feeling (Aesthetics) to what players end up doing (Dynamics) to the rules we write (Mechanics). Start every design with the feeling, never with the system.

The eight aesthetics, and where Magic Merger stands:

| Aesthetic  | Weight here | Where it lives                                                         |
| ---------- | ----------- | ---------------------------------------------------------------------- |
| Discovery  | core        | every merge, First Discovery, a new island, a wonder                   |
| Expression | core        | casting anywhere in the World, shaping an island, naming nothing fixed |
| Fantasy    | core        | being a mage whose spells are real programs                            |
| Sensation  | high        | the show of a spell: light, sound, shake, tiny people reacting         |
| Fellowship | medium      | invite links, the Community tab, a friend's name on a discovery        |
| Challenge  | low         | the daily challenge, nothing else                                      |
| Narrative  | low         | grimoire entries, villagers' thoughts                                  |
| Submission | low         | an island left to live on its own                                      |

A feature that serves only a low row is a weak candidate. A feature that weakens a core row (a hint system weakens Discovery) is a strong no, whatever else it adds.

## 2. Which loop does it feed?

Every mechanic connects to at least one of three nested loops. If it feeds none, cut it.

1. **Micro, under 30 seconds**: drag two items, get a third. It must feel good by itself, and answer within half a second (or show a wait that is itself pleasant: the merge animation).
2. **Meso, 5 to 15 minutes**: a chain toward something wanted (a higher tier, a new kind), then casting it in the World and watching people react. Goal, effort, reward, then a new goal.
3. **Macro, a session and the return**: First Discoveries, the island that persists, the daily challenge, what's new. Each session needs a natural place to stop and a reason to come back tomorrow.

## 3. Which need does it serve? (Self-Determination Theory)

Deci and Ryan (1985). A lasting feature serves at least one:

1. **Autonomy**: real choices. Any pair can be merged, a spell can be cast anywhere. Watch for false choices, where one option always wins.
2. **Competence**: the player sees why something happened. A merge result should make sense from its two names; a spell should visibly do what it says.
3. **Relatedness**: villagers who react, friends whose names appear, a Community tab with real people.

## 4. Flow and the first ten minutes

Csikszentmihalyi (1990): keep the player between boredom and anxiety.

1. **Teach through play, not text.** The owner forbids hints and suggested recipes, so the first ten minutes must teach by their structure: early merges of the eight forces should mostly give new items, the first spell should come soon, and the World should answer the first cast loudly.
2. **A sawtooth, not a slope.** Tension builds through a chain, releases at a discovery or a cast, then starts again a little higher. Long flat stretches (ten merges that only give known items or loops) are where players leave.
3. **Feedback clarity.** Every action has a visible answer within half a second, and a meaningful one within the meso loop.
4. **Failure costs in proportion to frequency.** A loop result (a pair giving back an input) is frequent, so it must cost almost nothing and still feel like information. A reset of an island is rare and may cost more, with a clear warning.

## 5. Degenerate play (Sirlin, "Playing to Win")

Players optimise the fun out of a game if the rules let them. For every mechanic, write down the dominant or degenerate strategy and what stops it. Magic Merger examples to look for:

1. One spell that wipes or fills the whole island, so every island ends the same.
2. A spell that is strictly better than every other of its tier, so the rest are never cast.
3. Farming First Discoveries with nonsense pairs, or a merge that always lands on the same few attractor names.
4. A daily challenge solved by the same pair every day, or whose answer can be found outside the game.
5. Waiting being better than playing (a world that grows richer if left alone than if touched).

Healthy mastery (a player who learns which pairs make spells) is fine. Degenerate play is when the best move is also the least fun one.

## 6. Systems: reinforcing and balancing loops

Map what grows and what holds it back. A village that gets richer builds more houses that draw more villagers (reinforcing); food, monsters and spells hold it back (balancing). A reinforcing loop with no balancing loop runs away (every island turns into a city); a balancing loop with nothing to push it stalls (nothing ever changes). Name both for any living system you add.

## 7. Tuning knobs

Every number a feature adds is one of three kinds. Say which, give its range and the reason for its default, and keep it in one named constant, not scattered.

1. **Feel**: moment to moment (spell timings, particle counts, camera shake, merge animation length). Tuned by playing and looking at frames.
2. **Curve**: shape over time (tier thresholds, rarity of wonders, how often villages grow). Tuned with a small model or a simulated run (`scripts/balance-run.ts`, `npm run evolve`).
3. **Gate**: pacing and limits (daily challenge timing, per invite caps, burst guards). Caps that touch money are the owner's (`CLAUDE.md`, ask first).

## 8. The promise of a name

In this game the name and the grimoire entry are the design document of each item. "Meteor Storm" promises things falling from the sky and craters; "Healing Rain" promises rain and creatures getting better. A spell that does less than its name, or something else, breaks Competence and Fantasy at once. Check the promise every time an item is made, changed or shown, and treat a broken promise as a bug.

## Using the lenses

### Judging an idea or a feature

Answer these in a few lines each. The answers are the reasoning `docs/IDEAS.md` asks for.

1. **Feeling**: which aesthetic, and is it a core row?
2. **Loop**: micro, meso or macro, and what it adds there.
3. **Need**: autonomy, competence or relatedness.
4. **Pillars**: which owner preference it serves, and any it strains.
5. **Degenerate case**: the way to break it, and the guard.
6. **Cost**: sessions to build (S or M), and money per day if it calls Claude (red class, owner's yes).
7. **Measure**: one number that shows it worked, taken before and after (the owner likes measured, not guessed).

If two or more options compete, score them with the `decision-matrix` skill and recommend one.

### Designing a feature

Write, in this order, before any code: the feeling it targets, the rules precise enough to build from, the numbers with their knob kind and range, the edge cases (zero, maximum, two at once, offline, a phone at 390 by 844), the degenerate case, and how a playtest will tell whether it feels right. Short is fine; missing is not.

### Reviewing how something plays

Play it (the `playtester` agent does this at phone size), then go through sections 1 to 8 and report only what you can point to in a frame, a number or a line of code.
