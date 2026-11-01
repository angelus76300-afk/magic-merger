import type { Delivery, Effect } from "../../shared/spell";
import { bodyOf, maxHp, type Creature } from "./creatures";
import { growTree } from "./grid";
import { FLAME, GAS, LIQUID, M, MATERIALS, POWDER, STATIC, materialByName } from "./materials";
import type { World } from "./world";

export interface Area {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  contains(x: number, y: number): boolean;
}

export function areaOf(effect: Effect, cx: number, cy: number, r: number, h: number): Area {
  if (effect.shape === "column") {
    const half = Math.max(2, r * 0.5);
    return box(cx - half, cx + half, 0, Math.min(h - 1, cy + r * 0.5), (x) => Math.abs(x - cx) <= half);
  }
  if (effect.shape === "ground") {
    // An ellipse, not a box: hard rectangular edges in the terrain read as a bug.
    const half = r * 1.6;
    const tall = Math.max(2, r * 0.4);
    return box(cx - half, cx + half, cy - tall, cy + tall, (x, y) => ((x - cx) / half) ** 2 + ((y - cy) / tall) ** 2 <= 1);
  }
  return box(cx - r, cx + r, cy - r, cy + r, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
}

function box(x0: number, x1: number, y0: number, y1: number, test: (x: number, y: number) => boolean): Area {
  return {
    x0: Math.floor(x0),
    x1: Math.ceil(x1),
    y0: Math.floor(y0),
    y1: Math.ceil(y1),
    contains: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && test(x, y),
  };
}

export interface EffectContext {
  world: World;
  effect: Effect;
  cx: number;
  cy: number;
  r: number;
  dt: number;
  // Instant effects act once at full strength; lasting ones act a little each tick.
  instant: boolean;
  // Seconds left for a lasting effect.
  remaining: number;
  delivery: Delivery;
  // True the first time a given creature is touched by this effect in this cast.
  firstTouch(c: Creature): boolean;
}

export function applyEffect(ctx: EffectContext): void {
  const { world, effect, cx, cy, r } = ctx;
  const area = areaOf(effect, cx, cy, r, world.grid.h);
  for (const c of world.creatures) {
    const { h } = bodyOf(c);
    if (area.contains(c.x, c.y - h / 2)) affectCreature(ctx, c);
  }
  affectTerrain(ctx, area);
  if (effect.verb === "summon" && effect.creature !== "none" && ctx.firstTouch(SUMMON_MARKER)) {
    const n = 1 + Math.round(4 * effect.strength);
    for (let i = 0; i < n; i++) {
      const x = Math.min(world.grid.w - 3, Math.max(2, cx + (Math.random() - 0.5) * 2 * Math.max(3, r)));
      world.spawn(effect.creature, x, cy - 4);
      sparkle(world, x, cy - 3, 0xffffff);
    }
  }
}

// A stand in creature so "summon" happens once per cast like the other once only verbs.
const SUMMON_MARKER = { id: -1 } as Creature;

function affectCreature(ctx: EffectContext, c: Creature): void {
  const { effect, instant, dt, cx, cy } = ctx;
  const s = effect.strength;
  const rate = instant ? 1 : dt;
  const lasting = (base: number) => (effect.duration > 0 ? ctx.remaining + 0.1 : base);

  switch (effect.verb) {
    case "revive":
      if (c.dead && ctx.firstTouch(c)) {
        c.dead = false;
        c.hp = maxHp(c) * (0.3 + 0.5 * s);
        sparkle(ctx.world, c.x, c.y - 3, 0xfff3b0);
      }
      return;
    case "teleport":
      if (ctx.firstTouch(c)) {
        c.x = 3 + Math.random() * (ctx.world.grid.w - 6);
        c.y = 3;
        c.vy = 0;
      }
      return;
  }
  if (c.dead) return;

  switch (effect.verb) {
    case "damage":
      c.hp -= (instant ? 70 : 40) * s * rate;
      break;
    case "heal":
      c.hp = Math.min(maxHp(c), c.hp + (instant ? 80 : 40) * s * rate);
      c.burning = 0;
      c.frozen = 0;
      if (Math.random() < 0.2) sparkle(ctx.world, c.x, c.y - 4, 0x80ed99);
      break;
    case "grow_plants":
      c.hp = Math.min(maxHp(c), c.hp + 10 * s * rate);
      break;
    case "ignite":
      if (c.type !== "spirit" && c.type !== "golem") c.burning = Math.max(c.burning, 2 + 5 * s);
      c.frozen = 0;
      break;
    case "freeze":
      c.frozen = Math.max(c.frozen, lasting(2 + 6 * s));
      c.burning = 0;
      break;
    case "heat":
      c.frozen = 0;
      if (s > 0.7 && Math.random() < s * rate) c.burning = Math.max(c.burning, 2);
      break;
    case "cool":
      c.burning = 0;
      if (s > 0.7 && Math.random() < s * rate * 0.5) c.frozen = Math.max(c.frozen, 1 + 3 * s);
      break;
    case "push":
    case "pull": {
      const dx = c.x - cx;
      const dy = c.y - 2 - cy;
      const len = Math.hypot(dx, dy) || 1;
      const sign = effect.verb === "push" ? 1 : -1;
      const force = (instant ? 18 + 40 * s : (30 + 60 * s) * dt) * sign;
      c.vx += (dx / len) * force;
      c.vy += (dy / len) * force - (instant ? 8 * s : 0);
      c.stun = Math.max(c.stun, 0.6);
      break;
    }
    case "levitate":
      c.levitate = Math.max(c.levitate, lasting(2 + 4 * s));
      break;
    case "fear":
      c.fear = Math.max(c.fear, lasting(4 + 6 * s));
      c.fearX = cx;
      c.sleep = 0;
      break;
    case "calm":
      c.fear = 0;
      c.calm = Math.max(c.calm, lasting(2 + 4 * s));
      if (Math.random() < 0.1) sparkle(ctx.world, c.x, c.y - 5, 0xffc8dd);
      break;
    case "sleep":
      c.sleep = Math.max(c.sleep, lasting(3 + 7 * s));
      break;
    case "shrink":
      if (ctx.firstTouch(c)) c.size = Math.max(0.4, c.size * (1 - 0.5 * s));
      break;
    case "enlarge":
      if (ctx.firstTouch(c)) c.size = Math.min(3, c.size * (1 + 0.6 * s));
      break;
    case "transform":
      if (effect.creature !== "none" && ctx.firstTouch(c)) {
        const ratio = c.hp / maxHp(c);
        c.type = effect.creature;
        c.hp = maxHp(c) * ratio;
        sparkle(ctx.world, c.x, c.y - 2, 0xb48cff);
      }
      break;
    case "quake":
      if (Math.random() < s * rate) {
        c.stun = Math.max(c.stun, 0.5);
        c.vy -= 6 + 10 * s * Math.random();
      }
      break;
  }
}

function affectTerrain(ctx: EffectContext, area: Area): void {
  const { world, effect, instant, dt, cx, cy, r } = ctx;
  const grid = world.grid;
  const s = effect.strength;
  const p = instant ? s : Math.min(1, s * dt * 3);
  const material = materialByName(effect.material);
  const verb = effect.verb;
  if (!TERRAIN_VERBS.has(verb)) return;
  const solidMaterial = MATERIALS[material].behavior === STATIC;

  // Instant spawn, erase and convert carve a clean round shape instead of noise.
  const blob = instant && effect.shape === "circle" && (verb === "spawn" || verb === "erase" || verb === "convert");
  const blobR = r * (0.35 + 0.65 * s);
  // Spells are aimed at the ground, so a blob centered on the target would lose
  // its lower half inside the earth. A spawned blob is lifted to sit on top of
  // the ground and then falls or flows from there.
  const blobY = verb === "spawn" ? cy - blobR : cy;
  // Rain only spawns in the top rows of the area and lets it fall.
  const rainTop = verb === "spawn" && ctx.delivery === "rain" && !blob;
  // Rain starts a little above the target, not at the top of the sky: from up
  // there a tall column took seconds to land, long after the spell had ended.
  const rainY0 = Math.max(area.y0, Math.floor(cy - Math.max(16, r * 2)));
  let trees = 0;
  const maxTrees = 1 + Math.round(3 * s);
  // Solid material cannot float, so solid "rain" (hail, crystal shards) settles
  // straight onto the surface below and piles up there, like snow.
  if (rainTop && solidMaterial) {
    for (let x = Math.max(0, area.x0); x <= Math.min(grid.w - 1, area.x1); x++) {
      if (Math.random() >= p) continue;
      let y = Math.max(0, rainY0);
      while (y < grid.h - 1 && grid.get(x, y + 1) === M.EMPTY) y++;
      if (grid.get(x, y) === M.EMPTY && area.contains(x, y)) grid.set(x, y, material);
    }
    return;
  }
  // A blob is its own shape: it may reach outside the effect area once lifted.
  const bounds = blob
    ? { x0: Math.floor(cx - blobR), x1: Math.ceil(cx + blobR), y0: Math.floor(blobY - blobR), y1: Math.ceil(blobY + blobR) }
    : area;

  for (let y = Math.max(0, rainTop ? rainY0 : bounds.y0); y <= Math.min(grid.h - 1, bounds.y1); y++) {
    if (rainTop && y > rainY0 + 2) break;
    for (let x = Math.max(0, bounds.x0); x <= Math.min(grid.w - 1, bounds.x1); x++) {
      if (!blob && !area.contains(x, y)) continue;
      const inBlob = blob && (x - cx) ** 2 + (y - blobY) ** 2 <= blobR * blobR;
      if (blob ? !inBlob : Math.random() >= p) continue;
      const m = grid.get(x, y);
      const info = MATERIALS[m];

      switch (verb) {
        case "spawn":
          // Scattered solid material would hang in the air as noise, so outside
          // a carved blob it only builds on something already there.
          if (m === M.EMPTY && material !== M.EMPTY && (blob || !solidMaterial || grid.get(x, y + 1) !== M.EMPTY)) {
            grid.set(x, y, material);
          }
          break;
        case "erase":
          if (m !== M.EMPTY) grid.set(x, y, M.EMPTY);
          break;
        case "convert":
          if (m !== M.EMPTY && material !== M.EMPTY) grid.set(x, y, material);
          break;
        case "ignite":
          if (info.flammable > 0) grid.set(x, y, M.FIRE, m);
          else if (m === M.EMPTY && Math.random() < 0.15) grid.set(x, y, M.FIRE);
          else if (m === M.WATER && Math.random() < 0.1) grid.set(x, y, M.STEAM);
          else if (m === M.ICE && Math.random() < 0.3) grid.set(x, y, M.WATER);
          break;
        case "heat":
          if (m === M.ICE) grid.set(x, y, M.WATER);
          else if (m === M.WATER && Math.random() < 0.5) grid.set(x, y, M.STEAM);
          else if (info.flammable > 0 && s > 0.6 && Math.random() < 0.5) grid.set(x, y, M.FIRE, m);
          break;
        case "freeze":
          if (m === M.WATER) grid.set(x, y, M.ICE);
          else if (m === M.LAVA) grid.set(x, y, M.STONE);
          else if (m === M.FIRE) grid.set(x, y, M.EMPTY);
          else if (m === M.STEAM) grid.set(x, y, M.WATER);
          break;
        case "cool":
          if (m === M.FIRE) grid.set(x, y, Math.random() < 0.5 ? M.SMOKE : M.EMPTY);
          else if (m === M.LAVA) grid.set(x, y, M.STONE);
          else if (m === M.STEAM) grid.set(x, y, M.WATER);
          else if (m === M.WATER && s > 0.5 && Math.random() < 0.5) grid.set(x, y, M.ICE);
          break;
        case "push":
        case "pull":
        case "levitate":
          if (isLoose(info.behavior)) displace(world, x, y, verb, cx, cy);
          break;
        case "grow_plants":
          if (m === M.DIRT && grid.get(x, y - 1) === M.EMPTY) grid.set(x, y, M.GRASS);
          // A one shot cast gets one chance per cell, so it needs better odds to sprout anything.
          else if (m === M.GRASS && grid.get(x, y - 1) === M.EMPTY && trees < maxTrees && Math.random() < (instant ? 0.15 : 0.04)) {
            growTree(grid, x, y - 1, grid.rng);
            trees++;
          }
          break;
        case "quake":
          if ((m === M.DIRT || m === M.GRASS) && Math.random() < 0.35) grid.set(x, y, M.GRAVEL);
          else if (m === M.STONE && Math.random() < 0.15) grid.set(x, y, M.GRAVEL);
          else if (m === M.LEAVES && Math.random() < 0.2) grid.set(x, y, M.EMPTY);
          break;
        case "damage":
          if (s > 0.6 && m === M.LEAVES) grid.set(x, y, M.EMPTY);
          break;
      }
    }
  }
}

const TERRAIN_VERBS = new Set([
  "spawn",
  "erase",
  "convert",
  "ignite",
  "heat",
  "freeze",
  "cool",
  "push",
  "pull",
  "levitate",
  "grow_plants",
  "quake",
  "damage",
]);

function isLoose(behavior: number): boolean {
  return behavior === POWDER || behavior === LIQUID || behavior === GAS || behavior === FLAME;
}

// Moves one loose cell a short way: away from or toward the center, or up.
function displace(world: World, x: number, y: number, verb: string, cx: number, cy: number): void {
  const grid = world.grid;
  let tx = x;
  let ty = y - 1;
  if (verb !== "levitate") {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const sign = verb === "push" ? 1 : -1;
    const dist = 1 + Math.floor(Math.random() * 3);
    tx = Math.round(x + (dx / len) * dist * sign);
    ty = Math.round(y + (dy / len) * dist * sign) - 1;
  }
  if (grid.get(tx, ty) !== M.EMPTY) return;
  const i = y * grid.w + x;
  const m = grid.mat[i];
  const fuel = grid.fuel[i];
  grid.set(x, y, M.EMPTY);
  grid.set(tx, ty, m, fuel);
}

function sparkle(world: World, x: number, y: number, color: number): void {
  for (let i = 0; i < 6; i++) {
    world.particles.add(x, y, (Math.random() - 0.5) * 8, -Math.random() * 6, 0.6 + Math.random() * 0.4, color, 1, true);
  }
}

