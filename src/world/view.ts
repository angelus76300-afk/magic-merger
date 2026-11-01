import { elementKey } from "../../shared/elements";
import { SCALE_RADIUS, maxScaleForDepth, sanitizeSpellSpec, type SpellSpec } from "../../shared/spell";
import * as api from "../api";
import { chipElement } from "../craft";
import type { Store } from "../store";
import { toast } from "../toast";
import { Renderer } from "./render";
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
  async prepare(key: string, regenerate = false): Promise<SpellSpec | null> {
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
      toast(err instanceof Error ? err.message : "The spell could not be prepared", "error");
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
    this.renderer.draw(this.world);
    if (now - this.lastSave > 10_000) {
      this.lastSave = now;
      this.save();
    }
    requestAnimationFrame((t) => this.frame(t));
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
