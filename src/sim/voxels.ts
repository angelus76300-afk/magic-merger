import { addGas } from "./cells";
import { FACE_STEPS, keyCell, keyLevel, keyOffset, keyX, keyY } from "./voxelkey";
import { DecorStore } from "./decor";
import { C, F, S } from "./materials";
import type { World } from "./world";
import { WARD, wardedAt } from "./wards";

// Free standing voxels (decor) are what spells build above the land: tree
// trunks and crowns, towers, spires, floating rocks. Each has a color and a
// kind, and the kind gives it physics:
//
//   stone   falls when nothing holds it, does not burn
//   wood    falls, burns slowly, spreads fire upward
//   leaf    falls, burns fast, spreads fire to its neighbors
//   ice     falls, melts into water near heat
//   glow    falls, shines at night (crystal, lanterns)
//   magic   floats where it was put and shines (runes, enchanted rocks)
//   float   floats where it was put (clouds, floating islands)
//
// A voxel is held if it touches the land or a floating voxel, directly or
// through other voxels. Whatever is not held falls, so a tree whose trunk
// burns through loses its crown, and stray blocks never hang in the sky.

export const VK = { STONE: 0, WOOD: 1, LEAF: 2, ICE: 3, GLOW: 4, MAGIC: 5, FLOAT: 6 } as const;
export const VOXEL_KINDS = ["stone", "wood", "leaf", "ice", "glow", "magic", "float"] as const;
const ALIASES: Record<string, number> = { rock: 0, metal: 0, bone: 0, trunk: 1, leaves: 2, crystal: 4, light: 4, cloud: 6, floating: 6 };
export type VoxelKind = (typeof VOXEL_KINDS)[number];

const KIND_SHIFT = 0x1000000;

export function packVoxel(color: number, kind: number): number {
  return (color & 0xffffff) + (kind & 7) * KIND_SHIFT;
}
export function voxelColor(v: number): number {
  return v % KIND_SHIFT;
}
export function voxelKind(v: number): number {
  return Math.floor(v / KIND_SHIFT) & 7;
}
export function kindId(name: unknown, fallback: number = VK.STONE): number {
  const n = String(name).toLowerCase();
  const k = VOXEL_KINDS.indexOf(n as VoxelKind);
  return k >= 0 ? k : (ALIASES[n] ?? fallback);
}
export function floats(kind: number): boolean {
  return kind === VK.MAGIC || kind === VK.FLOAT;
}
export function shines(kind: number): boolean {
  return kind === VK.GLOW || kind === VK.MAGIC;
}
function burnable(kind: number): boolean {
  return kind === VK.WOOD || kind === VK.LEAF;
}

function top(world: World, x: number, y: number): number {
  return Math.round(world.height[y * world.w + x] * 0.5);
}

// Physics state kept beside the decor map. Not saved: a reloaded world has
// no fire in its trees and settles again on its first steps.
export class VoxelState {
  burning = new Map<number, number>();
  falling = new Set<number>();
  // How far each falling voxel has dropped, for the landing.
  fell = 0;
  // Fallen leaves that will rot away.
  litter = new Set<number>();
  checkedVersion = -1;
  // Counts voxels taken away: only removals can leave others hanging, so a
  // change that only added voxels is checked less often.
  removals = 0;
  checkedRemovals = 0;
  sinceCheck = 0;
  sinceFire = 0;
  sinceFall = 0;
}

const N6 = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

// Key offsets for the six neighbors.
const D = keyOffset;

export function stepVoxels(world: World, dt: number): void {
  const s = world.voxels;
  if (world.decor.size === 0) {
    s.burning.clear();
    s.falling.clear();
    s.litter.clear();
    return;
  }
  s.sinceCheck += dt;
  s.sinceFire += dt;
  s.sinceFall += dt;

  if (s.falling.size) {
    if (s.sinceFall >= 1 / 20) {
      s.sinceFall = 0;
      fall(world);
    }
  } else if (world.decorVersion !== s.checkedVersion && (s.checkedVersion === -1 || s.sinceCheck >= (s.removals !== s.checkedRemovals ? 0.25 : 1))) {
    s.checkedRemovals = s.removals;
    s.sinceCheck = 0;
    s.checkedVersion = world.decorVersion;
    findUnsupported(world);
  }
  if (s.sinceFire >= 0.2) {
    fireAndHeat(world, s.sinceFire);
    s.sinceFire = 0;
  }
}

