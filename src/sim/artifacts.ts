import { TIERS, type Tier } from "../../shared/tiers";
import { daylight } from "./daylight";
import { C, F, G } from "./materials";
import { names, type Landmark } from "./social";
import { packLook, unpackLook } from "./villagers";
import { WARD, addWard, warded } from "./wards";
import { deed, life, markAt, mindOf, reborn, remember, villageOf } from "./kin";
import type { Creature } from "./creatures";
import type { World } from "./world";

// Artifacts that act (3.7). A placed artifact used to be a look (voxels, a
// creature, a landmark that lures or scares) and nothing more: after its
// arrival it changed nothing. `w.artifact` makes it a thing of the island
// with a life of its own:
//
// 1. effects over time and on triggers: at dawn or dusk, by night or day,
//    every so often, in a drought, when fire, an enemy or a death comes near;
// 2. state: charges that recharge, fuel that burns down, health that
//    creatures can wear away, all saved with the world;
// 3. grants that villagers come to use (draw water, arm themselves, pray,
//    take food, be healed, take gold) and uses that creatures act on (steal
//    from it, guard it, destroy it, worship it);
// 4. declared pairs: near a corpse, a kind, another artifact or a material,
//    it does something (a Phoenix Feather near a corpse revives it).
//
// Effects are a vocabulary of engine actions, plus `cast:<spell>` (a spell
// from the shared library, at a capped tier) and code of its own, like
// abilities. Every effect goes through the same rules as spells: fire and
// frost stop at wards, a flood never fills a house.

export const ART_EFFECTS = [
  "water",
  "rain",
  "heal",
  "grow",
  "freeze",
  "burn",
  "lightning",
  "shield",
  "light",
  "food",
  "gold",
  "revive",
  "summon",
  "cast",
] as const;
export type ArtEffectName = (typeof ART_EFFECTS)[number] | "code";
export const ART_WHENS = ["dawn", "dusk", "night", "day", "every", "drought", "fire", "enemy", "death", "hurt"] as const;
export type ArtWhen = (typeof ART_WHENS)[number];
export const ART_GRANTS = ["water", "arms", "prayer", "food", "heal", "gold"] as const;
export type ArtGrantName = (typeof ART_GRANTS)[number];
export const ART_USES = ["steal", "guard", "destroy", "worship"] as const;
export type ArtUseName = (typeof ART_USES)[number];

export interface ArtEffect {
  when: ArtWhen;
  every: number;
  do: ArtEffectName;
  // summon: a kind; cast: a spell's name; code: the index of its function.
  arg: string;
  radius: number;
  cost: number;
  next: number;
  // Night for dawn and dusk, a second ago.
  was: number;
}

export interface ArtGrant {
  what: ArtGrantName;
  to: string[];
  cost: number;
}

export interface ArtUse {
  do: ArtUseName;
  by: string[];
}

export interface ArtPair {
  with: string;
  within: number;
  do: ArtEffectName;
  arg: string;
  once: boolean;
  done: boolean;
  every: number;
  next: number;
}

export interface ArtState {
  id: number;
  // The spell that placed it, and its tier: library spells it casts never exceed it.
  key: string;
  tier: Tier;
  charges: number | null;
  maxCharges: number;
  // Seconds per charge back.
  recharge: number;
  rechargeAt: number;
  // Seconds of burning left; effects wait while it is out.
  fuel: number | null;
  maxFuel: number;
  health: number | null;
  maxHealth: number;
  effects: ArtEffect[];
  grants: ArtGrant[];
  uses: ArtUse[];
  pairs: ArtPair[];
  // What happens when its health runs out: an effect, or nothing.
  onBreak: ArtEffectName | null;
  // Things it did (its own deeds and those it let others do), the last ones.
  deeds: number;
  did: string[];
  placed: number;
  // Deeds after the arrival (the first 15 s), for the five minute test.
  later: number;
  // Seconds of world time when it was last hurt (for "hurt").
  hurtAt: number;
}

export type Artifact = Landmark & { art: ArtState };

export function isArtifact(l: Landmark): l is Artifact {
  return !!(l as Artifact).art;
}

export function artifactsOf(world: World): Artifact[] {
  return world.landmarks.filter(isArtifact);
}

// What the runtime does for artifacts: their code, and library spells.
export interface ArtHooks {
  run(a: Artifact, fn: string, target: Creature | null): boolean;
  // at: an enemy to aim at; without one, a spell that harms is not cast.
  cast(spell: string, x: number, y: number, cap: Tier, by: string, enemy: boolean): boolean;
}

