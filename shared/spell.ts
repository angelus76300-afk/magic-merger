// The spell spec: what Claude writes once per spell, and what the World tab
// plays. Three parts: the incantation circle, the animation phases, and the
// effects on the world. The verbs are fixed; how they combine is free.

export const SCALES = ["tiny", "small", "medium", "large", "huge", "cataclysmic"] as const;
export type Scale = (typeof SCALES)[number];

// Radius of the affected area, in world cells.
export const SCALE_RADIUS: Record<Scale, number> = {
  tiny: 3,
  small: 6,
  medium: 10,
  large: 16,
  huge: 26,
  cataclysmic: 40,
};

// Big spells have to be earned through long merge chains.
export function maxScaleForDepth(depth: number): Scale {
  if (depth <= 1) return "small";
  if (depth <= 3) return "medium";
  if (depth <= 5) return "large";
  if (depth <= 8) return "huge";
  return "cataclysmic";
}

export const DELIVERIES = ["burst", "projectile", "beam", "rain", "wave", "zone"] as const;
export type Delivery = (typeof DELIVERIES)[number];

export const PATTERNS = ["burst", "ring", "spiral", "fountain", "rain", "orbit", "sparkle", "column", "trail"] as const;
export type Pattern = (typeof PATTERNS)[number];

export const SHAPES = ["circle", "column", "ground"] as const;
export type Shape = (typeof SHAPES)[number];

export const MATERIALS = [
  "none",
  "stone",
  "dirt",
  "grass",
  "sand",
  "gravel",
  "water",
  "ice",
  "lava",
  "steam",
  "smoke",
  "fire",
  "wood",
  "leaves",
  "ash",
  "crystal",
] as const;
export type MaterialName = (typeof MATERIALS)[number];

export const CREATURES = ["none", "villager", "beast", "spirit", "golem"] as const;
export type CreatureName = (typeof CREATURES)[number];

// What each verb does. This text is also what Claude reads, so the engine and
// the prompt can never disagree.
export const VERB_DOCS = {
  damage: "hurts creatures",
  heal: "heals creatures and cures burning and freezing",
  ignite: "sets creatures and flammable things (grass, wood, leaves) on fire, and lights flames in the air",
  freeze: "freezes creatures in place, turns water to ice, lava to stone, puts out fire",
  heat: "melts ice, boils water into steam; above strength 0.6 it also sets flammable things alight, and above 0.7 creatures",
  cool: "puts out fire, turns steam to water and lava to stone; above strength 0.5 it also freezes water into ice, and above 0.7 creatures",
  push: "throws creatures and loose material (sand, gravel, ash, water) away from the center",
  pull: "draws creatures toward the center",
  levitate: "lifts creatures and loose material into the air for the duration",
  fear: "makes creatures run away from the center",
  calm: "removes fear; creatures stop and rest peacefully",
  sleep: "puts creatures to sleep for the duration",
  shrink: "makes creatures smaller, permanently",
  enlarge: "makes creatures bigger, permanently",
  transform: "turns creatures into the given creature type",
  summon: "creates new creatures of the given type",
  revive: "brings dead creatures back to life",
  teleport: "sends creatures to random places in the world",
  spawn: "creates the given material in empty space (with rain delivery it falls from above)",
  erase: "removes all terrain, digging a crater",
  convert: "turns all terrain into the given material",
  grow_plants: "covers dirt with grass and sprouts trees",
  quake: "shakes the ground loose into falling gravel and knocks creatures over",
} as const;
export type Verb = keyof typeof VERB_DOCS;
export const VERBS = Object.keys(VERB_DOCS) as Verb[];

export interface Emitter {
  pattern: Pattern;
  colors: string[];
  count: number;
  speed: number;
  gravity: number;
  lifetime: number;
  size: number;
  glow: boolean;
}

export interface Phase {
  duration: number;
  emitters: Emitter[];
}

export interface Incantation {
  rings: number;
  symmetry: number;
  runes: number;
  primary: string;
  secondary: string;
  spin: number;
}

