// Villagers left alone (22 November, the owner after letting an island run: "sleeping is them not
// moving. Its just weird"; homes.ts): an island runs with nothing cast and this counts, each
// minute, the villagers alive, those who starved, the fields tilled, the houses standing in water,
// and at night those asleep standing outside (main: everyone asleep stood frozen by the house;
// now they sleep indoors, and only the homeless sleep out, lying down). Used by npm test in its
// worker threads (a short island), and run on its own for the hour-long soak of the pull request:
//   npx esbuild scripts/villagers-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/villagers-run.mjs --log-level=warning
//   node node_modules/.cache/villagers-run.mjs <island: meadow|dry|large|small-meadow|small-dry> <minutes>
// It reads c.data.indoors and c.data.rough, which main does not set: on main every sleeper counts
// as standing outside, which is what main draws.
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { daylight } from "../src/sim/daylight";
import { C, F, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { raiseWonders } from "../src/sim/wonderbuild";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { island } from "./nature-run";

export interface VillagersRow {
  minute: number;
  alive: number;
  starved: number;
  died: number;
  fields: number;
  tilled: number;
  housesWet: number;
}

export interface VillagersRun {
  name: string;
  minutes: number;
  rows: VillagersRow[];
  // Houses (2 by 2 blocks counted by cell / 4) that stood in water at some sample, and the most at once.
  housesWetEver: number;
  // Night samples (every 5 s while the night is deep), of those asleep where they arrived (not those
  // still walking to bed, nor one running from a fright): asleep standing outside, the most at once
  // and summed; homeless asleep lying down, the most at once; asleep indoors, the most at once.
  nightSamples: number;
  standingMax: number;
  standingSum: number;
  roughMax: number;
  indoorsMax: number;
  seconds: number;
}

function houseCellsWet(world: World): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < world.n; i++) if (world.cover[i] === C.HOUSE && world.fluid[i] === F.WATER && world.depth[i] > 0.2) out.add(i);
  return out;
}

export function villagersRun(name: string, minutes: number): VillagersRun {
  const shared = Math.random;
  const t0 = Date.now();
  const spec = island(name);
  Math.random = seeded(spec.seed * 7919 + 1);
  resetCreatureIds(1);
  try {
    Runtime.slowMs = Infinity;
    const world = generateWorld(spec.size, spec.size, spec.seed, spec.land);
    populate(world);
    const rt = new Runtime(world, () => {});
    raiseWonders(world, rt);
    world.weather = true;
    world.reactions = true;
    const field0 = new Uint8Array(world.n);
    for (let i = 0; i < world.n; i++) field0[i] = world.ground[i] === G.FIELD ? 1 : 0;
    const tilled = new Set<number>();
    const wetEver = new Set<number>();
    // Each villager's hunger as last seen, to tell a starving death from another.
    const last = new Map<number, number>();
    let starved = 0;
    let died = 0;
    const count = () => world.creatures.filter((c) => !c.dead && c.kind === "villager").length;
    const row = (minute: number): VillagersRow => {
      let fields = 0;
      for (let i = 0; i < world.n; i++) if (world.ground[i] === G.FIELD) fields++;
      const wet = houseCellsWet(world);
      for (const i of wet) wetEver.add(i);
      return { minute, alive: count(), starved, died, fields, tilled: tilled.size, housesWet: Math.round(wet.size / 4) };
    };
    const rows = [row(0)];
    let nightSamples = 0;
    let standingMax = 0;
    let standingSum = 0;
    let roughMax = 0;
    let indoorsMax = 0;
    const per = Math.round(60 / TICK);
    const every = Math.round(1 / TICK);
    for (let m = 1; m <= minutes; m++) {
      for (let k = 0; k < per; k++) {
        stepHeadless(world, rt);
        if (k % every !== 0) continue;
        const seen = new Set<number>();
        for (const c of world.creatures) {
          if (c.kind !== "villager") continue;
          if (c.dead) continue;
          seen.add(c.id);
          last.set(c.id, c.mind?.hunger ?? 0);
        }
        for (const [id, h] of last)
          if (!seen.has(id)) {
            died++;
            if (h >= 0.95) starved++;
            last.delete(id);
          }
        for (let i = 0; i < world.n; i++) if (world.ground[i] === G.FIELD && !field0[i]) tilled.add(i);
        if (k % (every * 5) === 0 && daylight(world.time).night > 0.8) {
          nightSamples++;
          let standing = 0;
          let rough = 0;
          let indoors = 0;
          for (const c of world.creatures) {
            // Asleep where it lies down: arrived (its rest under way), not still walking to bed.
            if (c.dead || c.kind !== "villager" || c.mind?.task !== "rest" || !(c.mind.work > 0) || c.fear > 0 || c.sp > 0.5) continue;
            if (c.data.indoors !== undefined) indoors++;
            else if (c.data.rough) rough++;
            else standing++;
          }
          standingMax = Math.max(standingMax, standing);
          standingSum += standing;
          roughMax = Math.max(roughMax, rough);
          indoorsMax = Math.max(indoorsMax, indoors);
        }
      }
      rows.push(row(m));
    }
    return {
      name,
      minutes,
      rows,
      housesWetEver: Math.round(wetEver.size / 4),
      nightSamples,
      standingMax,
      standingSum,
      roughMax,
      indoorsMax,
      seconds: Math.round((Date.now() - t0) / 1000),
    };
  } finally {
    Math.random = shared;
  }
}

if (typeof process !== "undefined" && process.argv[1]?.includes("villagers-run")) {
  const name = process.argv[2] ?? "small-meadow";
  const minutes = Number(process.argv[3] ?? 6);
  const run = villagersRun(name, minutes);
  console.log(JSON.stringify(run));
  const at = (m: number) => run.rows.find((r) => r.minute === m) ?? run.rows[run.rows.length - 1];
  const half = Math.floor(minutes / 2);
  const end = at(minutes);
  console.error(
    `${name}: alive ${at(0).alive}/${at(half).alive}/${end.alive}, starved ${end.starved} of ${end.died} deaths, fields ${at(0).fields} to ${end.fields} (${end.tilled} tilled), houses wet ever ${run.housesWetEver}, at end ${end.housesWet}; night samples ${run.nightSamples}: standing max ${run.standingMax} sum ${run.standingSum}, rough max ${run.roughMax}, indoors max ${run.indoorsMax}; ${run.seconds} s`,
  );
}
