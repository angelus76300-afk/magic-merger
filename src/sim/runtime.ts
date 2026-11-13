import { guardLoops } from "../../shared/spellcode";
import { tierSize } from "./soundplace";
import { parseIntents } from "../../shared/promises";
import { REFERENCE_SIDE, TIERS, TIER_REACH, type Tier } from "../../shared/tiers";
import { bigBeing, isForm } from "../../shared/forms";
import { artDeed, artifactState, isArtifact, type Artifact } from "./artifacts";
import { BUILTIN_KINDS, KINDS, hostile, kindOf, makeCreature, maxHp, shieldedCreature, type Behavior, type Creature, type CreatureKind } from "./creatures";
import { bodyFrom, stillModelColor } from "./body";
import { NATIVE_NAMES } from "./wildlife";
import { goalFrom, goalFromBehavior, goalFromName } from "./goals";
import { abilitiesFrom, abilitiesFromName } from "./abilities";
import { CUSTOM_GOALS, LOADS, TRIGGERS, mindOf, remember, tell, type AbilitySpec, type Load, type Trigger } from "./kin";
import { BUILTIN, BUILTIN_BEFORE_4_4_5, C, F, G, LAYERS, isBuilding, type Layer } from "./materials";
import { valueNoise } from "./noise";
import { addGas } from "./cells";
import { explode, forDisc, quake } from "./physics";
import type { ParticleOptions } from "./particles";
import { BODY_LOOKS, Visuals, type Body, type BodyLook, type DrawFn } from "./visuals";
import { TICK, World } from "./world";
import { Builder, arch, island, spire, tower, tree, treeDefaults, wall } from "./structures";
import { VK, igniteVoxels, kindId } from "./voxels";
import { keyLevel, keyX, keyY, voxelKey } from "./voxelkey";
import { baseName, type Landmark, type Presence } from "./social";
import { hexColor, toColor } from "./colors";
import {
  DOME_SQUASH,
  TIER_POWER,
  WARD,
  WARD_ALL,
  addRuin,
  hpAgainst,
  addWard,
  passShare,
  rebuildMask,
  ruinPass,
  ruinSpares,
  damageWard,
  inDome,
  ownWard,
  stopsBodies,
  wardBits,
  wardHit,
  warded,
  type Ward,
} from "./wards";
import { makeBuilding, makePerson, makeVillage, makeWonder, shapeLand } from "./makers";
import { FINE_BOX, MAX_PROP_BOXES, addProp, propBounds, readProp, shadeParts } from "./props";
import { findNearest, natureOf, readFights, readHere, readHurt } from "./reading";

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
  // What it promises (shared/promises.ts), for its test run. The runtime ignores it.
  intents?: string[];
  // An artifact faces the five minute test in its test run (3.7).
  kind?: "spell" | "artifact";
  // A wonder written as a program (4.4.5 part C) works within its own reach, whatever the island's size.
  reach?: number;
  // 4.6: which of the seven kinds it is (shared/forms.ts), and whether it
  // says it is giant, for the size its test run holds it to. 4.7: the form
  // also sets the reach (`castReach`); the runtime ignores giant.
  form?: string;
  giant?: boolean;
}

// The statuses a creature can be given (aliases included): any other name does nothing.
const STATUSES = ["burn", "burning", "freeze", "frozen", "fear", "sleep", "calm", "levitate", "stun"];

interface SpellObject {
  materials?: unknown[];
  creatures?: unknown[];
  artifacts?: unknown[];
  goals?: unknown[];
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
  // Cast by a creature or an artifact from the shared library (3.7).
  library?: boolean;
}

export type ErrorReporter = (key: string, name: string, message: string) => void;

// Library spells cast by creatures and artifacts, island wide (3.7).
const LIBRARY_EVERY = 4;
const LIBRARY_AT_ONCE = 2;

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

// The tallest tree a creature may plant without it counting in its size (an oak is 12).
export const PLANTED_TREE_HEIGHT = 20;

