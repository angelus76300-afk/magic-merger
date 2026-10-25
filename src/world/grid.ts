import { FLAME, GAS, LIQUID, M, MATERIALS, NOTHING, POWDER } from "./materials";
import { Rng } from "./rng";

// The world as a grid of cells, one byte of material each, with falling sand
// physics: powders fall and pile, liquids flow, gases rise, fire spreads.
export class Grid {
  readonly mat: Uint8Array;
  // Per cell countdown for fire, steam and smoke.
  readonly life: Uint8Array;
  // What a fire cell is burning, to know what it leaves behind.
  readonly fuel: Uint8Array;
  // Random texture index per cell.
  readonly shade: Uint8Array;
  private moved: Uint8Array;
  private mark = 1;
  readonly rng = new Rng(Date.now() | 0);

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    const n = w * h;
    this.mat = new Uint8Array(n);
    this.life = new Uint8Array(n);
    this.fuel = new Uint8Array(n);
    this.shade = new Uint8Array(n);
    this.moved = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.shade[i] = (Math.random() * 256) | 0;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.mat[y * this.w + x] : M.STONE;
  }

  set(x: number, y: number, m: number, fuel: number = M.EMPTY): void {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    this.mat[i] = m;
    this.fuel[i] = fuel;
    this.shade[i] = (Math.random() * 256) | 0;
    this.life[i] = initialLife(m, fuel, this.rng);
  }

  // Creatures stand on solid cells; the world edges and floor count as solid.
  solid(x: number, y: number): boolean {
    if (x < 0 || x >= this.w || y >= this.h) return true;
    if (y < 0) return false;
    return MATERIALS[this.mat[y * this.w + x]].solid;
  }

  ignite(x: number, y: number): void {
    const m = this.get(x, y);
    if (m === M.EMPTY) this.set(x, y, M.FIRE);
    else if (MATERIALS[m].flammable > 0) this.set(x, y, M.FIRE, m);
  }

  step(): void {
    this.mark = this.mark === 255 ? 1 : this.mark + 1;
    const { w, h, mat } = this;
    for (let y = h - 1; y >= 0; y--) {
      const leftToRight = ((y + this.mark) & 1) === 0;
      for (let k = 0; k < w; k++) {
        const x = leftToRight ? k : w - 1 - k;
        const i = y * w + x;
        const m = mat[i];
        if (m === M.EMPTY || this.moved[i] === this.mark) continue;
        const behavior = MATERIALS[m].behavior;
        if (behavior === POWDER) this.stepPowder(x, y, i);
        else if (behavior === LIQUID) this.stepLiquid(x, y, i, m);
        else if (behavior === GAS) this.stepGas(x, y, i, m);
        else if (behavior === FLAME) this.stepFire(x, y, i);
        else if (m === M.ICE) this.stepIce(x, y);
      }
    }
  }

  private stepPowder(x: number, y: number, i: number): void {
    if (this.fallInto(i, x, y + 1)) return;
    const d = this.rng.chance(0.5) ? 1 : -1;
    if (this.fallInto(i, x + d, y + 1)) return;
    this.fallInto(i, x - d, y + 1);
  }

  private stepLiquid(x: number, y: number, i: number, m: number): void {
    if (m === M.LAVA) {
      this.lavaReactions(x, y);
      if (this.mat[i] !== M.LAVA || this.rng.chance(0.65)) return; // lava is slow
    }
    if (this.flowInto(i, x, y + 1)) return;
    const d = this.rng.chance(0.5) ? 1 : -1;
    if (this.flowInto(i, x + d, y + 1) || this.flowInto(i, x - d, y + 1)) return;
    const reach = m === M.WATER ? 3 : 1;
    for (let s = 1; s <= reach; s++) {
      if (!this.inside(x + d * s, y) || this.mat[this.idx(x + d * s, y)] !== M.EMPTY) break;
      if (s === reach || this.get(x + d * s, y + 1) === M.EMPTY) {
        this.swap(i, this.idx(x + d * s, y));
        return;
      }
    }
  }

  private stepGas(x: number, y: number, i: number, m: number): void {
    if (this.life[i] > 0) this.life[i]--;
    if (this.life[i] === 0) {
      // Steam condenses back into rain now and then.
      if (m === M.STEAM && this.rng.chance(0.3)) this.set(x, y, M.WATER);
      else this.set(x, y, M.EMPTY);
      return;
    }
    const d = this.rng.chance(0.5) ? 1 : -1;
    if (this.rng.chance(0.8) && this.riseInto(i, x, y - 1)) return;
    if (this.riseInto(i, x + d, y - 1)) return;
    this.riseInto(i, x + d, y);
  }

  private stepFire(x: number, y: number, i: number): void {
    const fuel = this.fuel[i];
    // Water nearby puts the flame out.
    for (let n = 0; n < 4; n++) {
      const nx = x + DX4[n];
      const ny = y + DY4[n];
      if (this.get(nx, ny) === M.WATER) {
        this.set(nx, ny, M.STEAM);
        this.set(x, y, fuel === M.GRASS ? M.DIRT : M.SMOKE);
        return;
      }
    }
    // Spread to anything flammable around.
    for (let n = 0; n < 8; n++) {
      const nx = x + DX8[n];
      const ny = y + DY8[n];
      const nm = this.get(nx, ny);
      if (MATERIALS[nm].flammable > 0 && this.rng.chance(MATERIALS[nm].flammable * (ny < y ? 1.5 : 0.6))) {
        this.set(nx, ny, M.FIRE, nm);
      }
    }
    if (fuel === M.EMPTY && this.rng.chance(0.08) && this.get(x, y - 1) === M.EMPTY) this.set(x, y - 1, M.SMOKE);

    if (this.life[i] > 0) this.life[i]--;
    if (this.life[i] === 0) {
      if (fuel === M.GRASS) this.set(x, y, M.DIRT);
      else if (fuel === M.WOOD && this.rng.chance(0.5)) this.set(x, y, M.ASH);
      else this.set(x, y, this.rng.chance(0.3) ? M.SMOKE : M.EMPTY);
      return;
    }
    // Free flames flicker upward; burning wood and grass stay put.
    if (fuel === M.EMPTY && this.rng.chance(0.5)) this.riseInto(i, x + this.rng.int(-1, 2), y - 1);
  }

  private stepIce(x: number, y: number): void {
    for (let n = 0; n < 4; n++) {
      const nm = this.get(x + DX4[n], y + DY4[n]);
      if ((nm === M.FIRE || nm === M.LAVA) && this.rng.chance(0.08)) {
        this.set(x, y, M.WATER);
        return;
      }
    }
  }

  private lavaReactions(x: number, y: number): void {
    for (let n = 0; n < 4; n++) {
      const nx = x + DX4[n];
      const ny = y + DY4[n];
      const nm = this.get(nx, ny);
      if (nm === M.WATER || nm === M.ICE) {
        this.set(nx, ny, M.STEAM);
        this.set(x, y, M.STONE);
        return;
      }
      if (MATERIALS[nm].flammable > 0 && this.rng.chance(0.1)) this.set(nx, ny, M.FIRE, nm);
      else if (nm === M.EMPTY && ny < y && this.rng.chance(0.002)) this.set(nx, ny, M.SMOKE);
    }
  }

  // Powders sink through liquids and gases.
  private fallInto(i: number, x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    const j = y * this.w + x;
    const b = MATERIALS[this.mat[j]].behavior;
    if (b !== NOTHING && b !== LIQUID && b !== GAS) return false;
    this.swap(i, j);
    return true;
  }

  // Liquids move into empty space and push gases aside.
  private flowInto(i: number, x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    const j = y * this.w + x;
    const b = MATERIALS[this.mat[j]].behavior;
    if (b !== NOTHING && b !== GAS) return false;
    this.swap(i, j);
    return true;
  }

  private riseInto(i: number, x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    const j = y * this.w + x;
    if (this.mat[j] !== M.EMPTY) return false;
    this.swap(i, j);
    return true;
  }

  private idx(x: number, y: number): number {
    return y * this.w + x;
  }

  private swap(i: number, j: number): void {
    const { mat, life, fuel, shade } = this;
    [mat[i], mat[j]] = [mat[j], mat[i]];
    [life[i], life[j]] = [life[j], life[i]];
    [fuel[i], fuel[j]] = [fuel[j], fuel[i]];
    [shade[i], shade[j]] = [shade[j], shade[i]];
    this.moved[j] = this.mark;
    this.moved[i] = this.mark;
  }

  // First solid cell from the top in a column, or the floor.
  groundY(x: number): number {
    for (let y = 0; y < this.h; y++) if (this.solid(x, y) || this.get(x, y) === M.WATER) return y;
    return this.h - 1;
  }

  serialize(): string {
    let s = "";
    for (let i = 0; i < this.mat.length; i += 0x8000) {
      s += String.fromCharCode(...this.mat.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  static deserialize(w: number, h: number, data: string): Grid | null {
    const raw = atob(data);
    if (raw.length !== w * h) return null;
    const grid = new Grid(w, h);
    for (let i = 0; i < raw.length; i++) {
      const m = raw.charCodeAt(i);
      grid.mat[i] = m < MATERIALS.length ? m : M.EMPTY;
      grid.life[i] = initialLife(grid.mat[i], M.EMPTY, grid.rng);
    }
    return grid;
  }
}

const DX4 = [1, -1, 0, 0];
const DY4 = [0, 0, 1, -1];
const DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
const DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

function initialLife(m: number, fuel: number, rng: Rng): number {
  if (m === M.FIRE) {
    const base = fuel === M.EMPTY ? 18 : MATERIALS[fuel].burnTicks;
    return Math.min(255, Math.max(1, Math.round(base * rng.range(0.6, 1.4))));
  }
  if (m === M.STEAM) return rng.int(60, 160);
  if (m === M.SMOKE) return rng.int(30, 90);
  return 0;
}

// Builds a fresh world: hills of grass, dirt and stone, a pond, trees and a
// few crystal veins.
export function generateTerrain(w: number, h: number, seed: number): Grid {
  const grid = new Grid(w, h);
  const rng = new Rng(seed);
  const base = h * 0.62;
  const p1 = rng.range(0, Math.PI * 2);
  const p2 = rng.range(0, Math.PI * 2);
  const surface: number[] = [];
  for (let x = 0; x < w; x++) {
    const t = x / w;
    const y = base + Math.sin(t * 5 + p1) * h * 0.06 + Math.sin(t * 13 + p2) * h * 0.025 + rng.range(-0.6, 0.6);
    surface.push(Math.round(y));
  }

  // A pond in the lowest stretch of land, dug out a little deeper.
  const pondWidth = Math.max(10, Math.round(w * 0.12));
  let pondStart = 0;
  let lowest = -Infinity;
  for (let x = 4; x < w - pondWidth - 4; x++) {
    if (surface[x + (pondWidth >> 1)] > lowest) {
      lowest = surface[x + (pondWidth >> 1)];
      pondStart = x;
    }
  }
  const pondDepth = Math.max(4, Math.round(h * 0.06));
  // Water fills up to the lower of the two rims, so it never spills over.
  const waterLevel = Math.max(surface[pondStart], surface[pondStart + pondWidth - 1]);
  for (let k = 0; k < pondWidth; k++) {
    surface[pondStart + k] += Math.round(Math.sin((k / (pondWidth - 1)) * Math.PI) * pondDepth);
  }

  for (let x = 0; x < w; x++) {
    const top = surface[x];
    const dirtDepth = 5 + ((x * 7) % 4);
    for (let y = Math.max(0, top); y < h; y++) {
      if (y === top) grid.set(x, y, M.GRASS);
      else if (y < top + dirtDepth) grid.set(x, y, M.DIRT);
      else grid.set(x, y, M.STONE);
    }
  }

  // Fill the pond and line it with sand.
  for (let x = pondStart; x < pondStart + pondWidth; x++) {
    for (let y = waterLevel; y < surface[x]; y++) grid.set(x, y, M.WATER);
    grid.set(x, surface[x], M.SAND);
    grid.set(x, surface[x] + 1, M.SAND);
  }
  for (const x of [pondStart - 2, pondStart - 1, pondStart + pondWidth, pondStart + pondWidth + 1]) {
    if (x >= 0 && x < w) grid.set(x, surface[x], M.SAND);
  }

  // Crystal veins deep in the stone.
  for (let v = 0; v < Math.max(2, Math.round(w / 80)); v++) {
    let x = rng.int(0, w);
    let y = rng.int(Math.round(h * 0.82), h - 2);
    for (let s = 0; s < 14; s++) {
      if (grid.get(x, y) === M.STONE) grid.set(x, y, M.CRYSTAL);
      x += rng.int(-1, 2);
      y += rng.int(-1, 2);
    }
  }

  // Trees, away from the pond.
  const trees = Math.max(3, Math.round(w / 35));
  for (let t = 0; t < trees; t++) {
    const x = rng.int(4, w - 4);
    if (x > pondStart - 4 && x < pondStart + pondWidth + 4) continue;
    growTree(grid, x, surface[x] - 1, rng);
  }

  return grid;
}

export function growTree(grid: Grid, x: number, groundY: number, rng: Rng): void {
  const height = rng.int(6, 12);
  for (let k = 0; k < height; k++) grid.set(x, groundY - k, M.WOOD);
  const top = groundY - height;
  const r = rng.int(3, 5);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r + rng.int(-2, 2) && grid.get(x + dx, top + dy) === M.EMPTY) {
        grid.set(x + dx, top + dy, M.LEAVES);
      }
    }
  }
}
