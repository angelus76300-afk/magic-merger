import { tell } from "./kin";
import { populate } from "./creatures";
import { FrameStats } from "./hud";
import { Runtime, type CastRequest, type ErrorReporter } from "./runtime";
import { loadWorld, saveWorld, type SavedWorld } from "./save";
import { SpellSound } from "./sound";
import { CAST_PRIORITY_SECONDS, listenerAt } from "./soundplace";
import { stepWorld } from "./tick";
import { VoxelView } from "./voxel/view";
import { GRAPHICS } from "./voxel/graphics";
import { FramePacer, ticksDue } from "./voxel/pacing";
import { TICK, generateWorld, type World } from "./world";
import { DEFAULT_LAND, type LandOptions } from "./land";
import { readWonder, type Wonder, type WonderDef } from "./wonders";
import { ownCreatures, raiseWonders, reloadWonders } from "./wonderbuild";

import { WORLD_SIZES, type WorldSize } from "./sizes";

export { WORLD_SIZES, type WorldSize } from "./sizes";

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
  // Frame times for the HUD; always collected, it costs a few array writes.
  stats = new FrameStats();
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

  static create(
    canvas: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    size: WorldSize,
    hooks: EngineHooks,
    seed = (Math.random() * 2 ** 31) | 0,
    options: EngineOptions = {},
    // The player's island (4.4); without, the island before 4.4 (the Spell Lab's).
    land?: LandOptions,
    // The wonder sets of the player's last islands, not made again (4.4.5 part B).
    recent: readonly string[] = [],
    // The pool of wonders written as programs (4.4.5 part C).
    defs: readonly WonderDef[] = [],
  ): Engine {
    const n = WORLD_SIZES[size] ?? WORLD_SIZES.medium;
    const world = generateWorld(n, n, seed, land, recent, defs);
    populate(world);
    const runtime = new Runtime(world, hooks.onError);
    raiseWonders(world, runtime);
    const engine = new Engine(canvas, overlay, world, hooks, runtime, options);
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
      // 4.4.5 part C: the island's program wonders carry their code.
      reloadWonders(
        (Array.isArray(data.wonders) ? data.wonders : []).map(readWonder).filter((x): x is Wonder => x !== null),
        runtime,
      );
    });
    if (!world || !runtime) return null;
    ownCreatures(world, runtime);
    // An island saved before 4.4 is a temperate island with the old climate:
    // it gets the sky and weather of one, nothing else changes.
    world.land ??= { ...DEFAULT_LAND };
    return new Engine(canvas, overlay, world, hooks, runtime);
  }

  save(): SavedWorld {
    return saveWorld(this.world, this.runtime.owners);
  }

  cast(req: CastRequest, x: number, y: number): boolean {
    const ok = this.runtime.cast(req, x, y);
    // A spell's sounds come from its center (4.8). w.sound carries no place
    // yet, so they belong to the player's last cast, for as long as it lasts.
    if (ok) this.lastCast = { x, y, at: performance.now() };
    // What the cast changed before the next tick is drawn too (view.ts, scan).
    this.view.landChanged = true;
    // The player's magic is part of the island's story (3.7).
    if (ok) tell(this.world, `a mage ${req.kind === "artifact" ? "placed" : "cast"} ${req.name}`);
    return ok;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.view.resize(rect.width, rect.height);
    this.cameraMoved = true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    // The time the World was hidden is not a frame: the HUD would count it as one.
    this.lastDraw = this.last;
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
  // Its events stay for render() to play (tick.ts).
  step(): void {
    stepWorld(this.world, this.runtime);
    this.onTick?.();
  }

  // Draws the current state. Public for the Spell Lab.
  render(dt = TICK): void {
    this.handleEvents();
    this.view.render(this.runtime.visuals, this.world.time, dt, this.reducedMotion);
  }

  // Without GRAPHICS.smooth, a frame is drawn only when there is something
  // new to show: the simulation advanced (30 times a second) or the camera
  // moved, and touch screens draw 30 a second at most. With it (2026-11-07),
  // every device draws up to 60 a second while it keeps up (pacing.ts), and
  // the frames between two ticks show creatures part way between them.
  private frame(now: number): void {
    this.rafId = 0;
    if (!this.running) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    // A frame's time stamp can be older than start(): the frame began before
    // the call that restarted the loop. Time never runs backwards (4.4: a
    // negative step held the simulation still until it was paid back).
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = Math.max(this.last, now);
    this.acc += dt;
    const steps = ticksDue(this.acc, TICK, this.pacer.enabled);
    const t0 = performance.now();
    for (let k = 0; k < steps; k++) {
      this.step();
      this.acc -= TICK;
    }
    if (this.acc > TICK * 3) this.acc = 0;
    const t1 = performance.now();
    this.simMs += t1 - t0;
    const since = now - this.lastDraw;
    const smooth = this.pacer.target === 60;
    // At 60 there is always something new: the creatures' motion between ticks.
    const changed = smooth || steps > 0 || this.cameraMoved || this.view.orbit.animating();
    const minDraw = this.coarse || smooth ? this.pacer.minDrawMs : 0;
    if (!changed || since < minDraw) {
      this.stats.idle++;
      return;
    }
    this.cameraMoved = false;
    this.lastDraw = now;
    // How far the frame is from the last tick to the next one, for the view.
    this.view.between = this.pacer.enabled ? Math.min(1, this.acc / TICK) : 1;
    this.view.paceMs = smooth ? 1000 / 60 : 1000 / 30;
    this.render(Math.min(0.1, since / 1000));
    // A draw from outside the loop (the Spell Lab, a test's frame) shows the
    // creatures where the simulation has them.
    this.view.between = 1;
    this.pacer.push(since, now);
    const t2 = performance.now();
    this.stats.push({ frame: since, sim: this.simMs, render: t2 - t1 });
    this.simMs = 0;
    this.stats.counts = {
      ...this.view.counts(),
      ...this.sound.counts(),
      voxels: this.world.decor.size,
      creatures: this.world.creatures.length,
      size: this.world.w,
    };
  }

  private lastDraw = 0;
  private simMs = 0;
  private cameraMoved = true;
  // Touch screens were capped at 30 a second; without GRAPHICS.smooth they still are.
  private coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  readonly pacer = new FramePacer(GRAPHICS.smooth, performance.now());

  private lastCast: { x: number; y: number; at: number } | null = null;

  private handleEvents(): void {
    const o = this.view.orbit;
    this.sound.listener = listenerAt(o.tx, o.ty, o.visibleRadius(), o.theta);
    const now = performance.now();
    // Back from a hidden tab: what piled up is not played all at once.
    const stale = this.sound.wasHidden();
    const cast = this.lastCast;
    const fresh = cast !== null && now - cast.at < CAST_PRIORITY_SECONDS * 1000;
    for (const e of this.world.events.splice(0)) {
      if (e.kind === "sound") {
        if (stale) continue;
        if (e.x !== undefined && e.y !== undefined) this.sound.play(e.name, e.size, { x: e.x, y: e.y, routine: e.routine });
        else if (cast) this.sound.play(e.name, e.size, { x: cast.x, y: cast.y, priority: fresh });
        else this.sound.play(e.name, e.size);
      } else if (e.kind === "shake") this.view.orbit.addShake(e.amount, e.seconds);
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
        this.pointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          sx: e.clientX,
          sy: e.clientY,
          t: performance.now(),
          moved: false,
          button: e.button,
          shift: e.shiftKey,
        });
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
          this.cameraMoved = true;
        } else if (this.pointers.size === 2 && this.pinch) {
          const now = this.pinchState();
          orbit.zoom(now.d / this.pinch.d);
          orbit.pan(now.mx - this.pinch.mx, now.my - this.pinch.my, c.clientHeight);
          this.cameraMoved = true;
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
        this.cameraMoved = true;
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
