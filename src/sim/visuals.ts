// Everything a spell shows that is not terrain: its bodies (the fireball, the
// cloud, the vortex), shockwave rings, lights in the dark, screen tints, and
// free drawing functions. The renderer reads these; the runtime fills them.

export const BODY_LOOKS = ["orb", "flame", "cloud", "ring", "shard", "vortex", "star", "meteor", "swarm", "none"] as const;
export type BodyLook = (typeof BODY_LOOKS)[number];

export interface Body {
  id: number;
  x: number;
  y: number;
  // Height above the ground. A body falling from the sky has a shadow.
  z: number;
  vx: number;
  vy: number;
  vz: number;
  // Radius in cells.
  r: number;
  color: number;
  color2: number;
  glow: boolean;
  look: BodyLook;
  age: number;
  life: number;
  alive: boolean;
  // Pull on z per second squared.
  gravity: number;
  drag: number;
  // Free data for the spell.
  data: Record<string, unknown>;
  owner: number;
  // Color of the particles it leaves behind, or null.
  trail: number | null;
}

// A bolt of lightning or a beam: a path of points in cells (x, y) and
// voxel levels (l), drawn as a line of glowing voxels.
export interface Bolt {
  points: { x: number; y: number; l: number }[];
  color: number;
  width: number;
  t: number;
  dur: number;
}

export interface Shockwave {
  x: number;
  y: number;
  r: number;
  color: number;
  width: number;
  t: number;
  dur: number;
}

export interface Light {
  x: number;
  y: number;
  r: number;
  color: number;
  t: number;
  dur: number;
}

export interface Fade {
  color: number;
  alpha: number;
  t: number;
  dur: number;
}

export type DrawFn = (ctx: CanvasRenderingContext2D, t: number) => void;

export interface Drawing {
  fn: DrawFn;
  space: "world" | "screen";
  t: number;
  dur: number;
  owner: number;
}

export const MAX_EFFECTS = 200;

export class Visuals {
  bodies: Body[] = [];
  shockwaves: Shockwave[] = [];
  lights: Light[] = [];
  // Darkness over the whole world (lights cut through it) and colored washes.
  darkness: Fade[] = [];
  tints: Fade[] = [];
  drawings: Drawing[] = [];
  bolts: Bolt[] = [];
  flash = 0;
  flashColor = 0xffffff;

  update(dt: number): void {
    // Spells may ask for any number of effects; the oldest go first past a cap,
    // so a loop of shockwaves cannot pile up meshes.
    const age = <T extends { t: number; dur: number }>(list: T[]) => {
      for (const v of list) v.t += dt;
      const alive = list.filter((v) => v.t < v.dur);
      return alive.length > MAX_EFFECTS ? alive.slice(alive.length - MAX_EFFECTS) : alive;
    };
    this.shockwaves = age(this.shockwaves);
    this.lights = age(this.lights);
    this.darkness = age(this.darkness);
    this.tints = age(this.tints);
    this.drawings = age(this.drawings);
    this.bolts = age(this.bolts);
    this.bodies = this.bodies.filter((b) => b.alive);
    this.flash = Math.max(0, this.flash - dt * 2.5);
  }

  // How dark the world is right now, 0 to 1, fading in and out.
  darknessLevel(): number {
    let d = 0;
    for (const f of this.darkness) d = Math.max(d, f.alpha * envelope(f.t, f.dur));
    return d;
  }

  removeOwner(owner: number): void {
    this.bodies = this.bodies.filter((b) => b.owner !== owner);
    this.drawings = this.drawings.filter((d) => d.owner !== owner);
  }

  clear(): void {
    this.bodies = [];
    this.shockwaves = [];
    this.lights = [];
    this.darkness = [];
    this.tints = [];
    this.drawings = [];
    this.bolts = [];
    this.flash = 0;
  }
}

// Quick fade in, hold, fade out over the last quarter.
export function envelope(t: number, dur: number): number {
  const fadeIn = Math.min(0.4, dur * 0.2);
  const fadeOut = Math.min(1, dur * 0.25);
  if (t < fadeIn) return t / fadeIn;
  if (t > dur - fadeOut) return Math.max(0, (dur - t) / fadeOut);
  return 1;
}
