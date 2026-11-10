import { parseIntents } from "../../shared/promises";
import { REFERENCE_SIDE, TIERS, TIER_REACH, type Tier } from "../../shared/tiers";
import { KINDS, kindOf, makeCreature, populate, resetCreatureIds, type Creature } from "./creatures";
import { abilitiesOf, promisesProtection, unfitDefence } from "./abilities";
import { daylight } from "./daylight";
import { C } from "./materials";
import { unpackLook } from "./villagers";
import { Runtime, type CastRequest } from "./runtime";
import { isArtifact, resetArtifactIds } from "./artifacts";
import { passiveDeeds } from "./held";
import { logCatches } from "./kin";
import { seeded } from "./noise";
import { stepHeadless } from "./tick";
import { TICK, generateWorld, type World } from "./world";
import { FORM_RULES, GIANT_FACTOR, bigBeing, isForm, personName, type Form } from "../../shared/forms";
import { isBuilding } from "./materials";
import { keyLevel, keyX, keyY } from "./voxelkey";
import { settlementNear } from "./buildings";
import { MODELS_PER_ITEM, propBounds } from "./props";

// The test run a new program goes through before it is stored (3.3). It is
// cast near a village on a small seeded island, and the island is compared,
// second by second, with the same island left alone (the control). A river
// that flows or a villager who walks is in both, so only what the spell did
// shows up. Three outcomes fail: a crash, nothing visible in the world, and
// an island wiped out by a spell that is not cosmic. A fourth since 3.4.2: a
// spell that breaks its promise (shared/promises.ts), such as a protection
// that does not protect.
//
// Runs where spell code may run: the sandboxed check frame in the browser
// (src/sim/checkframe.ts), and Node for `npm test` and the measurement scripts.
// The Worker cannot run it, since Cloudflare Workers forbid new Function.

export type CheckProblem = "crash" | "nothing" | "wiped" | "promise" | "idle" | "size" | "kind" | "look" | "fit";

export interface CheckResult {
  ok: boolean;
  problem: CheckProblem | null;
  // One sentence for the rewrite prompt and the admin card.
  detail: string;
  stats: {
    seconds: number;
    // Most land cells that differed from the control at any second, and that share of the land.
    cells: number;
    share: number;
    voxels: number;
    creatures: number;
    bodies: number;
    villagersLeft: number;
    housesLeft: number;
    worstTickMs: number;
    // The promise probe, when the spell has one: the share of the harm it
    // prevented, averaged over the threats (1 all of it, 0 none).
    saved?: number;
    // The five minute test of an artifact (3.7): what it changed after its arrival.
    acted?: number;
  };
  // Milliseconds of work in each part (4.2, measured, never part of the
  // verdict): control (the island left alone), cast (the spell's own run),
  // protect and acts (the probes).
  phases?: Record<string, number>;
}

// The reference island: the reach every item but a spell and land keeps on any island.
const SIZE = REFERENCE_SIDE;
const SEED = 11;
// Below this many cells, voxels or creatures, a difference with the control is
// noise (spells that only draw random numbers or particles: 0 cells and 0
// creatures over 14 seconds). A cantrip of gold lays 6 cells, so 3 is enough.
const MIN_CELLS = 3;
const MIN_VOXELS = 4;
const MIN_CREATURES = 1;
// Health given back, over everyone who was there, for a promise to heal to be
// kept: the wounded villager by the target gets 2 a second from its own rest,
// in both runs, so anything a spell adds shows.
const HEALED = 3;
// Past this share of the land changed, or with almost every villager and house
// gone, the spell wiped the island. Cosmic spells may (DESIGN.md, decisions).
const WIPED_SHARE: Partial<Record<Tier, number>> = { legendary: 0.9 };
const WIPED_SHARE_DEFAULT = 0.6;

interface Snapshot {
  height: Float32Array;
  ground: Uint8Array;
  fluid: Uint8Array;
  depth: Float32Array;
  cover: Uint8Array;
  fire: Uint8Array;
  decor: number;
  creatures: Map<string, string>;
  villagers: number;
  houses: number;
  landmarks: number;
  // For the promises of healing and summoning: cells of living plants, cells
  // on fire, the health of everyone alive (summed), the living that burn, and
  // the living creatures born or brought since the cast.
  plants: number;
  burning: number;
  // The health of each living creature that was there at the cast, by id.
  hp: Map<number, number>;
  aflame: number;
  brought: number;
}

function snapshot(world: World): Snapshot {
  const fire = new Uint8Array(world.n);
  let houses = 0;
  let plants = 0;
  let burning = 0;
  for (let i = 0; i < world.n; i++) {
    fire[i] = world.fire[i] > 0.1 ? 1 : 0;
    burning += fire[i];
    const c = world.cover[i];
    if (c === C.HOUSE) houses++;
    else if (c === C.TREE || c === C.BUSH || c === C.CROP || c === C.FLOWER) plants++;
  }
  const hp = new Map<number, number>();
  let aflame = 0;
  let brought = 0;
  // Each creature that was there at the cast, by id: alive or dead, kind,
  // what it is going through. Those born later (ids are not shared between
  // the two runs) are counted by kind.
  const creatures = new Map<string, string>();
  let villagers = 0;
  for (const c of world.creatures) {
    if (!c.dead && c.kind === "villager") villagers++;
    if (!c.dead) {
      // Of those who were there at the cast: a creature brought is not a wound healed.
      if (c.id <= baseId) hp.set(c.id, Math.max(0, c.hp));
      if (c.burning > 0) aflame++;
      if (c.id > baseId) brought++;
    }
    if (c.id > baseId) {
      if (c.dead) continue;
      const k = `new:${c.kind}`;
      creatures.set(k, String(Number(creatures.get(k) ?? 0) + 1));
      continue;
    }
    const status = [c.burning, c.frozen, c.fear, c.sleep, c.calm, c.levitate, c.stun].map((v) => (v > 0 ? 1 : 0)).join("");
    creatures.set(String(c.id), c.dead ? "dead" : `${c.kind}:${status}:${Math.round(c.hp / 10)}`);
  }
  return {
    height: world.height.slice(),
    ground: world.ground.slice(),
    fluid: world.fluid.slice(),
    depth: world.depth.slice(),
    cover: world.cover.slice(),
    fire,
    decor: world.decor.size,
    creatures,
    villagers,
    houses,
    landmarks: world.landmarks.length,
    plants,
    burning,
    hp,
    aflame,
    brought,
  };
}

function changedCells(a: Snapshot, b: Snapshot, land: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.cover.length; i++) {
    if (!land[i]) continue;
    if (
      Math.abs(a.height[i] - b.height[i]) > 0.4 ||
      a.ground[i] !== b.ground[i] ||
      a.fluid[i] !== b.fluid[i] ||
      Math.abs(a.depth[i] - b.depth[i]) > 0.4 ||
      a.cover[i] !== b.cover[i] ||
      a.fire[i] !== b.fire[i]
    )
      n++;
  }
  return n;
}

function changedCreatures(a: Snapshot, b: Snapshot): number {
  let n = 0;
  for (const [id, state] of b.creatures) {
    if (id.startsWith("new:")) n += Math.abs(Number(state) - Number(a.creatures.get(id) ?? 0));
    else if (a.creatures.get(id) !== state) n++;
  }
  for (const [id, state] of a.creatures) {
    if (b.creatures.has(id)) continue;
    n += id.startsWith("new:") ? Number(state) : 1;
  }
  return n;
}

interface Island {
  world: World;
  rt: Runtime;
  target: { x: number; y: number };
  land: Uint8Array;
  // Each run draws from its own random stream, set before each of its ticks.
  random: () => number;
  // Creatures draw from another one, the same in both runs: a spell that only
  // throws particles must not change which way a deer wanders (3.5: with
  // wildlife, that alone passed a spell that did nothing).
  life: () => number;
  // The villager who lies dead by the target (another stands there wounded).
  corpse: number;
}

// Creatures with a higher id were born after the cast.
let baseId = 0;

