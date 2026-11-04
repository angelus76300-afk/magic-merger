// 4.4.5 part B checks, run by `npm test` (sim-test.ts): wonders by rarity,
// each doing what it says, names, never the same set twice, buildings that
// differ inside a village and do their job, and saves that keep it all.
import { KINDS, makeCreature, populate } from "../src/sim/creatures";
import { C, G } from "../src/sim/materials";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { stepHeadless } from "../src/sim/tick";
import { generateWorld, type World } from "../src/sim/world";
import { resolveLand } from "../src/sim/land";
import { DAY_LENGTH, MOON_DAYS, fullMoon } from "../src/sim/daylight";
import { DRAGON, WONDERS, WONDER_KINDS, floatAt, signatureOf, vents, type Wonder } from "../src/sim/wonders";
import { JOBS as BUILDING_JOBS, growBuildings, hasJob, housesOf, tierOf } from "../src/sim/buildings";
import { villageOf } from "../src/sim/kin";
import { SPECIES, habitatCells } from "../src/sim/wildlife";
import { houseShape, jobShape } from "../src/sim/voxel/buildings";

type Check = (name: string, ok: boolean, detail?: string) => void;

const MID = { warmth: 0.5, water: 0.5, relief: 0.5, forest: 0.5 };
const make = (seed: number, size = 152, recent: string[] = [], choice = MID) => generateWorld(size, size, seed, resolveLand(choice, seed, size), recent);

function run(world: World, seconds: number, each?: (t: number) => void): void {
  const rt = new Runtime(world, () => {});
  for (let k = 0; k < seconds * 30; k++) {
    stepHeadless(world, rt);
    if (each && k % 15 === 0) each(k / 30);
  }
}

// Cells of a wonder's reach, for the checks below.
function near(world: World, w: Wonder, r: number, test: (i: number) => boolean): number {
  let n = 0;
  for (let y = Math.round(w.y - r); y <= w.y + r; y++)
    for (let x = Math.round(w.x - r); x <= w.x + r; x++) if (world.inside(x, y) && Math.hypot(x - w.x, y - w.y) <= r && test(y * world.w + x)) n++;
  return n;
}

