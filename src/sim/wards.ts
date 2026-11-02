import type { World } from "./world";

// Wards (3.5): a place a spell keeps safe for a while. Before wards, a
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

export function addWard(world: World, ward: Ward): void {
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
export function wardHit(world: World, i: number): void {
  const x = i % world.w;
  const y = Math.floor(i / world.w);
  for (const ward of world.wards) if ((x - ward.x) ** 2 + (y - ward.y) ** 2 <= (ward.r + 1.5) ** 2) ward.hit = world.time;
}

// The ward covering a cell that a given spell raised, if any.
export function ownWard(world: World, i: number, owner: string): boolean {
  const x = i % world.w;
  const y = Math.floor(i / world.w);
  return world.wards.some((w) => w.owner === owner && (x - w.x) ** 2 + (y - w.y) ** 2 <= w.r * w.r);
}