// The island both runs start from: rivers settled, aim at the edge of a village.
function island(errors: string[], streams = 0): Island {
  Math.random = seeded(SEED);
  resetCreatureIds();
  resetArtifactIds();
  const world = generateWorld(SIZE, SIZE, SEED);
  populate(world);
  baseId = Math.max(0, ...world.creatures.map((c) => c.id));
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  // Other streams give the same island a different life (the five minute scene runs a few).
  const life = seeded(SEED + 2 + streams * 101);
  for (let k = 0; k < 60; k++) step(world, rt, life);
  let target = { x: world.w / 2, y: world.h / 2 };
  for (let i = 0; i < world.n; i++) {
    if (world.cover[i] === C.HOUSE) {
      target = { x: (i % world.w) + 6, y: Math.floor(i / world.w) + 6 };
      break;
    }
  }
  // Something for healing and raising spells to work on: a villager lies dead
  // by the target and another stands there wounded. Without them, Resurrection,
  // Necromancy and Holy Light did nothing visible and failed.
  const near = world.creatures
    .filter((c) => c.kind === "villager" && !c.dead)
    .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
  // Right next to it: some spells only reach a few cells.
  if (near[0]) Object.assign(near[0], { x: target.x + 1, y: target.y + 1, hp: 0, dead: true });
  if (near[1]) Object.assign(near[1], { x: target.x - 1, y: target.y, hp: 35 });
  const land = new Uint8Array(world.n);
  for (let i = 0; i < world.n; i++) land[i] = world.depth[i] > 0.5 ? 0 : 1;
  return { world, rt, target, land, random: seeded(SEED + 1 + streams * 101), life, corpse: near[0]?.id ?? -1 };
}

// Seeded randomness (noise.ts), the same for the control and the spell run;
// the lives of the island have their own stream.
function step(world: World, rt: Runtime, life: () => number): void {
  stepHeadless(world, rt, { life });
}

// The control: the same island left alone, one snapshot per second. Kept
// between checks, since it never changes.
let control: { snaps: Snapshot[]; island: Island } | null = null;

function* controlUpTo(seconds: number): Generator<void, Snapshot[]> {
  const outer = Math.random;
  const was = phase;
  phase = "control";
  if (!control) {
    const isl = island([]);
    control = { snaps: [snapshot(isl.world)], island: isl };
  }
  const c = control;
  while (c.snaps.length <= seconds) {
    for (let k = 0; k < 1 / TICK; k++) {
      Math.random = c.island.random;
      step(c.island.world, c.island.rt, c.island.life);
      Math.random = outer;
      // A pause every few ticks, so the browser can draw in between.
      if (k % 5 === 4) yield;
    }
    c.snaps.push(snapshot(c.island.world));
  }
  Math.random = outer;
  phase = was;
  return c.snaps;
}

// A generator, so the browser can run it a second of game time at a time
// between frames; `runCheck` runs it to the end. Math.random is replaced
// while it runs (seeded, so a check gives the same answer every time).
export function* checkProgram(req: CastRequest): Generator<void, CheckResult> {
  const random = Math.random;
  const phases: Record<string, number> = {};
  phase = "cast";
  try {
    const it = check(req);
    for (;;) {
      const at = phase;
      const t0 = performance.now();
      const r = it.next();
      phases[at] = (phases[at] ?? 0) + performance.now() - t0;
      if (r.done) {
        for (const k of Object.keys(phases)) phases[k] = Math.round(phases[k]);
        return { ...r.value, phases };
      }
      yield;
    }
  } finally {
    Math.random = random;
  }
}

// Which part of the check is running, for its timing.
let phase = "cast";

// The control island and the probe runs without the spell are kept between
// checks; measurements start from nothing with this.
export function resetCheckCaches(): void {
  control = null;
  probeCache.clear();
}

// Did someone who was there at the cast become another kind of creature (a
// villager turned, a beast transformed)?
function changedKind(a: Snapshot, b: Snapshot): boolean {
  for (const [id, state] of b.creatures) {
    if (id.startsWith("new:") || state === "dead") continue;
    const was = a.creatures.get(id);
    if (was && was !== "dead" && was.split(":")[0] !== state.split(":")[0]) return true;
  }
  return false;
}

