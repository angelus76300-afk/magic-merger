// Building sites (4.9 part 2, src/sim/sites.ts): a house or a building with
// a job staked, paid, raised in four stages and finished; fire and blasts;
// saves; the view's stages; and whole islands, with and without sites.
import { populate, resetCreatureIds } from "../src/sim/creatures";
import type { Village } from "../src/sim/kin";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { C, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { explode, stepPhysics } from "../src/sim/physics";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { JOBS } from "../src/sim/buildings";
import { SITE, canStake, cellsOf, kindName, checkSites, logsLeft, siteLine, siteTotal, stageOf, stake, work } from "../src/sim/sites";
import { stepHeadless } from "../src/sim/tick";
import { houseShape, siteShape } from "../src/sim/voxel/buildings";
import { World, generateWorld } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

// A flat green island with one village and its settlement, on an island of
// 4.4.5 and later (flora set).
function flat(w = 48, h = 48): { world: World; v: Village } {
  const world = new World(w, h, 5);
  world.height.fill(10);
  world.flora = new Uint8Array(world.n);
  world.time = 10;
  const v: Village = { x: 24, y: 24, food: 10, wood: 30, gold: 3, people: 8, houses: 4 };
  world.villages = [v];
  world.settlements = [{ x: 24, y: 24, name: "Ashby", style: 0, level: 1, jobs: [] }];
  return { world, v };
}

const top = (boxes: { y: number; h: number }[]) => Math.max(...boxes.map((b) => b.y + b.h));

export function sitesChecks(check: Check): void {
  // 1. A house staked, worked through its four stages, and finished.
  {
    const { world, v } = flat();
    const i = 20 * 48 + 20;
    const s = stake(world, i, C.HOUSE, SITE.houseWood);
    const cells = cellsOf(world, i);
    const staked = cells.every((j) => world.cover[j] === C.SITE);
    const stages: number[] = [];
    const piles: number[] = [];
    let done: string | null = null;
    for (let t = 0; t < 40 && world.sites.length; t++) {
      stages.push(stageOf(s));
      piles.push(logsLeft(s));
      done = work(world, s, 2, null);
    }
    const distinct = [...new Set(stages)];
    check(
      "a house is staked as a site and goes up in four stages before it stands",
      staked && distinct.join(",") === "0,1,2,3" && done === "finished" && cells.every((j) => world.cover[j] === C.HOUSE) && v.houses === 5,
      `stages ${distinct.join(",")}, ${stages.length * 2} s of work, ${siteTotal(s)} needed, covers ${cells.map((j) => world.cover[j]).join(" ")}`,
    );
    check(
      "the log pile shrinks as the stages use it",
      piles[0] === SITE.houseWood && piles[piles.length - 1] < piles[0] && piles.every((p, k) => k === 0 || p <= piles[k - 1]),
      piles.join(" "),
    );
  }

  // 2. A building with a job: it joins its village's list only once finished,
  // and the chronicle says when it was begun and when it was built.
  {
    const { world } = flat();
    const s = stake(world, 30 * 48 + 30, C.GRANARY, 4);
    const begun = world.story.some((l) => l.text === "Ashby is raising a granary");
    const before = world.settlements[0].jobs?.length ?? 0;
    for (let t = 0; t < 100 && world.sites.length; t++) work(world, s, 2, null);
    check(
      "a granary is raised on a site and only then counts as the village's",
      begun && before === 0 && world.settlements[0].jobs?.[0]?.kind === C.GRANARY && world.story.some((l) => l.text === "Ashby built a granary"),
      world.story.map((l) => l.text).join(" | "),
    );
    check(
      "a site names each building with a job as its village does",
      JOBS.every((j) => kindName(j.id) === j.name) && kindName(C.HOUSE) === "house",
      JOBS.map((j) => kindName(j.id)).join(", "),
    );
    check("a building with a job takes longer to raise than a house", siteTotal(s) > SITE.stages.reduce((a, b) => a + b, 0));
  }

  // 3. One house and one building with a job open at a time in a village.
  {
    const { world, v } = flat();
    stake(world, 20 * 48 + 20, C.HOUSE, 5);
    const house = canStake(world, v, C.HOUSE);
    const job = canStake(world, v, C.SMITHY);
    stake(world, 28 * 48 + 20, C.SMITHY, 4);
    check(
      "a village keeps one house and one building going up at a time",
      !house && job && !canStake(world, v, C.TAVERN),
      `house ${house}, job ${job}, second job ${canStake(world, v, C.TAVERN)}`,
    );
    const line = siteLine(world, v);
    check(
      "the villager's card says what its village is raising",
      line === "a house, being staked out (1\u00a0of\u00a04); a smithy, being staked out (1\u00a0of\u00a04)",
      line ?? "none",
    );
    // Day 0 starts in the morning; 270 s in is the middle of the night.
    world.time = 270;
    check("at night the card says the work stopped", !!siteLine(world, v)?.endsWith(", work stops for the night"), siteLine(world, v) ?? "none");
  }

  // 4. A site burns to ash, never to rubble (rubble is rebuilt for free as a
  // house), and the chronicle says so.
  {
    const { world } = flat();
    const s = stake(world, 20 * 48 + 20, C.HOUSE, 5);
    work(world, s, 20, null);
    for (const j of cellsOf(world, s.i)) world.fire[j] = 1;
    for (let t = 0; t < 1800 && cellsOf(world, s.i).some((j) => world.cover[j] === C.SITE); t++) stepPhysics(world, 1 / 30);
    const covers = cellsOf(world, s.i).map((j) => world.cover[j]);
    checkSites(world);
    check(
      "a site that burns leaves ash, no rubble, and the village is told",
      covers.every((c) => c !== C.SITE && c !== C.RUBBLE) &&
        cellsOf(world, s.i).every((j) => world.ground[j] === G.ASH) &&
        !world.sites.length &&
        world.story.some((l) => l.text === "the house going up in Ashby burned"),
      `covers ${covers.join(" ")}, ground ${cellsOf(world, s.i)
        .map((j) => world.ground[j])
        .join(" ")}`,
    );
  }
  {
    const { world } = flat();
    const s = stake(world, 20 * 48 + 20, C.HOUSE, 5);
    explode(world, 21, 21, 3, 1);
    check(
      "a blast blows a site away, and leaves no rubble to rebuild",
      cellsOf(world, s.i).every((j) => world.cover[j] !== C.RUBBLE && world.cover[j] !== C.SITE),
      cellsOf(world, s.i)
        .map((j) => world.cover[j])
        .join(" "),
    );
  }

  // 5. Saved and loaded: the work done stays; a site cell with no site is
  // cleared; a save from before sites loads with none.
  {
    const { world } = flat();
    const s = stake(world, 20 * 48 + 20, C.HOUSE, 5);
    work(world, s, 17, null);
    world.cover[5 * 48 + 5] = C.SITE;
    const saved = JSON.parse(JSON.stringify(saveWorld(world, new Map())));
    const back = loadWorld(saved, () => {})!;
    const t = back.sites[0];
    check(
      "a site and the work done on it survive a save",
      back.sites.length === 1 &&
        t.i === s.i &&
        t.kind === C.HOUSE &&
        Math.abs(t.work - 17) < 0.2 &&
        stageOf(t) === stageOf(s) &&
        back.cover[5 * 48 + 5] === C.NONE,
      `${back.sites.length} sites, work ${t?.work}, stray cell ${back.cover[5 * 48 + 5]}`,
    );
    delete saved.sites;
    const old = loadWorld(saved, () => {})!;
    check(
      "a save without sites loads with none, and its site cells cleared",
      old.sites.length === 0 && cellsOf(old, s.i).every((j) => old.cover[j] === C.NONE),
    );
  }

  // 6. The view: stakes first, then each stage adds to the last and stays
  // under the house it becomes.
  {
    const final = houseShape(12345, "timber", false, false);
    const tops = [0, 1, 2, 3].map((n) => top(siteShape(final, n, 0)));
    const counts = [0, 1, 2, 3].map((n) => siteShape(final, n, 0).length);
    check(
      "a site is drawn taller and fuller at each stage, and lower than its house",
      tops[0] < 0.4 && tops[1] < tops[2] && tops[2] <= tops[3] && counts[1] < counts[2] && counts[2] < counts[3] && tops[3] < top(final.boxes),
      `tops ${tops.map((t) => t.toFixed(2)).join(" ")}, house ${top(final.boxes).toFixed(2)}, boxes ${counts.join(" ")}`,
    );
    check("the log pile is drawn, a log a wood", siteShape(final, 0, 5).length - siteShape(final, 0, 0).length === 5);
  }

  // 7. Whole islands. On an island of 4.4.5 and later, villages left alone
  // stake sites and finish them; the oldest island never has one.
  for (const [label, flora] of [
    ["an island of 4.4.5 and later", true],
    ["the oldest island", false],
  ] as const) {
    const before = Math.random;
    Math.random = seeded(71);
    resetCreatureIds();
    const world = flora ? generateWorld(112, 112, 7, resolveLand(DEFAULT_LAND, 7, 112)) : generateWorld(112, 112, 7);
    populate(world);
    world.time = 20;
    const rt = new Runtime(world, () => {});
    let staked = 0;
    let finished = 0;
    let seen = new Set(world.sites);
    for (let t = 0; t < 30 * 240; t++) {
      stepHeadless(world, rt);
      if (t % 10) continue;
      for (const s of world.sites) if (!seen.has(s)) staked++;
      for (const s of seen) if (!world.sites.includes(s) && cellsOf(world, s.i).every((j) => world.cover[j] === s.kind)) finished++;
      seen = new Set(world.sites);
    }
    let siteCells = 0;
    for (let i = 0; i < world.n; i++) if (world.cover[i] === C.SITE) siteCells++;
    Math.random = before;
    if (flora)
      check(
        `on ${label}, villages stake building sites and finish them`,
        staked >= 2 && finished >= 1 && siteCells === world.sites.length * 4,
        `${staked} staked, ${finished} finished in 4 minutes, ${world.sites.length} open`,
      );
    else check(`on ${label}, houses are built at once, as before`, staked === 0 && siteCells === 0);
  }
}