// Artifacts cast library spells at most at major; creatures at minor (abilities.ts).
export const ARTIFACT_CAST_CAP: Tier = "major";

export function capTier(a: Tier, b: Tier): Tier {
  return TIERS.indexOf(a) <= TIERS.indexOf(b) ? a : b;
}

const ARRIVAL = 15;

export function artDeed(world: World, a: Artifact, what: string): void {
  a.art.deeds++;
  if (world.time - a.art.placed > ARRIVAL) a.art.later++;
  a.art.did = [what, ...a.art.did.filter((d) => d !== what)].slice(0, 3);
}

function cell(world: World, x: number, y: number): number {
  return Math.max(0, Math.min(world.w - 1, Math.round(x))) + Math.max(0, Math.min(world.h - 1, Math.round(y))) * world.w;
}

function puff(world: World, x: number, y: number, color: number, n = 6): void {
  for (let k = 0; k < n; k++)
    world.particles.add({
      x: x + (Math.random() - 0.5) * 2,
      y: y + (Math.random() - 0.5) * 2,
      z: 1 + Math.random(),
      vz: 1.5 + Math.random(),
      life: 0.8,
      color,
      size: 1.2,
      glow: true,
    });
}

function land(world: World, i: number): boolean {
  return world.height[i] > world.seaLevel && world.fluid[i] !== F.LAVA;
}

// Share of the land around it that is dry and bare: a drought.
function dryness(world: World, x: number, y: number, r: number): number {
  let dry = 0;
  let n = 0;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const d = r * (0.3 + 0.7 * ((k * 7) % 10) * 0.1);
    const i = cell(world, x + Math.cos(a) * d, y + Math.sin(a) * d);
    if (!land(world, i) || world.cover[i] === C.HOUSE) continue;
    n++;
    const g = world.ground[i];
    const green = g === G.GRASS || g === G.FIELD || world.cover[i] === C.CROP || world.cover[i] === C.TREE || world.cover[i] === C.BUSH;
    if (!green && world.depth[i] < 0.05) dry++;
  }
  return n ? dry / n : 0;
}