function* check(req: CastRequest): Generator<void, CheckResult> {
  const big = TIERS.indexOf(req.tier) >= TIERS.indexOf("legendary");
  const cap = big ? 26 : 14;
  // The control first: it may already be there from an earlier check.
  yield* controlUpTo(1);
  const errors: string[] = [];
  const isl = island(errors);
  const { world, rt, target, land } = isl;
  Math.random = isl.random;
  const landCells = land.reduce((s, v) => s + v, 0);
  const before = formBefore(world);
  const started = rt.cast({ ...req, key: `check:${req.key}` }, target.x, target.y);
  let cells = 0;
  let voxels = 0;
  let creatures = 0;
  let bodies = 0;
  let bodySeconds = 0;
  // A ward changes no cell but shows as a dome: it counts as something visible.
  let wards = 0;
  let worst = 0;
  let seconds = 0;
  let quietFor = 0;
  let last = snapshot(world);
  // What a promise to heal or to summon is judged on, against the control at
  // the same second: the best of the cast for healing (a mend is a mend even
  // if a wolf bites later), the end of it for a summon (it must still be there).
  const mended = { health: 0, raised: false, plants: 0, quenched: 0 };
  // Health gained over the control, creature by creature: a wolf's bite
  // elsewhere does not hide a wound closed here.
  const gained = (ref: Snapshot, now: Snapshot) => {
    let sum = 0;
    for (const [id, v] of now.hp) {
      const was = ref.hp.get(id);
      if (was !== undefined && v > was) sum += v - was;
    }
    return sum;
  };
  while (started && !errors.length && seconds < cap) {
    for (let k = 0; k < 1 / TICK && !errors.length; k++) {
      const t0 = performance.now();
      step(world, rt, isl.life);
      worst = Math.max(worst, performance.now() - t0);
      const visible = rt.visuals.bodies.filter((b) => b.alive && b.look !== "none").length;
      bodies = Math.max(bodies, visible);
      if (visible) bodySeconds += TICK;
      wards = Math.max(wards, world.wards.length);
      if (k % 5 === 4) {
        yield;
        Math.random = isl.random;
      }
    }
    seconds++;
    last = snapshot(world);
    const snaps = yield* controlUpTo(seconds);
    Math.random = isl.random;
    const ref = snaps[seconds];
    cells = Math.max(cells, changedCells(ref, last, land));
    voxels = Math.max(voxels, Math.abs(ref.decor - last.decor));
    creatures = Math.max(creatures, changedCreatures(ref, last) + Math.abs(ref.landmarks - last.landmarks));
    mended.health = Math.max(mended.health, gained(ref, last));
    mended.raised ||= !ref.hp.has(isl.corpse) && last.hp.has(isl.corpse);
    mended.plants = Math.max(mended.plants, last.plants - ref.plants);
    mended.quenched = Math.max(mended.quenched, ref.burning - last.burning, (ref.aflame - last.aflame) * 3);
    // Done two seconds after the cast and its bodies are over, after four at least.
    quietFor = rt.busy() || rt.visuals.bodies.length || world.wards.length ? 0 : quietFor + 1;
    if (seconds >= 4 && quietFor >= 2) break;
  }
  const ref = (yield* controlUpTo(seconds))[seconds];
  const endCells = changedCells(ref, last, land);
  const share = landCells ? endCells / landCells : 0;
  const stats = {
    seconds,
    cells,
    share: Math.round(share * 1000) / 1000,
    voxels,
    creatures,
    bodies,
    villagersLeft: ref.villagers ? Math.round((last.villagers / ref.villagers) * 100) / 100 : 1,
    housesLeft: ref.houses ? Math.round((last.houses / ref.houses) * 100) / 100 : 1,
    worstTickMs: Math.round(worst),
  };
  if (!started || errors.length) {
    return { ok: false, problem: "crash", detail: `It crashed: ${errors[0] ?? "the cast did not start"}`, stats };
  }
  // 4.6: a fine model (props.ts) is something visible too.
  const props = world.props.filter((p) => p.key === `check:${req.key}`).length;
  const moved = cells >= MIN_CELLS || voxels >= MIN_VOXELS || creatures >= MIN_CREATURES || bodySeconds >= 0.5 || wards > 0 || props > 0;
  if (!moved) {
    return {
      ok: false,
      problem: "nothing",
      detail: `Nothing visible happened in the world: no land, water, plant, house, block or creature changed and nothing flew (${cells} cells, ${voxels} blocks, ${creatures} creatures). Particles, flashes and circles alone do not count.`,
      stats,
    };
  }
  if (req.tier !== "cosmic") {
    const limit = WIPED_SHARE[req.tier] ?? WIPED_SHARE_DEFAULT;
    const ruined = TIERS.indexOf(req.tier) <= TIERS.indexOf("grand") && stats.villagersLeft < 0.2 && stats.housesLeft < 0.2;
    if (share > limit || ruined) {
      return {
        ok: false,
        problem: "wiped",
        detail: `It wiped out the island, far beyond a ${req.tier} spell's reach: ${Math.round(share * 100)}% of the land changed, ${Math.round(stats.villagersLeft * 100)}% of villagers and ${Math.round(stats.housesLeft * 100)}% of houses left.`,
        stats,
      };
    }
  }
  // What its writer wrote and the engine could not use: it never happened, so
  // the item is not what was meant, whatever else it did.
  const lost = [
    ...(rt.dropped.get(`check:${req.key}`) ?? []),
    ...rt
      .unplaced(`check:${req.key}`)
      .map((n) => `spell.artifacts declares "${n}" and cast never calls w.artifact(x, y, "${n}"): declaring places nothing, so none of its effects ran`),
  ];
  if (lost.length) {
    const look = lost.every((l) => l.startsWith("w.model"));
    return {
      ok: false,
      problem: look ? "look" : "idle",
      detail: `Part of what was written never happened, because the engine could not use it: ${lost.slice(0, 3).join("; ")}.`.slice(0, 400),
      stats,
    };
  }
  // The promise of its main intent (shared/promises.ts), where the cast itself
  // shows it. A spell only: an item's healing or creatures come with what it
  // is, and its own tests follow it for minutes.
  const main = parseIntents(req.intents)[0];
  if (req.kind !== "artifact" && main === "heal" && mended.health < HEALED && !mended.raised && mended.plants < MIN_CELLS && mended.quenched < MIN_CELLS) {
    return {
      ok: false,
      problem: "promise",
      detail: `It promises to heal, but it healed nothing: a villager stood wounded (35 of 100 health) one cell from where it was cast and another lay dead beside it, and neither was better for it; nothing grew back and no fire went out. Heal with c.heal(n) on w.creatures(x, y, r) whatever their health, raise the dead with revive() on w.corpses(x, y, r), or mend the land with w.grow.`,
      stats,
    };
  }
  if (req.kind !== "artifact" && main === "summon" && last.brought - ref.brought < 1 && !changedKind(ref, last) && !mended.raised) {
    return {
      ok: false,
      problem: "promise",
      detail: `It promises to bring a creature, but when the cast was over nothing it brought was alive and nothing had been turned into something else (${seconds} s after the cast, by day). Spawn it with w.spawn (or w.person for a human) and let it live: no lifespan of a few seconds, and a creature weak to light must not arrive in the open by day.`,
      stats,
    };
  }
  // 4.6: an item is the size of its kind, and is that kind of thing at all.
  if (isForm(req.form) && req.form !== "spell") {
    const found = formCheck(
      req.form,
      req.name,
      req.giant === true,
      before,
      world,
      ref,
      rt.owners,
      `check:${req.key}`,
      rt.raised.get(`check:${req.key}`),
      rt.modelCalls.get(`check:${req.key}`),
      rt.people.get(`check:${req.key}`),
      rt.planted.get(`check:${req.key}`),
    );
    if (found) return { ok: false, problem: found.problem, detail: found.detail, stats };
    const unfit = defenceOf(req, rt.owners, `check:${req.key}`, rt.wardCalls.get(`check:${req.key}`) ?? 0);
    if (unfit) return { ok: false, problem: "fit", detail: unfit, stats };
  }
  const detail = `${cells} cells, ${voxels} blocks and ${creatures} creatures changed${bodies ? `, ${bodies} bodies flew` : ""}.`;
  let result: CheckResult = { ok: true, problem: null, detail, stats };
  // 4.6: a settlement is made on open ground away from the village the probe
  // attacks; what it promises is the village it makes, checked above.
  if (promisesProtection(req.name, parseIntents(req.intents)) && parseIntents(req.intents).includes("protect") && req.form !== "settlement") {
    phase = "protect";
    const probe = yield* protectProbe(req);
    const withSaved = { ...stats, saved: probe.saved };
    if (!probe.ok) return { ok: false, problem: "promise", detail: probe.detail, stats: withSaved };
    result = { ok: true, problem: null, detail: `${detail} ${probe.detail}`, stats: withSaved };
  }
  // 4.6 part B: a creature is followed for two minutes as a living thing;
  // that is its five minute test too (what it does are its deeds).
  if (req.form === "creature") {
    phase = "creature";
    const probe = yield* creatureProbe(req);
    const withLife = { ...result.stats, acted: probe.acted };
    if (!probe.ok) return { ok: false, problem: "idle", detail: probe.detail, stats: withLife };
    return { ok: true, problem: null, detail: `${result.detail} ${probe.detail}`, stats: withLife };
  }
  // A protection that has just kept a village from fire, lava, a blast and
  // raiders has done what it is for: in five minutes of peace it waits, and
  // waiting is not failing (its villagers' bows no longer count for it).
  const guarded = typeof result.stats.saved === "number";
  // Recorded as having acted (the Worker reads `acted` to know an artifact faced this test).
  if (req.kind === "artifact" && guarded) result = { ...result, stats: { ...result.stats, acted: 1 } };
  if (req.kind === "artifact" && !guarded && !actsByMaking(req.form, before, world)) {
    phase = "acts";
    const acts = yield* actsProbe(req);
    const withActed = { ...result.stats, acted: acts.acted };
    if (!acts.ok) return { ok: false, problem: "idle", detail: acts.detail, stats: withActed };
    result = { ok: true, problem: null, detail: `${result.detail} ${acts.detail}`, stats: withActed };
  }
  return result;
}

// --- 4.6 part B: the creature probe ------------------------------------------

// Placed by the village of the practice island and followed for two
// minutes: its own creatures (or the people it made) must move on their
// plan, pursue a goal, use an ability (night falls a minute in, for night
// magic), go for their prey when one is set near them, and leave the island's
// villagers and animals standing. Exported for npm test.
export const CREATURE_SECONDS = 120;

export interface CreatureLife {
  ok: boolean;
  acted: number;
  detail: string;
  moved: number;
  working: number;
  abilities: number;
  hunted: boolean | null;
  villagersLeft: number;
  animalsLeft: number;
}

