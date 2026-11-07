import type { Tier } from "../../shared/tiers";
import type { World } from "./world";

// Wards (3.4.2): a place a spell keeps safe for a while. Before wards, a
// protection spell could only build an opaque shell of magic blocks that lava
// flowed under and fire spread through, and that hid the village it was meant
// to guard. A ward is a rule of the land instead: inside it, what the ward is
// against cannot get in. The view draws it as a clear dome.
//
// Each ward sets bits on the cells it covers (`world.wardMask`), so physics
// and creatures only read one byte to know whether a cell is protected. The
// mask is rebuilt when a ward appears or ends, never every tick.

export const WARD = {
  // Fire does not spread in or start inside; what burned inside goes out.
  fire: 1,
  // Lava, acid, water and every spell fluid stop at the edge.
  fluids: 2,
  // Lightning strikes the dome, not what is under it.
  lightning: 4,
  // Creatures that hunt, attack or carry a harmful aura are pushed out.
  creatures: 8,
  // Blasts, quakes and direct harm from spells barely touch what is inside.
  harm: 16,
  // Frost and blizzards stop at the edge.
  cold: 32,
} as const;
export type WardAgainst = keyof typeof WARD;
export const WARD_ALL = 63;
// A ward's dome is this much flatter than a half sphere; the view draws it
// so, and lightning ends on it at that height.
export const DOME_SQUASH = 0.7;
const MAX_WARDS = 24;

export interface Ward {
  x: number;
  y: number;
  r: number;
  against: number;
  // World time it was raised and when it ends.
  from: number;
  until: number;
  color: number;
  // Kinds always pushed out, and kinds never pushed out, beside the hostile rule.
  keepOut: string[];
  allow: string[];
  // The spell that raised it: its own fluids may still be placed inside.
  owner: string;
  // When something last hit it, for the ripple the view draws.
  hit: number;
  // 4.7: a ward has a breaking point. Its health is 100 times the power of
  // the tier that raised it; what it stops wears it down (cracks in the
  // view) and it breaks at 0. Filled by addWard when left out.
  hp?: number;
  maxHp?: number;
  // What each source (a cast, the land, creatures) has taken from it.
  dealt?: Record<string, number>;
  // Cracks from pressure, which takes no health (PRESSURE).
  pressure?: number;
}

// How hard a tier hits and how much a ward of that tier holds: twice the
// tier below. Creature and artifact wards, and threats with no cast behind
// them (the land's lava and fire, raiders), count as minor.
export const TIER_POWER: Record<Tier, number> = { cantrip: 0.5, minor: 1, major: 2, grand: 4, legendary: 8, cosmic: 16 };
// One source takes at most this share of a ward of its own power: a spell
// of the same tier cracks a ward but never breaks it alone; two casts, or
// one a tier stronger, do.
export const ONE_SOURCE = 0.8;
// What presses on a ward with no cast behind it (lava and fire flowing from
// the land, creatures pushed out) cracks it, up to ONE_SOURCE, and takes no
// health: the lava a flood spell poured is that spell's doing, and the spell
// counts once (the playtest of 7 November: one minor flood broke a minor ward,
// its flowing lava counted as a second source).
const PRESSURE = new Set(["land", "creatures"]);

// Damage is in units of a ward of the same power (100 breaks it). Returns
// true when the ward broke.
export function damageWard(world: World, ward: Ward, amount: number, source: string, power = 1): boolean {
  if (!(amount > 0) || !world.wards.includes(ward)) return false;
  ward.dealt ??= {};
  ward.hit = world.time;
  if (PRESSURE.has(source)) {
    ward.pressure = Math.min((ward.maxHp ?? 100) * ONE_SOURCE, (ward.pressure ?? 0) + amount * power);
    return false;
  }
  const cap = 100 * ONE_SOURCE * power;
  const before = ward.dealt[source] ?? 0;
  const take = Math.max(0, Math.min(amount * power, cap - before));
  ward.dealt[source] = before + take;
  ward.hp = (ward.hp ?? 100) - take;
  ward.hit = world.time;
  if (ward.hp > 0) return false;
  breakWard(world, ward);
  return true;
}

// A ward breaks: it is gone at once, with a burst of glass where it stood.
export function breakWard(world: World, ward: Ward): void {
  world.wards = world.wards.filter((w) => w !== ward);
  rebuildMask(world);
  const n = Math.min(120, Math.round(ward.r * 10));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const up = Math.random();
    const rr = ward.r * Math.sqrt(1 - up * up);
    world.particles.add({
      x: ward.x + Math.cos(a) * rr,
      y: ward.y + Math.sin(a) * rr,
      z: 1 + up * ward.r * DOME_SQUASH * 2,
      // Shards of glass that fall about where the dome stood, not sparks.
      vx: Math.cos(a) * (1 + Math.random() * 2.5),
      vy: Math.sin(a) * (1 + Math.random() * 2.5),
      vz: 1 + Math.random() * 3,
      life: 0.9 + Math.random() * 0.6,
      color: k % 3 ? 0xeef8ff : ward.color,
      size: 1.1 + Math.random() * 1.1,
      glow: k % 4 === 0,
      gravity: 22,
      drag: 0.4,
    });
  }
  world.emit({ kind: "sound", name: "crackle", size: Math.min(1, 0.4 + ward.r / 20) });
  world.emit({ kind: "flash", color: ward.color, strength: 0.15 });
}