export class Runtime {
  // A cast whose ticks take longer than this five times is stopped. Tests
  // set it (4.1, review M8): on a loaded CI runner a correct spell can pass
  // 40 ms, and a verdict must not depend on the machine.
  static slowMs = 40;
  readonly visuals = new Visuals();
  // The ward a body was stopped on, while its land hook runs (4.7): what the
  // impact does inside that ward is taken by the glass. `harm` counts what
  // it tried to do there (a body that only heals does not wear the ward);
  // `replay` holds the blows it held back, dealt if the impact breaks it.
  glass: { ward: Ward; harm: number; replay: (() => void)[] } | null = null;
  private compiled = new Map<string, Compiled>();
  private casts: ActiveCast[] = [];
  // Told of each step of a program, before and after: a high water sees what each cast itself changes (highwater.ts).
  stepWatch: { before(id: number): void; after(id: number): void } | null = null;
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
    // Rules by material id, one table per layer: the scan of every cell reads
    // three bytes and three array slots instead of building strings (3.6).
    type Rule = { lures: string[]; scares: string[]; taken: boolean; color: number };
    const table = (layer: "ground" | "cover" | "fluid") =>
      w.materials.list[layer].map((m) => {
        const rule = w.lureMaterials.get(m.name);
        return rule ? ({ ...rule, color: m.colors[0] } as Rule) : null;
      });
    const ground = table("ground");
    const cover = table("cover");
    const fluid = table("fluid");
    const found: Presence[] = [];
    for (let i = 0; i < w.n; i++) {
      const rule = cover[w.cover[i]] ?? ground[w.ground[i]] ?? (w.fluid[i] ? fluid[w.fluid[i]] : null);
      if (rule) found.push({ x: i % w.w, y: Math.floor(i / w.w), lures: rule.lures, scares: rule.scares, taken: rule.taken, color: rule.color });
    }
    const max = 400;
    w.lures = found.length > max ? found.filter(() => Math.random() < max / found.length) : found;
  }
  // Which spell defined each custom material and creature, for saving the world.
  readonly owners = new Map<string, string>();
  // 4.6: the cells of the buildings each program raised (w.building), for
  // its test run: what it stacks on them hides what the builder draws. Not saved.
  readonly raised = new Map<string, number[]>();
  // 4.6: how many times each program called w.model (props.ts). Not saved.
  readonly modelCalls = new Map<string, number>();
  // 4.6 part B: the people each item made with w.person, for its test run.
  readonly people = new Map<string, Creature[]>();
  // 4.6: how many wards each program raised (w.ward), and the cells of each
  // tree it planted (w.tree), for its test run. Not saved.
  readonly wardCalls = new Map<string, number>();
  // What the engine could not use of what each program wrote, in words for
  // its writer: an effect it does not know, a model's boxes too thin to draw,
  // a status or a kind with no such name. The engine used to ignore these
  // without a word, so the test run passed an item whose main effect never
  // ran (the review of 10 November: 48 live programs). Not saved.
  readonly dropped = new Map<string, string[]>();
  drop(key: string, note: string): void {
    const list = this.dropped.get(key) ?? [];
    if (list.length < 8 && !list.includes(note)) list.push(note);
    this.dropped.set(key, list);
  }
  // The artifacts a program declared (spell.artifacts) and never placed with
  // w.artifact: declaring one places nothing, so none of its effects ever runs.
  readonly placedArt = new Set<string>();
  unplaced(key: string): string[] {
    const out: string[] = [];
    for (const k of this.artDefs.keys()) {
      const at = k.indexOf("|");
      if (k.slice(0, at) === key && !this.placedArt.has(k)) out.push(k.slice(at + 1));
    }
    return out;
  }
  readonly planted = new Map<string, number[][]>();
  // A spell's creature named like one of the island's animals ("wolf") is
  // kept as its own kind ("wolf#<spell>"), so summoning wolves that hunt
  // villagers does not turn the island's wolves against them. Per spell:
  // the name it wrote, then the kind it means.
  private aliases = new Map<string, Map<string, string>>();

  // The kind a spell means by a name: its own creature first.
  kindFor(spellKey: string, name: string): string {
    const n = String(name).toLowerCase();
    return this.aliases.get(spellKey)?.get(n) ?? n;
  }
  camera: CameraControl | null = null;

  constructor(
    readonly world: World,
    private report: ErrorReporter,
  ) {
    world.magic = {
      run: (a, fn, target) => this.runArtifact(a, fn, target),
      cast: (name, x, y, cap, by, enemy) => this.castLibrary(name, x, y, cap, by, enemy),
    };
  }

  // Spells from the shared library, by name (3.7): what creatures and
  // artifacts cast. The page sends the ones its world names; the spells this
  // world has compiled are in it too.
  private library = new Map<string, CastRequest>();
  private lastLibrary = -1e9;
  // The last library spells cast, for tests and the story.
  readonly libraryLog: { name: string; tier: Tier; by: string; t: number }[] = [];
  // Names asked for and not known: the page fetches them (frame.ts).
  readonly wanted = new Set<string>();
  setLibrary(list: CastRequest[]): void {
    for (const r of list) if (r && typeof r.name === "string" && typeof r.code === "string") this.library.set(r.name.toLowerCase(), r);
  }
  knows(name: string): boolean {
    return this.library.has(name.toLowerCase());
  }

  // A library spell cast by a creature or an artifact: at most at its cap
  // (minor for creatures, major for artifacts, never above the spell's own
  // tier), one every four seconds and two at once on the whole island, never
  // pulling the camera; a spell that harms only at an enemy.
  castLibrary(name: string, x: number, y: number, cap: Tier, by: string, enemy = false): boolean {
    const req = this.library.get(String(name).toLowerCase());
    if (!req) {
      if (this.wanted.size < 20) this.wanted.add(String(name).slice(0, 60));
      return false;
    }
    // A spell that harms is aimed at an enemy, never at the caster's feet.
    if (!enemy && parseIntents(req.intents).includes("harm")) return false;
    if (this.world.time - this.lastLibrary < LIBRARY_EVERY) return false;
    if (this.casts.filter((c) => c.library && !c.done).length >= LIBRARY_AT_ONCE) return false;
    const tier = TIERS.indexOf(req.tier) <= TIERS.indexOf(cap) ? req.tier : cap;
    if (!this.cast({ ...req, tier }, x, y, true)) return false;
    this.lastLibrary = this.world.time;
    this.libraryLog.push({ name: req.name, tier, by: by.split("#")[0], t: this.world.time });
    if (this.libraryLog.length > 20) this.libraryLog.shift();
    tell(this.world, `the ${by.split("#")[0]} cast ${req.name}`, { x, y });
    return true;
  }

  // An artifact's own code, through the World API like a creature's tick.
  readonly artFns = new Map<string, (self: ArtifactHandle, w: SpellApi, target: CreatureHandle | null) => unknown>();
  // What spell.artifacts declares, by "key|name", so w.artifact(x, y, "Well") finds it.
  readonly artDefs = new Map<string, Record<string, unknown>>();
  private reqs = new Map<string, CastRequest>();
  // The functions of an artifact's effects and pairs, by the index its state gives them.
  keepArtifactCode(key: string, name: string, o: Record<string, unknown>): void {
    for (const [field, prefix] of [
      ["effects", "effect"],
      ["pairs", "pair"],
    ] as const)
      (Array.isArray(o[field]) ? (o[field] as unknown[]) : []).forEach((raw, n) => {
        const act = raw && typeof raw === "object" ? (raw as Record<string, unknown>).act : null;
        if (typeof act === "function")
          this.artFns.set(`${key}|${name}|${prefix}:${n}`, act as (self: ArtifactHandle, w: SpellApi, t: CreatureHandle | null) => unknown);
      });
  }

  private runArtifact(a: Artifact, fn: string, target: Creature | null): boolean {
    const f = this.artFns.get(`${a.art.key}|${a.name.toLowerCase()}|${fn}`);
    const req = this.reqs.get(a.art.key);
    if (!f || !req) return false;
    const ruleKey = `artifact:${a.art.key}|${a.name}|${fn}`;
    if (this.brokenRules.has(ruleKey)) return false;
    let done = false;
    this.run(
      req.key,
      req.name,
      () => {
        done = f(new ArtifactHandle(a, this.world), this.ruleApi(req), target ? new CreatureHandle(target, this, req.key) : null) !== false;
      },
      () => this.brokenRules.add(ruleKey),
    );
    return done;
  }

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
      // A built-in material is the island's own; one 4.4.5 added (reeds,
      // crystals, a well...) may share a name with a spell's older material,
      // and then the spell's keeps its rules in that world.
      if (BUILTIN[layer].some((b, k) => b.name === name && k < BUILTIN_BEFORE_4_4_5[layer])) continue;
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
    // Goals of its own (3.6), before its creatures, which may name them.
    for (const raw of Array.isArray(spell.goals) ? spell.goals : []) {
      const g = raw as Record<string, unknown>;
      if (!g || typeof g.name !== "string") continue;
      const name = g.name.trim().toLowerCase().slice(0, 40);
      if (!name || goalFrom(name)) continue;
      const act =
        typeof g.act === "function" ? (g.act as (self: CreatureHandle, w: SpellApi, x: number, y: number, target: CreatureHandle | null) => unknown) : null;
      const ruleKey = `goal:${name}`;
      CUSTOM_GOALS.set(name, {
        name,
        seek: typeof g.seek === "string" && g.seek.trim() ? g.seek.trim().toLowerCase().slice(0, 30) : "anywhere",
        near: num(g.near, 3, 40, 14),
        work: num(g.work, 0.5, 30, 3),
        carry: (LOADS as readonly string[]).includes(g.carry as string) ? (g.carry as Load) : null,
        like: goalFrom(g.like),
        run: act
          ? (self, x, y, target) => {
              if (this.brokenRules.has(ruleKey)) return false;
              return this.run(
                req.key,
                req.name,
                () => void act(new CreatureHandle(self, this, req.key), this.ruleApi(req), x, y, target ? new CreatureHandle(target, this, req.key) : null),
                () => this.brokenRules.add(ruleKey),
              );
            }
          : null,
      });
      this.brokenRules.delete(ruleKey);
      this.owners.set(ruleKey, req.key);
    }
    // Artifacts it declares (3.7): placed by name, their code kept across a reload.
    this.reqs.set(req.key, req);
    for (const raw of Array.isArray(spell.artifacts) ? spell.artifacts : []) {
      const a = raw as Record<string, unknown>;
      if (!a || typeof a.name !== "string") continue;
      const name = a.name.toLowerCase().slice(0, 40);
      this.artDefs.set(`${req.key}|${name}`, a);
      this.keepArtifactCode(req.key, name, a);
    }
    const creatures = (Array.isArray(spell.creatures) ? spell.creatures : []).filter(
      (raw): raw is Record<string, unknown> => !!raw && typeof (raw as Record<string, unknown>).name === "string",
    );
    // Names first, so a creature can name another of the same spell (onDeath: "spawn:wolf").
    const alias = new Map<string, string>();
    for (const k of creatures) {
      const name = (k.name as string).toLowerCase().slice(0, 30);
      if (NATIVE_NAMES.has(name)) alias.set(name, `${name}#${shortHash(req.key)}`);
    }
    this.aliases.set(req.key, alias);
    for (const k of creatures) {
      const written = (k.name as string).toLowerCase().slice(0, 30);
      if (BUILTIN_KINDS.has(written) && !NATIVE_NAMES.has(written)) continue;
      const name = alias.get(written) ?? written;
      const baseKey = typeof k.base === "string" ? k.base.toLowerCase() : "beast";
      // "wolf" as a base is the island's wolf, even in a spell that has its own.
      const base = KINDS.get(baseKey) ?? KINDS.get("beast")!;
      const userTick = typeof k.tick === "function" ? (k.tick as (c: CreatureHandle, w: SpellApi, dt: number) => void) : null;
      const kind: CreatureKind = {
        ...base,
        name,
        speed: num(k.speed, 0, 20, base.speed),
        hp: num(k.hp, 1, 2000, base.hp),
        radius: num(k.radius, 0.3, 6, base.radius),
        color: toColor(k.color) ?? stillModelColor(k) ?? base.color,
        flying: typeof k.flying === "boolean" ? k.flying : base.flying,
        fireproof: typeof k.fireproof === "boolean" ? k.fireproof : base.fireproof,
        swims: typeof k.swims === "boolean" ? k.swims : base.swims,
        glow: typeof k.glow === "boolean" ? k.glow : base.glow,
        homebody: false,
        native: false,
        body: bodyFrom(k, written, base.body),
        fallback: base.name,
        ai: behaviorOf(k, alias),
        goal: undefined,
        abilities: undefined,
        needs: false,
        tick: userTick
          ? (self: Creature, dt: number) => {
              const ruleKey = `creature:${name}`;
              if (this.brokenRules.has(ruleKey)) return;
              this.run(
                req.key,
                req.name,
                () => userTick(new CreatureHandle(self, this, req.key), this.ruleApi(req), dt),
                () => this.brokenRules.add(ruleKey),
              );
            }
          : undefined,
      };
      // A goal and abilities (3.6): declared, or read from what it already
      // declares, its name and its base, so older spells need no rewrite.
      // Only kinds that declare a goal get needs (hunger, rest).
      const own = typeof k.goal === "string" ? k.goal.trim().toLowerCase() : "";
      const declared = goalFrom(k.goal) ?? (CUSTOM_GOALS.has(own) ? own : null);
      kind.goal = declared ?? goalFromBehavior(kind.ai) ?? goalFromName(written) ?? base.goal ?? "explore";
      const mine = this.ownAbilities(k.abilities, req);
      kind.abilities = mine.length ? [...(abilitiesFrom(k.abilities) ?? []), ...mine].slice(0, 3) : (abilitiesFrom(k.abilities) ?? abilitiesFromName(written));
      kind.needs = declared !== null;
      KINDS.set(name, kind);
      this.owners.set(`creature:${name}`, req.key);
    }
  }

  // Abilities a spell writes itself (3.6): {name, when, every, act(self, w, target)}.
  private ownAbilities(list: unknown, req: CastRequest): AbilitySpec[] {
    if (!Array.isArray(list)) return [];
    const out: AbilitySpec[] = [];
    for (const raw of list) {
      const a = raw as Record<string, unknown>;
      if (!a || typeof a.act !== "function") continue;
      const name = String(a.name ?? a.do ?? "its magic")
        .trim()
        .toLowerCase()
        .slice(0, 40);
      const act = a.act as (self: CreatureHandle, w: SpellApi, target: CreatureHandle | null) => unknown;
      const when = (TRIGGERS as readonly string[]).includes(a.when as string) ? (a.when as Trigger) : "every so often";
      const ruleKey = `ability:${req.key}:${name}`;
      out.push({
        do: name,
        when,
        every: num(a.every, 3, 120, 12),
        run: (self, target) => {
          if (this.brokenRules.has(ruleKey)) return false;
          let did = false;
          this.run(
            req.key,
            req.name,
            () => {
              did = act(new CreatureHandle(self, this, req.key), this.ruleApi(req), target ? new CreatureHandle(target, this, req.key) : null) !== false;
            },
            () => this.brokenRules.add(ruleKey),
          );
          return did;
        },
      });
    }
    return out;
  }

  cast(req: CastRequest, x: number, y: number, library = false): boolean {
    let compiled: Compiled;
    try {
      compiled = this.compile(req);
    } catch (err) {
      this.report(req.key, req.name, message(err));
      return false;
    }
    const id = this.nextCast++;
    const api = new SpellApi(this, req, id, x, y);
    const active: ActiveCast = { id, key: req.key, name: req.name, gen: null, wait: 0, slowTicks: 0, done: false, library };
    this.run(req.key, req.name, () => {
      active.gen = compiled.spell.cast!.call(compiled.spell, api);
    });
    if (!active.gen || typeof active.gen.next !== "function") {
      this.report(req.key, req.name, "`spell.cast` did not return a generator");
      return false;
    }
    // Big spells get the camera pulled back to show them whole.
    const r = api.r;
    if (!library && this.camera && r * 1.2 > this.camera.visibleRadius()) {
      this.camera.focus(x, y, r * 1.15, 0.8, this.world.time);
    }
    this.casts.push(active);
    return true;
  }

  /** The id of the cast begun last (playercast.ts: a high water watches what its program changes). */
  get lastCast(): number {
    return this.nextCast - 1;
  }

  // Runs spell code, catching everything it throws.
  run(key: string, name: string, fn: () => void, onError?: () => void): boolean {
    // While a spell's code runs, a voxel it puts on a house, a field or a
    // tree inside another spell's ward against harm is not placed: a voxel
    // clears the cover under it (World.voxelFits), and Meteor Strike's
    // stone ball cleared the houses a ward had kept.
    const outer = this.world.voxelGuard;
    this.world.voxelGuard = (i) =>
      (this.world.wards.length > 0 && warded(this.world, i, WARD.harm) && !ownWard(this.world, i, key)) ||
      (this.world.ruins.length > 0 && Math.random() >= ruinPass(this.world, key, i % this.world.w, Math.floor(i / this.world.w)));
    try {
      fn();
      return true;
    } catch (err) {
      this.report(key, name, message(err));
      onError?.();
      return false;
    } finally {
      this.world.voxelGuard = outer;
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
      this.stepWatch?.before(c.id);
      const ok = this.run(c.key, c.name, () => {
        const r = c.gen!.next();
        if (r.done) c.done = true;
        else c.wait = typeof r.value === "number" && Number.isFinite(r.value) ? Math.max(0, Math.min(30, r.value)) : 0;
      });
      this.stepWatch?.after(c.id);
      if (!ok) this.abort(c);
      else if (performance.now() - started > Runtime.slowMs && ++c.slowTicks > 5) {
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
    if (!this.world.voxelFits(keyX(key), keyY(key), keyLevel(key))) return;
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

  // A cast still running or voxels still to place (4.4.5 part C: a wonder
  // is built whole before anyone sees the island).
  pending(): boolean {
    return this.busy() || this.jobs.length > 0;
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
      const [px, py, pz] = [b.x, b.y, b.z];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const wasUp = b.z > 0;
      b.z += b.vz * dt;
      // 4.7: a ward stops what another spell throws at its edge (Ideas #2:
      // a meteor passed through a shield). The body lands on the dome, or
      // breaks it and goes on.
      if (this.world.wards.length && this.hitsWard(b, hooks, px, py, pz)) continue;
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

  // A body entering a ward's dome from outside: it stops where it was, on
  // the glass. A body with a land hook lands there: the hook runs with every
  // rule of the land holding inside the ward and no blow reaching anyone
  // under it; if it tried to harm what is inside, the ward takes the blow,
  // and a blow that breaks it goes through (the blows held back are dealt).
  // A body that only heals passes its help and leaves the ward whole. A
  // body with no land hook is a thrown thing: its blow is taken, or it
  // breaks the ward and flies on. True when the body was stopped.
  private hitsWard(b: Body, hooks: BodyHooks | undefined, px: number, py: number, pz: number): boolean {
    const owner = hooks?.key ?? "";
    let hit: Ward | undefined;
    for (const ward of this.world.wards) if (stopsBodies(ward, owner) && inDome(ward, b.x, b.y, b.z) && !inDome(ward, px, py, pz)) hit = ward;
    if (!hit) return false;
    hit.hitAt = { x: px, y: py, z: Math.max(0, pz) };
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const blow = (8 + 8 * Math.min(8, b.r)) * Math.min(2, 0.5 + speed / 40);
    const source = hooks?.source ?? "land";
    const power = hooks?.power ?? 1;
    if (!hooks?.land) {
      const hpBefore = hpAgainst(hit, source);
      if (damageWard(this.world, hit, blow, source, power)) {
        // Broken: it flies on with what passed, or bursts with the glass.
        const pass = passShare(hit, power, hpBefore);
        addRuin(this.world, hit, hooks?.key ?? "", pass, power);
        if (pass > 0) {
          b.vx *= Math.sqrt(pass);
          b.vy *= Math.sqrt(pass);
          b.vz *= Math.sqrt(pass);
          return false;
        }
      }
    }
    [b.x, b.y, b.z] = [px, py, Math.max(0, pz)];
    b.alive = false;
    if (!hooks?.land) this.splash(b, hit);
    // Its last hooks run on the glass: land, then end when it would have run
    // anyway (a body with a life ends when it runs out; the review of #64
    // found end skipped here). A body with no life never ends on the
    // ground, so it does not on the glass either.
    const ends = hooks?.end && b.life > 0 ? hooks.end : undefined;
    const last = [hooks?.land, ends].filter((f): f is NonNullable<BodyHooks["land"]> => !!f);
    if (!hooks || !last.length) return true;
    const mask = this.world.wardMask;
    forDisc(this.world, hit.x, hit.y, hit.r, (i) => (mask[i] = WARD_ALL));
    const glass = { ward: hit, harm: 0, replay: [] as (() => void)[] };
    this.glass = glass;
    try {
      for (const f of last) this.run(hooks.key, hooks.name, () => f(hooks.handle, hooks.api));
    } finally {
      this.glass = null;
      rebuildMask(this.world);
    }
    // One blow per body: a thrown thing's was taken above, and what its end
    // tried stays on the glass (the playtest found it striking twice).
    if (!glass.harm || !hooks.land) return true;
    this.splash(b, hit);
    const hpBefore = hpAgainst(hit, source);
    if (damageWard(this.world, hit, blow, source, power)) {
      // Broken: the blows held back are dealt, scaled by what passed (ruinPass).
      addRuin(this.world, hit, hooks.key, passShare(hit, power, hpBefore), power);
      for (const f of glass.replay) this.run(hooks.key, hooks.name, f);
    }
    return true;
  }

  // Sparks and a thump where a body hit the glass.
  private splash(b: Body, hit: Ward): void {
    for (let n = 0; n < 12; n++)
      this.world.particles.add({
        x: b.x,
        y: b.y,
        z: b.z + 0.5,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        vz: Math.random() * 4,
        life: 0.4 + Math.random() * 0.4,
        color: hit.color,
        size: 0.8,
        glow: true,
        gravity: 8,
        drag: 1,
      });
    this.world.emit({ kind: "sound", name: "thump", size: Math.min(1, 0.2 + b.r / 6) });
  }

  // Custom material rules: each cell of a material with a tick gets a call,
  // sampled when there are too many to keep frames smooth.
  private stepRules(dt: number): void {
    if (this.ticks.size === 0) return;
    const { world } = this;
    // Only ids with a rule are looked at: since 4.4.5 the island's own
    // covers include ids a spell's material may have taken over.
    const has = ruleMask(this.ticks.keys());
    const found: { rule: string; i: number }[] = [];
    for (let i = 0; i < world.n; i++) {
      if (has.ground[world.ground[i]]) found.push({ rule: `ground:${world.ground[i]}`, i });
      if (has.fluid[world.fluid[i]]) found.push({ rule: `fluid:${world.fluid[i]}`, i });
      if (has.cover[world.cover[i]]) found.push({ rule: `cover:${world.cover[i]}`, i });
      if (has.gas[world.gas[i]]) found.push({ rule: `gas:${world.gas[i]}`, i });
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
    const has = ruleMask(this.reactions.keys());
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
      const mask = has[layer];
      for (let i = 0; i < w.n; i++) {
        if (!mask[arr[i]]) continue;
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
  // Who threw it and how hard, for the wards it hits (4.7).
  source: string;
  power: number;
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
function behaviorOf(k: Record<string, unknown>, alias: Map<string, string>): Behavior | undefined {
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
    onDeath: typeof k.onDeath === "string" ? spawnAlias(k.onDeath.toLowerCase().slice(0, 40), alias) : null,
    lures: strings(k.lures),
    scares: strings(k.scares),
    converts: k.converts === true,
    active: k.active === "night" || k.active === "day" ? k.active : "always",
  };
}

function spawnAlias(onDeath: string, alias: Map<string, string>): string {
  if (!onDeath.startsWith("spawn:")) return onDeath;
  const kind = onDeath.slice(6).trim();
  return `spawn:${alias.get(kind) ?? kind}`;
}

// A short stable tag for a spell key, for kind names.
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// A plain object a program handed over as a body's own state.
function isPlainData(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
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

// An artifact as a spell sees it (3.7): where it is, its state, its deeds.
export class ArtifactHandle {
  constructor(
    readonly raw: Artifact,
    private world: World,
  ) {}
  get x() {
    return this.raw.x;
  }
  get y() {
    return this.raw.y;
  }
  get name() {
    return this.raw.name;
  }
  get charges() {
    return this.raw.art.charges;
  }
  set charges(v: number | null) {
    if (typeof v === "number" && Number.isFinite(v)) this.raw.art.charges = Math.max(0, Math.min(99, v));
  }
  get fuel() {
    return this.raw.art.fuel;
  }
  set fuel(v: number | null) {
    if (typeof v === "number" && Number.isFinite(v)) this.raw.art.fuel = Math.max(0, Math.min(3600, v));
  }
  get health() {
    return this.raw.art.health;
  }
  set health(v: number | null) {
    if (typeof v === "number" && Number.isFinite(v)) this.raw.art.health = Math.max(0, Math.min(2000, v));
  }
  get deeds() {
    return this.raw.art.deeds;
  }
  // Counts something it changed, for the five minute test and the card.
  did(what: string) {
    artDeed(this.world, this.raw, String(what).slice(0, 60));
  }
}

// A creature as a spell sees it.
export class CreatureHandle {
  constructor(
    readonly raw: Creature,
    private rt: Runtime,
    // The spell holding it: its own names win in transform.
    private spellKey = "",
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
  // A spell's own wolf is a wolf to every spell.
  get kind() {
    return baseName(this.raw.kind);
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
  // `b.data = {...}` is what a writer tries first: it crashed the whole cast
  // ("which has only a getter"). Taken as its fields, as w.body takes them.
  set data(v: Record<string, unknown>) {
    if (v && typeof v === "object") Object.assign(this.raw.data, v);
  }
  // A ward against harm takes most of a blow meant for someone it protects.
  // Under a ward this spell broke by two tiers or fewer, a blow that would
  // kill leaves the person at 1 health, afraid and running (the owner's
  // scale: a broken shield still saves its people). Not hostile creatures.
  private spared(blow: number): boolean {
    const w = this.rt.world;
    if (!w.ruins.length || hostile(this.raw) || blow < this.raw.hp || !ruinSpares(w, this.spellKey, this.raw.x, this.raw.y)) return false;
    this.raw.fear = Math.max(this.raw.fear, 8);
    return true;
  }
  private underForeignWard(): boolean {
    const w = this.rt.world;
    if (!w.wards.length || hostile(this.raw)) return false;
    const i = w.idx(Math.max(0, Math.min(w.w - 1, Math.round(this.raw.x))), Math.max(0, Math.min(w.h - 1, Math.round(this.raw.y))));
    return warded(w, i, WARD.harm) && !ownWard(w, i, this.spellKey);
  }
  private shielded() {
    return shieldedCreature(this.rt.world, this.raw) && !hostile(this.raw);
  }
  // Under the glass a body burst on (Runtime.glass): no blow gets through.
  // Held back, and counted as harm the glass took.
  private underGlass(blow: () => void) {
    const g = this.rt.glass;
    if (!g || Math.hypot(this.raw.x - g.ward.x, this.raw.y - g.ward.y) > g.ward.r || hostile(this.raw)) return false;
    g.harm++;
    g.replay.push(blow);
    return true;
  }
  hurt(n: number) {
    if (this.underGlass(() => this.hurt(n))) return;
    // Under another spell's ward against harm no blow gets through (it let
    // 15% through, and Meteor Strike's 80 took 12 from a villager under it).
    if (this.underForeignWard()) return;
    const w = this.rt.world;
    const pass = w.ruins.length ? ruinPass(w, this.spellKey, this.raw.x, this.raw.y) : 1;
    let blow = num(n, 0, 1e6, 0) * (this.shielded() ? 0.15 : 1) * pass;
    if (pass < 1 && this.spared(blow)) blow = Math.max(0, this.raw.hp - 1);
    this.raw.hp -= blow;
    // People remember what magic did to them (3.6).
    if (blow > 5 && this.raw.kind === "villager") remember(this.raw, "magic", -0.5);
    if (this.raw.hp <= 0) this.raw.dead = true;
  }
  heal(n: number) {
    if (this.raw.kind === "villager" && this.raw.hp < maxHp(this.raw) - 5) remember(this.raw, "magic", 0.5);
    this.raw.hp = Math.min(maxHp(this.raw), this.raw.hp + num(n, 0, 1e6, 0));
    this.raw.burning = 0;
    this.raw.frozen = 0;
  }
  kill() {
    if (this.underGlass(() => this.kill())) return;
    if (this.spared(Infinity)) {
      this.raw.hp = Math.min(this.raw.hp, 1);
      return;
    }
    if (this.shielded()) {
      this.raw.hp -= maxHp(this.raw) * 0.15;
      if (this.raw.hp > 0) return;
    }
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
    // Where this spell broke a ward a moment ago, a push is scaled by what
    // passed, and where its people are spared, never thrown high enough for
    // the fall to hurt (creatures.ts: landing faster than 16 hurts).
    const w = this.rt.world;
    let p = 1;
    let most = 200;
    if (w.ruins.length && !hostile(this.raw)) {
      p = ruinPass(w, this.spellKey, this.raw.x, this.raw.y);
      if (ruinSpares(w, this.spellKey, this.raw.x, this.raw.y)) most = 15;
    }
    this.raw.vx += num(dx, -200, 200, 0) * p;
    this.raw.vy += num(dy, -200, 200, 0) * p;
    this.raw.vz += Math.min(most, num(up, -200, 200, 0) * p);
    if (up > 0) this.raw.z = Math.max(this.raw.z, 0.1);
  }
  // fear needs a point to run from; the others only a duration.
  status(name: string, seconds: number, fromX?: number, fromY?: number) {
    const s = num(seconds, 0, 120, 3);
    const c = this.raw;
    const ward = this.rt.world.wards.length
      ? this.rt.world.wardMask[this.rt.world.idx(Math.max(0, Math.min(this.rt.world.w - 1, c.x)), Math.max(0, Math.min(this.rt.world.h - 1, c.y)))]
      : 0;
    if ((name === "burn" || name === "burning") && ward & WARD.fire) return;
    if ((name === "freeze" || name === "frozen") && ward & WARD.cold) return;
    if (!STATUSES.includes(name))
      this.rt.drop(this.spellKey, `status "${String(name).slice(0, 30)}" does not exist (burn, freeze, fear, sleep, calm, levitate, stun): it did nothing`);
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
  transform(name: string) {
    const kind = this.rt.kindFor(this.spellKey, name);
    if (!KINDS.has(kind)) return;
    const ratio = this.raw.hp / maxHp(this.raw);
    this.raw.kind = kind;
    this.raw.color = KINDS.get(kind)!.color;
    this.raw.hp = maxHp(this.raw) * ratio;
  }
  resize(factor: number) {
    // Within its kind (4.7 item 2): a spell that grows something again and
    // again keeps it a villager or a dragon, never a giant of six times.
    const most = Math.max(this.raw.size, growMax(kindOf(this.raw)));
    const ratio = this.raw.hp / maxHp(this.raw);
    this.raw.size = Math.max(Math.min(SHRINK_MIN, this.raw.size), Math.min(most, this.raw.size * num(factor, 0.1, 10, 1)));
    // Its health keeps its share (the playtest: a grown dragon read as hurt, a shrunk one over its most).
    if (!this.raw.dead) this.raw.hp = maxHp(this.raw) * ratio;
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
  // `b.data = {...}` is what a writer tries first: it crashed the whole cast
  // ("which has only a getter"). Taken as its fields, as w.body takes them.
  set data(v: Record<string, unknown>) {
    if (v && typeof v === "object") Object.assign(this.raw.data, v);
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

// The reach of a cast, w.r (4.7 item 2). A spell and land are a share of the
// island, so a storm covers as much of a big island as of a small one. Any
// other item (an object, a creature, a building, a settlement, a place) is
// drawn within w.r, so it keeps the reach it had in its test run, on the
// island of REFERENCE_SIDE cells: before, a staff drawn "within w.r" stood
// 3.4 times bigger on a 384 cell island than in the test that passed it. An
// item with no form (a library spell a creature casts) is a spell.
export function castReach(req: Pick<CastRequest, "tier" | "form" | "reach">, w: number, h: number): number {
  if (req.reach !== undefined) return req.reach;
  const side = Math.min(w, h);
  const held = isForm(req.form) && req.form !== "spell" && req.form !== "land";
  return Math.max(2, Math.round(TIER_REACH[req.tier] * (held ? Math.min(REFERENCE_SIDE, side) : side)));
}

// How much a spell may grow a creature (4.7 item 2), as its size: a person,
// and any creature, up to 1.6 times; a being a person is small beside (a
// dragon, a giant, a golem: shared/forms.ts, bigBeing) up to 3.2. The view
// caps every drawn figure at MAX_HEIGHT villagers whatever its size (rigs.ts).
export const GROW_MAX = 1.6;
export const GROW_MAX_BIG = 3.2;
export const SHRINK_MIN = 0.3;
export function growMax(kind: CreatureKind): number {
  if (kind.name === "villager") return GROW_MAX;
  const plan = kind.body.plan;
  return bigBeing(kind.name) || plan === "dragon" || plan === "golem" ? GROW_MAX_BIG : GROW_MAX;
}

// What a spell program can do. Kept high level on purpose: a few calls do a
// lot, so programs stay short (and cheap to write).
export class SpellApi {
  readonly r: number;
  private readonly owner: string;
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
    // One placing of one item: its models share this (props.ts, MODELS_PER_ITEM).
    this.owner = `${req.key}#${castId}@${Math.round(rt.world.time * 30)}`;
    this.width = rt.world.w;
    this.height = rt.world.h;
    this.r = castReach(req, rt.world.w, rt.world.h);
  }

  // Who wears a ward down, and how hard (4.7, wards.ts): one cast is one source.
  private get source() {
    return `cast:${this.castId}`;
  }
  private get power() {
    return TIER_POWER[this.req.tier] ?? 1;
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

  // 4.12, reading the island (reading.ts): the questions a smart spell asks,
  // one call each, all within (x, y, r), the cast's spot and reach by default.
  // They only read, so programs that never call them run as before.
  private area(x: unknown, y: unknown, r: unknown): [number, number, number] {
    return [num(x, -1e4, 1e4, this.x), num(y, -1e4, 1e4, this.y), num(r, 0, 400, this.r)];
  }
  private handles(list: Creature[]): CreatureHandle[] {
    return list.map((c) => new CreatureHandle(c, this.rt, this.req.key));
  }
  here(x?: number, y?: number, r?: number) {
    const h = readHere(this.rt.world, ...this.area(x, y, r));
    const f = (l: Creature[]) => this.handles(l);
    return { ...h, villagers: f(h.villagers), animals: f(h.animals), undead: f(h.undead), hostile: f(h.hostile), spirits: f(h.spirits), wounded: f(h.wounded) };
  }
  wouldHurt(x?: number, y?: number, r?: number) {
    return readHurt(this.rt.world, ...this.area(x, y, r));
  }
  nearest(what: string, x?: number, y?: number, max?: number) {
    const [px, py] = this.area(x, y, 0);
    const found = findNearest(this.rt.world, String(what), px, py, num(max, 0, 1000, Math.max(this.r * 3, 60)));
    if (!found) return null;
    return { x: found.x, y: found.y, d: found.d, ...(found.creature ? { creature: this.handles([found.creature])[0] } : {}) };
  }
  fights(x?: number, y?: number, r?: number) {
    return readFights(this.rt.world, ...this.area(x, y, r)).map((f) => ({ attacker: this.handles([f.attacker])[0], target: this.handles([f.target])[0] }));
  }
  nature(c: { raw?: Creature } | null | undefined): string {
    return c && c.raw ? natureOf(c.raw) : "none";
  }

  // Writing one cell. `set` puts any material on its own layer; for a fluid or
  // gas, amount is depth or density.
  set(x: number, y: number, material: string, amount = 1) {
    if (!this.inside(x, y)) return;
    const name = String(material).toLowerCase();
    const i = this.i(x, y);
    if (this.isFluid(name) && this.fluidBlocked(i)) return;
    if (this.coverAt(i, name) && this.landBlocked(i)) return;
    this.rt.world.place(i, name, num(amount, 0, 50, 1));
  }
  // Would placing this material change a cell's cover (a house, a field, a
  // tree), or the ground under a building? Paint on bare ground goes on.
  private coverAt(i: number, name: string): boolean {
    const w = this.rt.world;
    const layer = w.materials.find(name)?.layer;
    return (layer === "cover" && w.cover[i] !== C.NONE) || (layer === "ground" && isBuilding(w.cover[i]));
  }
  private isFluid(name: string): boolean {
    return this.rt.world.materials.find(name)?.layer === "fluid";
  }
  // Fluids a spell pours do not land inside someone else's ward against fluids.
  private fluidBlocked(i: number): boolean {
    const w = this.rt.world;
    if (w.ruins.length && Math.random() >= this.passAt(i)) return true;
    if (!w.wards.length || !warded(w, i, WARD.fluids) || ownWard(w, i, this.req.key)) return false;
    if (this.rt.glass) this.rt.glass.harm++;
    else if (Math.random() < 0.02) wardHit(w, i, 1, this.source, this.power);
    return true;
  }
  // 4.7, the owner's report of 7 November ("all of them let a meteor
  // through"): Meteor Strike's crater and Meteor Storm's craters are dug by
  // the cast, not the body, so a ward that stopped the meteor still had its
  // houses cleared and its land dug. What another spell does to the land
  // inside a ward against harm is held at the glass: its height, its covers
  // (houses, fields, trees) and the ground under a building do not change.
  private landBlocked(i: number): boolean {
    const w = this.rt.world;
    // Where it broke a ward a moment ago, only the share that passed goes through.
    if (w.ruins.length && Math.random() >= ruinPass(w, this.req.key, i % w.w, Math.floor(i / w.w))) return true;
    if (!w.wards.length || !warded(w, i, WARD.harm) || ownWard(w, i, this.req.key)) return false;
    if (this.rt.glass) this.rt.glass.harm++;
    else if (Math.random() < 0.02) wardHit(w, i, 1, this.source, this.power);
    return true;
  }
  // For heights, which scale with what passed instead of a coin toss.
  private landHeld(i: number): boolean {
    const w = this.rt.world;
    if (!w.wards.length || !warded(w, i, WARD.harm) || ownWard(w, i, this.req.key)) return false;
    if (this.rt.glass) this.rt.glass.harm++;
    else if (Math.random() < 0.02) wardHit(w, i, 1, this.source, this.power);
    return true;
  }
  private passAt(i: number): number {
    const w = this.rt.world;
    return w.ruins.length ? ruinPass(w, this.req.key, i % w.w, Math.floor(i / w.w)) : 1;
  }
  private fireBlocked(i: number): boolean {
    const w = this.rt.world;
    if (w.ruins.length && Math.random() >= this.passAt(i)) return true;
    if (!w.wards.length || !warded(w, i, WARD.fire)) return false;
    if (this.rt.glass) this.rt.glass.harm++;
    else if (Math.random() < 0.02) wardHit(w, i, 1, this.source, this.power);
    return true;
  }
  clear(x: number, y: number, layer: Layer) {
    if (!this.inside(x, y)) return;
    const w = this.rt.world;
    const i = this.i(x, y);
    if ((layer === "cover" || layer === "ground") && this.landBlocked(i)) return;
    if (layer === "cover") w.setCover(i, C.NONE);
    else if (layer === "fluid") w.setFluid(i, F.NONE, 0);
    else if (layer === "gas") w.gasAmt[i] = 0;
    else if (layer === "ground") w.ground[i] = G.DIRT;
  }
  fire(x: number, y: number, intensity = 1) {
    if (!this.inside(x, y) || this.fireBlocked(this.i(x, y))) return;
    const w = this.rt.world;
    w.fire[this.i(x, y)] = Math.max(w.fire[this.i(x, y)], num(intensity, 0, 1, 1));
  }
  heat(x: number, y: number, degrees: number) {
    if (!this.inside(x, y)) return;
    const d = num(degrees, -500, 3000, 0);
    const i = this.i(x, y);
    if (warded(this.rt.world, i, d > 0 ? WARD.fire : WARD.cold)) return;
    this.rt.world.temp[i] += d;
  }
  raise(x: number, y: number, amount: number) {
    if (!this.inside(x, y) || this.landHeld(this.i(x, y))) return;
    this.rt.world.height[this.i(x, y)] += num(amount, -50, 50, 0) * this.passAt(this.i(x, y));
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
    const radius = num(r, 0.5, 300, 4);
    const force = num(power, 0, 5, 1);
    // 4.7: a blast that reaches a ward against harm wears it down first;
    // a strong one breaks it, and then the blast goes through. On the glass
    // of a body's impact, the body's blow is what the ward takes, and the
    // blast inside is held back with the body's other blows.
    const g = this.rt.glass;
    const key = this.req.key;
    const blast = () => {
      // What a ward it broke a moment ago spent of it (ruinPass).
      const w = this.rt.world;
      const p = ruinPass(w, key, x, y);
      if (p <= 0) return;
      // The blast's own blows on people (physics.ts) spare those a ward
      // broken by two tiers or fewer covered: hurt, afraid, alive.
      const spared = w.ruins.length ? w.creatures.filter((c) => !c.dead && !hostile(c) && ruinSpares(w, key, c.x, c.y)) : [];
      explode(w, x, y, radius * Math.sqrt(p), force * p);
      for (const c of spared) {
        // Not thrown high enough for the fall to kill (landing faster than 16 hurts).
        c.vz = Math.min(c.vz, 15);
        if (c.dead || c.hp <= 0) {
          c.dead = false;
          c.hp = 1;
          c.burning = 0;
          c.fear = Math.max(c.fear, 8);
        }
      }
    };
    if (g && Math.hypot(g.ward.x - x, g.ward.y - y) < g.ward.r + radius) {
      g.harm++;
      g.replay.push(blast);
    }
    for (const ward of [...this.rt.world.wards])
      if (ward !== g?.ward && ward.against & WARD.harm && Math.hypot(ward.x - x, ward.y - y) < ward.r + radius) {
        const hpBefore = hpAgainst(ward, this.source);
        const d = Math.hypot(x - ward.x, y - ward.y) || 1;
        ward.hitAt = d > ward.r ? { x: ward.x + ((x - ward.x) / d) * ward.r, y: ward.y + ((y - ward.y) / d) * ward.r, z: 0 } : { x, y, z: ward.r * 0.6 };
        if (damageWard(this.rt.world, ward, 15 * force * Math.sqrt(Math.min(radius, 40)), this.source, this.power))
          addRuin(this.rt.world, ward, key, passShare(ward, this.power, hpBefore), this.power);
      }
    blast();
  }
  quake(x: number, y: number, r: number, strength = 1) {
    quake(this.rt.world, x, y, num(r, 1, 400, 8), num(strength, 0, 5, 1));
  }
  ignite(x: number, y: number, r: number, chance = 1) {
    const w = this.rt.world;
    forDisc(w, x, y, num(r, 0, 400, 3), (i) => {
      if (Math.random() < chance && !this.fireBlocked(i)) w.fire[i] = Math.max(w.fire[i], 0.8);
    });
    if (w.decor.size) igniteVoxels(w, x, y, num(r, 0, 400, 3) * 0.8);
  }
  // Adds fluid in a disc, deepest at the center.
  flood(x: number, y: number, r: number, fluid = "water", depth = 1) {
    const w = this.rt.world;
    const d = num(depth, 0, 40, 1);
    forDisc(w, x, y, num(r, 0, 400, 3), (i, k) => {
      if (!this.fluidBlocked(i)) w.place(i, String(fluid).toLowerCase(), d * (0.3 + 0.7 * k));
    });
  }
  drain(x: number, y: number, r: number) {
    const w = this.rt.world;
    forDisc(w, x, y, num(r, 0, 400, 3), (i) => w.setFluid(i, F.NONE, 0));
  }
  // Places a material on cells of a disc, each with a chance of density * closeness.
  paint(x: number, y: number, r: number, material: string, density = 1, amount = 1) {
    const w = this.rt.world;
    const name = String(material).toLowerCase();
    const fluid = this.isFluid(name);
    forDisc(w, x, y, num(r, 0, 400, 3), (i, k) => {
      if (fluid && this.fluidBlocked(i)) return;
      if (this.coverAt(i, name) && this.landBlocked(i)) return;
      if (Math.random() < density * (0.4 + 0.6 * k)) w.place(i, name, num(amount, 0, 50, 1));
    });
  }
  // Changes temperature in a disc: negative freezes water and puts out fire,
  // positive melts, boils and eventually sets things alight.
  temperature(x: number, y: number, r: number, delta: number) {
    const w = this.rt.world;
    const d = num(delta, -500, 3000, 0) * (w.ruins.length ? ruinPass(w, this.req.key, x, y) : 1);
    const guard = d > 0 ? WARD.fire : WARD.cold;
    forDisc(w, x, y, num(r, 0, 400, 3), (i, k) => {
      if (warded(w, i, guard)) return;
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
      if (warded(w, w.idx(Math.max(0, Math.min(w.w - 1, c.x)), Math.max(0, Math.min(w.h - 1, c.y))), guard)) continue;
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
      if (h !== 0 && this.landHeld(i)) return;
      w.height[i] += h * s * this.passAt(i);
      if (h > 4 && s > 0.6 && isBuilding(w.cover[i])) w.setCover(i, C.RUBBLE);
    });
  }
  // Builds a column `voxels` high at a cell, made of a ground material: trunks,
  // towers, walls, crystal spires. The whole column shows that material.
  build(x: number, y: number, voxels: number, material: string) {
    if (!this.inside(x, y)) return;
    const w = this.rt.world;
    const i = this.i(x, y);
    const found = w.materials.find(String(material).toLowerCase());
    if (!found || found.layer !== "ground" || this.landBlocked(i)) return;
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
    const height = num(o.height, 4, 120, style === "giant" ? 40 : 12);
    tree(b, x, y, num(o.z, 0, 200, 0), {
      height,
      style,
      trunk: colorList(o.trunk, d.trunk),
      leaves: style === "dead" ? [] : colorList(o.leaves, d.leaves),
      accent: colorList(o.accent, []),
      accentShare: num(o.accentShare, 0, 1, 0.25),
      leafKind: o.glow === true ? VK.GLOW : style === "crystal" ? VK.GLOW : VK.LEAF,
    });
    // Only a tree of an ordinary height is a creature's deed (the review of
    // #72: three giant trees, 120 high, slipped past its size).
    if (height <= PLANTED_TREE_HEIGHT) this.rt.planted.set(this.req.key, [...(this.rt.planted.get(this.req.key) ?? []), [...b.cells.keys()]]);
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

  // 4.6: the engine's own makers (makers.ts). A seed from the island, the
  // spot and the moment, so the test run's two islands build the same thing.
  private seedAt(x: number, y: number): number {
    return (Math.imul(this.rt.world.seed ^ 0x4d6, 31) + Math.round(x) * 7919 + Math.round(y) * 104729 + Math.round(this.rt.world.time * 30)) >>> 0;
  }
  // A real village near (x, y): houses round a plaza, a street, fields, a
  // well, its first buildings and villagers. {houses (3 to 14), name, villagers}.
  village(x: number, y: number, o: Record<string, unknown> = {}) {
    const made = makeVillage(
      this.rt.world,
      x,
      y,
      {
        houses: typeof o.houses === "number" ? num(o.houses, 3, 14, 7) : undefined,
        name: typeof o.name === "string" ? o.name : undefined,
        villagers: typeof o.villagers === "number" ? num(o.villagers, 2, 30, 10) : undefined,
      },
      this.seedAt(x, y),
    );
    return made;
  }
  // A house or a building with a job, two by two cells, in its village's style.
  building(x: number, y: number, o: Record<string, unknown> | string = {}) {
    if (!this.inside(x, y)) return null;
    const job = typeof o === "string" ? o : typeof o.job === "string" ? o.job : "house";
    const made = makeBuilding(this.rt.world, x, y, job.toLowerCase().trim());
    if (made) {
      const W = this.rt.world.w;
      const i = (made.y - 1) * W + made.x - 1;
      this.rt.raised.set(this.req.key, [...(this.rt.raised.get(this.req.key) ?? []), i, i + 1, i + W, i + W + 1]);
    }
    return made;
  }
  // 4.6 part B: a person, as the island's own villagers are: its village's
  // look, a job, a home with a household, memory, and a calling from the
  // item's name. {job, calling, title, age}; returns {x, y, job, calling,
  // village, household, forge, handle} or null when the island is full.
  person(x: number, y: number, o: Record<string, unknown> = {}) {
    if (!this.inside(x, y)) return null;
    const str = (v: unknown) => (typeof v === "string" ? v.toLowerCase().trim() : undefined);
    const made = makePerson(
      this.rt.world,
      x,
      y,
      { job: str(o.job), calling: str(o.calling), age: str(o.age), title: typeof o.title === "string" ? o.title : this.req.name },
      this.seedAt(x, y),
    );
    if (!made) return null;
    this.rt.people.set(this.req.key, [...(this.rt.people.get(this.req.key) ?? []), made.creature]);
    const { creature, ...rest } = made;
    return { ...rest, handle: new CreatureHandle(creature, this.rt, this.req.key) };
  }
  // The terrain reshaped: {shape, r, height}.
  land(x: number, y: number, o: Record<string, unknown> | string = {}) {
    const asked = typeof o === "string" ? { shape: o } : o;
    const shape = typeof asked.shape === "string" ? asked.shape.toLowerCase().trim() : "hill";
    if (shape === "floating island") {
      // The island's own floating rock, drawn in fine parts (33 in its model),
      // drifting as it does; whole voxels only when the island has no room for it.
      const rock = makeWonder(this.rt.world, "floating rock", x, y, this.seedAt(x, y));
      if (rock) return { shape, cells: 0, wonder: rock.name };
      this.island(x, y, { z: asked.z ?? asked.height ?? 18, r: asked.r ?? 7, grow: asked.grow });
      return { shape, cells: 0 };
    }
    const height = typeof asked.height === "number" && Number.isFinite(asked.height) ? Math.max(-40, Math.min(60, asked.height)) : null;
    return shapeLand(this.rt.world, x, y, shape, num(asked.r, 3, 60, Math.max(4, this.r)), height, this.seedAt(x, y));
  }
  // One of the island's built-in wonders where the item stands.
  wonder(x: number, y: number, kind: string) {
    const w = makeWonder(this.rt.world, String(kind), x, y, this.seedAt(x, y));
    return w ? { kind: w.kind, name: w.name, x: w.x, y: w.y, r: w.r } : null;
  }

  // 4.6: a fine box model of what the item looks like (props.ts): up to 80
  // boxes [x, y, z, w, d, h, color, "glow"], in cells from (x, y) and voxels
  // up from the ground, as small as a twentieth of a cell. {name, turn, vary}.
  model(x: number, y: number, boxes: unknown, o: Record<string, unknown> = {}) {
    if (!this.inside(x, y)) return null;
    // Calls by program, for its test run (more than MODELS_PER_ITEM fails its look).
    this.rt.modelCalls.set(this.req.key, (this.rt.modelCalls.get(this.req.key) ?? 0) + 1);
    const p = readProp({
      key: this.req.key,
      owner: this.owner,
      name: typeof o.name === "string" ? o.name : this.req.name,
      x: Math.round(x * 20) / 20,
      y: Math.round(y * 20) / 20,
      turn: o.turn,
      boxes: Array.isArray(boxes) ? boxes : [],
    });
    const given = Array.isArray(boxes) ? boxes.length : 0;
    const kept = p ? p.boxes.length : 0;
    // A fifth of its parts or three of them gone is a look the writer did not draw.
    if (given - kept >= Math.max(3, Math.ceil(given * 0.2)))
      this.rt.drop(
        this.req.key,
        `w.model drew ${kept} of ${given} boxes: a box with a side of zero or less, or not a number, is not drawn (a thin side is drawn at ${FINE_BOX}), and a model keeps ${MAX_PROP_BOXES} boxes at most`,
      );
    if (!p) return null;
    // Each part a slightly different shade, as the wonders' parts are; vary: 0 keeps the colors exact.
    shadeParts(p, num(o.vary, 0, 0.3, 0.07));
    if (!addProp(this.rt.world, p)) return null;
    const b = propBounds(p);
    return { x: p.x, y: p.y, boxes: p.boxes.length, across: Math.round(b.across * 100) / 100, tall: Math.round(b.tall * 100) / 100 };
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
    return list.map((c) => new CreatureHandle(c, this.rt, this.req.key));
  }
  corpses(x: number, y: number, r: number): CreatureHandle[] {
    return this.rt.world.creatures.filter((c) => c.dead && Math.hypot(c.x - x, c.y - y) <= r).map((c) => new CreatureHandle(c, this.rt, this.req.key));
  }
  spawn(kind: string, x: number, y: number): CreatureHandle | null {
    const w = this.rt.world;
    if (w.creatures.length > 600 || !this.inside(x, y)) return null;
    const name = this.rt.kindFor(this.req.key, kind);
    if (!KINDS.has(name))
      this.rt.drop(
        this.req.key,
        `w.spawn("${String(kind).slice(0, 30)}") names no creature kind: declare it in spell.creatures, or it arrives as a plain beast`,
      );
    const c = makeCreature(KINDS.has(name) ? name : "beast", x, y);
    w.creatures.push(c);
    return new CreatureHandle(c, this.rt, this.req.key);
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
      // 4.5.1 (audit): the prompt teaches `data` as a body field and programs
      // pass it here (Starfall Rain's `data: { h: 0 }`); it was dropped, so
      // their ticks read undefined and never healed. Bodies are never saved
      // or sent across frames. A shallow copy, so bodies made from one shared
      // options object do not share their state.
      data: isPlainData(o.data) ? { ...o.data } : {},
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
      source: this.source,
      power: this.power,
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

  // A ward (3.5): a clear dome that keeps what is inside safe for `seconds`
  // from what it is against: fire, fluids, lightning, creatures, harm, cold
  // (all of them by default). Hostile creatures are pushed out; keepOut and
  // allow name kinds to push out or let in whatever they are.
  ward(x: number, y: number, r: number, o: Record<string, unknown> = {}) {
    const w = this.rt.world;
    if (!this.inside(x, y)) return;
    const seconds = num(o.seconds, 1, 600, 20);
    // Cast again over its own ward, the same spell mends it and renews its
    // time (the game designer, 4.7): never past its health, never a new tier.
    const own = w.wards.find((d) => d.owner === this.req.key && Math.hypot(d.x - x, d.y - y) <= d.r);
    if (own) {
      own.hp = own.maxHp ?? 100;
      own.dealt = {};
      own.pressure = 0;
      own.until = Math.max(own.until, w.time + seconds);
      own.hit = w.time;
      this.rt.wardCalls.set(this.req.key, (this.rt.wardCalls.get(this.req.key) ?? 0) + 1);
      return;
    }
    addWard(
      w,
      {
        x,
        y,
        r: num(r, 1, 120, 8),
        against: wardBits(o.against),
        from: w.time,
        until: w.time + seconds,
        color: colorOr(o.color, 0x9fd8ff),
        keepOut: strings(o.keepOut),
        allow: strings(o.allow),
        owner: this.req.key,
        hit: -10,
      },
      this.power,
    );
    this.rt.wardCalls.set(this.req.key, (this.rt.wardCalls.get(this.req.key) ?? 0) + 1);
  }

  // Gives villagers near (x, y) a goal this spell defined as their job (3.6):
  // a forge hires smiths, an orchard pickers. Adults only, nearest first, up
  // to count (at most 6). Returns how many took it.
  hire(goal: string, x: number, y: number, count = 2): number {
    const name = String(goal).trim().toLowerCase();
    if (!CUSTOM_GOALS.has(name)) return 0;
    const w = this.rt.world;
    const n = Math.round(num(count, 1, 6, 2));
    const near = w.creatures
      .filter((c) => !c.dead && c.kind === "villager" && (c.look & 3) === 0 && Math.hypot(c.x - x, c.y - y) < 16 && c.mind?.job !== name)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
      .slice(0, n);
    for (const c of near) {
      const m = mindOf(c);
      m.job = name;
      m.task = "none";
    }
    return near.length;
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

  // An artifact that acts (3.7): a landmark with a life of its own. Its look
  // is built apart, like a landmark's. o is what spell.artifacts declared
  // under this name, or the options themselves:
  //   { name, radius, color, lures, scares, aura, power,
  //     charges, recharge, fuel, health, onBreak,
  //     effects: [{ when, every, do, radius, cost, act(self, w, target) }],
  //     grants: [{ what, to, cost }], uses: [{ do, by }],
  //     pairs: [{ with, within, do, once, every, act(self, w, other) }] }
  artifact(x: number, y: number, o: Record<string, unknown> | string = {}) {
    const w = this.rt.world;
    if (!this.inside(x, y) || w.landmarks.length >= 60) return null;
    const asked = typeof o === "string" ? { name: o } : o && typeof o === "object" ? o : {};
    const name = (typeof asked.name === "string" ? asked.name : this.req.name).slice(0, 40);
    const def = this.rt.artDefs.get(`${this.req.key}|${name.toLowerCase()}`) ?? {};
    const all: Record<string, unknown> = { ...def, ...asked };
    this.rt.placedArt.add(`${this.req.key}|${name.toLowerCase()}`);
    if (!this.rt.artDefs.has(`${this.req.key}|${name.toLowerCase()}`)) this.rt.keepArtifactCode(this.req.key, name.toLowerCase(), all);
    const aura = ["heal", "fear", "calm", "sleep", "burn", "freeze", "hurt"].includes(all.aura as string) ? (all.aura as string) : null;
    const radius = num(all.radius, 1, 40, 6);
    const a: Artifact = {
      x: Math.round(x),
      y: Math.round(y),
      name,
      lures: strings(all.lures),
      scares: strings(all.scares),
      taken: false,
      color: colorOr(all.color, 0xffd36a),
      radius,
      aura,
      power: num(all.power, 0, 10, 1),
      art: artifactState(all, this.req.key, this.req.tier, w.time, radius, (note) => this.rt.drop(this.req.key, `${name}: ${note}`)),
    };
    // 4.7: an object can be carried (held.ts); its kind when the spell carries one.
    if (this.req.form) a.art.form = this.req.form;
    w.landmarks.push(a);
    return new ArtifactHandle(a, w);
  }

  // Artifacts on the island (3.7), near a point.
  artifacts(x: number, y: number, r: number) {
    const w = this.rt.world;
    return w.landmarks.filter((l): l is Artifact => isArtifact(l) && Math.hypot(l.x - x, l.y - y) <= r).map((a) => new ArtifactHandle(a, w));
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
    // Under a ward against lightning, the bolt ends on the dome.
    // On the glass of a body's impact (4.7), a bolt of its land hook ends on that dome.
    const glass = this.rt.glass;
    const onGlass = glass && Math.hypot(glass.ward.x - x, glass.ward.y - y) <= glass.ward.r ? glass.ward : undefined;
    if (glass && onGlass) {
      glass.harm++;
      glass.replay.push(() => this.lightning(x, y, o));
    }
    const dome = onGlass ?? (warded(w, i, WARD.lightning) ? w.wards.find((d) => d.against & WARD.lightning && Math.hypot(d.x - x, d.y - y) <= d.r) : undefined);
    if (dome) {
      const top = w.height[w.idx(Math.max(0, Math.min(w.w - 1, dome.x)), Math.max(0, Math.min(w.h - 1, dome.y)))] * 0.5;
      target = Math.max(target, top + Math.sqrt(Math.max(0, dome.r ** 2 - (x - dome.x) ** 2 - (y - dome.y) ** 2)) * DOME_SQUASH);
      dome.hit = w.time;
    }
    // 4.7: a bolt on the dome wears it down; one that breaks it strikes through.
    const broke = !!dome && !onGlass && damageWard(w, dome, 20 * Math.max(0.5, power), this.source, this.power);
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
    if (dome && !broke) return;
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
  // Heard from the spell's center, and as big as its tier (4.8): stored
  // programs call w.sound(name, size) and need no change.
  sound(name: string, size = 0.5) {
    this.rt.world.emit({ kind: "sound", name: String(name), size: tierSize(num(size, 0, 1, 0.5), this.tier), x: this.x, y: this.y });
  }
}

// Which ids of each layer have a rule, from keys like "cover:12".
function ruleMask(keys: Iterable<string>): Record<Layer, Uint8Array> {
  const out = { ground: new Uint8Array(256), fluid: new Uint8Array(256), cover: new Uint8Array(256), gas: new Uint8Array(256) } as Record<Layer, Uint8Array>;
  for (const key of keys) {
    const [layer, id] = key.split(":");
    if (layer in out) out[layer as Layer][Number(id) & 255] = 1;
  }
  return out;
}
