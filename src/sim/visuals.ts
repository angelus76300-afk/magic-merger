// Everything a spell shows that is not terrain: its bodies (the fireball, the
// cloud, the vortex), shockwave rings, lights in the dark, screen tints, and
// free drawing functions. The renderer reads these; the runtime fills them.

export type BodyLook = "orb" | "flame" | "cloud" | "ring" | "shard" | "vortex" | "star" | "none";

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

export class Visuals {
  bodies: Body[] = [];
  shockwaves: Shockwave[] = [];
  lights: Light[] = [];
  // Darkness over the whole world (lights cut through it) and colored washes.
  darkness: Fade[] = [];
  tints: Fade[] = [];
  drawings: Drawing[] = [];
  flash = 0;
  flashColor = 0xffffff;

  update(dt: number): void {
    const age = <T extends { t: number; dur: number }>(list: T[]) => {
      for (const v of list) v.t += dt;
      return list.filter((v) => v.t < v.dur);
    };
    this.shockwaves = age(this.shockwaves);
    this.lights = age(this.lights);
    this.darkness = age(this.darkness);
    this.tints = age(this.tints);
    this.drawings = age(this.drawings);
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
