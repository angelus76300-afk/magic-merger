import { guardLoops } from "../../shared/spellcode";
import { TIER_REACH, type Tier } from "../../shared/tiers";
import { KINDS, kindOf, makeCreature, maxHp, type Behavior, type Creature, type CreatureKind } from "./creatures";
import { BUILTIN, C, F, G, LAYERS, type Layer } from "./materials";
import { valueNoise } from "./noise";
import { addGas } from "./cells";
import { explode, forDisc, quake } from "./physics";
import type { ParticleOptions } from "./particles";
import { BODY_LOOKS, Visuals, type Body, type BodyLook, type DrawFn } from "./visuals";
import { TICK, World } from "./world";
import { Builder, arch, island, spire, tower, tree, treeDefaults, wall } from "./structures";
import { VK, igniteVoxels, kindId } from "./voxels";
import { voxelKey } from "./voxelkey";
import { type Landmark, type Presence } from "./social";
import { hexColor, toColor } from "./colors";

// Runs spell programs. A program is JavaScript that defines `spell`:
//
//   const spell = {
//     materials: [...],             // optional new materials, with rules of their own
//     creatures: [...],             // optional new creatures
//     *cast(w) { ... yield 0.5 ... } // the spell itself, as a generator
//   };
//
// The generator runs one step per tick; `yield seconds` waits. Everything the
// program can touch goes through the API object `w`, documented for Claude in
// worker/prompts.ts. Errors stop the spell, never the world.

export interface CastRequest {
  key: string;
  name: string;
  tier: Tier;
  code: string;
}

interface SpellObject {
  materials?: unknown[];
  creatures?: unknown[];
  cast?: (w: SpellApi) => Iterator<unknown>;
}

interface Compiled {
  spell: SpellObject;
  code: string;
}

interface ActiveCast {
  id: number;
  key: string;
  name: string;
  gen: Iterator<unknown> | null;
  wait: number;
  slowTicks: number;
  done: boolean;
}

export type ErrorReporter = (key: string, name: string, message: string) => void;

// What spells may ask of the camera, whatever kind of view draws the world.
export interface CameraControl {
  focus(x: number, y: number, r: number, seconds: number, now: number): void;
  restore(seconds: number): void;
  // Radius in cells of what is on screen right now.
  visibleRadius(): number;
}

const LOOP_LIMIT = 4_000_000;
export const WRAPPER_LINES = 3;
const MAX_JOBS = 24;
const SLOW_MS = 40;

export class Runtime {
  readonly visuals = new Visuals();
  private compiled = new Map<string, Compiled>();
  private casts: ActiveCast[] = [];
  private nextCast = 1;
  private nextBody = 1;
  private loops = 0;
  // Builds growing over time: voxels still to place, in order.
  private jobs: { order: [number, number][]; at: number; perTick: number }[] = [];
  // Spell rules that run on their material's cells every tick, by layer and id.
  private ticks = new Map<string, { key: string; name: string; fn: (cell: CellHandle, w: SpellApi) => void }>();
  private brokenRules = new Set<string>();
  // Declared reactions of spell-made materials, by layer and id.
  private reactions = new Map<string, Reaction>();
  private sinceReact = 0;
  private sinceAppeal = 0;

  // Finds the cells of materials that lure or scare, sampled so that a
  // field of gold stays cheap: creatures only need a few points to walk to.
  private collectLures(): void {
    const w = this.world;
    if (!w.lureMaterials.size) {
      w.lures = [];
      return;
    }
    const byId = new Map<string, { lures: string[]; scares: string[]; taken: boolean; color: number }>();
    for (const layer of ["ground", "cover", "fluid"] as const) {
      w.materials.list[layer].forEach((m, id) => {
        const rule = w.lureMaterials.get(m.name);
        if (rule) byId.set(`${layer}:${id}`, { ...rule, color: m.colors[0] });
      });
    }
    const found: Presence[] = [];
    for (let i = 0; i < w.n; i++) {
      const rule = byId.get(`cover:${w.cover[i]}`) ?? byId.get(`ground:${w.ground[i]}`) ?? (w.fluid[i] ? byId.get(`fluid:${w.fluid[i]}`) : undefined);
      if (rule) found.push({ x: i % w.w, y: Math.floor(i / w.w), lures: rule.lures, scares: rule.scares, taken: rule.taken, color: rule.color });
    }
    const max = 400;
    w.lures = found.length > max ? found.filter(() => Math.random() < max / found.length) : found;
  }
  // Which spell defined each custom material and creature, for saving the world.
  readonly owners = new Map<string, string>();
  camera: CameraControl | null = null;

  constructor(
    readonly world: World,
    private report: ErrorReporter,
  ) {}

  // Compiles a program, once per code version. Throws on a broken program.
  compile(req: CastRequest): Compiled {
    const cached = this.compiled.get(req.key);
    if (cached && cached.code === req.code) return cached;
    const guarded = guardLoops(req.code);
    const factory = new Function("__g", `"use strict";\n${guarded}\n;return typeof spell === "undefined" ? undefined : spell;`) as (
      g: () => void,
    ) => SpellObject | undefined;
    const spell = factory(() => this.guard());
    if (!spell || typeof spell !== "object") throw new Error("The program does not define `spell`");
    if (typeof spell.cast !== "function") throw new Error("`spell.cast` must be a generator function");
    const compiled = { spell, code: req.code };
    this.compiled.set(req.key, compiled);
    this.defineRules(req, spell);
    return compiled;
  }

  private guard(): void {
    if (++this.loops > LOOP_LIMIT) throw new Error("A loop in the spell ran too long");
  }

  // Registers the materials and creatures a spell brings, so they exist even
  // before it is cast (a reloaded world may already contain them).
  defineRules(req: CastRequest, spell: SpellObject): void {
    const w0 = this.world;
    for (const raw of Array.isArray(spell.materials) ? spell.materials : []) {
      const m = raw as Record<string, unknown>;
      if (!m || typeof m.name !== "string") continue;
      const layer = (LAYERS as readonly string[]).includes(m.layer as string) ? (m.layer as Layer) : "ground";
      const name = m.name.toLowerCase().slice(0, 30);
      if (BUILTIN[layer].some((b) => b.name === name)) continue;
      const colors = (Array.isArray(m.colors) ? m.colors : [m.color]).map(toColor).filter((c): c is number => c !== null);
      const mat = this.world.materials.makeMaterial(name, layer, colors.length ? colors.slice(0, 6) : [0xff00ff], {
        flammable: num(m.flammable, 0, 1, 0),
        fuel: num(m.fuel, 0, 60, 2),
        flow: layer === "fluid" ? num(m.flow, 0, 1, 0.5) : 0,
        hurts: num(m.hurts, 0, 500, 0),
        heat: typeof m.heat === "number" && Number.isFinite(m.heat) ? Math.max(-80, Math.min(1500, m.heat)) : null,
        glow: m.glow === true,
        solid: m.solid === true,
        fallback: typeof m.becomes === "string" ? m.becomes : layer === "ground" ? "dirt" : "none",
      });
      const id = this.world.materials.define(mat);
      this.owners.set(`${layer}:${name}`, req.key);
      const ruleKey = `${layer}:${id}`;
      const lures = strings(m.lures);
      const scares = strings(m.scares);
      if (lures.length || scares.length) w0.lureMaterials.set(name, { lures, scares, taken: m.taken === true });
      else w0.lureMaterials.delete(name);
      const reaction = reactionOf(m, layer, name);
      if (reaction) this.reactions.set(ruleKey, reaction);
      else this.reactions.delete(ruleKey);
      if (typeof m.tick === "function") this.ticks.set(ruleKey, { key: req.key, name: req.name, fn: m.tick as (cell: CellHandle, w: SpellApi) => void });
      else this.ticks.delete(ruleKey);
      this.brokenRules.delete(ruleKey);
    }
    for (const raw of Array.isArray(spell.creatures) ? spell.creatures : []) {
      const k = raw as Record<string, unknown>;
      if (!k || typeof k.name !== "string") continue;
      const name = k.name.toLowerCase().slice(0, 30);
      if (["villager", "beast", "spirit", "golem"].includes(name)) continue;
      const base = KINDS.get(typeof k.base === "string" ? k.base : "beast") ?? KINDS.get("beast")!;
      const userTick = typeof k.tick === "function" ? (k.tick as (c: CreatureHandle, w: SpellApi, dt: number) => void) : null;
      const kind: CreatureKind = {
        ...base,
        name,
        speed: num(k.speed, 0, 20, base.speed),
        hp: num(k.hp, 1, 2000, base.hp),
        radius: num(k.radius, 0.3, 6, base.radius),
        color: toColor(k.color) ?? base.color,
        flying: typeof k.flying === "boolean" ? k.flying : base.flying,
        fireproof: typeof k.fireproof === "boolean" ? k.fireproof : base.fireproof,
        swims: typeof k.swims === "boolean" ? k.swims : base.swims,
        glow: typeof k.glow === "boolean" ? k.glow : base.glow,
        homebody: false,
        fallback: base.name,
        ai: behaviorOf(k),
        tick: userTick
          ? (self: Creature, dt: number) => {
              const ruleKey = `creature:${name}`;
              if (this.brokenRules.has(ruleKey)) return;
              this.run(
                req.key,
                req.name,
                () => userTick(new CreatureHandle(self, this), this.ruleApi(req), dt),
                () => this.brokenRules.add(ruleKey),
              );
            }
          : undefined,
      };
      KINDS.set(name, kind);
      this.owners.set(`creature:${name}`, req.key);
    }
  }