export function* creatureProbe(req: CastRequest): Generator<void, CreatureLife> {
  const errors: string[] = [];
  const isl = island(errors);
  const { world, rt, target } = isl;
  Math.random = isl.random;
  const key = `check:${req.key}`;
  const villagersAt = world.creatures.filter((c) => !c.dead && c.kind === "villager").length;
  const animalsAt = world.creatures.filter((c) => !c.dead && KINDS.get(c.kind)?.native).length;
  rt.cast({ ...req, key }, target.x, target.y);
  const own = (): Creature[] => [
    ...world.creatures.filter((c) => !c.dead && rt.owners.get(`creature:${c.kind}`) === key),
    ...(rt.people.get(key) ?? []).filter((c) => !c.dead),
  ];
  // Night a minute in, when one of them has night magic.
  let nightly = false;
  const start = new Map<Creature, { x: number; y: number }>();
  let moved = 0;
  let working = 0;
  let prey: Creature | null = null;
  let hunted: boolean | null = null;
  const ownDeeds = () => own().reduce((sum, c) => sum + (c.mind?.deeds ?? 0), 0);
  const used = () => own().reduce((sum, c) => sum + Number(c.data.used ?? 0), 0);
  let deedsAt = 0;
  // When the last of its own died, if they all did.
  let diedAt = 0;
  for (let k = 0; k < CREATURE_SECONDS / TICK && !errors.length; k++) {
    step(world, rt, isl.life);
    // Two seconds in, after the arrival: what it has, and night set to fall.
    if (k === Math.round(2 / TICK)) {
      for (const c of own()) start.set(c, { x: c.x, y: c.y });
      deedsAt = ownDeeds();
      nightly = own().some((c) => abilitiesOf(c, kindOf(c)).some((a) => a.when === "night"));
      if (nightly) {
        let t = world.time;
        while (daylight(t + 50).night < 0.6 && t < world.time + 400) t += 1;
        world.time = t;
      }
    }
    if (k > 2 / TICK && k % 30 === 0) {
      if (start.size && !diedAt && !own().length) diedAt = Math.round(k * TICK);
      for (const c of own()) {
        const s = start.get(c);
        if (s) moved = Math.max(moved, Math.hypot(c.x - s.x, c.y - s.y));
        const task = c.mind?.task;
        if (task && task !== "none" && task !== "rest") working++;
      }
      // At 40 s, one of what it hunts (a built-in kind) a few cells away.
      if (k === Math.round(40 / TICK) && !prey) {
        const hunter = own().find((c) => (kindOf(c).ai?.prey ?? []).some((p) => KINDS.has(p) && p !== "villager"));
        const kind = hunter && (kindOf(hunter).ai!.prey.find((p) => KINDS.has(p) && p !== "villager") as string);
        if (hunter && kind) {
          prey = makeCreature(kind, Math.max(1, Math.min(world.w - 2, hunter.x + 4)), hunter.y);
          world.creatures.push(prey);
          hunted = false;
          // A hunter goes for its prey when hungry: it is, by then.
          if (hunter.mind) hunter.mind.hunger = Math.max(hunter.mind.hunger, 0.8);
        }
      }
      if (prey && hunted === false && (prey.dead || own().some((c) => c.mind?.target === prey || Math.hypot(c.x - prey!.x, c.y - prey!.y) < 1.6)))
        hunted = true;
    }
    if (k % 5 === 4) {
      yield;
      Math.random = isl.random;
    }
  }
  const villagersLeft = villagersAt ? world.creatures.filter((c) => !c.dead && c.kind === "villager").length / villagersAt : 1;
  const animalsLeft = animalsAt ? world.creatures.filter((c) => !c.dead && KINDS.get(c.kind)?.native).length / animalsAt : 1;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const life = { moved: r2(moved), working, abilities: used(), hunted, villagersLeft: r2(villagersLeft), animalsLeft: r2(animalsLeft) };
  const deeds = ownDeeds() - deedsAt;
  const acted = deeds + life.abilities;
  if (errors.length) return { ok: false, acted: 0, detail: `It crashed while it lived: ${errors[0]}`, ...life };
  const name = req.name;
  const fail = (why: string): CreatureLife => ({ ok: false, acted, detail: `${name} was followed for two minutes as a living thing: ${why}`, ...life });
  if (!start.size) return fail("nothing of its own was alive two seconds after it arrived.");
  if (!own().length)
    return fail(
      `everything it brought was dead ${diedAt} s after it arrived, placed by a village in the morning as a player would. What kills it there: daylight on a creature weak to light, a lifespan of seconds, or the villagers, who fight what scares or hunts them and find it asleep by day. Let it live through its first day: health for a fight, no weakness to light in the open, and awake or hidden when it arrives.`,
    );
  if (moved < 3)
    return fail(`it never moved more than ${life.moved} cells from where it arrived. Give it a speed, a goal and a body that walks, swims or flies.`);
  if (working < 3 && deeds <= 0)
    return fail("it pursued no goal: it never took up a task or did anything. Give it a goal (hunt, gather, tend, guard, explore...).");
  // Asked only of the kinds it wrote: a villager's magic comes with its
  // calling or job (a mage's freeze and blink, for a fight the probe never starts).
  if (life.abilities <= 0 && own().some((c) => c.kind !== "villager" && abilitiesOf(c, kindOf(c)).length))
    return fail(`it never used its abilities${nightly ? ", even at night" : ""}. Give it one that fires without a fight (every so often, or night).`);
  if (hunted === false) return fail(`it ignored a ${prey!.kind} set four cells from it, though it hunts them.`);
  if (villagersLeft < 0.7 || animalsLeft < 0.5)
    return fail(
      `the island did not hold: ${Math.round(villagersLeft * 100)}% of its villagers and ${Math.round(animalsLeft * 100)}% of its animals were left.`,
    );
  const did = [
    `moved ${Math.round(moved)} cells`,
    deeds ? `${deeds} deeds` : `at its task ${working} times`,
    life.abilities ? `${life.abilities} uses of its magic` : "",
    hunted ? `went for a ${prey!.kind}` : "",
  ].filter(Boolean);
  return {
    ok: true,
    acted,
    detail: `Followed for two minutes it lived: ${did.join(", ")}; ${Math.round(villagersLeft * 100)}% of villagers and ${Math.round(animalsLeft * 100)}% of animals left.`,
    ...life,
  };
}

// --- 4.6: kinds and sizes ---------------------------------------------------

interface FormBefore {
  height: Float32Array;
  fluid: Uint8Array;
  decor: Set<number>;
  settlements: number;
  wonders: number;
  buildings: Uint8Array;
  creatureIds: number;
}

function formBefore(world: World): FormBefore {
  const decor = new Set<number>();
  for (const [k] of world.decor) decor.add(k);
  const buildings = new Uint8Array(world.n);
  for (let i = 0; i < world.n; i++) buildings[i] = isBuilding(world.cover[i]) ? 1 : 0;
  return {
    height: world.height.slice(),
    fluid: world.fluid.slice(),
    decor,
    settlements: world.settlements.length,
    wonders: world.wonders.length,
    buildings,
    creatureIds: Math.max(0, ...world.creatures.map((c) => c.id)),
  };
}

// What the item built: its new voxels (how many, how far across, how tall
// above the land under them), the land it reshaped (cells raised or sunk, or
// whose ground or water changed, against the island left alone), its new
// buildings, settlements, wonders and creatures.
export interface Made {
  voxels: number;
  across: number;
  tall: number;
  reshaped: number;
  landAcross: number;
  buildings: number;
  settlements: number;
  wonders: number;
  creatures: number;
  onBuilding: number;
  // Cells raised or sunk, the land's shape itself (paint and water are effects), and how far across.
  lifted: number;
  liftAcross: number;
  // Boxes of its fine models, and how many times it called w.model.
  fine: number;
  models: number;
  // 4.6 part B: people it made with w.person, alive at the end.
  people?: number;
}

