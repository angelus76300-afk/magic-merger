import { Camera } from "./camera";
import { lifeCycle, populate, updateCreature } from "./creatures";
import { stepPhysics } from "./physics";
import { Renderer } from "./render";
import { Runtime, type CastRequest, type ErrorReporter } from "./runtime";
import { loadWorld, saveWorld, type SavedWorld } from "./save";
import { SpellSound } from "./sound";
import { TICK, generateWorld, type World } from "./world";

export const WORLD_SIZES = { small: 128, medium: 176, large: 240 } as const;
export type WorldSize = keyof typeof WORLD_SIZES;

export interface EngineHooks {
  onError: ErrorReporter;
  // A tap on the world that did not pan or zoom.
  onTap: (x: number, y: number) => void;
}

// Runs one world: simulation in fixed ticks, rendering every frame, and the
// player's fingers (tap to cast, drag to look around, pinch or wheel to zoom).
export class Engine {
  readonly runtime: Runtime;
  readonly camera: Camera;
  readonly renderer: Renderer;
  readonly sound = new SpellSound();
  private running = false;
  private last = 0;
  private acc = 0;
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; moved: boolean }>();
  private pinch: { d: number; mx: number; my: number } | null = null;
  private reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly world: World,
    private hooks: EngineHooks,
    runtime?: Runtime,
  ) {
    this.runtime = runtime ?? new Runtime(world, hooks.onError);
    this.camera = new Camera(world.w, world.h);
    this.runtime.camera = this.camera;
    this.renderer = new Renderer(canvas, world);
    this.resize();
  }

  static create(canvas: HTMLCanvasElement, size: WorldSize, hooks: EngineHooks, seed = (Math.random() * 2 ** 31) | 0): Engine {
    const n = WORLD_SIZES[size] ?? WORLD_SIZES.medium;
    const world = generateWorld(n, n, seed);
    populate(world);
    const engine = new Engine(canvas, world, hooks);
    // Open on a village: the people are what makes the world feel alive.
    const home = world.creatures.find((c) => c.kind === "villager");
    if (home) {
      engine.camera.x = home.x;
      engine.camera.y = home.y;
    }
    return engine;
  }

  // Rebuilds a saved world. `rules` registers the materials and creatures of
  // the spells that defined some, before the cells are read.
  static restore(canvas: HTMLCanvasElement, data: SavedWorld, hooks: EngineHooks, rules: (rt: Runtime) => void): Engine | null {
    let runtime: Runtime | null = null;
    const world = loadWorld(data, (w) => {
      runtime = new Runtime(w, hooks.onError);
      rules(runtime);
    });
    if (!world || !runtime) return null;
    // The runtime that already knows the custom rules comes along.
    return new Engine(canvas, world, hooks, runtime);
  }

  save(): SavedWorld {
    return saveWorld(this.world, this.runtime.owners);
  }

  cast(req: CastRequest, x: number, y: number): boolean {
    return this.runtime.cast(req, x, y);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.fit(rect.width, rect.height, window.devicePixelRatio);
    this.camera.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  stop(): void {
    this.running = false;
  }

  // Advances the simulation by one tick. Public for the Spell Lab.
  step(): void {
    const { world } = this;
    world.time += TICK;
    world.tick++;
    stepPhysics(world, TICK);
    for (const c of world.creatures) updateCreature(world, c, TICK);
    lifeCycle(world, TICK);
    this.runtime.step(TICK);
    world.particles.update(TICK);
  }

  // Draws the current state. Public for the Spell Lab.
  render(dt = TICK): void {
    this.handleEvents();
    this.camera.update(dt, this.world.time, this.reducedMotion);
    this.renderer.draw(this.camera, this.runtime.visuals, this.world.time);
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK && steps < 3) {
      this.step();
      this.acc -= TICK;
      steps++;
    }
    if (this.acc > TICK * 3) this.acc = 0;
    this.render(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  private handleEvents(): void {
    for (const e of this.world.events.splice(0)) {
      if (e.kind === "sound") this.sound.play(e.name, e.size);
      else if (e.kind === "shake") this.camera.addShake(e.amount, e.seconds);
      else if (e.kind === "flash" && !this.reducedMotion) {
        this.runtime.visuals.flash = Math.max(this.runtime.visuals.flash, e.strength);
        this.runtime.visuals.flashColor = e.color;
      }
    }
  }

  // Input: one finger taps or pans, two fingers pinch, a wheel zooms.
  // Returns a function that removes the listeners again.
  bindInput(): () => void {
    const c = this.canvas;
    const abort = new AbortController();
    const opts = { signal: abort.signal };
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
      if (this.pointers.size === 2) this.pinch = this.pinchState();
    }, opts);
    c.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) p.moved = true;
      if (this.pointers.size === 1 && p.moved) this.camera.userPan(dx, dy);
      else if (this.pointers.size === 2 && this.pinch) {
        const now = this.pinchState();
        const rect = c.getBoundingClientRect();
        this.camera.userZoom(now.d / this.pinch.d, now.mx - rect.left, now.my - rect.top);
        this.camera.userPan(now.mx - this.pinch.mx, now.my - this.pinch.my);
        this.pinch = now;
        for (const q of this.pointers.values()) q.moved = true;
      }
    }, opts);
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!p || p.moved || e.type === "pointercancel" || performance.now() - p.t > 700) return;
      const rect = c.getBoundingClientRect();
      const at = this.camera.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (this.world.inside(Math.floor(at.x), Math.floor(at.y))) this.hooks.onTap(at.x, at.y);
    };
    c.addEventListener("pointerup", end, opts);
    c.addEventListener("pointercancel", end, opts);
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        this.camera.userZoom(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false, signal: abort.signal },
    );
    window.addEventListener("resize", () => this.resize(), opts);
    return () => abort.abort();
  }

  private pinchState(): { d: number; mx: number; my: number } {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  // Drops everything a spell left running, for a clean slate.
  clearSpells(): void {
    this.runtime.clear();
  }
}
