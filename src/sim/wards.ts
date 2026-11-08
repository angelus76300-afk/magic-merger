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
  // When a spell last took health from it: its cracks heal HEAL_AFTER
  // seconds later. A ripple (hit) or pressure does not hold the healing back.
  struck?: number;
  // Where it was last struck (z in voxels above the ground), for the glow the view draws there.
  hitAt?: { x: number; y: number; z: number };
}

// How hard a tier hits and how much a ward of that tier holds: twice the
// tier below. Creature and artifact wards, and threats with no cast behind
// them (the land's lava and fire, raiders), count as minor.
export const TIER_POWER: Record<Tier, number> = { cantrip: 0.5, minor: 1, major: 2, grand: 4, legendary: 8, cosmic: 16 };
// One source takes at most this share of a ward of its own power: a spell
// of the same tier cracks a ward but never breaks it alone; two casts, or
// one a tier stronger, do.
export const ONE_SOURCE = 0.8;
// What a ward keeps of its health against its own tier and below, whatever
// the number of casts (the owner, 7 November: "shouldn't break by default").
export const HOLDS = 0.2;
// Cracks heal: after this many seconds with no hit, this share of its health a second.
export const HEAL_AFTER = 5;
export const HEAL_RATE = 0.02;
// The slow motion of a shatter (the owner: "a small shield would have a slo
// mo break animation"): the island runs at SLOW_FACTOR for SLOW_SECONDS of
// real time, once per ward, and not again within a second of the last.
export const SLOW_FACTOR = 0.25;
export const SLOW_SECONDS = 1;

// 4.7, the owner's report and the game designer's rule: a ward broken by a
// stronger spell spends what it had on the blow. The share of the blow that
// passes is 1 - 2 (Pw / Pa) (hp / max): one tier up at full health nothing
// passes and the ward shatters; a fresh minor ward lets half a grand blow
// through and three quarters of a legendary one; a major ward none of a
// grand one and half a legendary. So every tier of ward is worth merging
// toward, and a cantrip ward never cancels a cosmic spell (94% passes).
export function passShare(ward: Ward, attacker: number, hpBefore: number): number {
  const most = ward.maxHp ?? 100;
  return Math.max(0, Math.min(1, 1 - 2 * (most / 100 / Math.max(1e-6, attacker)) * (Math.max(0, hpBefore) / most)));
}

// Where a ward was broken, and by which spell: for RUIN_SECONDS what that
// spell does there is scaled by the share that passed (Meteor Strike digs
// its crater from the cast a moment after its body breaks the glass, and
// Meteor Storm's other meteors fall after the first broke it).
export interface Ruin {
  x: number;
  y: number;
  r: number;
  key: string;
  pass: number;
  until: number;
  // Tiers between the spell that broke it and the ward: at MERCY_GAP or less
  // the people it covered are hurt and flee but live.
  gap: number;
}
// The owner's scale, the planner's choice of 7 November: a ward broken two
// tiers up still saves its people (half a blow of 80 killed them all).
export const MERCY_GAP = 2;
// Long enough for the rest of the cast that broke it (a cast lasts under 12
// seconds, a cosmic one 25): a rain of meteors is one blow, not six.
export const RUIN_SECONDS = 15;
// The health a ward had before this source struck it: one spell's hits count
// as one blow, so a rain that cracks it first does not pass more for it.
export function hpAgainst(ward: Ward, source: string): number {
  const most = ward.maxHp ?? 100;
  return Math.min(most, (ward.hp ?? most) + (ward.dealt?.[source] ?? 0));
}
export function addRuin(world: World, ward: Ward, key: string, pass: number, attacker = 1): void {
  world.ruins = world.ruins.filter((r) => r.until > world.time);
  const gap = Math.round(Math.log2(Math.max(1e-6, attacker) / ((ward.maxHp ?? 100) / 100)));
  world.ruins.push({ x: ward.x, y: ward.y, r: ward.r, key, pass, until: world.time + RUIN_SECONDS, gap });
}
// True where this spell broke a ward a moment ago by MERCY_GAP tiers or fewer:
// its blows on the people there stop short of death.
export function ruinSpares(world: World, key: string, x: number, y: number): boolean {
  for (const r of world.ruins) if (r.key === key && r.until > world.time && r.gap <= MERCY_GAP && (x - r.x) ** 2 + (y - r.y) ** 2 <= r.r * r.r) return true;
  return false;
}
// The share of what this spell does at (x, y) that goes through: 1 unless it
// broke a ward there a moment ago.
export function ruinPass(world: World, key: string, x: number, y: number): number {
  let p = 1;
  for (const r of world.ruins) if (r.key === key && r.until > world.time && (x - r.x) ** 2 + (y - r.y) ** 2 <= r.r * r.r) p = Math.min(p, r.pass);
  return p;
}
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
  let take = Math.max(0, Math.min(amount * power, cap - before));
  // The owner, 7 November: a ward does not break against its own tier and
  // below, however many casts. They crack it, down to HOLDS of its health
  // at most; only a stronger tier breaks it.
  const most = ward.maxHp ?? 100;
  if (power * 100 <= most) take = Math.min(take, Math.max(0, (ward.hp ?? most) - most * HOLDS));
  ward.dealt[source] = before + take;
  ward.hp = (ward.hp ?? 100) - take;
  ward.struck = world.time;
  ward.hit = world.time;
  if (ward.hp > 0) return false;
  breakWard(world, ward);
  return true;
}