function measureMade(
  before: FormBefore,
  world: World,
  ref: Snapshot,
  owners: Map<string, string>,
  key: string,
  raised: number[],
  modelCalls = 0,
  people: Creature[] = [],
  planted: ReadonlySet<number> = new Set(),
): Made {
  // What it built, measured round its middle: its voxels (each a cell) and
  // the parts of its fine models (props.ts), the farthest tenth left out, so
  // one block that strays (a lantern's voxel knocked eleven cells away after
  // the cast) does not make an object a building; a giant stays giant.
  // Marks creatures lay and grow (a cairn, a den, a graveyard's stones) are the island's life, not the item.
  const marks = world.marks;
  interface Part {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    tall: number;
    voxel: boolean;
  }
  const parts: Part[] = [];
  const mine: { x: number; y: number }[] = [];
  for (const [k] of world.decor) {
    if (before.decor.has(k) || planted.has(k)) continue;
    const x = keyX(k);
    const y = keyY(k);
    if (marks.some((mk) => Math.abs(mk.x - x) <= mk.size + 1.5 && Math.abs(mk.y - y) <= mk.size + 1.5)) continue;
    mine.push({ x, y });
    // A voxel spans its cell: x to x + 1.
    parts.push({
      x0: x,
      x1: x + 1,
      y0: y,
      y1: y + 1,
      tall: world.inside(x, y) ? keyLevel(k) + 1 - Math.round(world.height[y * world.w + x] * 0.5) : 0,
      voxel: true,
    });
  }
  const voxels = mine.length;
  let fine = 0;
  for (const p of world.props) {
    if (p.key !== key) continue;
    fine += p.boxes.length;
    for (const b of p.boxes) {
      const one = propBounds({ ...p, boxes: [b] });
      // A prop's (x, y) is a cell's corner in these units, as a voxel's is.
      parts.push({ x0: one.x0 + 0.5, x1: one.x1 + 0.5, y0: one.y0 + 0.5, y1: one.y1 + 0.5, tall: one.tall, voxel: false });
    }
  }
  const mid = (list: number[]) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;
  const mx = mid(parts.map((v) => (v.x0 + v.x1) / 2));
  const my = mid(parts.map((v) => (v.y0 + v.y1) / 2));
  const dist = (v: Part) => Math.hypot((v.x0 + v.x1) / 2 - mx, (v.y0 + v.y1) / 2 - my);
  const kept = parts.sort((a, b) => dist(a) - dist(b)).slice(0, Math.max(1, Math.floor(parts.length * 0.9)));
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let tall = 0;
  for (const v of kept) {
    x0 = Math.min(x0, v.x0);
    x1 = Math.max(x1, v.x1);
    y0 = Math.min(y0, v.y0);
    y1 = Math.max(y1, v.y1);
    tall = Math.max(tall, v.tall);
  }
  const across = parts.length ? Math.round(Math.max(x1 - x0, y1 - y0) * 10) / 10 : 0;
  tall = Math.round(tall * 10) / 10;
  // Voxels it stacked on the cells of a building it raised, which the builder draws.
  const blocks = new Set(raised);
  const onBuilding = mine.filter((v) => world.inside(v.x, v.y) && blocks.has(v.y * world.w + v.x)).length;
  let reshaped = 0;
  let lx0 = Infinity;
  let lx1 = -Infinity;
  let ly0 = Infinity;
  let ly1 = -Infinity;
  let lifted = 0;
  let hx0 = Infinity;
  let hx1 = -Infinity;
  let hy0 = Infinity;
  let hy1 = -Infinity;
  for (let i = 0; i < world.n; i++) {
    if (Math.abs(world.height[i] - ref.height[i]) > 0.4) {
      lifted++;
      const x = i % world.w;
      const y = Math.floor(i / world.w);
      hx0 = Math.min(hx0, x);
      hx1 = Math.max(hx1, x);
      hy0 = Math.min(hy0, y);
      hy1 = Math.max(hy1, y);
    }
    const land = Math.abs(world.height[i] - ref.height[i]) > 0.4 || world.ground[i] !== ref.ground[i] || world.fluid[i] !== ref.fluid[i];
    if (land) {
      reshaped++;
      const x = i % world.w;
      const y = Math.floor(i / world.w);
      lx0 = Math.min(lx0, x);
      lx1 = Math.max(lx1, x);
      ly0 = Math.min(ly0, y);
      ly1 = Math.max(ly1, y);
    }
  }
  // Its own creatures alive at the end, and built-in ones it brought: more
  // new ones of a kind than the island left alone had (rabbits are born in both).
  let creatures = 0;
  const born = new Map<string, number>();
  for (const c of world.creatures) {
    if (c.dead || c.id <= before.creatureIds) continue;
    if (owners.get(`creature:${c.kind}`) === key) creatures++;
    else if (c.kind !== "villager") born.set(c.kind, (born.get(c.kind) ?? 0) + 1);
  }
  for (const [kind, n] of born) creatures += Math.max(0, n - Number(ref.creatures.get(`new:${kind}`) ?? 0));
  return {
    voxels,
    across,
    tall,
    reshaped,
    landAcross: reshaped ? Math.max(lx1 - lx0, ly1 - ly0) + 1 : 0,
    liftAcross: lifted ? Math.max(hx1 - hx0, hy1 - hy0) + 1 : 0,
    // Raised with w.building: a house a village builds from an item's gold is not the item's.
    buildings: Math.round(blocks.size / 4),
    lifted,
    fine,
    models: modelCalls,
    settlements: world.settlements.length - before.settlements,
    wonders: world.wonders.length - before.wonders,
    creatures,
    onBuilding,
    people: people.filter((c) => !c.dead && c.kind === "villager").length,
  };
}

const LABEL: Record<Exclude<Form, "spell">, string> = {
  object: "an object",
  creature: "a creature",
  building: "a building",
  settlement: "a settlement",
  place: "a place",
  land: "land",
};

// Null when the item is what its kind says, at a size that kind can be.
export function formCheck(
  form: Exclude<Form, "spell">,
  name: string,
  giant: boolean,
  before: FormBefore,
  world: World,
  ref: Snapshot,
  owners: Map<string, string>,
  key: string,
  raised: number[] = [],
  modelCalls = 0,
  people: Creature[] = [],
  planted: number[][] = [],
): { problem: "size" | "kind" | "look"; detail: string } | null {
  // A creature or a person may plant a few trees (a druid's oak and birch):
  // its deeds, not its body. Up to three; a forest still counts.
  const trees = form === "creature" ? new Set(planted.slice(0, PLANTED_TREES).flat()) : new Set<number>();
  const m = measureMade(before, world, ref, owners, key, raised, modelCalls, people, trees);
  return judgeMade(form, name, giant, m);
}
export const PLANTED_TREES = 3;

// Its defensive magic, which its name or promise must call for (the owner's
// Serpent, 7 November): the abilities of the kinds it wrote, and its wards.
export function defenceOf(req: CastRequest, owners: Map<string, string>, key: string, wards: number): string | null {
  const abilities = [...owners]
    .filter(([k, v]) => v === key && k.startsWith("creature:"))
    .flatMap(([k]) => KINDS.get(k.slice("creature:".length))?.abilities ?? []);
  return unfitDefence(req.name, parseIntents(req.intents), abilities, wards);
}