// Flood fill from every held voxel; what is not reached starts to fall.
// Marks and the queue are flat arrays over the store's slots, kept between
// calls: no Set, no garbage, on up to 20000 voxels.
let held = new Uint8Array(0);
const queue = new Int32Array(new DecorStore().slots);
function findUnsupported(world: World): void {
  const { decor, height, w } = world;
  const slots = decor.slots;
  if (held.length !== slots) held = new Uint8Array(slots);
  else held.fill(0);
  // Slots to visit; each is pushed at most once.
  let top = 0;
  let count = 0;
  for (let s = 0; s < slots; s++) {
    if (!decor.isLive(s)) continue;
    const key = decor.keyOf(s);
    if (floats(voxelKind(decor.valueOf(s))) || keyLevel(key) <= Math.round(height[keyY(key) * w + keyX(key)] * 0.5)) {
      held[s] = 1;
      queue[top++] = s;
      count++;
    }
  }
  const steps = FACE_STEPS;
  while (top > 0) {
    const key = decor.keyOf(queue[--top]);
    for (let d = 0; d < 6; d++) {
      const n = decor.slot(key + steps[d]);
      if (n >= 0 && !held[n]) {
        held[n] = 1;
        queue[top++] = n;
        count++;
      }
    }
  }
  if (count === decor.size) return;
  const s = world.voxels;
  for (let slot = 0; slot < slots; slot++) if (decor.isLive(slot) && !held[slot]) s.falling.add(decor.keyOf(slot));
  s.fell = 0;
  s.sinceFall = 0;
}

// Moves every falling voxel one level down, together. When any of them hits
// the land or a resting voxel, they all stop and support is checked again,
// which sends on whatever is still loose.
function fall(world: World): void {
  const { decor } = world;
  const s = world.voxels;
  let landed = false;
  for (const key of s.falling) {
    const { x, y, level } = keyCell(key);
    const below = key - 1;
    if (level - 1 < top(world, x, y) || (decor.has(below) && !s.falling.has(below)) || level - 1 < -60) {
      landed = true;
      break;
    }
  }
  if (landed) {
    land(world);
    return;
  }
  const moved: [number, number][] = [];
  for (const key of s.falling) {
    const v = decor.get(key);
    if (v !== undefined) moved.push([key - 1, v]);
    decor.delete(key);
  }
  const next = new Set<number>();
  for (const [key, v] of moved) {
    decor.set(key, v);
    next.add(key);
    const b = s.burning.get(key + 1);
    if (b !== undefined) {
      s.burning.delete(key + 1);
      s.burning.set(key, b);
    }
  }
  s.falling = next;
  s.fell++;
  world.decorVersion++;
}

// A fall that ends: heavy things crush what they land on, burning things set
// the ground alight, leaves start to rot.
function land(world: World): void {
  const s = world.voxels;
  const hard = s.fell >= 4;
  const hit = new Map<number, number>();
  for (const key of s.falling) {
    const v = world.decor.get(key);
    if (v === undefined) continue;
    const kind = voxelKind(v);
    const { x, y } = keyCell(key);
    const i = y * world.w + x;
    if (kind === VK.LEAF) s.litter.add(key);
    if (s.burning.has(key)) world.fire[i] = Math.max(world.fire[i], 0.7);
    if (hard && kind !== VK.LEAF && kind !== VK.FLOAT) hit.set(i, (hit.get(i) ?? 0) + 1);
  }
  if (hit.size) {
    for (const [i, n] of hit) {
      const x = i % world.w;
      const y = Math.floor(i / world.w);
      if (world.cover[i] === C.HOUSE && n >= 2) world.setCover(i, C.RUBBLE);
      else if (world.cover[i] === C.TREE || world.cover[i] === C.BUSH || world.cover[i] === C.CROP) world.setCover(i, C.NONE);
      if (Math.random() < 0.25)
        world.particles.add({
          x: x + 0.5,
          y: y + 0.5,
          z: 0.5,
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 0.5) * 4,
          vz: 3,
          life: 0.8,
          color: 0x9a8f80,
          size: 1.4,
          glow: false,
          gravity: 6,
          drag: 1,
        });
    }
    for (const c of world.creatures) {
      if (c.dead) continue;
      const n = hit.get(Math.round(c.y - 0.5) * world.w + Math.round(c.x - 0.5)) ?? hit.get(Math.floor(c.y) * world.w + Math.floor(c.x));
      if (n) c.hp -= 25 * Math.min(4, n) * Math.min(3, s.fell / 4);
      if (c.hp <= 0) c.dead = true;
    }
    world.emit({ kind: "sound", name: "rumble", size: Math.min(1, 0.2 + hit.size / 200) });
    if (hit.size > 30) world.emit({ kind: "shake", amount: Math.min(8, hit.size / 30), seconds: 0.3 });
  }
  s.falling.clear();
  s.fell = 0;
  // Ask for a support check right away: other loose parts keep falling.
  s.checkedVersion = -1;
}

