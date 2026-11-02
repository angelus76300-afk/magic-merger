import { guardLoops } from "../../shared/spellcode";
import { TIER_REACH, type Tier } from "../../shared/tiers";
import { KINDS, kindOf, makeCreature, maxHp, type Creature, type CreatureKind } from "./creatures";
import { BUILTIN, C, F, G, LAYERS, type Layer } from "./materials";
import { valueNoise } from "./noise";
import { addGas, explode, forDisc, quake } from "./physics";
import type { ParticleOptions } from "./particles";
import { Visuals, type Body, type BodyLook, type DrawFn } from "./visuals";
import { TICK, type World } from "./world";

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
const SLOW_MS = 40;

export class Runtime {
  readonly visuals = new Visuals();
  private compiled = new Map<string, Compiled>();
  private casts: ActiveCast[] = [];
  private nextCast = 1;
  private nextBody = 1;
  private loops = 0;
  // Spell rules that run on their material's cells every tick, by layer and id.
  private ticks = new Map<string, { key: string; name: string; fn: (cell: CellHandle, w: SpellApi) => void }>();
  private brokenRules = new Set<string>();
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
        tick: userTick
          ? (self: Creature, dt: number) => {
              const ruleKey = `creature:${name}`;
              if (this.brokenRules.has(ruleKey)) return;
              this.run(req.key, req.name, () => userTick(new CreatureHandle(self, this), this.ruleApi(req), dt), () => this.brokenRules.add(ruleKey));
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
    this.stepBodies(dt);
    this.stepRules(dt);
    this.visuals.update(dt);
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
      if (hooks?.tick) this.run(hooks.key, hooks.name, () => hooks.tick!(hooks.handle, hooks.api, dt), () => (b.alive = false));
      if (!b.alive) continue;
      if (wasUp && b.z <= 0) {
        b.z = 0;
        if (hooks?.land) this.run(hooks.key, hooks.name, () => hooks.land!(hooks.handle, hooks.api), () => (b.alive = false));
        else b.alive = false;
      }
      if (b.life > 0 && b.age >= b.life) {
        if (hooks?.end) this.run(hooks.key, hooks.name, () => hooks.end!(hooks.handle, hooks.api));
        b.alive = false;
      }
      if (b.x < -50 || b.y < -50 || b.x > this.world.w + 50 || b.y > this.world.h + 50) b.alive = false;
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
      this.run(t.key, t.name, () => t.fn(cell, api), () => this.brokenRules.add(rule));
    }
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
    // The line inside the spell code, if the stack has one (two wrapper lines come first).
    const line = /<anonymous>:(\d+):(\d+)/.exec(err.stack ?? "");
    return line ? `${err.name}: ${err.message} (line ${Number(line[1]) - 2})` : `${err.name}: ${err.message}`;
  }
  return String(err);
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}

// Accepts "#ff8800", "#f80", 0xff8800 or "orange"-free hex only, by design.
export function toColor(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v & 0xffffff;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return parseInt(s.slice(1), 16);
  if (/^#[0-9a-f]{3}$/i.test(s)) return parseInt([...s.slice(1)].map((c) => c + c).join(""), 16);
  return null;
}

function colorOr(v: unknown, fallback: number): number {
  return toColor(v) ?? fallback;
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
    this.raw.hp -= Math.max(0, n);
    if (this.raw.hp <= 0) this.raw.dead = true;
  }
  heal(n: number) {
    this.raw.hp = Math.min(maxHp(this.raw), this.raw.hp + Math.max(0, n));
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
      if (Math.random() < density * (0.4 + 0.6 * k)) w.place(i, name, amount);
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

  // Free standing voxels, for what floats or overhangs: a tree's crown, a
  // floating rock, a statue, an arch. z is in voxels above the ground there.
  voxel(x: number, y: number, z: number, color: string | number) {
    if (!this.inside(x, y)) return;
    const w = this.rt.world;
    const ground = Math.round(w.height[this.i(x, y)] * 0.5);
    w.setVoxel(x, y, ground + Math.round(num(z, -40, 300, 0)), colorOr(color, 0xffffff));
  }
  sphere(x: number, y: number, z: number, r: number, colors: (string | number)[] | string | number, density = 1) {
    const list = (Array.isArray(colors) ? colors : [colors]).map((c) => colorOr(c, 0xffffff));
    const rr = num(r, 0.5, 40, 3);
    const w = this.rt.world;
    const base = Math.round(w.height[this.i(x, y)] * 0.5) + num(z, -40, 300, 0);
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        for (let dz = -rr; dz <= rr; dz++) {
          if (dx * dx + dy * dy + dz * dz > rr * rr || Math.random() > density) continue;
          w.setVoxel(x + dx, y + dy, base + dz, list[(Math.random() * list.length) | 0]);
        }
      }
    }
  }
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, colors: (string | number)[] | string | number) {
    const list = (Array.isArray(colors) ? colors : [colors]).map((c) => colorOr(c, 0xffffff));
    const w = this.rt.world;
    const base = Math.round(w.height[this.i(x, y)] * 0.5) + num(z, -40, 300, 0);
    for (let dy = 0; dy < num(sy, 1, 60, 1); dy++)
      for (let dx = 0; dx < num(sx, 1, 60, 1); dx++)
        for (let dz = 0; dz < num(sz, 1, 80, 1); dz++) w.setVoxel(x + dx, y + dy, base + dz, list[(Math.random() * list.length) | 0]);
  }
  unvoxel(x: number, y: number, r: number) {
    this.rt.world.clearVoxels(x, y, num(r, 0, 2000, 3));
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
      look: (["orb", "flame", "cloud", "ring", "shard", "vortex", "star", "none"] as const).includes(o.look as BodyLook) ? (o.look as BodyLook) : "orb",
      age: 0,
      life: num(o.life, 0, 120, 0),
      alive: true,
      gravity: num(o.gravity, -200, 200, 0),
      drag: num(o.drag, 0, 20, 0),
      data: {},
      owner: this.castId,
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

  // Screen and camera.
  shockwave(x: number, y: number, r: number, color: string | number = "#ffffff", seconds = 0.8, width = 1) {
    this.rt.visuals.shockwaves.push({ x, y, r: num(r, 0, 3000, 10), color: colorOr(color, 0xffffff), width: num(width, 0.1, 50, 1), t: 0, dur: num(seconds, 0.05, 20, 0.8) });
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
    const c1 = `#${colorOr(color, 0xb48cff).toString(16).padStart(6, "0")}`;
    const c2 = `#${colorOr(color2, 0xf4d58d).toString(16).padStart(6, "0")}`;
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
