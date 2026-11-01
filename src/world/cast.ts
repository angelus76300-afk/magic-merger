import { PHASE_NAMES, SCALE_RADIUS, type Emitter, type SpellSpec } from "../../shared/spell";
import type { Creature } from "./creatures";
import { applyEffect } from "./effects";
import { hexToRgb } from "./particles";
import type { World } from "./world";

interface Point {
  x: number;
  y: number;
}

export interface CircleState extends Point {
  r: number;
  alpha: number;
  angle: number;
  // Seen from the side, a circle drawn on the ground is squashed into an ellipse.
  flat: boolean;
}

// One spell being cast: plays the four phases, emits particles and applies the
// effects when the spell is released.
export class Cast {
  t = 0;
  done = false;
  readonly radius: number;
  readonly target: Point;
  readonly origin: Point;
  private starts: number[];
  private releaseAt: number;
  private end: number;
  private entered = new Set<number>();
  private emitDebt = new Map<Emitter, number>();
  private touched = new Set<string>();
  private colors: number[];

  constructor(
    readonly spec: SpellSpec,
    x: number,
    y: number,
    private world: World,
  ) {
    this.radius = SCALE_RADIUS[spec.scale];
    this.target = { x, y };
    const { charge, travel, release, linger } = spec.phases;
    const flies = spec.delivery === "projectile" || spec.delivery === "beam";
    const side = x < world.grid.w / 2 ? -1 : 1;
    this.origin =
      spec.delivery === "projectile"
        ? { x: x + side * Math.min(60, world.grid.w * 0.3), y: Math.max(6, y - 60) }
        : spec.delivery === "beam"
          ? { x, y: Math.max(6, y - 70) }
          : { x, y };

    const durations = [
      Math.max(0.5, charge.duration),
      flies ? Math.max(0.35, travel.duration) : 0,
      release.duration,
      linger.duration,
    ];
    this.starts = [0];
    for (let i = 1; i < 4; i++) this.starts.push(this.starts[i - 1] + durations[i - 1]);
    this.releaseAt = this.starts[2];
    const longestEffect = Math.max(0, ...spec.effects.map((e) => e.duration));
    this.end = Math.max(this.starts[3] + durations[3], this.releaseAt + longestEffect) + 0.2;
    this.colors = [spec.incantation.primary, spec.incantation.secondary].map(hexToRgb);
  }

  // Where the magic circle is drawn, and how visible it is.
  circle(): CircleState | null {
    const { spec, t, releaseAt } = this;
    const fadeOut = 0.6;
    if (t > releaseAt + fadeOut) return null;
    const alpha = t < 0.3 ? t / 0.3 : t > releaseAt ? 1 - (t - releaseAt) / fadeOut : 1;
    const flies = spec.delivery === "projectile" || spec.delivery === "beam";
    const at = flies ? this.origin : this.target;
    return {
      x: at.x,
      y: at.y,
      // Below about 10 cells the rings, star and runes blur into a dot.
      r: Math.max(10, Math.min(this.radius * 1.2, 22)),
      alpha: Math.max(0, alpha),
      angle: t * spec.incantation.spin * Math.PI * 2,
      flat: !flies,
    };
  }

  update(dt: number): void {
    const { t } = this;
    const phase = this.phaseAt(t);
    if (phase >= 0) this.emitPhase(phase, dt);
    this.deliveryVisuals();
    this.applyEffects(dt);
    this.t += dt;
    if (this.t >= this.end) this.done = true;
  }

  private phaseAt(t: number): number {
    for (let i = 3; i >= 0; i--) {
      const duration = i < 3 ? this.starts[i + 1] - this.starts[i] : this.spec.phases.linger.duration;
      if (t >= this.starts[i] && (t < this.starts[i] + duration || (duration === 0 && !this.entered.has(i)))) return i;
    }
    return -1;
  }

  private head(): Point {
    const { origin, target } = this;
    const travel = this.starts[2] - this.starts[1];
    if (travel <= 0) return target;
    const k = Math.min(1, Math.max(0, (this.t - this.starts[1]) / travel));
    return { x: origin.x + (target.x - origin.x) * k, y: origin.y + (target.y - origin.y) * k };
  }

  private emitPhase(index: number, dt: number): void {
    const name = PHASE_NAMES[index];
    const phase = this.spec.phases[name];
    const firstTick = !this.entered.has(index);
    this.entered.add(index);
    const circle = this.circle();
    const anchor = name === "charge" ? (circle ?? this.target) : name === "travel" ? this.head() : this.target;
    // Charge particles gather at the circle, the others fill the spell's area.
    const radius = name === "charge" && circle ? circle.r : this.radius;
    const progress = phase.duration > 0 ? (this.t - this.starts[index]) / phase.duration : 1;

    for (const emitter of phase.emitters) {
      let n: number;
      if (phase.duration === 0) n = firstTick ? emitter.count : 0;
      else {
        const debt = (this.emitDebt.get(emitter) ?? 0) + (emitter.count / phase.duration) * dt;
        n = Math.floor(debt);
        this.emitDebt.set(emitter, debt - n);
      }
      for (let i = 0; i < n; i++) this.emitOne(emitter, anchor, progress, radius);
    }
  }

