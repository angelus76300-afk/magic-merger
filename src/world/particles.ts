// Visual only particles, stored as flat arrays. When full, the oldest are reused.
export class Particles {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly gravity: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly color: Uint32Array;
  readonly size: Uint8Array;
  readonly glow: Uint8Array;
  private next = 0;

  constructor(readonly capacity = 6000) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.color = new Uint32Array(capacity);
    this.size = new Uint8Array(capacity);
    this.glow = new Uint8Array(capacity);
  }

  add(x: number, y: number, vx: number, vy: number, life: number, color: number, size = 1, glow = false, gravity = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.color[i] = color;
    this.size[i] = size;
    this.glow[i] = glow ? 1 : 0;
    this.gravity[i] = gravity;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vy[i] += this.gravity[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }

  clear(): void {
    this.life.fill(0);
  }
}

export function hexToRgb(hex: string): number {
  return parseInt(hex.slice(1), 16) || 0xffffff;
}
