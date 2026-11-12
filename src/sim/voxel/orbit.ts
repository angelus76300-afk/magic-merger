import { PerspectiveCamera, Vector3 } from "three";
import type { CameraControl } from "../runtime";
import { PITCH_START, clampPitch, lookDir, lookTheta, type Eye } from "../eyes";

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
  // Become anything (2026-11-12, possess.ts): behind and above the creature
  // the player is. It turns behind it once, when it is taken (turn); after
  // that its turn is the player's (the playtest of 12 November: a camera that
  // swung behind the creature after every step turned the stick under the
  // thumb, and a pull down walked it back and forth). A drag turns it round
  // the creature, as in the eye view.
  // A flier or a swimmer is steered by bank (drive.ts): its camera follows
  // behind it (follow), as a flight game's does, since the stick turns it.
  private chased: { x: number; y: number; z: number; hd: number; dist: number; turn: number | null; tilt: number; follow: boolean } | null = null;
  // Through its eyes (2026-11-12, eyes.ts): at the head of the creature the
  // player is, looking where they look. A drag turns the look; the chase
  // above keeps following meanwhile, so the behind view comes back in place.
  private eyed: Eye | null = null;
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
    // Nothing takes the camera from the creature the player is, not even a spell's shot.
    if (this.chased) return;
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
    this.chased = null;
    this.returnAt = 0;
    const turn = theta === undefined ? undefined : this.theta + Math.atan2(Math.sin(theta - this.theta), Math.cos(theta - this.theta));
    this.goal = { tx, ty, dist: Math.max(this.minDist, Math.min(this.maxDist * 0.5, dist)), phi, speed: 1 / Math.max(0.2, seconds), theta: turn };
  }

  // Keeps (x, y) in the middle from `dist` away, called again as the subject moves.
  watch(x: number, y: number, dist: number): void {
    if (this.chased) return;
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

  // Behind the creature at (x, y), z above the ground, facing `heading`
  // (radians, 0 along +x as creatures.ts hd). Called again as it moves. `size`:
  // its radius in cells, so a dragon is not filmed from as close as a rabbit.
  chase(x: number, y: number, z: number, heading: number, size = 0.6, follow = false): void {
    if (!this.chased) {
      this.goal = null;
      this.saved = null;
      this.returnAt = 0;
      this.watched = null;
      // Close enough that the creature is the subject on a folded phone (344 px wide).
      const dist = Math.max(9, Math.min(24, 7.5 + size * 6.5));
      this.chased = { x, y, z, hd: heading, dist, turn: Math.atan2(-Math.cos(heading), -Math.sin(heading)), tilt: 0, follow };
      return;
    }
    this.chased.x = x;
    this.chased.y = y;
    this.chased.z = z;
    this.chased.hd = heading;
    this.chased.follow = follow;
    if (follow) this.chased.turn = Math.atan2(-Math.cos(heading), -Math.sin(heading));
  }

  // Let go: the camera stays where it is, it does not fly back.
  unchase(): void {
    this.chased = null;
  }

  get chasing(): boolean {
    return this.chased !== null;
  }

  // Into the eyes, looking along `yaw` (its heading). The view.ts sets where the eye is every frame.
  eyeOn(yaw: number, x: number, y: number, h: number): void {
    this.eyed = { x, y, h, yaw, pitch: PITCH_START };
  }

  eyeAt(x: number, y: number, h: number): void {
    if (!this.eyed) return;
    this.eyed.x = x;
    this.eyed.y = y;
    this.eyed.h = h;
  }

  // The tilt of the view from behind, -0.35 (from above) to 0.3 (from low): a flier's climb.
  get tilt(): number {
    return this.chased?.tilt ?? 0;
  }

  // Back behind it, turned the way the eyes looked.
  eyeOff(): void {
    if (!this.eyed) return;
    this.theta = lookTheta(this.eyed.yaw);
    if (this.chased) this.chased.turn = null;
    this.eyed = null;
  }

  get eye(): Eye | null {
    return this.eyed;
  }

  // A slow turn while a shot holds, so the place is seen from more than one side.
  spin(radians: number): void {
    this.theta += radians;
  }

  // True while the camera moves on its own: flying to a spell, coming back,
  // shaking. The engine keeps drawing frames for it.
  animating(): boolean {
    return this.goal !== null || this.watched !== null || this.chased !== null || this.eyed !== null || (this.shakeTime > 0 && this.shake > 0.001);
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
    if (this.eyed) {
      // A drag turns the look the way the finger goes: right turns right, up looks up.
      this.eyed.yaw += dx * 0.0065;
      this.eyed.pitch = clampPitch(this.eyed.pitch - dy * 0.0055);
      return;
    }
    if (this.chased) {
      // Round the creature, never away from it; the turn stays where the finger leaves it.
      this.chased.turn = null;
      this.theta -= dx * 0.006;
      this.chased.tilt = Math.max(-0.35, Math.min(0.3, this.chased.tilt - dy * 0.004));
      return;
    }
    this.release();
    this.theta -= dx * 0.006;
    this.phi = Math.max(0.25, Math.min(1.45, this.phi - dy * 0.005));
  }

  zoom(factor: number): void {
    if (this.eyed) return;
    if (this.chased) {
      this.chased.dist = Math.max(6, Math.min(30, this.chased.dist / factor));
      return;
    }
    this.release();
    this.dist = Math.max(this.minDist, Math.min(this.maxDist * 0.5, this.dist / factor));
  }

  // Pans along the ground, in screen pixels.
  pan(dx: number, dy: number, viewH: number): void {
    // The view stays on the creature the player is.
    if (this.chased) return;
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
    if (this.eyed) return this.updateEye(dt, groundAt, reducedMotion);
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
    const ch = this.chased;
    if (ch) {
      // Follows the creature closely (its steps come thirty times a second;
      // the ease keeps the frame from trembling). With reduced motion the
      // first turn behind it is a slow ease, never a swing.
      const k = Math.min(1, dt * 6);
      this.tx += (ch.x - this.tx) * k;
      this.ty += (ch.y - this.ty) * k;
      // Behind it once, when it is taken; never again by itself.
      if (ch.turn !== null) {
        const turn = Math.atan2(Math.sin(ch.turn - this.theta), Math.cos(ch.turn - this.theta));
        this.theta += turn * Math.min(1, dt * (reducedMotion ? 0.8 : 2.6));
        if (Math.abs(turn) < 0.01 && !ch.follow) ch.turn = null;
      }
      this.phi += (0.9 + ch.tilt - this.phi) * Math.min(1, dt * (reducedMotion ? 1 : 3));
      this.dist = Math.exp(Math.log(this.dist) + (Math.log(ch.dist) - Math.log(this.dist)) * Math.min(1, dt * (reducedMotion ? 1.2 : 2.5)));
    }
    // Look at the ground under the target, eased so hills do not jerk the view;
    // a creature the player is, at its own height (a bird in the air).
    const lift = ch ? ch.z + 1 : 0;
    this.th += (groundAt(this.tx, this.ty) + lift - this.th) * Math.min(1, dt * 3);
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
    this.camera.fov = 40;
    // Near and far planes follow the zoom so depth precision stays good.
    this.camera.near = Math.max(0.3, this.dist * 0.02);
    this.camera.far = this.dist * 4 + 1500;
    this.camera.updateProjectionMatrix();
  }

  // The eye: no ease on the position (the view sets it from the creature as
  // drawn, between ticks), a wider lens, a near plane a hand from the face.
  private updateEye(dt: number, groundAt: (x: number, y: number) => number, reducedMotion: boolean): void {
    const e = this.eyed!;
    // The rest of the camera keeps up for the sound (engine.ts listenerAt) and a smooth way back.
    this.tx = e.x;
    this.ty = e.y;
    this.th = e.h;
    this.dist = 14;
    this.theta = lookTheta(e.yaw);
    if (this.chased) {
      this.chased.x = e.x;
      this.chased.y = e.y;
    }
    const pos = new Vector3(e.x - this.worldW / 2, Math.max(e.h, groundAt(e.x, e.y) + 0.3), e.y - this.worldH / 2);
    this.camera.position.copy(pos);
    if (this.shakeTime > 0 && !reducedMotion) {
      this.shakeTime -= dt;
      const s = this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.shake *= 1 - Math.min(1, dt * 2.5);
    }
    const d = lookDir(e.yaw, e.pitch);
    this.camera.lookAt(pos.x + d.x, pos.y + d.h, pos.z + d.y);
    // About 75 degrees across, as a first person game, within 55 to 95 up and
    // down: a folded phone (344 by 882) would otherwise see a slit of the world.
    const across = Math.tan((75 * Math.PI) / 360) / Math.max(0.1, this.camera.aspect);
    this.camera.fov = Math.max(55, Math.min(95, (Math.atan(across) * 360) / Math.PI));
    this.camera.near = 0.06;
    this.camera.far = Math.max(this.worldW, this.worldH) * 3 + 200;
    this.camera.updateProjectionMatrix();
  }
}