export function judgeMade(form: Exclude<Form, "spell">, name: string, giant: boolean, m: Made): { problem: "size" | "kind" | "look"; detail: string } | null {
  const rule = FORM_RULES[form];
  const f = giant ? GIANT_FACTOR : 1;
  // A giant, and a dragon or a titan, may be bigger; never both at once (a "Small Giant").
  const scale = Math.max(f, form === "creature" && bigBeing(name) ? 2 : 1);
  const across = rule.across * scale;
  const tall = rule.tall * scale;
  const most = rule.voxels * scale * scale;
  const giantNote = giant ? "" : ` Only an item whose name or entry says it is giant may be bigger.`;
  const measured = `(${m.voxels} voxels and ${m.fine} fine boxes, ${m.across} cells across, ${m.tall} tall; land reshaped on ${m.reshaped} cells, ${m.landAcross} across, raised or sunk on ${m.lifted}, ${m.liftAcross} across; ${m.buildings} buildings, ${m.settlements} settlements, ${m.wonders} wonders, ${m.creatures} creatures)`;
  // Is it that kind of thing at all?
  const kind = (() => {
    switch (form) {
      case "creature":
        // 4.6 part B: a person is one of the island's villagers (the owner: "real villagers").
        if (personName(name))
          return (m.people ?? 0) > 0
            ? null
            : `${name} is a person, so it is one of the island's own villagers, not a creature kind or a figure: make it with w.person(x, y, {calling, title}).`;
        return m.creatures > 0 || (m.people ?? 0) > 0
          ? null
          : `${name} is a creature, but no living creature of its own was on the island after it arrived: spawn it with w.spawn, from spell.creatures.`;
      case "building":
        return m.buildings > 0 || m.voxels >= 20 || m.fine >= 12
          ? null
          : `${name} is a building, but nothing was built: use w.building(x, y, {job}) for the building itself, then add what is special with the structures.`;
      case "settlement":
        return m.settlements > 0 || m.buildings >= 3
          ? null
          : `${name} is a settlement, but no village was made: use w.village(x, y, {houses}), which lays out houses, a plaza, fields and villagers as the island's own villages are.`;
      case "land":
        return m.reshaped >= 25 || m.voxels >= 60 || m.wonders > 0
          ? null
          : `${name} is land, but the land itself barely changed (${m.reshaped} cells): reshape it with w.land(x, y, {shape, r}), or w.terraform, w.flood and w.paint over its reach.`;
      default:
        return null;
    }
  })();
  if (kind) return { problem: "kind", detail: `${kind} ${measured}` };
  // Its look, at the detail of the island's own wonders (12 to 70 parts, half
  // under a cell, each its own shade: docs/measurements/forms-4.6.md).
  if (m.models > MODELS_PER_ITEM)
    return {
      problem: "look",
      detail: `${name} called w.model ${m.models} times: an item has ${MODELS_PER_ITEM} models at most, and past that its own oldest is taken away. Draw it as one model of up to 80 parts (a garden's flowers in one model), or a few. ${measured}`,
    };
  if (form === "object" && m.fine < 6)
    return {
      problem: "look",
      detail: `${name} is an object, but it is drawn with ${m.fine} fine parts${m.voxels ? ` and ${m.voxels} whole voxels` : ""}: a whole voxel is as big as a villager's body. Draw it with w.model in 6 to 40 boxes at its real size (a lantern's frame and glass, a book's covers and pages, a sword's blade, guard and grip), on what bears it. ${measured}`,
    };
  if (form === "place" && !m.wonders && m.fine < 8 && m.voxels < 20 && m.lifted < 10)
    return {
      problem: "look",
      detail: `${name} is a place, but nothing stands there: raise it with w.wonder, shape its land with w.land or w.terraform, or draw what stands there with w.model in fine parts (a rim of stones round a pool, an altar, a ring of mushrooms). ${measured}`,
    };
  if (form === "object" && (m.buildings > 0 || m.settlements > 0 || m.lifted > 12 * f))
    return {
      problem: "size",
      detail: `${name} is an object, something a hand holds or a table bears, but it built ${m.buildings ? "a building" : m.settlements ? "a village" : `land: ${m.lifted} cells raised or sunk`}. Keep its look to a small thing on a pedestal at most, and let what it does reach further through w.artifact.${giantNote} ${measured}`,
    };
  if (m.onBuilding >= 6)
    return {
      problem: "size",
      detail: `${name} stacked ${m.onBuilding} voxels on the cells of the building it raised, which the island's builder draws: build what is special at b.beside, next to it, never on it. ${measured}`,
    };
  if ((form === "creature" || form === "building") && m.settlements > 0)
    return { problem: "size", detail: `${name} is ${LABEL[form]}, but it founded a whole village. ${measured}` };
  // The land it raised or sank: within its kind's reach, and for what is not land itself, a plinth at most.
  const plinth: Partial<Record<Exclude<Form, "spell">, number>> = { creature: 12, building: 60 };
  const mostLifted = plinth[form];
  if (m.liftAcross > across || (mostLifted !== undefined && m.lifted > mostLifted * scale))
    return {
      problem: "size",
      detail: `${name} reshaped too much land for ${LABEL[form]}: ${m.lifted} cells raised or sunk, ${m.liftAcross} across (at most ${across} across${mostLifted !== undefined ? ` and ${mostLifted * scale} cells` : ""}).${giantNote} ${measured}`,
    };
  const over =
    m.across > across
      ? `${m.across} cells across (at most ${across})`
      : m.tall > tall
        ? `${m.tall} voxels tall (at most ${tall})`
        : m.voxels > most
          ? `${m.voxels} voxels (at most ${most})`
          : "";
  if (over) {
    const scale: Record<Exclude<Form, "spell">, string> = {
      object: "an object fits in a hand: a voxel or two on a pedestal, an altar or a lectern, never a statue of itself",
      creature: "a creature is its body, drawn beside a villager; what it builds stays small",
      building: "a building stands beside a house (two by two cells, two voxels tall); a temple or a tower is a few houses, not a mountain",
      settlement: "a village is about thirty cells across",
      place: "a place reaches 4 to 14 cells, like the island's wonders",
      land: "land reaches as far as its tier",
    };
    return { problem: "size", detail: `${name} is too big for ${LABEL[form]}: ${over}; ${scale[form]}.${giantNote} ${measured}` };
  }
  return null;
}

// A building, a settlement, a place or land acts through what the engine
// made of it: a job that works for its village, villagers at their work, a
// wonder doing what it does, water and lava running on new land. Their five
// minute test is the making itself; any other artifact still faces it.
function actsByMaking(form: string | undefined, before: FormBefore, world: World): boolean {
  if (form === "settlement") return world.settlements.length > before.settlements;
  if (form === "place") return world.wonders.length > before.wonders;
  if (form === "building") {
    for (let i = 0; i < world.n; i++)
      if (!before.buildings[i] && isBuilding(world.cover[i]) && world.cover[i] !== C.HOUSE && settlementNear(world, i % world.w, Math.floor(i / world.w)))
        return true;
    return false;
  }
  if (form === "land") {
    let n = 0;
    for (let i = 0; i < world.n && n < 25; i++) if (Math.abs(world.height[i] - before.height[i]) > 0.4 || world.fluid[i] !== before.fluid[i]) n++;
    return n >= 25;
  }
  return false;
}

// The five minute test of an artifact (3.7). Placed by the village of the
// practice island, it is left alone for five simulated minutes, and must
// have changed something: deeds of its own (an effect, a grant villagers
// used, a pair), or after its arrival (its first 15 seconds) deeds of the
// creatures it brought, cells of its own materials that keep spreading, or a
// body of its own still at work. A statue that only stands there fails.
export const ACT_SECONDS = 300;
const ACT_FROM = 15;

// 4.2: the five minute test stops as soon as the artifact has acted, since
// nothing after that can make it fail: once a second it looks at what the
// end of the test would count (its deeds, its creatures' deeds since the
// arrival, its material spreading, a body of its own at work for 30 s). An
// artifact that never acts still runs the full five minutes. `full` runs
// every test to the end, to compare (scripts/test-run-timing.ts).
let fullActs = false;
export function fullActsProbe(on: boolean): void {
  fullActs = on;
}

