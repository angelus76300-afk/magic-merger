// The island tells its stories (2026-11-11, src/sim/director.ts): a story line
// carries its place without changing the save, the director prefers what is
// going on, never shows the same thing twice in a minute, and an untouched
// island gives it something to show every second of six minutes.
import { makeCreature } from "../src/sim/creatures";
import { Director, nameOf } from "../src/sim/director";
import { MAX_HAPPENINGS, mindOf, tell, weightOf } from "../src/sim/kin";
import { saveWorld } from "../src/sim/save";
import { World } from "../src/sim/world";
import { watchIsland } from "./director-run";

type Check = (name: string, ok: boolean, detail?: string) => void;

function flat(): World {
  const world = new World(64, 64, 5);
  world.height.fill(10);
  world.time = 10;
  return world;
}

export function directorChecks(check: Check): void {
  // 1. A line with a place is a happening; a line without is only a line; the save holds neither.
  {
    const world = flat();
    tell(world, "a village opened its granary");
    check("stories: a line without a place is no happening", world.happenings.length === 0 && world.story.length === 1);
    tell(world, "a deer died, killed by the wolf", { x: 12, y: 30 });
    const h = world.happenings[0];
    check("stories: a line with a place is a happening there", world.happenings.length === 1 && h.x === 12 && h.y === 30 && h.weight === 3, JSON.stringify(h));
    tell(world, "a deer died, killed by the wolf", { x: 40, y: 8 });
    check(
      "stories: the same line again is one line of the story and two happenings",
      world.story.length === 2 && world.happenings.length === 2 && world.story[1].n === 2,
    );
    for (let k = 0; k < 60; k++) tell(world, `a villager finished house ${k}`, { x: 5, y: 5 });
    check("stories: at most forty happenings are kept", world.happenings.length === MAX_HAPPENINGS, String(world.happenings.length));
    check("stories: happenings are not saved", !JSON.stringify(saveWorld(world, new Map())).includes("happenings"));
    check(
      "stories: weights",
      weightOf("a child was born in the village") === 3 && weightOf("Ashby built a tavern") === 2 && weightOf("a villager left an offering") === 1,
    );
  }
  // 2. A hunt going on comes before a line about something over, and is framed with its prey.
  {
    const world = flat();
    const wolf = makeCreature("wolf", 20, 20);
    const deer = makeCreature("deer", 28, 20);
    world.creatures.push(wolf, deer);
    const m = mindOf(wolf);
    m.task = "hunt";
    m.target = deer;
    tell(world, "Ashby built a tavern", { x: 50, y: 50 });
    const d = new Director(() => 0.5);
    const { shot, cut } = d.update(world);
    check("director: the hunt is the shot", cut && shot?.kind === "drama" && shot.caption === "A wolf is hunting a deer", shot?.caption);
    world.time += 0.3;
    d.update(world);
    check(
      "director: hunter and prey are both in frame",
      !!d.shot && Math.abs(d.shot.x - 24) < 0.1 && d.shot.r >= 8,
      JSON.stringify(d.shot && [d.shot.x, d.shot.r]),
    );
    // The hunt ends: the shot is over within three seconds, and the tavern has its turn.
    m.task = "none";
    m.target = null;
    world.time += 7;
    d.update(world);
    world.time += 3;
    tell(world, "Ashby built a mill", { x: 50, y: 50 });
    const next = d.update(world);
    check("director: when the hunt is over the camera moves on", next.cut && next.shot?.kind === "news", next.shot?.caption);
    // Its subject dies: two seconds on what is left, no more.
    m.task = "hunt";
    m.target = deer;
    world.time += 70;
    d.update(world);
    const on = d.shot;
    wolf.dead = true;
    world.time += 0.3;
    d.update(world);
    check(
      "director: a dead subject is left within two seconds",
      on?.kind === "drama" && d.shot === on && on.until <= world.time + 2.01,
      String(on && on.until - world.time),
    );
  }
  // 3. The player's own cast is not news; the same subject is not shown twice in a minute.
  {
    const world = flat();
    tell(world, "a mage cast Fire", { x: 10, y: 10, weight: 0 });
    const d = new Director(() => 0.5);
    check("director: the player's own cast is not a shot", d.update(world).shot === null);
    const c = makeCreature("villager", 30, 30);
    world.creatures.push(c);
    tell(world, "a villager fought a bear", { x: 30, y: 30, who: c });
    const first = d.update(world).shot;
    world.time += 9;
    tell(world, "a villager fought a bear", { x: 30, y: 30, who: c });
    const again = d.update(world);
    check("director: not the same villager twice in a minute", first?.who === c.id && !again.cut, `${first?.caption} / ${again.shot?.caption}`);
    world.time += 61;
    tell(world, "a villager fought a bear", { x: 30, y: 30, who: c });
    check("director: again after a minute", d.update(world).cut);
    check(
      "director: a villager is told by name",
      !!first && first.caption.startsWith(nameOf(world, c)) && first.caption.endsWith("fought a bear"),
      first?.caption,
    );
    const name = nameOf(world, c);
    c.id += 1000;
    check("director: a name holds across a reload (ids change, the look and the home do not)", nameOf(world, c) === name && /^[A-Z][a-z]+$/.test(name), name);
    // Followed from its card: held until let go, whatever else happens.
    const pin = d.pin(world, c);
    world.time += 120;
    tell(world, "a child was born in the village", { x: 5, y: 5 });
    check("director: a creature followed from its card is held", d.update(world).shot === pin && !d.update(world).cut);
  }
  // 4. An untouched island, six minutes: always something to show, never the same twice.
  {
    const r = watchIsland(7, 360).summary;
    const text = JSON.stringify(r);
    check("director: something to show every second of six minutes", r.empty === 0 && r.off === 0, text);
    check("director: between 25 and 60 shots in six minutes", r.shots >= 25 && r.shots <= 60, text);
    check("director: no shot longer than 21 s", r.longest <= 21, text);
    check("director: no subject twice in a minute, no two alike in a row", r.repeats === 0 && r.alike === 0, text);
    check("director: at least four kinds of shot", Object.keys(r.byKind).length >= 4, text);
    check("director: most of what matters is seen (a birth, a kill, a wonder waking)", r.big >= 3 && r.bigSeen / r.big >= 0.6, text);
  }
}
