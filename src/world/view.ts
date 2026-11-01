import { elementKey } from "../../shared/elements";
import { SCALES, SCALE_RADIUS, maxScaleForDepth, sanitizeSpellSpec, type SpellSpec } from "../../shared/spell";
import * as api from "../api";
import { chipElement } from "../craft";
import type { Store } from "../store";
import { toast } from "../toast";
import { Renderer } from "./render";
import { SpellSound } from "./sound";
import { TICK, World } from "./world";

const WORLD_KEY = "magic-merger.world";
const SIZES = { small: 120, medium: 200, large: 320 } as const;
type WorldSize = keyof typeof SIZES;

export interface WorldElements {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  list: HTMLElement;
  add: HTMLButtonElement;
  reset: HTMLButtonElement;
  size: HTMLSelectElement;
  sound: HTMLButtonElement;
}

// The World tab: runs the simulation while visible, and casts the selected
// spell wherever the player taps.
export class WorldView {
  // Created on first show, when the stage has its real size.
  private world: World | null = null;
  private renderer!: Renderer;
  private running = false;
  private last = 0;
  private acc = 0;
  private lastSave = 0;
  private selected: string | null = null;
  private preparing = new Set<string>();
  // Mock specs are never saved, but are kept for the session so casting is instant.
  private sessionSpecs = new Map<string, SpellSpec>();
  private sound = new SpellSound();
  // Screen shake and flash after a release, fading out over a fraction of a second.
  private shake = 0;
  private flash = 0;
  private readonly calmMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  constructor(
    private store: Store,
    private el: WorldElements,
  ) {}

  init(): void {
    this.el.canvas.addEventListener("pointerdown", (e) => this.onTap(e));
    this.el.add.addEventListener("click", () => {
      this.world?.spawn("villager");
      toast("A villager wanders in");
    });
    this.el.reset.addEventListener("click", () => {
      if (window.confirm("Reset the world? Everything in it will be lost.")) {
        this.newWorld(this.el.size.value as WorldSize);
      }
    });
    window.addEventListener("pagehide", () => this.save());
    const showSound = () => {
      this.el.sound.textContent = this.sound.muted ? "Sound off" : "Sound on";
      this.el.sound.setAttribute("aria-pressed", String(!this.sound.muted));
    };
    this.el.sound.addEventListener("click", () => {
      this.sound.setMuted(!this.sound.muted);
      showSound();
    });
    showSound();
  }

