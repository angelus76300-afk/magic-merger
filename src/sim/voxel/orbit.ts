import { PerspectiveCamera, Vector3 } from "three";
import type { CameraControl } from "../runtime";

// An orbiting camera around a point on the island. The player turns it with
// one finger, zooms with a pinch or the wheel, and pans with two fingers.
// Spells can fly it somewhere (close in, or far out to show the whole island
// hanging in space) and it drifts back to the player's view afterwards.
export class OrbitCamera implements CameraControl {
  readonly camera: PerspectiveCamera;
  // Point looked at, in world cells (x, y on the ground; h is height in scene units).
  tx = 0;
  ty = 0;
  th = 4;
  theta = Math.PI * 0.25;
  phi = 0.95;
  dist = 90;
  private goal: { tx: number; ty: number; dist: number; phi: number; speed: number; theta?: number } | null = null;
  private saved: { tx: number; ty: number; dist: number; phi: number } | null = null;
  private returnAt = 0;
  // The island tells its stories (2026-11-11, director.ts): a subject the
  // camera keeps in frame, moving with it, until the player touches the view.
  private watched: { x: number; y: number; dist: number } | null = null;
  private shake = 0;
  private shakeTime = 0;
  readonly minDist = 8;
  maxDist: number;

  constructor(
    private worldW: number,
    private worldH: number,
  ) {
    this.camera = new PerspectiveCamera(40, 1, 0.5, 4000);
    this.tx = worldW / 2;
    this.ty = worldH / 2;
    this.maxDist = Math.max(worldW, worldH) * 6;
    this.dist = Math.max(worldW, worldH) * 0.55;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // Distance at which a circle of radius r fits the narrower side of the view.
  distanceFor(r: number): number {
    const fov = (this.camera.fov * Math.PI) / 180;
    const narrow = Math.min(1, this.camera.aspect);
    return (r * 1.15) / Math.tan(fov / 2) / narrow;
  }

  visibleRadius(): number {
    const fov = (this.camera.fov * Math.PI) / 180;
    return (Math.tan(fov / 2) * this.dist * Math.min(1, this.camera.aspect)) / 1.15;
  }

  focus(x: number, y: number, r: number, seconds: number, now: number): void {
    // A spell's own shot comes before the story being watched.
    this.watched = null;
    if (!this.saved) this.saved = { tx: this.tx, ty: this.ty, dist: this.dist, phi: this.phi };
    const dist = Math.max(this.minDist, Math.min(this.maxDist, this.distanceFor(Math.max(3, r))));
    // Far shots look more from above, so the whole island reads as a shape.
    const phi = dist > Math.max(this.worldW, this.worldH) ? 0.7 : this.phi;
    this.goal = { tx: x, ty: y, dist, phi, speed: 1 / Math.max(0.15, seconds) };
    this.returnAt = Math.max(this.returnAt, now + seconds + 2.5);
  }

  restore(seconds: number): void {
    if (!this.saved) return;
    this.goal = { ...this.saved, speed: 1 / Math.max(0.2, seconds) };
    this.saved = null;
    this.returnAt = 0;
  }

  // The first look at a new island (4.4.5 part B): a flight from shot to
  // shot that nothing undoes afterwards. The player's first touch ends it.
  // With `theta`, it also turns to look from that side (the shorter way round).
  flyTo(tx: number, ty: number, dist: number, phi: number, seconds: number, theta?: number): void {
    this.saved = null;
    this.watched = null;
    this.returnAt = 0;
    const turn = theta === undefined ? undefined : this.theta + Math.atan2(Math.sin(theta - this.theta), Math.cos(theta - this.theta));
    this.goal = { tx, ty, dist: Math.max(this.minDist, Math.min(this.maxDist * 0.5, dist)), phi, speed: 1 / Math.max(0.2, seconds), theta: turn };
  }

  // Keeps (x, y) in the middle from `dist` away, called again as the subject moves.
  watch(x: number, y: number, dist: number): void {
    this.goal = null;
    this.saved = null;
    this.returnAt = 0;
    this.watched = { x, y, dist: Math.max(this.minDist * 1.5, Math.min(this.maxDist * 0.5, dist)) };
  }

  unwatch(): void {
    this.watched = null;
  }

  get watching(): boolean {
    return this.watched !== null;
  }

  // A slow turn while a shot holds, so the place is seen from more than one side.
  spin(radians: number): void {
    this.theta += radians;
  }

  // True while the camera moves on its own: flying to a spell, coming back,
  // shaking. The engine keeps drawing frames for it.
  animating(): boolean {
    return this.goal !== null || this.watched !== null || (this.shakeTime > 0 && this.shake > 0.001);
  }

  addShake(amount: number, seconds: number): void {
    this.shake = Math.max(this.shake, amount * 0.15);
    this.shakeTime = Math.max(this.shakeTime, seconds);
  }

  // The player takes over: a spell's shot is dropped and not undone later.
  private release(): void {
    this.watched = null;
    this.goal = null;
    this.saved = null;
    this.returnAt = 0;
  }

  orbit(dx: number, dy: number): void {
    this.release();
    this.theta -= dx * 0.006;
    this.phi = Math.max(0.25, Math.min(1.45, this.phi - dy * 0.005));
  }

  zoom(factor: number): void {
    this.release();
    this.dist = Math.max(this.minDist, Math.min(this.maxDist * 0.5, this.dist / factor));
  }

  // Pans along the ground, in screen pixels.
  pan(dx: number, dy: number, viewH: number): void {
    this.release();
    const perPixel = (this.dist * Math.tan((this.camera.fov * Math.PI) / 360) * 2) / Math.max(1, viewH);
    // Screen right on the ground is (cos, -sin); screen up is away from the
    // camera, stretched by the tilt. The ground follows the finger.
    const cos = Math.cos(this.theta);
    const sin = Math.sin(this.theta);
    const tilt = 1 / Math.max(0.35, Math.cos(this.phi));
    this.tx += (-dx * cos - dy * sin * tilt) * perPixel;
    this.ty += (dx * sin - dy * cos * tilt) * perPixel;
    this.tx = Math.max(-this.worldW * 0.2, Math.min(this.worldW * 1.2, this.tx));
    this.ty = Math.max(-this.worldH * 0.2, Math.min(this.worldH * 1.2, this.ty));
  }

  update(dt: number, now: number, groundAt: (x: number, y: number) => number, reducedMotion: boolean): void {
    if (this.saved && this.returnAt && now > this.returnAt) this.restore(1.5);
    if (this.goal) {
      const k = Math.min(1, dt * this.goal.speed * 2.5);
      this.tx += (this.goal.tx - this.tx) * k;
      this.ty += (this.goal.ty - this.ty) * k;
      this.phi += (this.goal.phi - this.phi) * k;
      if (this.goal.theta !== undefined) this.theta += (this.goal.theta - this.theta) * k;
      this.dist = Math.exp(Math.log(this.dist) + (Math.log(this.goal.dist) - Math.log(this.dist)) * k);
      if (Math.abs(this.dist - this.goal.dist) / this.goal.dist < 0.01 && Math.hypot(this.goal.tx - this.tx, this.goal.ty - this.ty) < 0.2) this.goal = null;
    }
    if (this.watched && !this.goal) {
      // Eased, never snapped: a cut is a glide of about a second, and a
      // walking subject is followed without the frame trembling.
      const k = Math.min(1, dt * 2.2);
      this.tx += (this.watched.x - this.tx) * k;
      this.ty += (this.watched.y - this.ty) * k;
      this.dist = Math.exp(Math.log(this.dist) + (Math.log(this.watched.dist) - Math.log(this.dist)) * Math.min(1, dt * 1.6));
      this.phi += (0.98 - this.phi) * Math.min(1, dt * 1.2);
      if (!reducedMotion) this.theta += dt * 0.035;
    }
    // Look at the ground under the target, eased so hills do not jerk the view.
    this.th += (groundAt(this.tx, this.ty) - this.th) * Math.min(1, dt * 3);
    const target = new Vector3(this.tx - this.worldW / 2, this.th, this.ty - this.worldH / 2);
    const offset = new Vector3(Math.sin(this.phi) * Math.sin(this.theta), Math.cos(this.phi), Math.sin(this.phi) * Math.cos(this.theta)).multiplyScalar(
      this.dist,
    );
    this.camera.position.copy(target).add(offset);
    // Never inside a hill: close to a villager on a slope, the eye would sit
    // under the ground behind it and the screen fill with sand (the preview, 11 November).
    const ex = this.camera.position.x + this.worldW / 2;
    const ey = this.camera.position.z + this.worldH / 2;
    if (ex >= 0 && ey >= 0 && ex < this.worldW && ey < this.worldH) this.camera.position.y = Math.max(this.camera.position.y, groundAt(ex, ey) + 2.5);
    if (this.shakeTime > 0 && !reducedMotion) {
      this.shakeTime -= dt;
      const s = this.shake * Math.min(1, this.dist / 60);
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake *= 1 - Math.min(1, dt * 2.5);
    }
    this.camera.lookAt(target);
    // Near and far planes follow the zoom so depth precision stays good.
    this.camera.near = Math.max(0.3, this.dist * 0.02);
    this.camera.far = this.dist * 4 + 1500;
    this.camera.updateProjectionMatrix();
  }
}
