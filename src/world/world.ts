import type { SpellSpec } from "../../shared/spell";
import { Cast } from "./cast";
import { makeCreature, reviveFromSave, updateCreature, type Creature, type CreatureType } from "./creatures";
import { Grid, generateTerrain } from "./grid";
import { Particles } from "./particles";

export const TICK = 1 / 30;

interface SavedWorld {
  version: 1;
  w: number;
  h: number;
  cells: string;
  creatures: Partial<Creature>[];
}

// Everything that lives in the World tab: terrain, creatures, particles and the
// spells being cast. Advances in fixed ticks so physics is the same at any frame rate.
export class World {
  readonly particles = new Particles();
  readonly casts: Cast[] = [];
  time = 0;

  constructor(
    readonly grid: Grid,
    readonly creatures: Creature[],
  ) {}

  static create(w: number, h: number, seed = (Math.random() * 2 ** 31) | 0): World {
    const world = new World(generateTerrain(w, h, seed), []);
    const villagers = Math.max(6, Math.round(w / 14));
    for (let i = 0; i < villagers; i++) world.spawn("villager");
    for (let i = 0; i < Math.max(2, Math.round(w / 50)); i++) world.spawn("beast");
    return world;
  }

  // Places a creature on the ground at x, or somewhere random.
  spawn(type: CreatureType, x?: number, y?: number): Creature {
    const cx = Math.round(x ?? 4 + Math.random() * (this.grid.w - 8));
    const ground = this.grid.groundY(cx);
    const cy = type === "spirit" && y !== undefined ? y : ground - 0.001;
    const c = makeCreature(type, cx, cy);
    this.creatures.push(c);
    return c;
  }

  cast(spec: SpellSpec, x: number, y: number): void {
    this.casts.push(new Cast(spec, x, y, this));
  }

  step(): void {
    this.time += TICK;
    this.grid.step();
    const events = {
      emit: (x: number, y: number, color: number, vx: number, vy: number, life: number) =>
        this.particles.add(x, y, vx, vy, life, color, 1, true),
    };
    for (const c of this.creatures) updateCreature(c, this.grid, TICK, events);
    for (const cast of this.casts) cast.update(TICK);
    for (let i = this.casts.length - 1; i >= 0; i--) if (this.casts[i].done) this.casts.splice(i, 1);
    this.particles.update(TICK);
    // The world forgets the dead after a while, so it never fills up with bodies.
    if (this.creatures.length > 400) {
      const firstDead = this.creatures.findIndex((c) => c.dead);
      if (firstDead >= 0) this.creatures.splice(firstDead, 1);
    }
  }

  serialize(): string {
    const data: SavedWorld = {
      version: 1,
      w: this.grid.w,
      h: this.grid.h,
      cells: this.grid.serialize(),
      creatures: this.creatures.map(({ type, x, y, hp, size, shirt, dead }) => ({ type, x, y, hp, size, shirt, dead })),
    };
    return JSON.stringify(data);
  }

  static deserialize(json: string): World | null {
    try {
      const data = JSON.parse(json) as SavedWorld;
      if (data.version !== 1) return null;
      const grid = Grid.deserialize(data.w, data.h, data.cells);
      if (!grid) return null;
      const creatures = data.creatures.map(reviveFromSave).filter((c): c is Creature => c !== null);
      return new World(grid, creatures);
    } catch {
      return null;
    }
  }
}