export function wonderChecks(check: Check): void {
  // Eighty medium islands and sixteen large ones, as the game makes them.
  const byKind = new Map<string, World>();
  const counts = new Map<string, number>();
  const problems: string[] = [];
  const names = new Set<string>();
  let legendary = 0;
  let islands = 0;
  let longName = "";
  const sizes: [number, number][] = [
    ...Array.from({ length: 80 }, (_, k) => [k * 7 + 3, 152] as [number, number]),
    ...Array.from({ length: 16 }, (_, k) => [k * 13 + 5, 208] as [number, number]),
  ];
  for (const [seed, size] of sizes) {
    const choice = { ...MID, warmth: [0.5, 0.25, 0.75][seed % 3], water: [0.5, 0.3, 0.7][(seed % 4) % 3] };
    const w = make(seed, size, [], choice);
    islands++;
    const ws = w.wonders;
    if (ws.length < 2 || ws.length > 4) problems.push(`${seed}: ${ws.length} wonders`);
    if (!ws.some((x) => WONDER_KINDS.get(x.kind)!.rarity !== "common")) problems.push(`${seed}: only common wonders`);
    if (ws.some((x) => WONDER_KINDS.get(x.kind)!.rarity === "legendary")) legendary++;
    for (let a = 0; a < ws.length; a++)
      for (let b = a + 1; b < ws.length; b++) if (Math.hypot(ws[a].x - ws[b].x, ws[a].y - ws[b].y) < 20) problems.push(`${seed}: two wonders close`);
    for (const x of ws) {
      counts.set(x.kind, (counts.get(x.kind) ?? 0) + 1);
      if (!byKind.has(x.kind) && size === 152) byKind.set(x.kind, w);
      const lands = WONDER_KINDS.get(x.kind)!.lands;
      const i = Math.round(x.y) * w.w + Math.round(x.x);
      const biome = w.biomeMap ? ["temperate", "desert", "tundra", "jungle", "swamp", "volcanic", "mesa"][w.biomeMap[i]] : w.land!.biome;
      if (lands !== "any" && !lands.includes(biome as never)) problems.push(`${seed}: ${x.kind} in ${biome}`);
    }
    if (w.islandName) names.add(w.islandName);
    if ((w.islandName ?? "").length > longName.length) longName = w.islandName ?? "";
    if (new Set(ws.map((x) => x.name)).size !== ws.length) problems.push(`${seed}: two wonders share a name`);
    if (new Set(w.settlements.map((s) => s.name)).size !== w.settlements.length) problems.push(`${seed}: two villages share a name`);
  }
  check(
    "4.4.5 B: every island gets two to four wonders, one uncommon or better, each in its lands",
    !problems.length,
    problems.slice(0, 5).join("; ") || `${islands} islands`,
  );
  check(
    "4.4.5 B: wonders by rarity: every kind seen, legendary ones rare",
    counts.size >= 15 && legendary / islands < 0.2 && legendary > 0,
    `${counts.size} of ${WONDERS.length} kinds; legendary on ${legendary} of ${islands}; ${[...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
  );
  check(
    "4.4.5 B: islands named from syllables, short, rarely twice",
    names.size >= islands * 0.92 && longName.length <= 22,
    `${names.size} names for ${islands}; longest "${longName}"`,
  );
  const again = make(3 * 7 + 3);
  const first = make(3 * 7 + 3);
  check(
    "4.4.5 B: the same seed makes the same wonders and names",
    JSON.stringify(again.wonders) === JSON.stringify(first.wonders) && again.islandName === first.islandName && again.wonders.length > 0,
  );

  // A player resetting thirty times: never the set of one of the last ten.
  const recent: string[] = [];
  let repeats = 0;
  for (let k = 0; k < 30; k++) {
    const w = make(1000 + (k % 6), 152, recent.slice(-10));
    const sig = signatureOf(w.wonders.map((x) => x.kind));
    if (recent.slice(-10).includes(sig)) repeats++;
    recent.push(sig);
  }
  check(
    "4.4.5 B: never the same set of wonders as one of the last ten islands, even on the same seeds",
    repeats === 0,
    `${repeats} repeats in 30 islands on 6 seeds`,
  );

  // A save keeps the wonders, the island's name, the villages' buildings and patched roofs.
  {
    const w = byKind.get("crater") ?? make(10);
    w.patched.add(w.settlements[0] ? Math.round(w.settlements[0].y) * w.w + Math.round(w.settlements[0].x) : 0);
    const kept = loadWorld(JSON.parse(JSON.stringify(saveWorld(w, new Map()))), () => {});
    check(
      "4.4.5 B: a save keeps the wonders, the name, the villages' buildings and patched roofs",
      !!kept &&
        JSON.stringify(kept.wonders) === JSON.stringify(w.wonders) &&
        kept.islandName === w.islandName &&
        JSON.stringify(kept.settlements) === JSON.stringify(w.settlements) &&
        kept.patched.size === w.patched.size &&
        kept.cover.every((v, i) => v === w.cover[i]),
      `${w.wonders.length} wonders, ${w.settlements.reduce((n, s) => n + (s.jobs?.length ?? 0), 0)} buildings`,
    );
  }
  check(
    "4.4.5 B: the island before 4.4 and the challenges have no wonders",
    !generateWorld(112, 112, 4).wonders.length && !generateWorld(112, 112, 4).islandName,
  );

  // Every wonder does something.
  const did: string[] = [];
  const failed: string[] = [];
  const tryKind = (kind: string, test: (w: World, x: Wonder) => string | null) => {
    let world = byKind.get(kind);
    for (let s = 2000; !world && s < 2600; s += 7) {
      const w = make(s, 152, [], { ...MID, warmth: kind === "frozen waterfall" ? 0.1 : MID.warmth });
      if (w.wonders.some((x) => x.kind === kind)) world = w;
    }
    if (!world) return failed.push(`${kind}: no island found`);
    const w = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, new Map()))), () => {})!;
    populate(w);
    const x = w.wonders.find((o) => o.kind === kind)!;
    const why = test(w, x);
    if (why) failed.push(`${kind}: ${why}`);
    else did.push(kind);
  };
  const put = (w: World, kind: string, x: number, y: number, hp?: number) => {
    const c = makeCreature(kind, x, y);
    c.homeX = x;
    c.homeY = y;
    if (hp !== undefined) c.hp = hp;
    w.creatures.push(c);
    return c;
  };
  const daytime = (w: World) => {
    w.time = Math.ceil(w.time / DAY_LENGTH) * DAY_LENGTH + 30;
  };
  tryKind("hot spring", (w, x) => {
    const deer = put(w, "deer", x.x + 0.5, x.y + 0.5, 20);
    for (let y = -6; y <= 6; y++)
      for (let k = -6; k <= 6; k++) if (Math.hypot(k, y) > 3.5 && Math.hypot(k, y) < 6.5) w.ground[(x.y + y) * w.w + x.x + k] = G.SNOW;
    const snow = near(w, x, 6.5, (i) => w.ground[i] === G.SNOW);
    run(w, 20);
    const left = near(w, x, 6.5, (i) => w.ground[i] === G.SNOW);
    return deer.hp > 35 && left < snow * 0.7 ? null : `hp ${deer.hp.toFixed(0)}, snow ${snow} to ${left}`;
  });
  tryKind("geysers", (w, x) => {
    const v = vents(x)[0];
    const deer = put(w, "deer", v.x + 0.5, v.y + 0.5);
    let high = 0;
    x.t = 0.5;
    run(w, 12, () => {
      high = Math.max(high, deer.z);
      if (Math.hypot(deer.x - v.x - 0.5, deer.y - v.y - 0.5) > 1) [deer.x, deer.y, deer.vx, deer.vy] = [v.x + 0.5, v.y + 0.5, 0, 0];
    });
    return high > 1.5 ? null : `rose to ${high.toFixed(1)}`;
  });
  tryKind("crater", (w) => {
    let ore = -1;
    for (let i = 0; i < w.n && ore < 0; i++) if (w.cover[i] === C.ORE) ore = i;
    if (ore < 0) return "no ore";
    const v = w.villages[0] ?? null;
    const miner = put(w, "villager", (ore % w.w) + 0.5, Math.floor(ore / w.w) + 0.5);
    if (w.settlements[0]) [miner.homeX, miner.homeY] = [w.settlements[0].x, w.settlements[0].y];
    run(w, 3);
    const vil = villageOf(w, miner.homeX, miner.homeY) ?? v;
    return w.cover[ore] !== C.ORE ? null : `ore still there (village ${vil ? "found" : "none"})`;
  });
  tryKind("bones", (w, x) => {
    // To the first night of a full moon.
    let t = 0;
    while (!fullMoon(t) && t < DAY_LENGTH * MOON_DAYS * 2) t += 5;
    w.time = t;
    run(w, 3);
    const risen = w.creatures.filter((c) => !c.dead && c.kind === "risen" && Math.hypot(c.x - x.x, c.y - x.y) < 12).length;
    run(w, 10);
    const more = w.creatures.filter((c) => !c.dead && c.kind === "risen").length;
    return risen >= 2 && more <= 3 ? null : `${risen} rose, ${more} after ten seconds`;
  });
  tryKind("fairy ring", (w, x) => {
    // The darkest of a night.
    w.time = DAY_LENGTH * 0.72;
    // Hunters out of the way: a deer chased by wolves runs for its life (the
    // food web), and that is not what this checks.
    // (They come back from the edge within seconds since the owner's rule:
    // kept away for the whole look.)
    const noHunters = () => {
      for (const c of w.creatures) if (["wolf", "bear", "fox", "polar bear"].includes(c.kind)) c.dead = true;
    };
    noHunters();
    const deer = put(w, "deer", x.x + 5, x.y + 1);
    let round = 0;
    let samples = 0;
    const seen: string[] = [];
    run(w, 25, () => {
      noHunters();
      samples++;
      const r = Math.hypot(deer.x - x.x - 0.5, deer.y - x.y - 0.5);
      if (Math.abs(r - 3) < 1.6) round++;
      if (samples % 5 === 0) seen.push(`${r.toFixed(0)} ${deer.mind?.action ?? ""}`);
    });
    return round > samples * 0.3 ? null : `round the ring ${round} of ${samples} looks (${deer.dead ? "dead; " : ""}${seen.join(", ")})`;
  });
  tryKind("hoard", (w, x) => {
    daytime(w);
    let gold = -1;
    for (let i = 0; i < w.n && gold < 0; i++) if (w.cover[i] === C.HOARD) gold = i;
    if (gold < 0) return "no gold";
    const thief = put(w, "villager", (gold % w.w) + 0.5, Math.floor(gold / w.w) + 0.5);
    run(w, 2);
    const awake = w.creatures.filter((c) => !c.dead && c.kind === DRAGON).length;
    // The thief gone, the dragon sleeps again.
    thief.dead = true;
    run(w, 120);
    const after = w.creatures.filter((c) => !c.dead && c.kind === DRAGON).length;
    return awake === 1 && (after === 0 || x.state === 2) && KINDS.get(DRAGON)?.tags.includes("dragon")
      ? null
      : `awake ${awake}, after two minutes ${after}, state ${x.state}`;
  });
  tryKind("frozen waterfall", (w, x) => {
    daytime(w);
    let hot = 0;
    run(w, 10, () => {
      for (let y = -2; y <= 2; y++) for (let k = -2; k <= 2; k++) w.temp[(x.y + y) * w.w + x.x + k] = 60;
      hot++;
    });
    return x.kind === "waterfall" ? null : `still frozen after ${hot} heat waves`;
  });
  tryKind("world tree", (w, x) => {
    const deer = put(w, "deer", x.x + 4, x.y + 0.5, 15);
    run(w, 10);
    return deer.hp > 40 ? null : `deer at ${deer.hp.toFixed(0)}`;
  });
  tryKind("floating rock", (w, x) => {
    daytime(w);
    // A fire under it is put out.
    const p = floatAt(w, x, w.time);
    const i = Math.round(p.y) * w.w + Math.round(p.x);
    w.fire[i] = 1;
    run(w, 1);
    return w.fire[i] === 0 ? null : `fire ${w.fire[i].toFixed(2)} under it`;
  });
  tryKind("ruins", (w, x) => {
    daytime(w);
    const s = w.settlements[0];
    const c = put(w, "villager", x.x + 0.5, x.y + 0.5);
    if (s) [c.homeX, c.homeY] = [s.x, s.y];
    const v = villageOf(w, c.homeX, c.homeY);
    const gold = v?.gold ?? 0;
    run(w, 2);
    const after = villageOf(w, c.homeX, c.homeY)?.gold ?? 0;
    return after > gold || !v ? null : `gold ${gold} to ${after}`;
  });
  tryKind("lone tree", (w, x) => {
    const before = near(w, x, 9, (i) => w.cover[i] === C.BUSH || w.cover[i] === C.TREE);
    run(w, 120);
    const after = near(w, x, 9, (i) => w.cover[i] === C.BUSH || w.cover[i] === C.TREE);
    return after > before ? null : `${before} to ${after} young trees`;
  });
  for (const [kind, who, r] of [
    ["sinkhole lake", "fish", 5],
    ["sea stacks", "bird", 14],
    ["sunken temple", "fish", 6],
  ] as const)
    tryKind(kind, (w, x) => {
      for (const c of w.creatures) if (c.kind === who && Math.hypot(c.x - x.x, c.y - x.y) < r + 2) c.dead = true;
      x.t = 0;
      run(w, 2);
      const n = w.creatures.filter((c) => !c.dead && c.kind === who && Math.hypot(c.x - x.x, c.y - x.y) < r + 2).length;
      return n > 0 ? null : `no ${who} came back`;
    });
  for (const kind of ["waterfall", "cave mouth", "stone arch"])
    tryKind(kind, (w, x) => {
      const deer = put(w, "deer", x.x + 0.5, x.y + 0.5, 20);
      if (kind === "stone arch") deer.fear = 3;
      if (kind === "waterfall") w.fire[Math.round(x.y) * w.w + Math.round(x.x) + 1] = 1;
      run(w, 3, () => {
        if (kind === "cave mouth") [deer.x, deer.y] = [x.x + 0.5, x.y + 0.5];
      });
      if (kind === "waterfall") return w.fire[Math.round(x.y) * w.w + Math.round(x.x) + 1] === 0 ? null : "the mist did not put out the fire";
      if (kind === "cave mouth") return deer.hp > 22 ? null : `deer at ${deer.hp.toFixed(0)}`;
      return deer.fear === 0 ? null : "still afraid";
    });
  check("4.4.5 B: every wonder does something", !failed.length && did.length === WONDERS.length, failed.join("; ") || did.join(", "));

  // The owner's rule: back only where it can live. A scorched island (every
  // plant and house gone, the grass burnt, every creature killed): for a
  // minute and a half no animal is alive while its kind's habitat is gone,
  // and no villager comes back without a house. (The wipe in the balance
  // runs is the other side: the habitat stays, and every kind is back.)
  {
    const w = make(7);
    populate(w);
    run(w, 5);
    for (let i = 0; i < w.n; i++) {
      if (w.cover[i] !== 0) w.setCover(i, C.NONE);
      if (w.ground[i] === G.GRASS || w.ground[i] === G.FIELD || w.ground[i] === G.PATH) w.ground[i] = G.ASH;
    }
    w.creatures.length = 0;
    const wrong: string[] = [];
    let villagers = 0;
    let fish = 0;
    run(w, 90, (t) => {
      if (t % 5 !== 0) return;
      for (const sp of SPECIES) {
        if (sp.kind.aquatic) continue;
        const alive = w.creatures.filter((c) => !c.dead && c.kind === sp.kind.name).length;
        if (alive && habitatCells(w, sp) < 30) wrong.push(`${alive} ${sp.kind.name} at ${t} s`);
      }
      villagers = Math.max(villagers, w.creatures.filter((c) => !c.dead && c.kind === "villager").length);
      fish = Math.max(fish, w.creatures.filter((c) => !c.dead && c.kind === "fish").length);
    });
    check(
      "4.4.5 B: back only where it can live: nothing on a scorched island, no villager without a house",
      !wrong.length && villagers === 0,
      wrong.slice(0, 4).join(", ") || `no land animal on the ash, ${villagers} villagers, ${fish} fish back in the water that is left`,
    );
  }
  // Buildings that differ inside a village.
  {
    const shapes = new Set<string>();
    for (let k = 0; k < 200; k++)
      shapes.add(
        JSON.stringify(
          houseShape(k * 2654435761, ["timber", "adobe", "stone", "stilts", "snowroof"][k % 5], k % 3 === 0, k % 7 === 0).boxes.map((b) => [
            b.w.toFixed(2),
            b.h.toFixed(2),
            b.color,
          ]),
        ),
      );
    const jobs = BUILDING_JOBS.filter((j) => jobShape(j.id * 31, j.id, "timber").boxes.length >= 5);
    const boxes = Math.max(...Array.from({ length: 50 }, (_, k) => houseShape(k * 97, "timber", true, true).boxes.length));
    check(
      "4.4.5 B: no two houses alike; every building with a job its own look",
      shapes.size === 200 && jobs.length === BUILDING_JOBS.length && boxes <= 40,
      `${shapes.size} of 200 houses differ; ${jobs.length} of ${BUILDING_JOBS.length} job buildings; at most ${boxes} boxes a house`,
    );
  }
  {
    // Villages start with one or two buildings by their place; named apart.
    let villages = 0;
    let withJob = 0;
    for (let k = 0; k < 20; k++) {
      const w = make(k * 31 + 7);
      for (const s of w.settlements) {
        villages++;
        if ((s.jobs?.length ?? 0) >= 1) withJob++;
      }
    }
    check("4.4.5 B: every village starts with a building that has a job", withJob === villages, `${withJob} of ${villages}`);
  }
  {
    // A medium island for fifteen minutes: villages raise buildings, grow,
    // and what the buildings do shows.
    const w = make(7);
    populate(w);
    const startJobs = w.settlements.map((s) => s.jobs?.length ?? 0);
    const startHouses = w.settlements.map((s) => housesOf(w, s));
    run(w, 15 * 60);
    const endJobs = w.settlements.map((s) => s.jobs?.length ?? 0);
    const told = w.story.filter((l) => / built a (smithy|granary|bakery|barn|tavern|market|chapel|watchtower|lumber yard|fisher hut)/.test(l.text)).length;
    check(
      "4.4.5 B: villages raise buildings with a job as they grow",
      endJobs.every((n, k) => n > startJobs[k]) && told > 0,
      w.settlements
        .map((s, k) => `${s.name} ${startJobs[k]} to ${endJobs[k]} buildings, ${startHouses[k]} to ${housesOf(w, s)} houses (${tierOf(housesOf(w, s))})`)
        .join("; "),
    );
    check(
      "4.4.5 B: monsters and spell creatures stay capped with wonders and buildings",
      w.creatures.length < 480 && w.creatures.filter((c) => !c.dead && c.kind === "risen").length <= 3,
      `${w.creatures.length} creatures`,
    );
  }
  {
    // A burnt building rebuilt as a house turns back into what it was; a
    // granary keeps and gives back; a barn sows.
    const w = make(7);
    populate(w);
    run(w, 5);
    const s = w.settlements[0];
    const job = s.jobs![0];
    const cells = [job.i, job.i + 1, job.i + w.w, job.i + w.w + 1];
    for (const i of cells) w.setCover(i, C.HOUSE);
    growBuildings(w);
    const back = cells.every((i) => w.cover[i] === job.kind);
    const granary = { kind: C.GRANARY, i: job.i };
    s.jobs = [granary];
    for (const i of cells) w.setCover(i, C.GRANARY);
    const v = villageOf(w, s.x, s.y)!;
    v.food = 40;
    growBuildings(w);
    const stored = s.store ?? 0;
    v.food = 1;
    growBuildings(w);
    check(
      "4.4.5 B: a building rebuilt after a fire comes back; a granary keeps food and gives it back",
      back && stored > 0 && v.food > 1 && hasJob(w, s.x, s.y, C.GRANARY),
      `rebuilt ${back}, stored ${stored}, food after a famine ${v.food}`,
    );
  }
}