  cast(req: CastRequest, x: number, y: number): boolean {
    let compiled: Compiled;
    try {
      compiled = this.compile(req);
    } catch (err) {
      this.report(req.key, req.name, message(err));
      return false;
    }
    const id = this.nextCast++;
    const api = new SpellApi(this, req, id, x, y);
    const active: ActiveCast = { id, key: req.key, name: req.name, gen: null, wait: 0, slowTicks: 0, done: false };
    this.run(req.key, req.name, () => {
      active.gen = compiled.spell.cast!.call(compiled.spell, api);
    });
    if (!active.gen || typeof active.gen.next !== "function") {
      this.report(req.key, req.name, "`spell.cast` did not return a generator");
      return false;
    }
    // Big spells get the camera pulled back to show them whole.
    const r = api.r;
    if (this.camera && r * 1.2 > this.camera.visibleRadius()) {
      this.camera.focus(x, y, r * 1.15, 0.8, this.world.time);
    }
    this.casts.push(active);
    return true;
  }

  // Runs spell code, catching everything it throws.
  run(key: string, name: string, fn: () => void, onError?: () => void): boolean {
    try {
      fn();
      return true;
    } catch (err) {
      this.report(key, name, message(err));
      onError?.();
      return false;
    }
  }

  step(dt: number): void {
    this.loops = 0;
    for (const c of this.casts) {
      if (c.done) continue;
      if (c.wait > 0) {
        c.wait -= dt;
        if (c.wait > 0) continue;
      }
      const started = performance.now();
      const ok = this.run(c.key, c.name, () => {
        const r = c.gen!.next();
        if (r.done) c.done = true;
        else c.wait = typeof r.value === "number" && Number.isFinite(r.value) ? Math.max(0, Math.min(30, r.value)) : 0;
      });
      if (!ok) this.abort(c);
      else if (performance.now() - started > SLOW_MS && ++c.slowTicks > 5) {
        this.report(c.key, c.name, "The spell took too long on every frame and was stopped");
        this.abort(c);
      }
    }
    this.casts = this.casts.filter((c) => !c.done || this.visuals.bodies.some((b) => b.owner === c.id));
    this.stepJobs();
    this.stepBodies(dt);
    this.stepRules(dt);
    this.sinceAppeal += dt;
    if (this.sinceAppeal >= 0.5) {
      this.sinceAppeal = 0;
      this.collectLures();
    }
    this.sinceReact += dt;
    if (this.sinceReact >= 0.2) {
      this.stepReactions(this.sinceReact);
      this.sinceReact = 0;
    }
    this.visuals.update(dt);
  }

  // Places the next voxels of every growing build.
  private stepJobs(): void {
    if (!this.jobs.length) return;
    for (const job of this.jobs) {
      const end = Math.min(job.order.length, job.at + job.perTick);
      for (; job.at < end; job.at++) this.placeVoxel(job.order[job.at][0], job.order[job.at][1]);
    }
    this.jobs = this.jobs.filter((j) => j.at < j.order.length);
    this.world.decorVersion++;
  }

  placeVoxel(key: number, value: number): void {
    const { decor, voxels } = this.world;
    if (!decor.has(key) && decor.size >= World.MAX_DECOR) return;
    decor.set(key, value);
    voxels.burning.delete(key);
  }

  // Places a build now, or grows it over `seconds` from its base outward.
  commit(b: Builder, seconds: number): void {
    if (seconds <= 0) {
      for (const [k, v] of b.cells) this.placeVoxel(k, v);
      this.world.decorVersion++;
      return;
    }
    const order = b.growOrder();
    if (this.jobs.length >= MAX_JOBS) this.jobs.shift();
    this.jobs.push({ order, at: 0, perTick: Math.max(1, Math.ceil(order.length / (seconds / TICK))) });
  }

  private abort(c: ActiveCast): void {
    c.done = true;
    this.visuals.removeOwner(c.id);
  }

  busy(): boolean {
    return this.casts.some((c) => !c.done);
  }

  private stepBodies(dt: number): void {
    for (const b of this.visuals.bodies) {
      if (!b.alive) continue;
      const hooks = bodyHooks.get(b);
      b.age += dt;
      const k = 1 - Math.min(1, b.drag * dt);
      b.vx *= k;
      b.vy *= k;
      b.vz = b.vz * k - b.gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const wasUp = b.z > 0;
      b.z += b.vz * dt;
      if (hooks?.tick)
        this.run(
          hooks.key,
          hooks.name,
          () => hooks.tick!(hooks.handle, hooks.api, dt),
          () => (b.alive = false),
        );
      if (!b.alive) continue;
      if (wasUp && b.z <= 0) {
        b.z = 0;
        if (hooks?.land)
          this.run(
            hooks.key,
            hooks.name,
            () => hooks.land!(hooks.handle, hooks.api),
            () => (b.alive = false),
          );
        else b.alive = false;
      }
      if (b.life > 0 && b.age >= b.life) {
        if (hooks?.end) this.run(hooks.key, hooks.name, () => hooks.end!(hooks.handle, hooks.api));
        b.alive = false;
      }
      // Off the island, a body near the ground has nothing under it: it is gone.
      // High in the sky it may still be on its way in.
      const out = b.x < -1 || b.y < -1 || b.x > this.world.w + 1 || b.y > this.world.h + 1;
      if ((out && b.z < 24) || b.x < -80 || b.y < -80 || b.x > this.world.w + 80 || b.y > this.world.h + 80) b.alive = false;
      if (b.alive && b.trail !== null && b.look !== "none") {
        this.world.particles.add({
          x: b.x + (Math.random() - 0.5) * b.r,
          y: b.y + (Math.random() - 0.5) * b.r,
          z: b.z + b.r,
          vx: -b.vx * 0.1,
          vy: -b.vy * 0.1,
          vz: -b.vz * 0.1 + 0.5,
          life: 0.5 + Math.random() * 0.5,
          color: b.trail,
          size: Math.max(0.8, Math.min(4, b.r * 0.9)),
          glow: true,
          gravity: -0.5,
          drag: 1.5,
        });
      }
    }
  }