function* actsProbe(req: CastRequest): Generator<void, { ok: boolean; acted: number; detail: string }> {
  const errors: string[] = [];
  const isl = island(errors);
  const { world, rt, target } = isl;
  Math.random = isl.random;
  const key = `check:${req.key}`;
  rt.cast({ ...req, key }, target.x, target.y);
  const owned = (what: string) => rt.owners.get(what) === key;
  const creatureDeeds = () => world.creatures.reduce((sum, c) => sum + (owned(`creature:${c.kind}`) ? (c.mind?.deeds ?? 0) : 0), 0);
  const materialCells = () => {
    let n = 0;
    for (const layer of ["ground", "cover", "fluid"] as const) {
      const ids = world.materials.list[layer].map((m) => owned(`${layer}:${m.name}`));
      if (!ids.some(Boolean)) continue;
      const cells = world[layer];
      for (let i = 0; i < world.n; i++) if (ids[cells[i]]) n++;
    }
    return n;
  };
  let deedsAt = 0;
  let cellsAt = 0;
  let bodySeconds = 0;
  // What was done to it (worshipped, guarded, robbed, taken) is not its doing.
  const ownDeeds = () => world.landmarks.filter(isArtifact).reduce((sum, a) => sum + (a.art.key === key ? a.art.deeds - passiveDeeds(a) : 0), 0);
  for (let k = 0; k < ACT_SECONDS / TICK && !errors.length; k++) {
    step(world, rt, isl.life);
    if (k === Math.round(ACT_FROM / TICK)) {
      deedsAt = creatureDeeds();
      cellsAt = materialCells();
    }
    if (k > ACT_FROM / TICK && k % 30 === 0 && rt.visuals.bodies.some((b) => b.alive && b.look !== "none")) bodySeconds++;
    if (!fullActs && k % 30 === 29) {
      const after = k > ACT_FROM / TICK;
      if (ownDeeds() > 0 || bodySeconds >= 30 || (after && creatureDeeds() - deedsAt > 0) || (after && Math.abs(materialCells() - cellsAt) >= MIN_CELLS)) break;
    }
    if (k % 5 === 4) {
      yield;
      Math.random = isl.random;
    }
  }
  if (errors.length) return { ok: false, acted: 0, detail: `It crashed during its five minute test: ${errors[0]}` };
  const own = world.landmarks.filter(isArtifact).filter((l) => l.art.key === key);
  // Its own deeds count from the start: a Phoenix Feather that revives the
  // corpse beside it at once has acted. What else changed counts after the
  // arrival, when the placing itself is over.
  const artDeeds = own.reduce((sum, a) => sum + a.art.deeds - passiveDeeds(a), 0);
  const kinDeeds = Math.max(0, creatureDeeds() - deedsAt);
  const spread = Math.abs(materialCells() - cellsAt);
  const acted = artDeeds + kinDeeds + (spread >= MIN_CELLS ? 1 : 0) + (bodySeconds >= 30 ? 1 : 0);
  const did = [
    artDeeds ? `${artDeeds} things done by the artifact${own[0]?.art.did.length ? ` (${own[0].art.did.join(", ")})` : ""}` : "",
    kinDeeds ? `${kinDeeds} by its creatures` : "",
    spread >= MIN_CELLS ? `its material changed by ${spread} cells` : "",
    bodySeconds >= 30 ? `a body of its own at work for ${bodySeconds} s` : "",
  ].filter(Boolean);
  if (acted > 0) return { ok: true, acted, detail: `After five minutes it had kept acting: ${did.join("; ")}.` };
  return {
    ok: false,
    acted: 0,
    detail: `Placed by a village and left alone for five minutes, it changed nothing after it arrived: no effect, nothing villagers or creatures used, no creature of its own at work, no material spreading (villagers bowing to it, guarding it or carrying it off is their doing, not its own). Make it do what its name does with w.artifact: effects on a trigger (code of its own in act), grants villagers use, or pairs.`,
  };
}

// The protection probe (3.4.2). The spell is cast on the village; three seconds
// later a threat hits the same spot. What its reach covered at the cast (the
// houses, and the villagers by their health) is counted nine seconds later,
// against the same threat with no spell and against no threat at all. Each
// threat is a small hostile spell going through the same World API, so a
// ward has to stop what a player's Fireball would do, not a test double.
// A threat that does no harm on its own is not counted.
const THREAT_AT = 3;
const PROBE_END = 12;
const SAVED_ENOUGH = 0.5;
const R_CODE = "const R = Math.max(4, Math.min(w.r, w.width * 0.25));";
const THREATS: { name: string; label: string; code: string }[] = [
  {
    name: "fire",
    label: "a rain of fire",
    code: `const spell = { *cast(w) { ${R_CODE} for (let k = 0; k < 8; k++) { w.ignite(w.x, w.y, R, 0.3); for (const c of w.creatures(w.x, w.y, R)) if (c.kind === "villager") c.status("burn", 3); yield 0.5; } } };`,
  },
  {
    name: "lava",
    label: "a flood of lava",
    code: `const spell = { *cast(w) { ${R_CODE} w.flood(w.x, w.y, R, "lava", 1.4); yield 1.5; w.flood(w.x, w.y, R * 0.7, "lava", 1); } };`,
  },
  {
    name: "blast",
    label: "a blast",
    code: `const spell = { *cast(w) { ${R_CODE} w.explode(w.x, w.y, R * 0.8, 1.6); } };`,
  },
  {
    name: "raiders",
    label: "raiders hunting its people",
    code: `const spell = {
  creatures: [{ name: "probe raider", base: "beast", color: "#5a1020", speed: 6, hp: 400, behavior: "hunt", prey: ["villager"], attack: 45, sense: 60, lifespan: 30 }],
  *cast(w) { ${R_CODE} for (let k = 0; k < 6; k++) { const a = k * 1.047; w.spawn("probe raider", w.x + Math.cos(a) * (R + 5), w.y + Math.sin(a) * (R + 5)); } } };`,
  },
];

function probeRadius(tier: Tier): number {
  return Math.max(4, Math.min(Math.max(2, Math.round(TIER_REACH[tier] * SIZE)), SIZE * 0.25));
}

interface Region {
  houses: number[];
  villagers: Set<number>;
}

function regionOf(world: World, target: { x: number; y: number }, r: number): Region {
  const houses: number[] = [];
  for (let i = 0; i < world.n; i++) {
    if (world.cover[i] !== C.HOUSE) continue;
    if (Math.hypot((i % world.w) - target.x, Math.floor(i / world.w) - target.y) <= r) houses.push(i);
  }
  const villagers = new Set(
    world.creatures.filter((c) => c.kind === "villager" && !c.dead && Math.hypot(c.x - target.x, c.y - target.y) <= r).map((c) => c.id),
  );
  return { houses, villagers };
}

// A house standing counts one (a 2 by 2 house is four cells), a villager one at full health.
function regionValue(world: World, region: Region): number {
  let v = 0;
  for (const i of region.houses) if (world.cover[i] === C.HOUSE) v += 0.25;
  for (const c of world.creatures) if (region.villagers.has(c.id) && !c.dead && c.kind === "villager") v += Math.max(0, Math.min(1, c.hp / 100));
  return v;
}

function* probeRun(spell: CastRequest | null, threat: (typeof THREATS)[number] | null, tier: Tier): Generator<void, { value: number; error?: string }> {
  const errors: string[] = [];
  const isl = island(errors);
  const { world, rt, target } = isl;
  Math.random = isl.random;
  const region = regionOf(world, target, probeRadius(tier));
  if (spell) rt.cast({ ...spell, key: `check:${spell.key}` }, target.x, target.y);
  for (let k = 0; k < PROBE_END / TICK; k++) {
    if (threat && k === Math.round(THREAT_AT / TICK))
      rt.cast({ key: `threat:${threat.name}`, name: threat.label, tier, code: threat.code }, target.x, target.y);
    step(world, rt, isl.life);
    if (k % 5 === 4) {
      yield;
      Math.random = isl.random;
    }
  }
  return { value: regionValue(world, region), error: errors[0] };
}

// Runs without the spell never change: kept between checks.
const probeCache = new Map<string, number>();

function* cachedRun(threat: (typeof THREATS)[number] | null, tier: Tier): Generator<void, number> {
  const key = `${threat?.name ?? "none"}:${probeRadius(tier)}`;
  const known = probeCache.get(key);
  if (known !== undefined) return known;
  const { value } = yield* probeRun(null, threat, tier);
  probeCache.set(key, value);
  return value;
}

function* protectProbe(req: CastRequest): Generator<void, { ok: boolean; saved: number; detail: string }> {
  const base = yield* cachedRun(null, req.tier);
  const lines: string[] = [];
  const shares: number[] = [];
  for (const threat of THREATS) {
    const without = yield* cachedRun(threat, req.tier);
    const harm = base - without;
    if (harm < 0.75) continue;
    const run = yield* probeRun(req, threat, req.tier);
    if (run.error) return { ok: false, saved: 0, detail: `It crashed during its protection test: ${run.error}` };
    const saved = Math.max(-1, Math.min(1.5, (run.value - without) / harm));
    shares.push(saved);
    lines.push(`${threat.label}: ${Math.round(Math.max(0, saved) * 100)}% of the harm prevented`);
  }
  if (!shares.length) return { ok: true, saved: 1, detail: "Its protection test found nothing to protect." };
  const saved = Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 100) / 100;
  if (saved >= SAVED_ENOUGH) return { ok: true, saved, detail: `It protected what it covered (${lines.join("; ")}).` };
  return {
    ok: false,
    saved,
    detail: `It promises protection, but the village it covers was barely safer with it than without it (${lines.join("; ")}). Raise w.ward over what it protects within two seconds of the cast, lasting at least 15 seconds, with no solid shell over people.`,
  };
}

