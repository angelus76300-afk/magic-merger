// Visual only particles. They live in world cells, with a height z above the
// ground that the renderer shows as a lift and a shadow. When full, the oldest
// are reused.
export interface ParticleOptions {
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life?: number;
  color?: number;
  size?: number;
  glow?: boolean;
  // Pull on z per second squared: positive falls, negative rises.
  gravity?: number;
  // Fraction of speed lost per second.
  drag?: number;
}

export class Particles {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly color: Uint32Array;
  readonly size: Float32Array;
  readonly glow: Uint8Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  private next = 0;

  constructor(readonly capacity = 12000) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.color = new Uint32Array(capacity);
    this.size = new Float32Array(capacity);
    this.glow = new Uint8Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
  }

  add(o: ParticleOptions): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.x[i] = o.x;
    this.y[i] = o.y;
    this.z[i] = o.z ?? 0;
    this.vx[i] = o.vx ?? 0;
    this.vy[i] = o.vy ?? 0;
    this.vz[i] = o.vz ?? 0;
    const life = Math.max(0.05, o.life ?? 1);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.color[i] = (o.color ?? 0xffffff) >>> 0;
    this.size[i] = Math.max(0.2, Math.min(8, o.size ?? 1));
    this.glow[i] = o.glow ? 1 : 0;
    this.gravity[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = 1 - Math.min(1, this.drag[i] * dt);
      this.vx[i] *= k;
      this.vy[i] *= k;
      this.vz[i] = this.vz[i] * k - this.gravity[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      if (this.z[i] < 0) {
        this.z[i] = 0;
        this.vz[i] *= -0.3;
      }
    }
  }

  clear(): void {
    this.life.fill(0);
  }
}