  // Custom material rules: each cell of a material with a tick gets a call,
  // sampled when there are too many to keep frames smooth.
  private stepRules(dt: number): void {
    if (this.ticks.size === 0) return;
    const { world } = this;
    const builtin = { ground: BUILTIN.ground.length, fluid: BUILTIN.fluid.length, cover: BUILTIN.cover.length, gas: BUILTIN.gas.length };
    const found: { rule: string; i: number }[] = [];
    for (let i = 0; i < world.n; i++) {
      if (world.ground[i] >= builtin.ground) found.push({ rule: `ground:${world.ground[i]}`, i });
      if (world.fluid[i] >= builtin.fluid) found.push({ rule: `fluid:${world.fluid[i]}`, i });
      if (world.cover[i] >= builtin.cover) found.push({ rule: `cover:${world.cover[i]}`, i });
      if (world.gas[i] >= builtin.gas) found.push({ rule: `gas:${world.gas[i]}`, i });
    }
    const budget = 3000;
    const keep = found.length > budget ? budget / found.length : 1;
    for (const { rule, i } of found) {
      if (keep < 1 && Math.random() > keep) continue;
      const t = this.ticks.get(rule);
      if (!t || this.brokenRules.has(rule)) continue;
      const api = this.ruleApi({ key: t.key, name: t.name, tier: "minor", code: "" });
      const cell = new CellHandle(i % world.w, Math.floor(i / world.w), api, dt / keep);
      this.run(
        t.key,
        t.name,
        () => t.fn(cell, api),
        () => this.brokenRules.add(rule),
      );
    }
  }

  // Declared reactions: what touches a material changes it, it decays, it spreads.
  private stepReactions(dt: number): void {
    if (this.reactions.size === 0) return;
    const w = this.world;
    const arrays = { ground: w.ground, fluid: w.fluid, cover: w.cover, gas: w.gas };
    const builtin = { ground: BUILTIN.ground.length, fluid: BUILTIN.fluid.length, cover: BUILTIN.cover.length, gas: BUILTIN.gas.length };
    const near = (i: number, test: (j: number) => boolean) => {
      if (test(i)) return true;
      const x = i % w.w;
      return (x > 0 && test(i - 1)) || (x < w.w - 1 && test(i + 1)) || (i >= w.w && test(i - w.w)) || (i + w.w < w.n && test(i + w.w));
    };
    const wet = (j: number) => w.fluid[j] === F.WATER && w.depth[j] > 0.05;
    const fiery = (j: number) => w.fire[j] > 0.25;
    const lava = (j: number) => w.fluid[j] === F.LAVA && w.depth[j] > 0.05;
    const acid = (j: number) => w.fluid[j] === F.ACID && w.depth[j] > 0.05;
    let spreads = 0;
    for (const layer of LAYERS) {
      const arr = arrays[layer];
      const first = builtin[layer];
      for (let i = 0; i < w.n; i++) {
        if (arr[i] < first) continue;
        const r = this.reactions.get(`${layer}:${arr[i]}`);
        if (!r) continue;
        const into =
          (r.reacts.fire !== undefined && near(i, fiery) && r.reacts.fire) ||
          (r.reacts.water !== undefined && near(i, wet) && r.reacts.water) ||
          (r.reacts.lava !== undefined && near(i, lava) && r.reacts.lava) ||
          (r.reacts.acid !== undefined && near(i, acid) && r.reacts.acid) ||
          (r.reacts.cold !== undefined && w.temp[i] < -2 && r.reacts.cold) ||
          (r.reacts.heat !== undefined && w.temp[i] > 120 && r.reacts.heat) ||
          (r.decay > 0 && Math.random() < dt / r.decay && r.becomes) ||
          null;
        if (into && Math.random() < 0.6) {
          this.transform(i, layer, into);
          continue;
        }
        if (r.spreadRate > 0 && spreads < 600) {
          const x = i % w.w;
          for (const j of [x > 0 ? i - 1 : -1, x < w.w - 1 ? i + 1 : -1, i - w.w, i + w.w]) {
            if (j < 0 || j >= w.n || arr[j] === arr[i] || Math.random() > r.spreadRate * dt) continue;
            const target = w.materials.get(layer, arr[j]).name;
            if (r.spreadInto && !r.spreadInto.includes(target)) continue;
            if (!r.spreadInto && layer !== "ground" && arr[j] === 0) continue;
            w.place(j, r.name, layer === "fluid" ? Math.max(0.2, w.depth[i] * 0.5) : 0.6);
            spreads++;
          }
        }
      }
    }
  }

  // Turns a cell's material into something else, or into an event.
  private transform(i: number, layer: Layer, into: string): void {
    const w = this.world;
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    const clearOwn = () => {
      if (layer === "ground") w.ground[i] = G.DIRT;
      else if (layer === "fluid") w.setFluid(i, F.NONE, 0);
      else if (layer === "cover") w.setCover(i, C.NONE);
      else w.gasAmt[i] = 0;
    };
    switch (into) {
      case "none":
        clearOwn();
        return;
      case "explode":
        clearOwn();
        explode(w, x, y, 3, 0.8);
        return;
      case "fire":
        clearOwn();
        w.fire[i] = 1;
        return;
      case "steam":
      case "smoke":
        clearOwn();
        addGas(w, i, into === "steam" ? 2 : 1, 0.7);
        return;
    }
    const found = w.materials.find(into);
    if (!found) return;
    const depth = w.depth[i];
    if (found.layer !== layer) clearOwn();
    w.place(i, into, found.layer === "fluid" ? Math.max(0.3, depth) : 0.6);
  }

  private ruleApis = new Map<string, SpellApi>();
  ruleApi(req: CastRequest): SpellApi {
    let api = this.ruleApis.get(req.key);
    if (!api) {
      api = new SpellApi(this, req, 0, this.world.w / 2, this.world.h / 2);
      this.ruleApis.set(req.key, api);
    }
    return api;
  }

  newBody(owner: number): number {
    void owner;
    return this.nextBody++;
  }

  clear(): void {
    this.casts = [];
    this.jobs = [];
    this.visuals.clear();
  }
}

interface BodyHooks {
  key: string;
  name: string;
  api: SpellApi;
  handle: BodyHandle;
  tick?: (b: BodyHandle, w: SpellApi, dt: number) => void;
  land?: (b: BodyHandle, w: SpellApi) => void;
  end?: (b: BodyHandle, w: SpellApi) => void;
}
const bodyHooks = new WeakMap<Body, BodyHooks>();

function message(err: unknown): string {
  if (err instanceof Error) {
    // The line inside the spell code, if the stack has one. new Function adds
    // two lines of its own and the wrapper one more ("use strict").
    const line = /<anonymous>:(\d+):(\d+)/.exec(err.stack ?? "");
    return line ? `${err.name}: ${err.message} (line ${Number(line[1]) - WRAPPER_LINES})` : `${err.name}: ${err.message}`;
  }
  return String(err);
}

function strings(v: unknown, max = 12): string[] {
  return (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.toLowerCase().slice(0, 30))
    .slice(0, max);
}

interface Reaction {
  name: string;
  reacts: Partial<Record<"fire" | "water" | "lava" | "acid" | "cold" | "heat", string>>;
  decay: number;
  becomes: string;
  spreadRate: number;
  spreadInto: string[] | null;
}

