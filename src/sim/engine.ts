import { lifeCycle, populate, updateCreature } from "./creatures";
import { stepPhysics } from "./physics";
import { Runtime, type CastRequest, type ErrorReporter } from "./runtime";
import { loadWorld, saveWorld, type SavedWorld } from "./save";
import { SpellSound } from "./sound";
import { VoxelView } from "./voxel/view";
import { TICK, generateWorld, type World } from "./world";

export const WORLD_SIZES = { small: 112, medium: 152, large: 208 } as const;
export type WorldSize = keyof typeof WORLD_SIZES;

export interface EngineHooks {
  onError: ErrorReporter;
  // A tap on the island that did not turn, pan or zoom the view.
  onTap: (x: number, y: number) => void;
}

export interface EngineOptions {
  // The Spell Lab reads frames back from the canvas.
  preserveDrawingBuffer?: boolean;
}

// Runs one world: simulation in fixed ticks, the voxel view every frame, and
// the player's fingers (tap to cast, drag to turn, pinch or wheel to zoom,
// two fingers to pan).
export class Engine {
  readonly runtime: Runtime;
  readonly view: VoxelView;
  readonly sound = new SpellSound();
  private running = false;
  private last = 0;
  private acc = 0;
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; moved: boolean; button: number; shift: boolean }>();
  private pinch: { d: number; mx: number; my: number } | null = null;
  // Runs after every tick: a challenge's hazard and its goal check.
  onTick: (() => void) | null = null;
  private reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly overlay: HTMLCanvasElement,
    readonly world: World,
    private hooks: EngineHooks,
    runtime?: Runtime,
    options: EngineOptions = {},
  ) {
    this.runtime = runtime ?? new Runtime(world, hooks.onError);
    this.view = new VoxelView(canvas, overlay, world, options);
    this.runtime.camera = this.view.orbit;
    this.resize();
  }

  static create(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, size: WorldSize, hooks: EngineHooks, seed = (Math.random() * 2 ** 31) | 0, options: EngineOptions = {}): Engine {
    const n = WORLD_SIZES[size] ?? WORLD_SIZES.medium;
    const world = generateWorld(n, n, seed);
    populate(world);
    const engine = new Engine(canvas, overlay, world, hooks, undefined, options);
    // Open on a village, a little zoomed in: the people make the world feel alive.
    const home = world.creatures.find((c) => c.kind === "villager");
    if (home) {
      engine.view.orbit.tx = home.x;
      engine.view.orbit.ty = home.y;
      engine.view.orbit.dist = Math.max(world.w, world.h) * 0.42;
    }
    return engine;
  }

  // Rebuilds a saved world. `rules` registers the materials and creatures of
  // the spells that defined some, before the cells are read.
  static restore(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, data: SavedWorld, hooks: EngineHooks, rules: (rt: Runtime) => void): Engine | null {
    let runtime: Runtime | null = null;
    const world = loadWorld(data, (w) => {
      runtime = new Runtime(w, hooks.onError);
      rules(runtime);
    });
    if (!world || !runtime) return null;
    return new Engine(canvas, overlay, world, hooks, runtime);
  }

  save(): SavedWorld {
    return saveWorld(this.world, this.runtime.owners);
  }

  cast(req: CastRequest, x: number, y: number): boolean {
    return this.runtime.cast(req, x, y);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.view.resize(rect.width, rect.height);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    // A frame still pending from before a stop must not start a second loop.
    if (this.rafId === 0) this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private rafId = 0;

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
    this.onTick?.();
  }

  // Draws the current state. Public for the Spell Lab.
  render(dt = TICK): void {
    this.handleEvents();
    this.view.render(this.runtime.visuals, this.world.time, dt, this.reducedMotion);
  }

  private frame(now: number): void {
    this.rafId = 0;
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
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  private handleEvents(): void {
    for (const e of this.world.events.splice(0)) {
      if (e.kind === "sound") this.sound.play(e.name, e.size);
      else if (e.kind === "shake") this.view.orbit.addShake(e.amount, e.seconds);
      else if (e.kind === "flash" && !this.reducedMotion) {
        const v = this.runtime.visuals;
        v.flash = Math.max(v.flash, e.strength);
        v.flashColor = e.color;
      }
    }
  }

  // Returns a function that removes the listeners again.
  bindInput(): () => void {
    const c = this.canvas;
    const orbit = this.view.orbit;
    const abort = new AbortController();
    const opts = { signal: abort.signal };
    c.addEventListener(
      "pointerdown",
      (e) => {
        c.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, button: e.button, shift: e.shiftKey });
        if (this.pointers.size === 2) this.pinch = this.pinchState();
      },
      opts,
    );
    c.addEventListener(
      "pointermove",
      (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) p.moved = true;
        if (this.pointers.size === 1 && p.moved) {
          // Right button or shift pans; otherwise the view turns.
          if (p.button === 2 || p.shift) orbit.pan(dx, dy, c.clientHeight);
          else orbit.orbit(dx, dy);
        } else if (this.pointers.size === 2 && this.pinch) {
          const now = this.pinchState();
          orbit.zoom(now.d / this.pinch.d);
          orbit.pan(now.mx - this.pinch.mx, now.my - this.pinch.my, c.clientHeight);
          this.pinch = now;
          for (const q of this.pointers.values()) q.moved = true;
        }
      },
      opts,
    );
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!p || p.moved || e.type === "pointercancel" || performance.now() - p.t > 700 || p.button !== 0) return;
      const rect = c.getBoundingClientRect();
      const at = this.view.pick(e.clientX - rect.left, e.clientY - rect.top);
      if (at) this.hooks.onTap(at.x, at.y);
    };
    c.addEventListener("pointerup", end, opts);
    c.addEventListener("pointercancel", end, opts);
    c.addEventListener("contextmenu", (e) => e.preventDefault(), opts);
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        orbit.zoom(Math.exp(-e.deltaY * 0.0015));
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

  dispose(): void {
    this.stop();
    this.view.dispose();
  }
}