// The living island (3.6), on the same island and with the same seeded
// streams as the probes above. A scene is cast as a spell through the World
// API, like the threats: a dragon that hoards, a vampire, three more wolves,
// gold and a shrine, beside the villages, forest and wildlife the island
// already has. Then nothing is done for `seconds`. It answers what the player
// would see after walking away: did every creature change something, and did
// any kind explode or vanish?
export const SCENE = `const spell = {
  materials: [{ name: "gold", layer: "ground", colors: ["#ffd23d", "#f5c518"], lures: ["villager"], taken: true }],
  artifacts: [
    { name: "Well", radius: 8, charges: 4, recharge: 40, effects: [{ when: "dawn", do: "water", radius: 9 }], grants: [{ what: "water" }] },
    { name: "Lantern Post", radius: 7, effects: [{ when: "night", do: "light", every: 10 }], uses: [{ do: "destroy", by: ["vampire"] }], health: 300 },
  ],
  creatures: [
    { name: "dragon", base: "beast", body: "dragon", color: "#8a1c1c", color2: "#e0a030", flying: true, fireproof: true, hp: 900, speed: 4,
      goal: "hoard", prey: ["deer", "boar"], attack: 30, sense: 14, scares: ["villager"],
      abilities: [{ do: "breathe fire", when: "enemy near", every: 12 }] },
    { name: "vampire", base: "villager", color: "#3a0d1e", goal: "convert", behavior: "hunt", prey: ["villager"], attack: 40, converts: true,
      active: "night", weak: ["light"], hp: 400, speed: 4, abilities: [{ do: "teleport", when: "hurt", every: 12 }] },
  ],
  *cast(w) {
    // Dry land near a point, on the island.
    const dry = (x, y) => {
      for (let k = 0; k < 60; k++) {
        const px = Math.max(4, Math.min(w.width - 5, x + w.rand(-10, 10)));
        const py = Math.max(4, Math.min(w.height - 5, y + w.rand(-10, 10)));
        const c = w.cell(px, py);
        if (c.depth < 0.05 && c.cover !== "tree" && c.cover !== "house" && c.cover !== "boulder") return [px, py];
      }
      return [x, y];
    };
    const toward = (t) => [w.x + (w.width / 2 - w.x) * t, w.y + (w.height / 2 - w.y) * t];
    w.paint(w.x - 4, w.y + 4, 2, "gold", 1);
    w.landmark(w.x - 6, w.y + 2, { name: "shrine", scares: ["vampire"], aura: "heal", radius: 5 });
    w.artifact(w.x + 3, w.y - 3, "Well");
    w.artifact(w.x - 2, w.y - 5, "Lantern Post");
    const [dx, dy] = dry(...toward(0.9));
    w.spawn("dragon", dx, dy);
    const [vx, vy] = dry(...toward(1.2));
    w.spawn("vampire", vx, vy);
    const [fx, fy] = dry(...toward(1.4));
    for (let k = 0; k < 3; k++) w.spawn("wolf", fx + k * 0.7, fy);
  },
};`;

export interface SceneReport {
  seconds: number;
  // Living creatures by kind: at the start (after the scene arrived), the fewest and most seen, and at the end.
  kinds: Record<string, { start: number; min: number; max: number; end: number }>;
  // Creatures there at the start that lived at least `idleAfter` seconds and changed nothing.
  idle: { id: number; kind: string; action: string }[];
  // How many of those creatures changed something, by kind, of how many.
  lively: Record<string, [number, number]>;
  marks: Record<string, number>;
  deeds: Record<string, number>;
  // Every placed artifact and what it did (3.7).
  artifacts: { name: string; deeds: number; did: string[] }[];
  // Who caught whom ("wolf caught a deer": 3), 4.3.
  catches: Record<string, number>;
  errors: string[];
  worstTickMs: number;
  meanTickMs: number;
}

export function* sceneRun(
  seconds: number,
  extra: CastRequest | null = null,
  idleAfter = 150,
  // Dev scripts look in once a second.
  watch?: (world: World) => void,
  streams = 0,
): Generator<void, SceneReport> {
  const outer = Math.random;
  try {
    const errors: string[] = [];
    const isl = island(errors, streams);
    const { world, rt, target } = isl;
    Math.random = isl.random;
    const caught = logCatches(true)!;
    rt.cast({ key: "scene", name: "The five minute scene", tier: "major", code: SCENE }, target.x, target.y);
    if (extra) rt.cast({ ...extra, key: `check:${extra.key}` }, target.x, target.y);
    // The scene's creatures come in on the first tick.
    step(world, rt, isl.life);
    const tally = () => {
      const t = new Map<string, number>();
      for (const c of world.creatures) if (!c.dead) t.set(base(c.kind), (t.get(base(c.kind)) ?? 0) + 1);
      return t;
    };
    const kinds: SceneReport["kinds"] = {};
    for (const [k, n] of tally()) kinds[k] = { start: n, min: n, max: n, end: n };
    // Everyone there now, and how long each lived.
    const watched = new Map(world.creatures.filter((c) => !c.dead).map((c) => [c, 0]));
    let worst = 0;
    let total = 0;
    const ticks = Math.round(seconds / TICK);
    for (let k = 0; k < ticks; k++) {
      const t0 = performance.now();
      step(world, rt, isl.life);
      const ms = performance.now() - t0;
      if (k > 30) worst = Math.max(worst, ms);
      total += ms;
      if (k % 30 === 0) {
        watch?.(world);
        for (const [c, lived] of watched) if (!c.dead) watched.set(c, lived + 1);
        const t = tally();
        for (const key of new Set([...Object.keys(kinds), ...t.keys()])) {
          const n = t.get(key) ?? 0;
          const e = (kinds[key] ??= { start: 0, min: n, max: n, end: n });
          e.min = Math.min(e.min, n);
          e.max = Math.max(e.max, n);
          e.end = n;
        }
      }
      if (k % 5 === 4) {
        yield;
        Math.random = isl.random;
      }
    }
    const idle: SceneReport["idle"] = [];
    const lively: SceneReport["lively"] = {};
    const deeds: Record<string, number> = {};
    for (const [c, lived] of watched) {
      const did = (c.mind?.deeds ?? 0) > 0;
      const key = base(c.kind);
      const row = (lively[key] ??= [0, 0]);
      row[1]++;
      if (did) row[0]++;
      deeds[key] = (deeds[key] ?? 0) + (c.mind?.deeds ?? 0);
      if (!did && lived >= idleAfter)
        idle.push({ id: c.id, kind: key === "villager" ? `${unpackLook(c.look).age} ${unpackLook(c.look).job}` : key, action: c.mind?.action ?? "no mind" });
    }
    const marks: Record<string, number> = {};
    for (const m of world.marks) marks[m.kind] = (marks[m.kind] ?? 0) + m.size;
    const artifacts = world.landmarks.filter(isArtifact).map((a) => ({ name: a.name, deeds: a.art.deeds, did: a.art.did }));
    return {
      seconds,
      kinds,
      idle,
      lively,
      marks,
      deeds,
      artifacts,
      catches: Object.fromEntries(caught),
      errors,
      worstTickMs: Math.round(worst * 10) / 10,
      meanTickMs: Math.round((total / ticks) * 100) / 100,
    };
  } finally {
    Math.random = outer;
    logCatches(false);
  }
}

const base = (kind: string) => kind.split("#")[0];

export function runScene(seconds: number, extra: CastRequest | null = null, idleAfter = 150, watch?: (world: World) => void, streams = 0): SceneReport {
  const it = sceneRun(seconds, extra, idleAfter, watch, streams);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

export function runCheck(req: CastRequest): CheckResult {
  const it = checkProgram(req);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
