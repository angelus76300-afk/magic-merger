// Where the player looks: a center in world cells and a zoom in screen pixels
// per cell. The player pinches and drags; spells can take the camera for a
// moment (zoom out for a cataclysm, close in on a fizzle) and hand it back.
export class Camera {
  x = 0;
  y = 0;
  scale = 2;
  viewW = 1;
  viewH = 1;
  shakeX = 0;
  shakeY = 0;
  private shake = 0;
  private shakeTime = 0;
  // A spell's shot: where to go, how fast, and where the player was before.
  private shot: { x: number; y: number; scale: number; speed: number } | null = null;
  private saved: { x: number; y: number; scale: number } | null = null;
  private returnAt = 0;

  constructor(
    private worldW: number,
    private worldH: number,
  ) {
    this.x = worldW / 2;
    this.y = worldH / 2;
  }

  resize(w: number, h: number): void {
    const first = this.viewW <= 1;
    this.viewW = w;
    this.viewH = h;
    // Start close enough to see people: about a hundred cells across the short side.
    if (first) this.scale = Math.max(this.fitScale(), Math.min(w, h) / 100);
    this.clamp();
  }

  fitScale(): number {
    return Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
  }

  // Zoomed out a bit past the whole world, for cosmic spells.
  minScale(): number {
    return this.fitScale() * 0.45;
  }

  maxScale(): number {
    return 28;
  }

  // The scale at which a circle of radius r cells fills most of the view.
  scaleFor(r: number): number {
    return Math.min(this.viewW, this.viewH) / (r * 2.6);
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.viewW / 2) / this.scale + this.x, y: (sy - this.viewH / 2) / this.scale + this.y };
  }

  // The player takes over: any spell shot is dropped and not undone later.
  userPan(dx: number, dy: number): void {
    this.release();
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
    this.clamp();
  }

  userZoom(factor: number, sx: number, sy: number): void {
    this.release();
    const before = this.toWorld(sx, sy);
    this.scale = Math.max(this.fitScale() * 0.8, Math.min(this.maxScale(), this.scale * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  // A spell asks to look at a circle of radius r around (x, y) for a while.
  focus(x: number, y: number, r: number, seconds: number, now: number): void {
    if (!this.saved) this.saved = { x: this.x, y: this.y, scale: this.scale };
    const scale = Math.max(this.minScale(), Math.min(this.maxScale(), this.scaleFor(Math.max(2, r))));
    this.shot = { x, y, scale, speed: 1 / Math.max(0.15, seconds) };
    this.returnAt = Math.max(this.returnAt, now + seconds + 2);
  }

  // Back to what the player was looking at.
  restore(seconds: number): void {
    if (!this.saved) return;
    this.shot = { ...this.saved, speed: 1 / Math.max(0.2, seconds) };
    this.saved = null;
    this.returnAt = 0;
  }

  addShake(amount: number, seconds: number): void {
    this.shake = Math.max(this.shake, amount);
    this.shakeTime = Math.max(this.shakeTime, seconds);
  }

  // A spell that never asked to give the camera back gets it returned after a while.
  keepFocusUntil(now: number): void {
    this.returnAt = Math.max(this.returnAt, now);
  }

  update(dt: number, now: number, reducedMotion: boolean): void {
    if (this.saved && this.returnAt && now > this.returnAt) this.restore(1.2);
    if (this.shot) {
      const k = Math.min(1, dt * this.shot.speed * 2.5);
      this.x += (this.shot.x - this.x) * k;
      this.y += (this.shot.y - this.y) * k;
      // Zoom moves in log space so zooming out a lot is as smooth as zooming in.
      this.scale = Math.exp(Math.log(this.scale) + (Math.log(this.shot.scale) - Math.log(this.scale)) * k);
      if (Math.abs(this.scale - this.shot.scale) / this.shot.scale < 0.01 && Math.hypot(this.shot.x - this.x, this.shot.y - this.y) < 0.1) this.shot = null;
    }
    this.clamp();
    if (this.shakeTime > 0 && !reducedMotion) {
      this.shakeTime -= dt;
      this.shakeX = (Math.random() - 0.5) * this.shake;
      this.shakeY = (Math.random() - 0.5) * this.shake;
      this.shake *= 1 - Math.min(1, dt * 3);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  private release(): void {
    this.shot = null;
    this.saved = null;
    this.returnAt = 0;
  }

  // Keeps some of the world on screen, but allows looking past the edge when zoomed out.
  private clamp(): void {
    const halfW = this.viewW / 2 / this.scale;
    const halfH = this.viewH / 2 / this.scale;
    const mx = Math.max(0, this.worldW / 2 - halfW);
    const my = Math.max(0, this.worldH / 2 - halfH);
    this.x = Math.max(this.worldW / 2 - mx - 0.0001, Math.min(this.worldW / 2 + mx + 0.0001, this.x));
    this.y = Math.max(this.worldH / 2 - my - 0.0001, Math.min(this.worldH / 2 + my + 0.0001, this.y));
  }
}