// How cracked a ward looks, 0 whole to 1 about to break.
export function wardDamage(ward: Ward): number {
  const max = ward.maxHp ?? 100;
  return Math.max(0, Math.min(1, Math.max(1 - (ward.hp ?? max) / max, (ward.pressure ?? 0) / max)));
}

// A point (z in voxels above the ground) inside a ward's dome.
export function inDome(ward: Ward, x: number, y: number, z: number): boolean {
  return (x - ward.x) ** 2 + (y - ward.y) ** 2 + (Math.max(0, z) / DOME_SQUASH) ** 2 <= ward.r * ward.r;
}

// What a ward stops of a moving body (a meteor, a fireball, a bolt thrown):
// a ward against harm or fire, raised by another spell.
export function stopsBodies(ward: Ward, owner: string): boolean {
  return (ward.against & (WARD.harm | WARD.fire)) !== 0 && ward.owner !== owner;
}

export function wardBits(list: unknown): number {
  if (!Array.isArray(list) && typeof list !== "string") return WARD_ALL;
  const names = (Array.isArray(list) ? list : [list]).map((v) => String(v).toLowerCase());
  if (names.includes("all") || names.includes("everything")) return WARD_ALL;
  let bits = 0;
  for (const name of names) {
    const key = (ALIASES[name] ?? name) as WardAgainst;
    if (key in WARD) bits |= WARD[key];
  }
  return bits || WARD_ALL;
}

// Plain words Claude and players use for the same thing.
const ALIASES: Record<string, string> = {
  flame: "fire",
  flames: "fire",
  heat: "fire",
  burn: "fire",
  fluid: "fluids",
  lava: "fluids",
  water: "fluids",
  flood: "fluids",
  acid: "fluids",
  storm: "lightning",
  creature: "creatures",
  monsters: "creatures",
  beasts: "creatures",
  undead: "creatures",
  damage: "harm",
  blast: "harm",
  blasts: "harm",
  force: "harm",
  frost: "cold",
  ice: "cold",
};

export function addWard(world: World, ward: Ward, power = 1): void {
  ward.maxHp ??= 100 * power;
  ward.hp ??= ward.maxHp;
  ward.dealt ??= {};
  if (world.wards.length >= MAX_WARDS) world.wards.shift();
  world.wards.push(ward);
  rebuildMask(world);
}

// Drops wards that ended. Called once per tick, before physics.
export function stepWards(world: World): void {
  if (!world.wards.length) return;
  const before = world.wards.length;
  world.wards = world.wards.filter((w) => w.until > world.time);
  if (world.wards.length !== before) rebuildMask(world);
}

export function rebuildMask(world: World): void {
  const mask = world.wardMask;
  mask.fill(0);
  for (const ward of world.wards) {
    const r2 = ward.r * ward.r;
    const x0 = Math.max(0, Math.floor(ward.x - ward.r));
    const x1 = Math.min(world.w - 1, Math.ceil(ward.x + ward.r));
    const y0 = Math.max(0, Math.floor(ward.y - ward.r));
    const y1 = Math.min(world.h - 1, Math.ceil(ward.y + ward.r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x - ward.x) ** 2 + (y - ward.y) ** 2 <= r2) mask[y * world.w + x] |= ward.against;
  }
}

export function warded(world: World, i: number, bit: number): boolean {
  return (world.wardMask[i] & bit) !== 0;
}

export function wardedAt(world: World, x: number, y: number, bit: number): boolean {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (!world.inside(cx, cy)) return false;
  return (world.wardMask[cy * world.w + cx] & bit) !== 0;
}

// Something was stopped at cell i: the ward there ripples. Sampled by the
// caller where blocks are frequent (fire trying to spread every tick).
// With an amount, the ward also takes that much damage from the source (in
// units of damageWard), for each sampled hit.
export function wardHit(world: World, i: number, amount = 0, source = "land", power = 1): void {
  const x = i % world.w;
  const y = Math.floor(i / world.w);
  for (const ward of [...world.wards])
    if ((x - ward.x) ** 2 + (y - ward.y) ** 2 <= (ward.r + 1.5) ** 2) {
      ward.hit = world.time;
      if (amount > 0) damageWard(world, ward, amount, source, power);
    }
}

// The ward covering a cell that a given spell raised, if any.
export function ownWard(world: World, i: number, owner: string): boolean {
  const x = i % world.w;
  const y = Math.floor(i / world.w);
  return world.wards.some((w) => w.owner === owner && (x - w.x) ** 2 + (y - w.y) ** 2 <= w.r * w.r);
}