// Fire in trees, melting ice, rotting leaves. Runs a few times a second.
function fireAndHeat(world: World, dt: number): void {
  const { decor } = world;
  const s = world.voxels;
  let changed = false;

  // Ignition from the land: a fire or heat on the cell reaches the lowest voxels.
  // Sampled, so very large builds stay cheap (about 3000 looked at per pass).
  const stride = Math.max(1, Math.ceil(decor.size / 3000));
  let k = 0;
  for (let slot = 0; slot < decor.slots; slot++) {
    if (!decor.isLive(slot)) continue;
    if (stride > 1 && k++ % stride !== world.tick % stride) continue;
    const key = decor.keyOf(slot);
    const kind = voxelKind(decor.valueOf(slot));
    if (kind !== VK.WOOD && kind !== VK.LEAF && kind !== VK.ICE) continue;
    const x = keyX(key);
    const y = keyY(key);
    const level = keyLevel(key);
    const i = y * world.w + x;
    const near = level - top(world, x, y) <= 2;
    const hot = world.temp[i] > 200 || (near && (world.fire[i] > 0.25 || (world.fluid[i] === F.LAVA && world.depth[i] > 0.05)));
    if (kind === VK.ICE) {
      if ((hot || world.temp[i] > 30) && Math.random() < 0.35 * stride) {
        decor.delete(key);
        s.removals++;
        world.place(i, "water", 0.25);
        changed = true;
      }
    } else if (hot && !s.burning.has(key) && Math.random() < (kind === VK.LEAF ? 0.6 : 0.3) * stride) {
      s.burning.set(key, burnTime(kind));
    }
  }

  // Burning voxels: spread, heat, smoke, then burn away.
  if (s.burning.size) {
    const spread: number[] = [];
    for (const [key, left] of s.burning) {
      const v = decor.get(key);
      if (v === undefined) {
        s.burning.delete(key);
        continue;
      }
      const kind = voxelKind(v);
      const { x, y, level } = keyCell(key);
      const i = y * world.w + x;
      // Water at the voxel's level puts it out.
      if (world.fluid[i] === F.WATER && world.height[i] + world.depth[i] >= level * 2) {
        s.burning.delete(key);
        continue;
      }
      for (const [dx, dy, dl] of N6) {
        const nk = key + D(dx, dy, dl);
        const nv = decor.get(nk);
        if (nv === undefined || s.burning.has(nk)) continue;
        const nkind = voxelKind(nv);
        if (nkind === VK.ICE && Math.random() < 0.3) {
          decor.delete(nk);
          s.removals++;
          changed = true;
          continue;
        }
        if (!burnable(nkind)) continue;
        // Fire climbs faster than it spreads sideways or down.
        const p = (nkind === VK.LEAF ? 0.45 : 0.14) * (dl > 0 ? 1.8 : dl < 0 ? 0.5 : 1) * dt * 5;
        if (Math.random() < p) spread.push(nk);
      }
      if (level - top(world, x, y) <= 3) world.fire[i] = Math.max(world.fire[i], 0.5);
      world.temp[i] = Math.max(world.temp[i], 120);
      if (Math.random() < 0.3)
        world.particles.add({
          x: x + Math.random(),
          y: y + Math.random(),
          z: level - top(world, x, y) + 1,
          vx: world.wind.x,
          vy: world.wind.y,
          vz: 2 + Math.random() * 2,
          life: 0.5 + Math.random() * 0.4,
          color: Math.random() < 0.5 ? 0xffb347 : 0xff6a1a,
          size: 1.1,
          glow: true,
          gravity: -1,
          drag: 0.5,
        });
      if (Math.random() < 0.08) addGas(world, i, S.SMOKE, 0.3);
      // Embers drop from high fires and can light the ground below.
      if (Math.random() < 0.02) world.fire[i] = Math.max(world.fire[i], 0.4);
      const rest = left - dt;
      if (rest <= 0) {
        s.burning.delete(key);
        decor.delete(key);
        s.removals++;
        changed = true;
        // Some burnt wood stays as charcoal and still holds what is above.
        if (kind === VK.WOOD && Math.random() < 0.15) decor.set(key, packVoxel(0x2b2622, VK.STONE));
      } else s.burning.set(key, rest);
    }
    for (const nk of spread) {
      if (!decor.has(nk) || s.burning.has(nk)) continue;
      if (world.wards.length && wardedAt(world, keyX(nk), keyY(nk), WARD.fire)) continue;
      s.burning.set(nk, burnTime(voxelKind(decor.get(nk)!)));
    }
    // Burning voxels flicker: the view redraws them.
    changed = true;
  }

  // Fallen leaves rot away over a few seconds.
  if (s.litter.size) {
    for (const key of s.litter) {
      if (!decor.has(key)) s.litter.delete(key);
      else if (Math.random() < 0.06 * dt * 5) {
        decor.delete(key);
        s.litter.delete(key);
        s.removals++;
        changed = true;
      }
    }
  }
  if (changed) world.decorVersion++;
}

function burnTime(kind: number): number {
  return kind === VK.LEAF ? 1.2 + Math.random() * 1.6 : 4 + Math.random() * 5;
}

// Sets fire to burnable voxels near a point (lightning, fireballs, explosions).
export function igniteVoxels(world: World, x: number, y: number, r: number): void {
  const s = world.voxels;
  const decor = world.decor;
  for (let slot = 0; slot < decor.slots; slot++) {
    if (!decor.isLive(slot)) continue;
    const key = decor.keyOf(slot);
    const v = decor.valueOf(slot);
    if (!burnable(voxelKind(v)) || s.burning.has(key)) continue;
    if ((keyX(key) - x) ** 2 + (keyY(key) - y) ** 2 > r * r) continue;
    if (world.wards.length && wardedAt(world, keyX(key), keyY(key), WARD.fire)) continue;
    s.burning.set(key, burnTime(voxelKind(v)));
  }
}