function enemyNear(world: World, x: number, y: number, r: number): Creature | null {
  let best: Creature | null = null;
  let bestD = r;
  for (const o of world.crowd.near(world, x, y, r)) {
    if (o.dead || !life.hostile(o)) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function fireNear(world: World, x: number, y: number, r: number): number {
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2;
    const i = cell(world, x + Math.cos(a) * r * ((k % 3) + 1) * 0.33, y + Math.sin(a) * r * ((k % 3) + 1) * 0.33);
    if (world.fire[i] > 0.1) return i;
  }
  return -1;
}

// Does one effect at (x, y); false when there was nothing to do it on.
export function doEffect(world: World, a: Artifact, what: ArtEffectName, arg: string, r: number, target: Creature | null): boolean {
  const x = a.x;
  const y = a.y;
  switch (what) {
    case "water":
    case "rain": {
      // A well waters the dry fields and crops around it; rain falls wider and puts fires out.
      const reach = what === "rain" ? r : Math.min(r, 10);
      const tries = what === "rain" ? 60 : 30;
      let n = 0;
      for (let k = 0; k < tries; k++) {
        const i = cell(world, x + (Math.random() - 0.5) * 2 * reach, y + (Math.random() - 0.5) * 2 * reach);
        if (!land(world, i) || world.cover[i] === C.HOUSE || warded(world, i, WARD.fluids)) continue;
        if (world.fire[i] > 0) {
          world.fire[i] = 0;
          n++;
        }
        const g = world.ground[i];
        const thirsty = g === G.FIELD || g === G.SAND || g === G.DIRT || g === G.ASH || world.cover[i] === C.CROP;
        if (!thirsty && what === "water") continue;
        if (world.fluid[i] === F.NONE || world.fluid[i] === F.WATER) {
          world.setFluid(i, F.WATER, Math.max(world.depth[i], 0.08));
          if ((g === G.DIRT || g === G.ASH) && Math.random() < 0.3) world.ground[i] = G.GRASS;
          if (g === G.FIELD && world.cover[i] === C.NONE && Math.random() < 0.3) world.setCover(i, C.CROP);
          n++;
        }
      }
      if (what === "rain")
        for (let k = 0; k < 20; k++)
          world.particles.add({
            x: x + (Math.random() - 0.5) * 2 * r,
            y: y + (Math.random() - 0.5) * 2 * r,
            z: 9,
            vz: -8,
            life: 1,
            color: 0x9fc8ff,
            size: 0.8,
            glow: false,
          });
      else puff(world, x, y, 0x7ab8ff, 4);
      return n > 0;
    }
    case "heal": {
      let n = 0;
      for (const o of world.crowd.near(world, x, y, r)) {
        if (o.dead || life.hostile(o) || (o.hp >= life.maxHp(o) * 0.9 && o.burning <= 0)) continue;
        o.hp = Math.min(life.maxHp(o), o.hp + 30);
        o.burning = 0;
        remember(o, a.name, 1);
        puff(world, o.x, o.y, 0x9dffb0, 3);
        n++;
      }
      return n > 0;
    }
    case "grow": {
      let n = 0;
      for (let k = 0; k < 14 && n < 5; k++) {
        const i = cell(world, x + (Math.random() - 0.5) * 2 * r, y + (Math.random() - 0.5) * 2 * r);
        if (!land(world, i) || world.depth[i] > 0.05 || world.fire[i] > 0) continue;
        if (world.ground[i] === G.DIRT || world.ground[i] === G.ASH) world.ground[i] = G.GRASS;
        else if (world.cover[i] === C.STUMP) world.setCover(i, C.TREE);
        else if (world.ground[i] === G.GRASS && world.cover[i] === C.NONE) world.setCover(i, Math.random() < 0.6 ? C.FLOWER : C.BUSH);
        else continue;
        n++;
      }
      if (n) puff(world, x, y, 0x9dffb0, 4);
      return n > 0;
    }
    case "freeze":
    case "burn":
    case "lightning": {
      const t = target && !target.dead ? target : enemyNear(world, x, y, r);
      if (!t) return false;
      const i = cell(world, t.x, t.y);
      if (what === "freeze") {
        if (warded(world, i, WARD.cold)) return false;
        t.frozen = Math.max(t.frozen, 3);
        world.temp[i] = Math.min(world.temp[i], -10);
        puff(world, t.x, t.y, 0xbfe8ff, 6);
      } else if (what === "burn") {
        if (warded(world, i, WARD.fire)) return false;
        if (!life.kindOf(t).fireproof) t.burning = Math.max(t.burning, 3);
        t.hp -= 12;
        puff(world, t.x, t.y, 0xff7a1a, 6);
      } else {
        if (warded(world, i, WARD.lightning)) return false;
        t.hp -= 35;
        t.stun = Math.max(t.stun, 1);
        world.emit({ kind: "flash", color: 0xdfe8ff, strength: 0.2 });
        world.emit({ kind: "sound", name: "zap", size: 0.4 });
        puff(world, t.x, t.y, 0xdfe8ff, 8);
      }
      remember(t, a.name, -1);
      if (t.hp <= 0) t.dead = true;
      return true;
    }
    case "shield": {
      if (world.wards.some((w) => Math.hypot(w.x - x, w.y - y) < r * 0.5)) return false;
      addWard(world, {
        x,
        y,
        r: Math.min(r, 12),
        against: WARD.creatures | WARD.harm | WARD.fire | WARD.fluids,
        from: world.time,
        until: world.time + 12,
        color: a.color,
        keepOut: [],
        allow: [],
        owner: "artifact",
        hit: 0,
      });
      return true;
    }
    case "light": {
      // A light in the dark: what hunts by night keeps away.
      if (daylight(world.time).night < 0.4) return false;
      let n = 0;
      for (const o of world.crowd.near(world, x, y, r)) {
        if (o.dead || !life.hostile(o)) continue;
        o.fear = Math.max(o.fear, 3);
        o.fearX = x;
        o.fearY = y;
        n++;
      }
      puff(world, x, y, 0xffe9a0, 3);
      return n > 0 || Math.random() < 0.3;
    }
    case "food":
    case "gold": {
      const v = villageOf(world, x, y);
      if (!v) return false;
      if (what === "food") v.food += 1;
      else v.gold += 1;
      puff(world, x, y, what === "food" ? 0xe0c14a : 0xf2c94c, 3);
      return true;
    }
    case "revive": {
      const t =
        target && target.dead
          ? target
          : world.creatures.find((o) => o.dead && o.deadFor < 35 && !o.data.eaten && Math.abs(o.x - x) <= r && Math.abs(o.y - y) <= r);
      if (!t) return false;
      t.dead = false;
      t.deadFor = 0;
      t.vz = 0;
      t.z = 0;
      t.hp = life.maxHp(t) * 0.8;
      t.burning = 0;
      t.data = {};
      reborn(t);
      remember(t, a.name, 1);
      puff(world, t.x, t.y, 0xffb347, 10);
      world.emit({ kind: "sound", name: "chime", size: 0.4 });
      return true;
    }
    case "summon": {
      const kind = arg || "spirit";
      let near = 0;
      for (const o of world.crowd.near(world, x, y, 16)) if (o.kind === kind && !o.dead) near++;
      if (near >= 4 || world.creatures.length > 480) return false;
      const s = life.make(kind, x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3);
      s.homeX = x;
      s.homeY = y;
      world.creatures.push(s);
      puff(world, s.x, s.y, a.color, 5);
      return true;
    }
    case "cast":
      return (
        !!arg &&
        !!world.magic?.cast(arg, target ? target.x : x, target ? target.y : y, capTier(a.art.tier, ARTIFACT_CAST_CAP), a.name, !!target && !target.dead)
      );
    case "code":
      return !!world.magic?.run(a, arg, target);
  }
  return false;
}

const WORDS: Record<ArtEffectName, string> = {
  water: "watered the fields",
  rain: "called rain",
  heal: "healed the wounded",
  grow: "made the land grow",
  freeze: "froze an enemy",
  burn: "burned an enemy",
  lightning: "struck an enemy with lightning",
  shield: "raised a ward",
  light: "kept the dark away",
  food: "fed the village",
  gold: "gave gold",
  revive: "brought the dead back to life",
  summon: "called a creature",
  cast: "cast a spell",
  code: "acted",
};

// Pays for an effect: a charge, fuel to burn. False when it is spent.
function canPay(a: Artifact, cost: number): boolean {
  const s = a.art;
  if (s.fuel !== null && s.fuel <= 0) return false;
  return s.charges === null || s.charges >= cost;
}
function pay(a: Artifact, cost: number): void {
  if (a.art.charges !== null) a.art.charges = Math.max(0, a.art.charges - cost);
}

// Once a second per artifact, staggered: state, then triggers, then pairs.
export function stepArtifacts(world: World): void {
  if (!world.landmarks.length) return;
  const night = daylight(world.time).night;
  let broken = false;
  for (const l of world.landmarks) {
    if (!isArtifact(l)) continue;
    const s = l.art;
    if ((world.tick + s.id) % 30 !== 0) continue;
    // State: charges come back, fuel burns, fire wears it down.
    if (s.charges !== null && s.charges < s.maxCharges && world.time >= s.rechargeAt) {
      s.charges++;
      s.rechargeAt = world.time + s.recharge;
    }
    if (s.fuel !== null) s.fuel = Math.max(0, s.fuel - 1);
    const here = cell(world, l.x, l.y);
    if (s.health !== null && world.fire[here] > 0.3 && !warded(world, here, WARD.fire)) hurtArtifact(world, l, 4);
    if (s.health !== null && s.health <= 0) {
      broken = true;
      continue;
    }
    for (const e of s.effects) {
      const wasNight = e.was;
      e.was = night;
      if (world.time < e.next) continue;
      let fire = false;
      let target: Creature | null = null;
      switch (e.when) {
        case "dawn":
          fire = wasNight > 0.4 && night <= 0.4;
          break;
        case "dusk":
          fire = wasNight < 0.4 && night >= 0.4;
          break;
        case "night":
          fire = night > 0.6;
          break;
        case "day":
          fire = night < 0.2;
          break;
        case "every":
          fire = true;
          break;
        case "drought":
          fire = dryness(world, l.x, l.y, e.radius) > 0.55;
          break;
        case "fire":
          fire = fireNear(world, l.x, l.y, e.radius) >= 0;
          break;
        case "enemy":
          target = enemyNear(world, l.x, l.y, e.radius);
          fire = !!target;
          break;
        case "death":
          fire = world.deaths.some((d) => d.t > world.time - 1.5 && Math.abs(d.x - l.x) <= e.radius && Math.abs(d.y - l.y) <= e.radius);
          if (fire) target = world.creatures.find((o) => o.dead && o.deadFor < 2 && Math.abs(o.x - l.x) <= e.radius && Math.abs(o.y - l.y) <= e.radius) ?? null;
          break;
        case "hurt":
          fire = world.time - s.hurtAt < 1.5;
          break;
      }
      if (!fire || !canPay(l, e.cost)) continue;
      const done = doEffect(world, l, e.do, e.arg, e.radius, target);
      // Dawn and dusk come once a day; the rest wait their cooldown, or a
      // few seconds when there was nothing to do it on.
      e.next = world.time + (done ? e.every : Math.min(e.every, 4));
      if (done) {
        pay(l, e.cost);
        artDeed(world, l, WORDS[e.do]);
      }
    }
    for (const p of s.pairs) {
      if ((p.once && p.done) || world.time < p.next || !canPay(l, 1)) continue;
      const partner = partnerOf(world, l, p);
      if (!partner) continue;
      const done = doEffect(world, l, p.do, p.arg, p.within, partner.creature);
      p.next = world.time + (done ? p.every : 3);
      if (!done) continue;
      pay(l, 1);
      p.done = true;
      artDeed(world, l, `${WORDS[p.do]} with ${partner.label}`);
      if (partner.artifact) artDeed(world, partner.artifact, `${WORDS[p.do]} with the ${l.name}`);
    }
  }
  if (broken) world.landmarks = world.landmarks.filter((l) => !isArtifact(l) || l.art.health === null || l.art.health > 0);
}

// What a pair is with: a corpse, a creature kind, another artifact by name, or a material.
function partnerOf(world: World, a: Artifact, p: ArtPair): { creature: Creature | null; artifact: Artifact | null; label: string } | null {
  const w = p.with;
  const r = p.within;
  if (w === "corpse" || w === "dead") {
    const c = world.creatures.find((o) => o.dead && o.deadFor < 35 && !o.data.eaten && Math.abs(o.x - a.x) <= r && Math.abs(o.y - a.y) <= r);
    return c ? { creature: c, artifact: null, label: "a corpse" } : null;
  }
  for (const o of world.landmarks)
    if (o !== a && isArtifact(o) && o.name.toLowerCase() === w && Math.hypot(o.x - a.x, o.y - a.y) <= r)
      return { creature: null, artifact: o, label: `the ${o.name}` };
  for (const o of world.crowd.near(world, a.x, a.y, r))
    if (!o.dead && names([w], o.kind)) return { creature: o, artifact: null, label: `a ${o.kind.split("#")[0]}` };
  for (const layer of ["cover", "ground", "fluid"] as const) {
    const id = world.materials.id(layer, w);
    if (id <= 0) continue;
    for (let k = 0; k < 20; k++) {
      const i = cell(world, a.x + (Math.random() - 0.5) * 2 * r, a.y + (Math.random() - 0.5) * 2 * r);
      if (world[layer][i] === id) return { creature: null, artifact: null, label: w };
    }
  }
  return null;
}

export function hurtArtifact(world: World, a: Artifact, n: number): void {
  const s = a.art;
  if (s.health === null) return;
  s.health = Math.max(0, s.health - n);
  s.hurtAt = world.time;
  if (s.health === 0) {
    if (s.onBreak) doEffect(world, a, s.onBreak, "", a.radius, null);
    world.emit({ kind: "sound", name: "thump", size: 0.4 });
    for (let k = 0; k < 10; k++) world.particles.add({ x: a.x, y: a.y, z: 1, vz: 3 + Math.random() * 2, life: 1, color: a.color, size: 1.4, glow: false });
  }
}

// --- Grants and uses: the goal side (goals.ts asks, then reports back). ---

// Who may use what. Villagers: water for farmers and anyone in a drought;
// arms for grown villagers who are not guards (three guards a village at
// most); prayer for anyone, priests first; food when the village is short;
// healing for the wounded; gold for merchants and the poor.
function wantsGrant(world: World, c: Creature, g: ArtGrant, a: Artifact): boolean {
  // A grant is for villagers unless it names other kinds.
  if (g.to.length ? !names(g.to, c.kind) : c.kind !== "villager") return false;
  if (c.kind !== "villager") return g.what === "heal" ? c.hp < life.maxHp(c) * 0.7 : g.what === "food" ? mindOf(c).hunger > 0.4 : true;
  const look = unpackLook(c.look);
  const v = villageOf(world, c.homeX, c.homeY);
  switch (g.what) {
    case "water":
      return look.age !== "child" && (look.job === "farmer" || dryness(world, a.x, a.y, 10) > 0.4 || Math.random() < 0.3);
    case "arms": {
      if (look.age !== "adult" || look.job === "guard" || look.job === "priest") return false;
      let guards = 0;
      for (const o of world.creatures)
        if (!o.dead && o.kind === "villager" && unpackLook(o.look).job === "guard" && Math.abs(o.homeX - c.homeX) < 20 && Math.abs(o.homeY - c.homeY) < 20)
          guards++;
      return guards < 3 + (v ? Math.floor(v.people / 8) : 0);
    }
    case "prayer":
      return look.job === "priest" || Math.random() < 0.35;
    case "food":
      return !v || v.food < 8 || mindOf(c).hunger > 0.5;
    case "heal":
      return c.hp < life.maxHp(c) * 0.8 || c.burning > 0;
    case "gold":
      return look.job === "merchant" || !v || v.gold < 2;
  }
  return false;
}

export interface Visit {
  id: number;
  kind: "grant" | "use";
  n: number;
}

// The artifact a creature might go to now, if any: what it grants this
// creature, or what this kind does to it. At most once every 40 seconds a
// creature, so artifacts add to a day without taking it over.
export function artifactVisit(world: World, c: Creature): { a: Artifact; visit: Visit } | null {
  if (!world.landmarks.length) return null;
  const last = (c.data.usedArt as number | undefined) ?? -1e9;
  if (world.time - last < 40) return null;
  let best: { a: Artifact; visit: Visit } | null = null;
  let bestD = 24;
  for (const l of world.landmarks) {
    if (!isArtifact(l)) continue;
    const d = Math.hypot(l.x - c.x, l.y - c.y);
    if (d >= bestD) continue;
    const s = l.art;
    s.grants.forEach((g, n) => {
      if (canPay(l, g.cost) && wantsGrant(world, c, g, l)) {
        best = { a: l, visit: { id: s.id, kind: "grant", n } };
        bestD = d;
      }
    });
    s.uses.forEach((u, n) => {
      if (!names(u.by, c.kind)) return;
      if (u.do === "steal" && (mindOf(c).carry || (s.charges !== null && s.charges < 1))) return;
      if (u.do === "destroy" && s.health === null) return;
      best = { a: l, visit: { id: s.id, kind: "use", n } };
      bestD = d;
    });
  }
  // Nothing to do there: look again later, not every decision.
  if (!best) c.data.usedArt = world.time - 30;
  return best;
}

// At the artifact: the grant or the use takes effect. False when it no longer can.
export function useArtifact(world: World, c: Creature, visit: Visit): boolean {
  const a = world.landmarks.find((l): l is Artifact => isArtifact(l) && l.art.id === visit.id);
  c.data.usedArt = world.time;
  if (!a) return false;
  const s = a.art;
  if (visit.kind === "grant") {
    const g = s.grants[visit.n];
    if (!g || !canPay(a, g.cost)) return false;
    const v = villageOf(world, c.homeX, c.homeY);
    let what = "";
    switch (g.what) {
      case "water": {
        // Drawn and carried to the dry fields of its village.
        const home = v ?? { x: c.homeX, y: c.homeY };
        let n = 0;
        for (let k = 0; k < 24 && n < 4; k++) {
          const i = cell(world, home.x + (Math.random() - 0.5) * 24, home.y + (Math.random() - 0.5) * 24);
          const gr = world.ground[i];
          if (!land(world, i) || world.cover[i] === C.HOUSE || !(gr === G.FIELD || gr === G.SAND || gr === G.DIRT || world.cover[i] === C.CROP)) continue;
          if (world.fluid[i] !== F.NONE && world.fluid[i] !== F.WATER) continue;
          world.setFluid(i, F.WATER, Math.max(world.depth[i], 0.08));
          if (gr === G.FIELD && world.cover[i] === C.NONE) world.setCover(i, C.CROP);
          n++;
        }
        what = `drew water at the ${a.name}`;
        break;
      }
      case "arms":
        if (c.kind === "villager") {
          const look = unpackLook(c.look);
          c.look = packLook({ ...look, job: "guard" });
          const m = mindOf(c);
          m.job = null;
        }
        what = `armed at the ${a.name}`;
        break;
      case "prayer":
        c.calm = Math.max(c.calm, 5);
        c.fear = 0;
        c.hp = Math.min(life.maxHp(c), c.hp + 10);
        markAt(world, "offerings", a.x, a.y, c.kind, 2);
        what = `prayed at the ${a.name}`;
        break;
      case "food":
        if (v) v.food += 2;
        mindOf(c).hunger = Math.max(0, mindOf(c).hunger - 0.5);
        what = `took food from the ${a.name}`;
        break;
      case "heal":
        c.hp = life.maxHp(c);
        c.burning = 0;
        what = `was healed by the ${a.name}`;
        break;
      case "gold":
        if (v) v.gold += 1;
        else mindOf(c).carry = "gold";
        what = `took gold from the ${a.name}`;
        break;
    }
    pay(a, g.cost);
    remember(c, a.name, 1);
    deed(c, what);
    artDeed(world, a, what.replace(` at the ${a.name}`, "").replace(` from the ${a.name}`, "").replace(` by the ${a.name}`, ""));
    return true;
  }
  const u = s.uses[visit.n];
  if (!u) return false;
  const kind = c.kind.split("#")[0];
  switch (u.do) {
    case "steal":
      if (s.charges !== null) {
        if (s.charges < 1) return false;
        s.charges -= 1;
      }
      mindOf(c).carry = "loot";
      deed(c, `stole from the ${a.name}`);
      artDeed(world, a, `was robbed by a ${kind}`);
      return true;
    case "guard":
      c.homeX = a.x;
      c.homeY = a.y;
      deed(c, `guarded the ${a.name}`);
      artDeed(world, a, `was guarded by a ${kind}`);
      return true;
    case "destroy":
      hurtArtifact(world, a, 25);
      deed(c, `battered the ${a.name}`);
      artDeed(world, a, `was battered by a ${kind}`);
      return true;
    case "worship":
      markAt(world, "offerings", a.x, a.y, kind, 2);
      c.calm = Math.max(c.calm, 5);
      deed(c, `worshipped the ${a.name}`);
      artDeed(world, a, `was worshipped by a ${kind}`);
      return true;
  }
  return false;
}

// --- What a spell declares, bounded. ---

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().toLowerCase().slice(0, 30))
    .filter(Boolean)
    .slice(0, 8);