export interface Effect {
  verb: Verb;
  strength: number;
  duration: number;
  shape: Shape;
  material: MaterialName;
  creature: CreatureName;
}

export interface SpellSpec {
  summary: string;
  scale: Scale;
  delivery: Delivery;
  incantation: Incantation;
  phases: { charge: Phase; travel: Phase; release: Phase; linger: Phase };
  effects: Effect[];
}

export const PHASE_NAMES = ["charge", "travel", "release", "linger"] as const;

const LIMITS = {
  phaseDuration: [0, 5],
  emitters: 3,
  colors: 4,
  count: [0, 400],
  speed: [0, 60],
  gravity: [-40, 40],
  lifetime: [0.1, 3],
  size: [1, 3],
  rings: [1, 4],
  symmetry: [3, 12],
  runes: [0, 16],
  spin: [-2, 2],
  effects: 5,
  effectDuration: [0, 10],
} as const;

// Turns anything into a valid, bounded spec. Never throws: a broken field is
// replaced by a safe default, so a stored spell always plays.
export function sanitizeSpellSpec(raw: unknown, maxScale: Scale): SpellSpec {
  const r = obj(raw);
  const phasesRaw = obj(r.phases);
  const scale = pick(r.scale, SCALES, "small");
  const capped = SCALES.indexOf(scale) > SCALES.indexOf(maxScale) ? maxScale : scale;

  const effects = arr(r.effects)
    .slice(0, LIMITS.effects)
    .map((e) => {
      const o = obj(e);
      return {
        verb: pick(o.verb, VERBS, "damage"),
        strength: num(o.strength, 0, 1, 0.5),
        duration: num(o.duration, ...LIMITS.effectDuration, 0),
        shape: pick(o.shape, SHAPES, "circle"),
        material: pick(o.material, MATERIALS, "none"),
        creature: pick(o.creature, CREATURES, "none"),
      };
    });

  const inc = obj(r.incantation);
  return {
    summary: typeof r.summary === "string" ? r.summary.slice(0, 200) : "",
    scale: capped,
    delivery: pick(r.delivery, DELIVERIES, "burst"),
    incantation: {
      rings: Math.round(num(inc.rings, ...LIMITS.rings, 2)),
      symmetry: Math.round(num(inc.symmetry, ...LIMITS.symmetry, 6)),
      runes: Math.round(num(inc.runes, ...LIMITS.runes, 8)),
      primary: color(inc.primary, "#b48cff"),
      secondary: color(inc.secondary, "#f4d58d"),
      spin: num(inc.spin, ...LIMITS.spin, 0.5),
    },
    phases: {
      charge: phase(phasesRaw.charge),
      travel: phase(phasesRaw.travel),
      release: phase(phasesRaw.release),
      linger: phase(phasesRaw.linger),
    },
    effects: effects.length ? effects : [{ verb: "damage", strength: 0.3, duration: 0, shape: "circle", material: "none", creature: "none" }],
  };
}

function phase(raw: unknown): Phase {
  const o = obj(raw);
  return {
    duration: num(o.duration, ...LIMITS.phaseDuration, 0),
    emitters: arr(o.emitters)
      .slice(0, LIMITS.emitters)
      .map((e) => {
        const m = obj(e);
        const colors = arr(m.colors)
          .slice(0, LIMITS.colors)
          .map((c) => color(c, ""))
          .filter(Boolean);
        return {
          pattern: pick(m.pattern, PATTERNS, "burst"),
          colors: colors.length ? colors : ["#ffffff"],
          count: Math.round(num(m.count, ...LIMITS.count, 40)),
          speed: num(m.speed, ...LIMITS.speed, 10),
          gravity: num(m.gravity, ...LIMITS.gravity, 0),
          lifetime: num(m.lifetime, ...LIMITS.lifetime, 1),
          size: Math.round(num(m.size, ...LIMITS.size, 1)),
          glow: m.glow === true,
        };
      }),
  };
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function color(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  return fallback;
}