  show(): void {
    if (!this.world) {
      const saved = readSaved();
      const world = saved ? World.deserialize(saved) : null;
      if (world) this.setWorld(world);
      else this.newWorld(window.innerWidth < 600 ? "small" : "medium");
    }
    this.renderSpells();
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  hide(): void {
    this.running = false;
    this.save();
  }

  selectSpell(key: string): void {
    this.selected = key;
    this.renderSpells();
    void this.prepare(key);
  }

  // Asks the Worker for the spell spec, once. Admins can force a new one.
  // A quiet prepare runs in the background and keeps its errors to itself: the
  // player will see them if they actually try to cast.
  async prepare(key: string, regenerate = false, quiet = false): Promise<SpellSpec | null> {
    if (!regenerate) {
      const known = this.specFor(key);
      if (known) {
        this.updateStatus();
        return known;
      }
    }
    const discovery = this.store.get(key);
    if (!discovery || this.preparing.has(key)) return null;
    this.preparing.add(key);
    this.updateStatus();
    try {
      const res = await api.spell(discovery.element.name, regenerate);
      const spec = sanitizeSpellSpec(res.spec, maxScaleForDepth(discovery.element.depth));
      if (res.mock) this.sessionSpecs.set(key, spec);
      else this.store.setSpell(key, spec);
      return spec;
    } catch (err) {
      if (!quiet) toast(err instanceof Error ? err.message : "The spell could not be prepared", "error");
      return null;
    } finally {
      this.preparing.delete(key);
      this.updateStatus();
    }
  }

  private specFor(key: string): SpellSpec | undefined {
    return this.store.spell(key) ?? this.sessionSpecs.get(key);
  }

  private onTap(e: PointerEvent): void {
    if (!this.world) return;
    const cell = this.toCell(this.world, e);
    if (!cell) return;
    if (!this.selected) {
      toast("Pick a spell below first");
      return;
    }
    const spec = this.specFor(this.selected);
    if (!spec) {
      toast(this.preparing.has(this.selected) ? "Still preparing this spell…" : "This spell is not ready");
      if (!this.preparing.has(this.selected)) void this.prepare(this.selected);
      return;
    }
    const target = snapToGround(this.world, cell, SCALE_RADIUS[spec.scale]);
    this.world.cast(spec, target.x, target.y);
  }

  // Screen to world cell, through the letterboxing of object-fit: contain.
  private toCell(world: World, e: PointerEvent): { x: number; y: number } | null {
    const rect = this.el.canvas.getBoundingClientRect();
    const { w, h } = world.grid;
    const scale = Math.min(rect.width / w, rect.height / h);
    const x = (e.clientX - rect.left - (rect.width - w * scale) / 2) / scale;
    const y = (e.clientY - rect.top - (rect.height - h * scale) / 2) / scale;
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    return { x: Math.floor(x), y: Math.floor(y) };
  }

  private frame(now: number): void {
    if (!this.running || !this.world) return;
    this.acc += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    while (this.acc >= TICK) {
      this.world.step();
      this.acc -= TICK;
    }
    this.playEvents(this.world);
    this.renderer.draw(this.world);
    this.applyScreenEffects();
    if (now - this.lastSave > 10_000) {
      this.lastSave = now;
      this.save();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // Sound, shake, flash and a buzz on phones: what makes a cast land.
  private playEvents(world: World): void {
    for (const event of world.events.splice(0)) {
      const size = SCALES.indexOf(event.spec.scale) / (SCALES.length - 1);
      if (event.kind === "charge") {
        this.sound.charge(event.spec.phases.charge.duration);
        continue;
      }
      this.sound.release(
        event.spec.effects.map((e) => e.verb),
        event.spec.delivery,
        size,
      );
      if (this.calmMotion) continue;
      this.shake = Math.max(this.shake, 1 + 7 * size);
      this.flash = Math.max(this.flash, 0.25 + 0.5 * size);
      if (size >= 0.6) navigator.vibrate?.(Math.round(40 + 120 * size));
    }
  }

  private applyScreenEffects(): void {
    const canvas = this.el.canvas;
    if (this.shake > 0.2) {
      const dx = (Math.random() - 0.5) * this.shake;
      const dy = (Math.random() - 0.5) * this.shake;
      canvas.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      this.shake *= 0.85;
    } else if (this.shake > 0) {
      this.shake = 0;
      canvas.style.transform = "";
    }
    if (this.flash > 0.02) {
      canvas.style.filter = `brightness(${(1 + this.flash).toFixed(2)})`;
      this.flash *= 0.8;
    } else if (this.flash > 0) {
      this.flash = 0;
      canvas.style.filter = "";
    }
  }

  private newWorld(size: WorldSize): void {
    const w = SIZES[size] ?? SIZES.medium;
    const rect = this.el.stage.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.height / rect.width : 0.6;
    // A tall phone screen gets a bit more sky, not a tower of stone: past 1.25
    // the canvas just leaves room above it.
    const h = Math.round(w * Math.min(1.25, Math.max(0.45, aspect)));
    this.setWorld(World.create(w, h));
    this.save();
  }

  private setWorld(world: World): void {
    this.world = world;
    this.renderer = new Renderer(this.el.canvas, world.grid.w, world.grid.h);
    const size = (Object.keys(SIZES) as WorldSize[]).find((k) => SIZES[k] === world.grid.w);
    if (size) this.el.size.value = size;
    this.renderer.draw(world);
  }

  private save(): void {
    if (!this.world) return;
    try {
      localStorage.setItem(WORLD_KEY, this.world.serialize());
    } catch {
      // Storage full or blocked: the world lives on until the page closes.
    }
  }

  private renderSpells(): void {
    const spells = this.store
      .discoveries()
      .filter((d) => d.element.kind === "spell")
      .sort((a, b) => b.discoveredAt - a.discoveredAt);
    const fragment = document.createDocumentFragment();
    for (const { element } of spells) {
      const key = elementKey(element.name);
      const chip = chipElement(element, "button");
      chip.classList.add("chip-castable");
      chip.setAttribute("aria-pressed", String(key === this.selected));
      chip.addEventListener("click", () => this.selectSpell(key));
      fragment.append(chip);
    }
    this.el.list.replaceChildren(fragment);
    this.updateStatus();
  }

  private updateStatus(): void {
    const key = this.selected;
    const name = key ? this.store.get(key)?.element.name : null;
    let text = "Pick a spell, then tap the world to cast it.";
    if (key && name) {
      if (this.preparing.has(key)) text = `Preparing ${name}… the first cast of a spell takes a moment.`;
      else if (this.specFor(key)) text = `Tap the world to cast ${name}.`;
      else text = `${name} is not ready yet.`;
    }
    this.el.status.textContent = text;
  }
}

// A tap in open sky close above the ground means "there, on the ground": spells
// are aimed at the land. Far up in the sky, the tap is taken as it is.
function snapToGround(world: World, cell: { x: number; y: number }, radius: number): { x: number; y: number } {
  const ground = world.grid.groundY(cell.x);
  if (world.grid.get(cell.x, cell.y) !== 0 || cell.y >= ground) return cell;
  return ground - cell.y <= Math.max(12, radius * 2) ? { x: cell.x, y: ground - 1 } : cell;
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(WORLD_KEY);
  } catch {
    return null;
  }
}