const WHEN_WORDS: Record<string, ArtWhen> = {
  morning: "dawn",
  sunrise: "dawn",
  evening: "dusk",
  sunset: "dusk",
  "every so often": "every",
  often: "every",
  always: "every",
  dry: "drought",
  "enemy near": "enemy",
  enemies: "enemy",
  attacked: "hurt",
  hit: "hurt",
  dies: "death",
  "friend dies": "death",
};
const EFFECT_WORDS: Record<string, ArtEffectName> = {
  waters: "water",
  "water fields": "water",
  storm: "rain",
  "call rain": "rain",
  ward: "shield",
  protect: "shield",
  "raise the dead": "revive",
  resurrect: "revive",
  revives: "revive",
  feed: "food",
  "breathe fire": "burn",
  fire: "burn",
  frost: "freeze",
};
const GRANT_WORDS: Record<string, ArtGrantName> = {
  draw: "water",
  "draw water": "water",
  arm: "arms",
  weapons: "arms",
  pray: "prayer",
  worship: "prayer",
  feed: "food",
  healing: "heal",
};

// An effect's do: one of the vocabulary, "summon:<kind>", "cast:<spell>", or
// a function (code); index is where its function is kept.
function effectOf(raw: Record<string, unknown>, index: string): { do: ArtEffectName; arg: string } | null {
  if (typeof raw.act === "function") return { do: "code", arg: index };
  const d = String(raw.do ?? raw.effect ?? "").trim();
  const lower = d.toLowerCase();
  if (lower.startsWith("summon:")) return { do: "summon", arg: lower.slice(7).trim().slice(0, 30) };
  if (lower.startsWith("cast:")) return { do: "cast", arg: d.slice(5).trim().slice(0, 60) };
  if (typeof raw.spell === "string" && (lower === "cast" || !lower)) return { do: "cast", arg: raw.spell.trim().slice(0, 60) };
  const name = (ART_EFFECTS as readonly string[]).includes(lower) ? (lower as ArtEffectName) : EFFECT_WORDS[lower];
  if (!name || name === "cast") return null;
  return {
    do: name,
    arg:
      name === "summon"
        ? String(raw.kind ?? "spirit")
            .toLowerCase()
            .slice(0, 30)
        : "",
  };
}