// A ward breaks: it is gone at once, with a burst of glass where it stood.
export function breakWard(world: World, ward: Ward): void {
  world.wards = world.wards.filter((w) => w !== ward);
  rebuildMask(world);
  // Slow motion while the shards fly, unless another ward broke within the
  // last second (several at once would drag the island).
  if (world.time - world.lastSlow > 1) {
    world.slowUntil = world.time + SLOW_SECONDS * SLOW_FACTOR;
    world.lastSlow = world.time;
  }
  // A stronger ward shatters bigger: more shards, flung further.
  const grade = 1 + Math.log2(Math.max(0.5, (ward.maxHp ?? 100) / 100)) * 0.25;
  const n = Math.min(200, Math.round(ward.r * 10 * grade));
  // Away from where it was struck: the far side flies, the struck side falls.
  const ha = ward.hitAt ? Math.atan2(ward.hitAt.y - ward.y, ward.hitAt.x - ward.x) : 0;
  const away = ward.hitAt ? { a: ha + Math.PI, x: -Math.cos(ha), y: -Math.sin(ha) } : { a: 0, x: 0, y: 0 };
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const up = Math.random();
    const rr = ward.r * Math.sqrt(1 - up * up);
    world.particles.add({
      x: ward.x + Math.cos(a) * rr,
      y: ward.y + Math.sin(a) * rr,
      z: 1 + up * ward.r * DOME_SQUASH * 2,
      // Shards of glass that fall about where the dome stood, not sparks,
      // flung away from the point struck (4.7: the shatter starts there).
      vx: (Math.cos(a) * (1 + Math.random() * 2.5) + away.x * (1 - Math.cos(a - away.a)) * 2) * grade,
      vy: (Math.sin(a) * (1 + Math.random() * 2.5) + away.y * (1 - Math.cos(a - away.a)) * 2) * grade,
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
  // A ringing tone after the crack, and a brighter flash (the game designer: 0.25).
  world.emit({ kind: "sound", name: "chime", size: Math.min(1, 0.3 + ward.r / 30) });
  world.emit({ kind: "flash", color: 0xffffff, strength: 0.25 });
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
export function stepWards(world: World, dt = 1 / 30): void {
  if (!world.wards.length) return;
  // Cracks heal slowly (the owner, 7 November): after HEAL_AFTER seconds
  // with nothing striking it, a ward regains HEAL_RATE of its health a
  // second, and what each source dealt is forgiven in step.
  for (const ward of world.wards) {
    const most = ward.maxHp ?? 100;
    if (world.time - (ward.struck ?? ward.from) < HEAL_AFTER || ((ward.hp ?? most) >= most && !ward.pressure)) continue;
    const gain = most * HEAL_RATE * dt;
    ward.hp = Math.min(most, (ward.hp ?? most) + gain);
    if (ward.pressure) ward.pressure = Math.max(0, ward.pressure - gain);
    if (ward.dealt) for (const k in ward.dealt) ward.dealt[k] = Math.max(0, ward.dealt[k] - gain);
  }
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