// Reads a material's declared reactions; undefined when it declares none.
function reactionOf(m: Record<string, unknown>, layer: Layer, name: string): Reaction | undefined {
  const reacts: Reaction["reacts"] = {};
  const raw = m.reacts && typeof m.reacts === "object" ? (m.reacts as Record<string, unknown>) : {};
  for (const k of ["fire", "water", "lava", "acid", "cold", "heat"] as const)
    if (typeof raw[k] === "string") reacts[k] = (raw[k] as string).toLowerCase().slice(0, 30);
  const spread = m.spreads && typeof m.spreads === "object" ? (m.spreads as Record<string, unknown>) : null;
  const decay = num(m.decays, 0, 3600, 0);
  void layer;
  if (!Object.keys(reacts).length && !decay && !spread) return undefined;
  const into = spread ? strings(spread.into) : [];
  return {
    name,
    reacts,
    decay,
    becomes: typeof m.becomes === "string" ? m.becomes.toLowerCase() : "none",
    spreadRate: spread ? num(spread.rate, 0, 5, 0.3) : 0,
    spreadInto: into.length && !into.includes("any") ? into : null,
  };
}

const MODES = ["wander", "hunt", "guard", "follow", "flee"] as const;
const AURAS = ["heal", "fear", "calm", "sleep", "burn", "freeze", "hurt"];

// Reads a creature's declared behavior; undefined when it declares none.
function behaviorOf(k: Record<string, unknown>): Behavior | undefined {
  const keys = ["behavior", "prey", "leader", "attack", "aura", "leaves", "weak", "immune", "lifespan", "onDeath", "lures", "scares", "converts", "active"];
  if (!keys.some((key) => k[key] !== undefined)) return undefined;
  const mode = (MODES as readonly string[]).includes(k.behavior as string) ? (k.behavior as Behavior["mode"]) : "wander";
  return {
    mode,
    prey: strings(k.prey),
    leader: strings(k.leader),
    attack: num(k.attack, 0, 500, mode === "hunt" || mode === "guard" ? 20 : 0),
    sense: num(k.sense, 2, 60, 18),
    aura: AURAS.includes(k.aura as string) ? (k.aura as string) : null,
    auraRadius: num(k.auraRadius, 1, 30, 4),
    auraPower: num(k.auraPower, 0, 10, 1),
    leaves: typeof k.leaves === "string" ? k.leaves.toLowerCase().slice(0, 30) : null,
    weak: strings(k.weak),
    immune: strings(k.immune),
    lifespan: num(k.lifespan, 0, 3600, 0),
    onDeath: typeof k.onDeath === "string" ? k.onDeath.toLowerCase().slice(0, 40) : null,
    lures: strings(k.lures),
    scares: strings(k.scares),
    converts: k.converts === true,
    active: k.active === "night" || k.active === "day" ? k.active : "always",
  };
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}

function colorOr(v: unknown, fallback: number): number {
  return toColor(v) ?? fallback;
}