let nextArt = 1;

// The state of an artifact from what `w.artifact` was given. Functions are
// not kept (a save holds data); the runtime keeps them by the index each one
// is given here.
export function artifactState(o: Record<string, unknown>, key: string, tier: Tier, now: number, radius: number): ArtState {
  const id = nextArt++;
  const charges = o.charges === undefined ? null : num(o.charges, 0, 99, 3);
  const fuel = o.fuel === undefined ? null : num(o.fuel, 1, 3600, 300);
  const health = o.health === undefined ? null : num(o.health, 1, 2000, 100);
  const effects: ArtEffect[] = [];
  (Array.isArray(o.effects) ? o.effects : []).slice(0, 4).forEach((raw, n) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const what = effectOf(r, `effect:${n}`);
    if (!what) return;
    const w = String(r.when ?? r.on ?? "every")
      .trim()
      .toLowerCase();
    const when = (ART_WHENS as readonly string[]).includes(w) ? (w as ArtWhen) : (WHEN_WORDS[w] ?? "every");
    const minEvery = what.do === "cast" ? 30 : when === "dawn" || when === "dusk" ? 60 : 3;
    effects.push({
      when,
      every: num(r.every, minEvery, 600, when === "dawn" || when === "dusk" ? 120 : 20),
      do: what.do,
      arg: what.arg,
      radius: num(r.radius, 1, 30, Math.max(4, radius)),
      cost: charges === null ? 0 : num(r.cost, 0, 10, 1),
      next: now + 2,
      was: 0,
    });
  });
  const grants: ArtGrant[] = [];
  for (const raw of (Array.isArray(o.grants) ? o.grants : typeof o.grants === "string" ? [o.grants] : []).slice(0, 3)) {
    const r = typeof raw === "string" ? { what: raw } : raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    if (!r) continue;
    const w = String(r.what ?? r.grant ?? r.do ?? "")
      .trim()
      .toLowerCase();
    const what = (ART_GRANTS as readonly string[]).includes(w) ? (w as ArtGrantName) : GRANT_WORDS[w];
    if (what && !grants.some((g) => g.what === what)) grants.push({ what, to: list(r.to), cost: charges === null ? 0 : num(r.cost, 0, 10, 1) });
  }
  const uses: ArtUse[] = [];
  for (const raw of (Array.isArray(o.uses) ? o.uses : []).slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const d = String(r.do ?? r.use ?? "")
      .trim()
      .toLowerCase();
    const by = list(r.by ?? r.kinds);
    if ((ART_USES as readonly string[]).includes(d) && by.length) uses.push({ do: d as ArtUseName, by });
  }
  const pairs: ArtPair[] = [];
  (Array.isArray(o.pairs) ? o.pairs : []).slice(0, 3).forEach((raw, n) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const partner = String(r.with ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 40);
    const what = effectOf(r, `pair:${n}`);
    if (!partner || !what) return;
    pairs.push({
      with: partner,
      within: num(r.within ?? r.radius, 1, 20, 4),
      do: what.do,
      arg: what.arg,
      once: r.once === true,
      done: false,
      every: num(r.every, 3, 600, 20),
      next: now + 1,
    });
  });
  const brk = typeof o.onBreak === "string" ? effectOf({ do: o.onBreak }, "") : null;
  return {
    id,
    key,
    tier,
    charges,
    maxCharges: charges ?? 0,
    recharge: num(o.recharge, 5, 3600, 60),
    rechargeAt: now + num(o.recharge, 5, 3600, 60),
    fuel,
    maxFuel: fuel ?? 0,
    health,
    maxHealth: health ?? 0,
    effects,
    grants,
    uses,
    pairs,
    onBreak: brk && brk.do !== "code" ? brk.do : null,
    deeds: 0,
    did: [],
    placed: now,
    later: 0,
    hurtAt: -1e9,
  };
}

// A saved artifact's state, checked: a save comes from the sandbox like
// anything else and is read again on load.
export function loadedState(raw: unknown): ArtState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as ArtState;
  if (
    typeof s.id !== "number" ||
    typeof s.key !== "string" ||
    !Array.isArray(s.effects) ||
    !Array.isArray(s.grants) ||
    !Array.isArray(s.uses) ||
    !Array.isArray(s.pairs)
  )
    return null;
  nextArt = Math.max(nextArt, s.id + 1);
  s.did = Array.isArray(s.did) ? s.did.filter((d) => typeof d === "string").slice(0, 3) : [];
  return s;
}

// Fresh ids per test island, so two runs of the same check agree.
export function resetArtifactIds(): void {
  nextArt = 1;
}