  private emitOne(e: Emitter, at: Point, progress: number, R: number): void {
    const color = hexToRgb(e.colors[(Math.random() * e.colors.length) | 0]);
    const life = e.lifetime * (0.8 + Math.random() * 0.4);
    const a = Math.random() * Math.PI * 2;
    const sp = e.speed * (0.5 + Math.random() * 0.5);
    let x = at.x;
    let y = at.y;
    let vx = 0;
    let vy = 0;
    switch (e.pattern) {
      case "burst":
        vx = Math.cos(a) * sp;
        vy = Math.sin(a) * sp;
        break;
      case "ring":
        x += Math.cos(a) * R * 0.8;
        y += Math.sin(a) * R * 0.8 * 0.5;
        vx = Math.cos(a) * sp * 0.3;
        vy = Math.sin(a) * sp * 0.15;
        break;
      case "spiral": {
        const ang = a + progress * 6;
        const rad = R * (1 - progress * 0.8);
        x += Math.cos(ang) * rad;
        y += Math.sin(ang) * rad * 0.5;
        vx = -Math.sin(ang) * sp - Math.cos(ang) * sp * 0.3;
        vy = Math.cos(ang) * sp * 0.5 - Math.sin(ang) * sp * 0.15;
        break;
      }
      case "fountain":
        vx = (Math.random() - 0.5) * sp * 0.6;
        vy = -sp;
        break;
      case "rain":
        x += (Math.random() - 0.5) * 2 * R;
        y -= R * 1.5 + Math.random() * 4;
        vx = (Math.random() - 0.5) * 2;
        vy = Math.max(10, sp);
        break;
      case "orbit": {
        const rad = R * (0.4 + Math.random() * 0.5);
        x += Math.cos(a) * rad;
        y += Math.sin(a) * rad * 0.6;
        vx = -Math.sin(a) * sp;
        vy = Math.cos(a) * sp * 0.6;
        break;
      }
      case "sparkle": {
        const rad = Math.sqrt(Math.random()) * R;
        x += Math.cos(a) * rad;
        y += Math.sin(a) * rad;
        vx = (Math.random() - 0.5) * sp * 0.3;
        vy = (Math.random() - 0.5) * sp * 0.3;
        break;
      }
      case "column":
        x += (Math.random() - 0.5) * R * 0.6;
        y -= Math.random() * R * 1.5;
        vx = (Math.random() - 0.5) * 2;
        vy = -sp;
        break;
      case "trail":
        vx = (Math.random() - 0.5) * sp * 0.4;
        vy = (Math.random() - 0.5) * sp * 0.4;
        break;
    }
    this.world.particles.add(x, y, vx, vy, life, color, e.size, e.glow, e.gravity);
  }

  // Built in visuals that make each delivery readable whatever the spec says.
  private deliveryVisuals(): void {
    const { spec, t, world } = this;
    const [primary, secondary] = this.colors;
    const travelling = t >= this.starts[1] && t < this.starts[2];
    if (spec.delivery === "projectile" && travelling) {
      const h = this.head();
      for (let i = 0; i < 4; i++) {
        world.particles.add(h.x + (Math.random() - 0.5) * 2, h.y + (Math.random() - 0.5) * 2, 0, 0, 0.25, i % 2 ? primary : secondary, 2, true);
      }
    }
    if (spec.delivery === "beam" && (travelling || (t >= this.releaseAt && t < this.releaseAt + 0.3))) {
      const h = this.head();
      for (let y = this.origin.y; y < h.y; y += 1) {
        if (Math.random() < 0.5) world.particles.add(h.x + (Math.random() - 0.5) * 2, y, 0, 0, 0.12, Math.random() < 0.5 ? primary : 0xffffff, 1, true);
      }
    }
    if (spec.delivery === "wave" && t >= this.releaseAt && t < this.releaseAt + 0.8) {
      const k = (t - this.releaseAt) / 0.8;
      for (const side of [-1, 1]) {
        const x = this.target.x + side * k * this.radius * 1.6;
        world.particles.add(x, this.target.y - Math.random() * 3, side * 4, -3, 0.4, primary, 1, true);
      }
    }
  }

  private applyEffects(dt: number): void {
    const { t, releaseAt, spec } = this;
    if (t < releaseAt) return;
    const first = t - dt < releaseAt;
    spec.effects.forEach((effect, index) => {
      const lasting = effect.duration > 0;
      if (!lasting && !first) return;
      if (lasting && t > releaseAt + effect.duration) return;
      applyEffect({
        world: this.world,
        effect,
        cx: this.target.x,
        cy: this.target.y,
        r: this.radius,
        dt,
        instant: !lasting,
        remaining: lasting ? releaseAt + effect.duration - t : 0,
        delivery: spec.delivery,
        firstTouch: (c: Creature) => {
          const key = `${index}:${c.id}`;
          if (this.touched.has(key)) return false;
          this.touched.add(key);
          return true;
        },
      });
    });
  }
}