function colorList(v: unknown, fallback: number[]): number[] {
  const list = (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(toColor).filter((c): c is number => c !== null);
  return list.length ? list.slice(0, 12) : fallback;
}

// A creature as a spell sees it.
export class CreatureHandle {
  constructor(
    readonly raw: Creature,
    private rt: Runtime,
  ) {}
  get x() {
    return this.raw.x;
  }
  set x(v: number) {
    if (Number.isFinite(v)) this.raw.x = Math.max(0.5, Math.min(this.rt.world.w - 1.5, v));
  }
  get y() {
    return this.raw.y;
  }
  set y(v: number) {
    if (Number.isFinite(v)) this.raw.y = Math.max(0.5, Math.min(this.rt.world.h - 1.5, v));
  }
  get z() {
    return this.raw.z;
  }
  set z(v: number) {
    if (Number.isFinite(v)) this.raw.z = Math.max(0, Math.min(200, v));
  }
  get kind() {
    return this.raw.kind;
  }
  get hp() {
    return this.raw.hp;
  }
  get alive() {
    return !this.raw.dead;
  }
  get data() {
    return this.raw.data;
  }
  hurt(n: number) {
    this.raw.hp -= num(n, 0, 1e6, 0);
    if (this.raw.hp <= 0) this.raw.dead = true;
  }
  heal(n: number) {
    this.raw.hp = Math.min(maxHp(this.raw), this.raw.hp + num(n, 0, 1e6, 0));
    this.raw.burning = 0;
    this.raw.frozen = 0;
  }
  kill() {
    this.raw.dead = true;
    this.raw.hp = 0;
  }
  revive() {
    if (!this.raw.dead) return;
    this.raw.dead = false;
    this.raw.deadFor = 0;
    this.raw.vz = 0;
    this.raw.hp = maxHp(this.raw) * 0.6;
  }
  push(dx: number, dy: number, up = 0) {
    this.raw.vx += num(dx, -200, 200, 0);
    this.raw.vy += num(dy, -200, 200, 0);
    this.raw.vz += num(up, -200, 200, 0);
    if (up > 0) this.raw.z = Math.max(this.raw.z, 0.1);
  }
  // fear needs a point to run from; the others only a duration.
  status(name: string, seconds: number, fromX?: number, fromY?: number) {
    const s = num(seconds, 0, 120, 3);
    const c = this.raw;
    switch (name) {
      case "burn":
      case "burning":
        if (!kindOf(c).fireproof) c.burning = Math.max(c.burning, s);
        c.frozen = 0;
        break;
      case "freeze":
      case "frozen":
        c.frozen = Math.max(c.frozen, s);
        c.burning = 0;
        break;
      case "fear":
        c.fear = Math.max(c.fear, s);
        c.fearX = fromX ?? c.x - 1;
        c.fearY = fromY ?? c.y;
        c.sleep = 0;
        break;
      case "sleep":
        c.sleep = Math.max(c.sleep, s);
        c.fear = 0;
        break;
      case "calm":
        c.calm = Math.max(c.calm, s);
        c.fear = 0;
        break;
      case "levitate":
        c.levitate = Math.max(c.levitate, s);
        break;
      case "stun":
        c.stun = Math.max(c.stun, s);
        break;
    }
  }
  transform(kind: string) {
    if (!KINDS.has(kind)) return;
    const ratio = this.raw.hp / maxHp(this.raw);
    this.raw.kind = kind;
    this.raw.color = KINDS.get(kind)!.color;
    this.raw.hp = maxHp(this.raw) * ratio;
  }
  resize(factor: number) {
    this.raw.size = Math.max(0.3, Math.min(6, this.raw.size * num(factor, 0.1, 10, 1)));
  }
  tint(color: string | number) {
    this.raw.color = colorOr(color, this.raw.color);
  }
  teleport(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.raw.vx = 0;
    this.raw.vy = 0;
  }
}

export class BodyHandle {
  constructor(readonly raw: Body) {}
  get x() {
    return this.raw.x;
  }
  set x(v) {
    if (Number.isFinite(v)) this.raw.x = v;
  }
  get y() {
    return this.raw.y;
  }
  set y(v) {
    if (Number.isFinite(v)) this.raw.y = v;
  }
  get z() {
    return this.raw.z;
  }
  set z(v) {
    if (Number.isFinite(v)) this.raw.z = v;
  }
  get vx() {
    return this.raw.vx;
  }
  set vx(v) {
    if (Number.isFinite(v)) this.raw.vx = v;
  }
  get vy() {
    return this.raw.vy;
  }
  set vy(v) {
    if (Number.isFinite(v)) this.raw.vy = v;
  }
  get vz() {
    return this.raw.vz;
  }
  set vz(v) {
    if (Number.isFinite(v)) this.raw.vz = v;
  }
  get r() {
    return this.raw.r;
  }
  set r(v) {
    if (Number.isFinite(v)) this.raw.r = Math.max(0, Math.min(400, v));
  }
  get age() {
    return this.raw.age;
  }
  get alive() {
    return this.raw.alive;
  }
  get data() {
    return this.raw.data;
  }
  set color(v: string | number) {
    this.raw.color = colorOr(v, this.raw.color);
  }
  set look(v: BodyLook) {
    this.raw.look = v;
  }
  kill() {
    this.raw.alive = false;
  }
  // Steers toward a point at a given speed, in cells per second.
  seek(x: number, y: number, speed: number) {
    const dx = x - this.raw.x;
    const dy = y - this.raw.y;
    const d = Math.hypot(dx, dy) || 1;
    this.raw.vx = (dx / d) * speed;
    this.raw.vy = (dy / d) * speed;
  }
}

// One cell, for material rules.
export class CellHandle {
  constructor(
    readonly x: number,
    readonly y: number,
    private w: SpellApi,
    readonly dt: number,
  ) {}
  get info() {
    return this.w.cell(this.x, this.y);
  }
}

// What a spell program can do. Kept high level on purpose: a few calls do a
// lot, so programs stay short (and cheap to write).
export class SpellApi {
  readonly r: number;
  readonly tier: Tier;
  readonly width: number;
  readonly height: number;

  constructor(
    private rt: Runtime,
    private req: CastRequest,
    private castId: number,
    readonly x: number,
    readonly y: number,
  ) {
    this.tier = req.tier;
    this.width = rt.world.w;
    this.height = rt.world.h;
    this.r = Math.max(2, Math.round(TIER_REACH[req.tier] * Math.min(rt.world.w, rt.world.h)));
  }

  get time() {
    return this.rt.world.time;
  }
  get dt() {
    return TICK;
  }

  // Math helpers.
  rand(a = 0, b = 1) {
    return a + (b - a) * Math.random();
  }
  chance(p: number) {
    return Math.random() < p;
  }
  pick<T>(list: T[]): T {
    return list[(Math.random() * list.length) | 0];
  }
  dist(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x2 - x1, y2 - y1);
  }
  angle(x1: number, y1: number, x2: number, y2: number) {
    return Math.atan2(y2 - y1, x2 - x1);
  }
  lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
  }
  noise(x: number, y: number) {
    return valueNoise(x, y, 99);
  }
  inside(x: number, y: number) {
    return this.rt.world.inside(Math.round(x), Math.round(y));
  }

  private i(x: number, y: number): number {
    const w = this.rt.world;
    return Math.max(0, Math.min(w.h - 1, Math.round(y))) * w.w + Math.max(0, Math.min(w.w - 1, Math.round(x)));
  }

  // Reading the land.
  cell(x: number, y: number) {
    const w = this.rt.world;
    const i = this.i(x, y);
    return {
      height: w.height[i],
      ground: w.layerName("ground", w.ground[i]),
      fluid: w.layerName("fluid", w.fluid[i]),
      depth: w.depth[i],
      cover: w.layerName("cover", w.cover[i]),
      fire: w.fire[i],
      temp: w.temp[i],
      gas: w.layerName("gas", w.gas[i]),
    };
  }

  // Writing one cell. `set` puts any material on its own layer; for a fluid or
  // gas, amount is depth or density.
  set(x: number, y: number, material: string, amount = 1) {
    if (!this.inside(x, y)) return;
    this.rt.world.place(this.i(x, y), String(material).toLowerCase(), num(amount, 0, 50, 1));
  }
  clear(x: number, y: number, layer: Layer) {
    if (!this.inside(x, y)) return;
    const w = this.rt.world;
    const i = this.i(x, y);
    if (layer === "cover") w.setCover(i, C.NONE);
    else if (layer === "fluid") w.setFluid(i, F.NONE, 0);
    else if (layer === "gas") w.gasAmt[i] = 0;
    else if (layer === "ground") w.ground[i] = G.DIRT;
  }
  fire(x: number, y: number, intensity = 1) {
    if (!this.inside(x, y)) return;
    const w = this.rt.world;
    w.fire[this.i(x, y)] = Math.max(w.fire[this.i(x, y)], num(intensity, 0, 1, 1));
  }
  heat(x: number, y: number, degrees: number) {
    if (!this.inside(x, y)) return;
    this.rt.world.temp[this.i(x, y)] += num(degrees, -500, 3000, 0);
  }
  raise(x: number, y: number, amount: number) {
    if (!this.inside(x, y)) return;
    this.rt.world.height[this.i(x, y)] += num(amount, -50, 50, 0);
  }

  // Shapes: call fn(x, y, k) on every cell, k going from 1 at the center to 0 at the edge.
  disc(x: number, y: number, r: number, fn: (x: number, y: number, k: number) => void) {
    forDisc(this.rt.world, x, y, num(r, 0, 2000, 1), (_i, k, cx, cy) => fn(cx, cy, k));
  }
  ring(x: number, y: number, r0: number, r1: number, fn: (x: number, y: number, k: number) => void) {
    forDisc(this.rt.world, x, y, r1, (_i, _k, cx, cy) => {
      const d = Math.hypot(cx - x, cy - y);
      if (d >= r0) fn(cx, cy, 1 - (d - r0) / Math.max(0.001, r1 - r0));
    });
  }
  line(x0: number, y0: number, x1: number, y1: number, width: number, fn: (x: number, y: number, k: number) => void) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len));
    const half = Math.max(0.5, width / 2);
    const seen = new Set<number>();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      forDisc(this.rt.world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, half, (i, k, cx, cy) => {
        if (seen.has(i)) return;
        seen.add(i);
        fn(cx, cy, k);
      });
    }
  }

  // Big moves: each does a lot in one call.
  explode(x: number, y: number, r: number, power = 1) {
    explode(this.rt.world, x, y, num(r, 0.5, 300, 4), num(power, 0, 5, 1));
  }
  quake(x: number, y: number, r: number, strength = 1) {
    quake(this.rt.world, x, y, num(r, 1, 400, 8), num(strength, 0, 5, 1));
  }
  ignite(x: number, y: number, r: number, chance = 1) {
    const w = this.rt.world;
    forDisc(w, x, y, num(r, 0, 400, 3), (i) => {
      if (Math.random() < chance) w.fire[i] = Math.max(w.fire[i], 0.8);
    });
    if (w.decor.size) igniteVoxels(w, x, y, num(r, 0, 400, 3) * 0.8);
  }
  // Adds fluid in a disc, deepest at the center.
  flood(x: number, y: number, r: number, fluid = "water", depth = 1) {
    const w = this.rt.world;
    const d = num(depth, 0, 40, 1);
    forDisc(w, x, y, num(r, 0, 400, 3), (i, k) => w.place(i, String(fluid).toLowerCase(), d * (0.3 + 0.7 * k)));
  }
  drain(x: number, y: number, r: number) {
    const w = this.rt.world;
    forDisc(w, x, y, num(r, 0, 400, 3), (i) => w.setFluid(i, F.NONE, 0));
  }
  // Places a material on cells of a disc, each with a chance of density * closeness.
  paint(x: number, y: number, r: number, material: string, density = 1, amount = 1) {
    const w = this.rt.world;
    const name = String(material).toLowerCase();
    forDisc(w, x, y, num(r, 0, 400, 3), (i, k) => {
      if (Math.random() < density * (0.4 + 0.6 * k)) w.place(i, name, num(amount, 0, 50, 1));
    });
  }
  // Changes temperature in a disc: negative freezes water and puts out fire,
  // positive melts, boils and eventually sets things alight.
  temperature(x: number, y: number, r: number, delta: number) {
    const w = this.rt.world;
    const d = num(delta, -500, 3000, 0);
    forDisc(w, x, y, num(r, 0, 400, 3), (i, k) => {
      w.temp[i] += d * (0.4 + 0.6 * k);
      if (d < -20) {
        w.fire[i] = 0;
        if (w.fluid[i] === F.WATER && w.temp[i] < 0) w.fluid[i] = F.ICE;
        if (w.fluid[i] === F.LAVA && d < -150) {
          w.height[i] += w.depth[i];
          w.ground[i] = G.BASALT;
          w.setFluid(i, F.NONE, 0);
        }
      }
    });
    for (const c of this.rt.world.creatures) {
      if (c.dead || Math.hypot(c.x - x, c.y - y) > r) continue;
      if (d < -40) c.frozen = Math.max(c.frozen, Math.min(10, -d / 20));
      if (d > 150 && !kindOf(c).fireproof) c.burning = Math.max(c.burning, 2);
    }
  }
  // Raises (positive) or digs (negative) a smooth hill or crater.
  terraform(x: number, y: number, r: number, height: number) {
    const w = this.rt.world;
    const h = num(height, -60, 60, 0);
    forDisc(w, x, y, num(r, 0, 400, 3), (i, k) => {
      const s = k * k * (3 - 2 * k);
      w.height[i] += h * s;
      if (h > 4 && s > 0.6 && w.cover[i] === C.HOUSE) w.setCover(i, C.RUBBLE);
    });
  }
  // Builds a column `voxels` high at a cell, made of a ground material: trunks,
  // towers, walls, crystal spires. The whole column shows that material.
  build(x: number, y: number, voxels: number, material: string) {
    if (!this.inside(x, y)) return;
    const w = this.rt.world;
    const i = this.i(x, y);
    const found = w.materials.find(String(material).toLowerCase());
    if (!found || found.layer !== "ground") return;
    w.ground[i] = found.id;
    w.height[i] += num(voxels, -60, 60, 1) * 2;
    w.setCover(i, C.NONE);
  }

  // Free standing voxels, z in voxels above the land at that cell. `kind` gives
  // them physics: stone, wood, leaf, ice, glow fall when nothing holds them;
  // magic and float stay where they are put. Wood and leaves burn, ice melts.
  voxel(x: number, y: number, z: number, color: string | number, kind: string = "stone") {
    if (!this.inside(x, y)) return;
    const w = this.rt.world;
    const ground = Math.round(w.height[this.i(x, y)] * 0.5);
    w.setVoxel(x, y, ground + Math.round(num(z, -40, 300, 0)), colorOr(color, 0xffffff), kindId(kind));
  }
  sphere(x: number, y: number, z: number, r: number, colors: (string | number)[] | string | number, density = 1, kind: string = "stone") {
    const list = colorList(colors, [0xffffff]);
    const rr = num(r, 0.5, 40, 3);
    const w = this.rt.world;
    const k = kindId(kind);
    const base = Math.round(w.height[this.i(x, y)] * 0.5) + num(z, -40, 300, 0);
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        for (let dz = -rr; dz <= rr; dz++) {
          const d = (dx * dx + dy * dy + dz * dz) / (rr * rr);
          // Density only thins the outer shell, so the inside stays whole.
          if (d > 1 || (d > 0.6 && Math.random() > density)) continue;
          w.setVoxel(x + dx, y + dy, base + dz, list[(Math.random() * list.length) | 0], k);
        }
      }
    }
  }
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, colors: (string | number)[] | string | number, kind: string = "stone") {
    const list = colorList(colors, [0xffffff]);
    const w = this.rt.world;
    const k = kindId(kind);
    const base = Math.round(w.height[this.i(x, y)] * 0.5) + num(z, -40, 300, 0);
    for (let dy = 0; dy < num(sy, 1, 60, 1); dy++)
      for (let dx = 0; dx < num(sx, 1, 60, 1); dx++)
        for (let dz = 0; dz < num(sz, 1, 80, 1); dz++) w.setVoxel(x + dx, y + dy, base + dz, list[(Math.random() * list.length) | 0], k);
  }
  unvoxel(x: number, y: number, r: number) {
    this.rt.world.clearVoxels(x, y, num(r, 0, 2000, 3));
  }
  // Sets fire to wood and leaves within r.
  burnVoxels(x: number, y: number, r: number) {
    igniteVoxels(this.rt.world, x, y, num(r, 0, 400, 3));
  }

  // The structure kit. Each takes an options object; `grow: seconds` raises
  // the build over time from its base instead of all at once.
  tree(x: number, y: number, o: Record<string, unknown> = {}) {
    const styles = ["oak", "pine", "birch", "willow", "palm", "dead", "giant", "mushroom", "crystal"];
    const style = typeof o.style === "string" && styles.includes(o.style) ? o.style : "oak";
    const d = treeDefaults(style);
    const b = new Builder(this.rt.world);
    tree(b, x, y, num(o.z, 0, 200, 0), {
      height: num(o.height, 4, 120, style === "giant" ? 40 : 12),
      style,
      trunk: colorList(o.trunk, d.trunk),
      leaves: style === "dead" ? [] : colorList(o.leaves, d.leaves),
      accent: colorList(o.accent, []),
      accentShare: num(o.accentShare, 0, 1, 0.25),
      leafKind: o.glow === true ? VK.GLOW : style === "crystal" ? VK.GLOW : VK.LEAF,
    });
    this.rt.commit(b, num(o.grow, 0, 30, 0));
  }
  spire(x: number, y: number, o: Record<string, unknown> = {}) {
    const b = new Builder(this.rt.world);
    const h = num(o.height, 2, 150, 14);
    spire(
      b,
      x,
      y,
      h,
      num(o.radius, 0.5, 20, Math.max(1, h / 7)),
      colorList(o.colors, [0xb9a4ff, 0xd3c6ff, 0x9f88f5]),
      kindId(o.kind, VK.GLOW),
      num(o.lean, 0, 1, 0),
      num(o.angle, -10, 10, 0),
    );
    this.rt.commit(b, num(o.grow, 0, 30, 0));
  }
  tower(x: number, y: number, o: Record<string, unknown> = {}) {
    const b = new Builder(this.rt.world);
    tower(
      b,
      x,
      y,
      num(o.height, 3, 120, 16),
      num(o.radius, 1.5, 20, 3),
      colorList(o.colors, [0x9a9aa0, 0x8a8a90, 0xa8a8ae]),
      o.roof === undefined ? 0x7a3b5a : o.roof === null || o.roof === false ? null : colorOr(o.roof, 0x7a3b5a),
      o.windows === false ? null : colorOr(o.windows, 0xffd36a),
    );
    this.rt.commit(b, num(o.grow, 0, 30, 0));
  }
  wall(x0: number, y0: number, x1: number, y1: number, o: Record<string, unknown> = {}) {
    const b = new Builder(this.rt.world);
    wall(b, x0, y0, x1, y1, num(o.height, 1, 80, 4), num(o.thick, 1, 6, 1), colorList(o.colors, [0x9a9aa0, 0x8a8a90]), kindId(o.kind, VK.STONE));
    this.rt.commit(b, num(o.grow, 0, 30, 0));
  }
  arch(x0: number, y0: number, x1: number, y1: number, o: Record<string, unknown> = {}) {
    const b = new Builder(this.rt.world);
    arch(
      b,
      x0,
      y0,
      x1,
      y1,
      num(o.height, 2, 100, Math.hypot(x1 - x0, y1 - y0) / 2),
      num(o.thick, 1, 6, 1),
      colorList(o.colors, [0x9a9aa0, 0x8a8a90]),
      kindId(o.kind, VK.STONE),
    );
    this.rt.commit(b, num(o.grow, 0, 30, 0));
  }
  island(x: number, y: number, o: Record<string, unknown> = {}) {
    const b = new Builder(this.rt.world);
    island(b, x, y, num(o.z, 4, 200, 20), num(o.r, 2, 30, 6), colorList(o.top, [0x5d9c3a, 0x67a842]), colorList(o.rock, [0x8a6a44, 0x8a8a8e, 0x7e7e84]));
    this.rt.commit(b, num(o.grow, 0, 30, 0));
  }

  // Grass, then trees, bushes and flowers.
  grow(x: number, y: number, r: number, density = 1) {
    const w = this.rt.world;
    const d = num(density, 0, 1, 1);
    forDisc(w, x, y, num(r, 0, 400, 3), (i, k) => {
      if (w.depth[i] > 0.1 || w.fire[i] > 0) return;
      const g = w.ground[i];
      if (g === G.DIRT || g === G.ASH || g === G.SAND || g === G.SNOW) w.ground[i] = G.GRASS;
      if (w.cover[i] === C.NONE || w.cover[i] === C.STUMP) {
        const p = Math.random();
        if (p < d * 0.35 * (0.5 + k)) w.setCover(i, C.TREE);
        else if (p < d * 0.45) w.setCover(i, Math.random() < 0.5 ? C.BUSH : C.FLOWER);
      }
    });
  }
  wind(dx: number, dy: number) {
    this.rt.world.wind.x = num(dx, -20, 20, 0);
    this.rt.world.wind.y = num(dy, -20, 20, 0);
  }
  gas(x: number, y: number, r: number, type = "smoke", amount = 0.6) {
    const w = this.rt.world;
    const found = w.materials.find(String(type).toLowerCase());
    if (!found || found.layer !== "gas") return;
    forDisc(w, x, y, num(r, 0, 400, 3), (i, k) => addGas(w, i, found.id, num(amount, 0, 1, 0.6) * (0.4 + 0.6 * k)));
  }

  // Creatures.
  creatures(x?: number, y?: number, r?: number): CreatureHandle[] {
    const list = this.rt.world.creatures.filter((c) => !c.dead && (r === undefined || Math.hypot(c.x - (x ?? 0), c.y - (y ?? 0)) <= r));
    return list.map((c) => new CreatureHandle(c, this.rt));
  }
  corpses(x: number, y: number, r: number): CreatureHandle[] {
    return this.rt.world.creatures.filter((c) => c.dead && Math.hypot(c.x - x, c.y - y) <= r).map((c) => new CreatureHandle(c, this.rt));
  }
  spawn(kind: string, x: number, y: number): CreatureHandle | null {
    const w = this.rt.world;
    if (w.creatures.length > 600 || !this.inside(x, y)) return null;
    const c = makeCreature(KINDS.has(kind) ? kind : "beast", x, y);
    w.creatures.push(c);
    return new CreatureHandle(c, this.rt);
  }

  // Bodies: things the spell is made of, moving through the world.
  body(o: Record<string, unknown> = {}): BodyHandle {
    const b: Body = {
      id: this.rt.newBody(this.castId),
      x: num(o.x, -100, 5000, this.x),
      y: num(o.y, -100, 5000, this.y),
      z: num(o.z, 0, 2000, 0),
      vx: num(o.vx, -500, 500, 0),
      vy: num(o.vy, -500, 500, 0),
      vz: num(o.vz, -500, 500, 0),
      r: num(o.r, 0, 400, 1),
      color: colorOr(o.color, 0xffffff),
      color2: colorOr(o.color2, colorOr(o.color, 0xffffff)),
      glow: o.glow !== false,
      look: (BODY_LOOKS as readonly string[]).includes(o.look as string) ? (o.look as BodyLook) : "orb",
      age: 0,
      life: num(o.life, 0, 120, 0),
      alive: true,
      gravity: num(o.gravity, -200, 200, 0),
      drag: num(o.drag, 0, 20, 0),
      data: {},
      owner: this.castId,
      trail: o.trail === false ? null : o.trail === undefined ? (o.look === "meteor" ? 0xff8a2a : null) : colorOr(o.trail, colorOr(o.color, 0xffffff)),
    };
    const handle = new BodyHandle(b);
    bodyHooks.set(b, {
      key: this.req.key,
      name: this.req.name,
      api: this,
      handle,
      tick: typeof o.tick === "function" ? (o.tick as BodyHooks["tick"]) : undefined,
      land: typeof o.land === "function" ? (o.land as BodyHooks["land"]) : undefined,
      end: typeof o.end === "function" ? (o.end as BodyHooks["end"]) : undefined,
    });
    if (this.rt.visuals.bodies.length < 400) this.rt.visuals.bodies.push(b);
    else b.alive = false;
    return handle;
  }

  // Particles: pure decoration.
  particle(o: Partial<ParticleOptions> & { color?: string | number }) {
    this.rt.world.particles.add({
      x: num(o.x, -100, 5000, this.x),
      y: num(o.y, -100, 5000, this.y),
      z: num(o.z, 0, 500, 0),
      vx: num(o.vx, -500, 500, 0),
      vy: num(o.vy, -500, 500, 0),
      vz: num(o.vz, -500, 500, 0),
      life: num(o.life, 0.05, 20, 1),
      color: colorOr(o.color, 0xffffff),
      size: num(o.size, 0.2, 8, 1),
      glow: o.glow !== false,
      gravity: num(o.gravity, -200, 200, 0),
      drag: num(o.drag, 0, 20, 0),
    });
  }
  // A radial burst of particles.
  burst(x: number, y: number, o: Record<string, unknown> = {}) {
    const colors = (Array.isArray(o.colors) ? o.colors : [o.color ?? "#ffffff"]).map((c) => colorOr(c, 0xffffff));
    const count = num(o.count, 0, 1500, 60);
    const speed = num(o.speed, 0, 300, 10);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.rt.world.particles.add({
        x,
        y,
        z: num(o.z, 0, 500, 0.5),
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: num(o.up, -300, 300, 4) * (0.5 + Math.random()),
        life: num(o.life, 0.05, 20, 1) * (0.7 + Math.random() * 0.6),
        color: colors[k % colors.length],
        size: num(o.size, 0.2, 8, 1),
        glow: o.glow !== false,
        gravity: num(o.gravity, -200, 200, 6),
        drag: num(o.drag, 0, 20, 1),
      });
    }
  }

  // A lasting presence at a place: villagers and creatures it lures come to
  // it, those it scares keep away, and its aura acts on whoever stands near.
  // It has no look of its own: build one (a shrine, a totem, a cursed stone).
  landmark(x: number, y: number, o: Record<string, unknown> = {}) {
    const w = this.rt.world;
    if (!this.inside(x, y) || w.landmarks.length >= 60) return;
    const aura = ["heal", "fear", "calm", "sleep", "burn", "freeze", "hurt"].includes(o.aura as string) ? (o.aura as string) : null;
    const l: Landmark = {
      x: Math.round(x),
      y: Math.round(y),
      name: typeof o.name === "string" ? o.name.slice(0, 40) : this.req.name,
      lures: strings(o.lures),
      scares: strings(o.scares),
      taken: false,
      color: colorOr(o.color, 0xffd36a),
      radius: num(o.radius, 1, 40, 8),
      aura,
      power: num(o.power, 0, 10, 1),
    };
    w.landmarks.push(l);
  }

  // Lightning from the sky to a cell: strikes the highest thing there (a
  // tree top, a tower), burns, hurts, sets wood alight, and shocks every
  // creature in the water it hits. Sand it strikes turns to glass.
  lightning(x: number, y: number, o: Record<string, unknown> = {}) {
    if (!this.inside(x, y)) return;
    const w = this.rt.world;
    const i = this.i(x, y);
    const power = num(o.power, 0, 5, 1);
    const color = colorOr(o.color, 0xd8ecff);
    // The highest voxel standing on this cell, or the land.
    let target = Math.round(w.height[i] * 0.5);
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let l = target + 1; l < target + 140; l++) if (w.decor.has(voxelKey(cx, cy, l))) target = l + 1;
    if (w.depth[i] > 0.05) target = Math.max(target, (w.height[i] + w.depth[i]) * 0.5);
    const path = (x0: number, y0: number, l0: number, x1: number, y1: number, l1: number, jag: number) => {
      const pts = [{ x: x0, y: y0, l: l0 }];
      const n = 10;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        pts.push({ x: x0 + (x1 - x0) * t + (Math.random() - 0.5) * jag, y: y0 + (y1 - y0) * t + (Math.random() - 0.5) * jag, l: l0 + (l1 - l0) * t });
      }
      pts.push({ x: x1, y: y1, l: l1 });
      return pts;
    };
    const fromX = num((o.from as { x?: number } | undefined)?.x, -100, 5000, x + (Math.random() - 0.5) * 10);
    const fromY = num((o.from as { y?: number } | undefined)?.y, -100, 5000, y + (Math.random() - 0.5) * 10);
    const main = path(fromX, fromY, target + 70, x, y, target, 5);
    const vis = this.rt.visuals;
    vis.bolts.push({ points: main, color, width: num(o.width, 0.3, 4, 1) * Math.max(0.6, Math.sqrt(power)), t: 0, dur: 0.35 });
    for (let k = 0; k < 2; k++) {
      const from = main[3 + k * 3];
      vis.bolts.push({
        points: path(from.x, from.y, from.l, from.x + (Math.random() - 0.5) * 16, from.y + (Math.random() - 0.5) * 16, from.l - 15 - Math.random() * 15, 3),
        color,
        width: 0.6,
        t: 0,
        dur: 0.25,
      });
    }
    vis.lights.push({ x, y, r: 10 * Math.max(0.6, power), color, t: 0, dur: 0.5 });
    this.flash(color, 0.3);
    this.sound("zap", Math.min(1, 0.4 + power * 0.2));
    // Effects on the land.
    const g = w.ground[i];
    if (g === G.SAND && Math.random() < 0.6) w.ground[i] = G.CRYSTAL;
    if (w.depth[i] < 0.05 && (w.materials.get("cover", w.cover[i]).flammable > 0 || w.materials.get("ground", g).flammable > 0))
      w.fire[i] = Math.max(w.fire[i], 0.9);
    if (w.cover[i] === C.POWDER) explode(w, x, y, 4, 1);
    if (w.fluid[i] === F.OIL) w.fire[i] = 1;
    igniteVoxels(w, x, y, 1.5);
    w.temp[i] += 300 * power;
    // Creatures: struck ones, and everyone in the same water.
    const wet = w.fluid[i] === F.WATER && w.depth[i] > 0.05;
    for (const c of w.creatures) {
      if (c.dead) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      const ci = this.i(c.x, c.y);
      const shocked = d < 1.8 || (wet && d < 14 * Math.max(0.5, power) && w.fluid[ci] === F.WATER && w.depth[ci] > 0.05);
      if (!shocked) continue;
      c.hp -= (d < 1.8 ? 70 : 35) * power * (kindOf(c).ai?.weak.includes("lightning") ? 3 : kindOf(c).ai?.immune.includes("lightning") ? 0 : 1);
      c.stun = Math.max(c.stun, 1.5);
      if (d < 1.8 && !kindOf(c).fireproof) c.burning = Math.max(c.burning, 2);
      if (c.hp <= 0) c.dead = true;
    }
  }
  // A straight beam between two points, z in voxels above the land at each
  // end. It only shows; the spell decides what the beam does.
  beam(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: Record<string, unknown> = {}) {
    const w = this.rt.world;
    const l0 = w.height[this.i(x0, y0)] * 0.5 + num(z0, -40, 400, 0);
    const l1 = w.height[this.i(x1, y1)] * 0.5 + num(z1, -40, 400, 0);
    this.rt.visuals.bolts.push({
      points: [
        { x: x0, y: y0, l: l0 },
        { x: x1, y: y1, l: l1 },
      ],
      color: colorOr(o.color, 0xfff3b0),
      width: num(o.width, 0.2, 6, 1),
      t: 0,
      dur: num(o.seconds, 0.05, 30, 0.5),
    });
  }

  // Screen and camera.
  shockwave(x: number, y: number, r: number, color: string | number = "#ffffff", seconds = 0.8, width = 1) {
    this.rt.visuals.shockwaves.push({
      x,
      y,
      r: num(r, 0, 3000, 10),
      color: colorOr(color, 0xffffff),
      width: num(width, 0.1, 50, 1),
      t: 0,
      dur: num(seconds, 0.05, 20, 0.8),
    });
  }
  light(x: number, y: number, r: number, color: string | number = "#fff3b0", seconds = 2) {
    this.rt.visuals.lights.push({ x, y, r: num(r, 0, 3000, 8), color: colorOr(color, 0xfff3b0), t: 0, dur: num(seconds, 0.05, 60, 2) });
  }
  darken(amount: number, seconds: number) {
    this.rt.visuals.darkness.push({ color: 0, alpha: num(amount, 0, 1, 0.6), t: 0, dur: num(seconds, 0.1, 60, 3) });
  }
  tint(color: string | number, alpha: number, seconds: number) {
    this.rt.visuals.tints.push({ color: colorOr(color, 0xffffff), alpha: num(alpha, 0, 1, 0.3), t: 0, dur: num(seconds, 0.05, 60, 1) });
  }
  flash(color: string | number = "#ffffff", strength = 0.6) {
    this.rt.visuals.flash = Math.max(this.rt.visuals.flash, num(strength, 0, 1, 0.6));
    this.rt.visuals.flashColor = colorOr(color, 0xffffff);
  }
  // Free drawing on a canvas 2D context, every frame for `seconds`. In "world"
  // space one unit is one cell; in "screen" space units are CSS pixels.
  draw(fn: DrawFn, seconds: number, space: "world" | "screen" = "world") {
    if (typeof fn !== "function") return;
    const key = this.req.key;
    const name = this.req.name;
    const rt = this.rt;
    let failed = false;
    const safe: DrawFn = (ctx, t) => {
      if (failed) return;
      if (!rt.run(key, name, () => fn(ctx, t))) failed = true;
    };
    this.rt.visuals.drawings.push({ fn: safe, space: space === "screen" ? "screen" : "world", t: 0, dur: num(seconds, 0.02, 60, 1), owner: this.castId });
  }
  // A rotating magic circle on the ground.
  circle(x: number, y: number, r: number, color: string | number = "#b48cff", color2: string | number = "#f4d58d", seconds = 1.5) {
    const c1 = hexColor(colorOr(color, 0xb48cff));
    const c2 = hexColor(colorOr(color2, 0xf4d58d));
    const dur = num(seconds, 0.1, 30, 1.5);
    this.draw(
      (ctx, t) => {
        const a = Math.min(1, t * 3, (dur - t) * 3);
        ctx.globalAlpha = Math.max(0, a);
        ctx.lineWidth = Math.max(0.15, r * 0.04);
        ctx.strokeStyle = c1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = c2;
        ctx.beginPath();
        for (let k = 0; k <= 5; k++) {
          const ang = t * 1.2 + (k * 2 * Math.PI * 2) / 5;
          ctx.lineTo(x + Math.cos(ang) * r * 0.8, y + Math.sin(ang) * r * 0.8);
        }
        ctx.stroke();
        for (let k = 0; k < 12; k++) {
          const ang = -t * 0.8 + (k / 12) * Math.PI * 2;
          ctx.fillStyle = k % 2 ? c1 : c2;
          ctx.fillRect(x + Math.cos(ang) * r * 0.9 - r * 0.03, y + Math.sin(ang) * r * 0.9 - r * 0.03, r * 0.06, r * 0.06);
        }
      },
      dur,
      "world",
    );
  }
  camera(x: number, y: number, r: number, seconds = 0.8) {
    this.rt.camera?.focus(x, y, num(r, 1, 5000, 20), num(seconds, 0.1, 10, 0.8), this.rt.world.time);
  }
  cameraBack(seconds = 1) {
    this.rt.camera?.restore(num(seconds, 0.1, 10, 1));
  }
  shake(amount: number, seconds = 0.5) {
    this.rt.world.emit({ kind: "shake", amount: num(amount, 0, 40, 4), seconds: num(seconds, 0.05, 10, 0.5) });
  }
  sound(name: string, size = 0.5) {
    this.rt.world.emit({ kind: "sound", name: String(name), size: num(size, 0, 1, 0.5) });
  }
}
