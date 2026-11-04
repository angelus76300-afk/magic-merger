import { FilterBar, applyFilters } from "./filters";
import { elementKey } from "../shared/elements";
import type { GameElement } from "../shared/types";
import * as api from "./api";
import { timeline } from "./timeline";
import { openCard } from "./card";
import type { BoardChip, Store } from "./store";
import { toast } from "./toast";

const DRAG_THRESHOLD = 6;

interface Point {
  x: number;
  y: number;
}

export function chipElement(element: GameElement, tag: "div" | "button" = "div"): HTMLElement {
  const node = document.createElement(tag);
  node.className = `chip chip-${element.kind}`;
  if (element.tier) {
    node.dataset.tier = element.tier;
    node.title = `${element.tier[0].toUpperCase()}${element.tier.slice(1)}`;
  }
  const emoji = document.createElement("span");
  emoji.className = "chip-emoji";
  emoji.textContent = element.emoji;
  const name = document.createElement("span");
  name.className = "chip-name";
  name.textContent = element.name;
  node.append(emoji, name);
  if (element.tier) {
    // A small dot of the tier's color: how much power the item carries.
    const dot = document.createElement("span");
    dot.className = "chip-tier";
    dot.setAttribute("aria-hidden", "true");
    node.append(dot);
  }
  return node;
}

// The Craft tab: a board where chips are dropped onto each other, and the
// inventory of everything discovered so far.
export class Craft {
  private nodes = new Map<number, HTMLElement>();
  // Chips waiting for a merge answer cannot be touched.
  private busy = new Set<number>();
  private hovered: HTMLElement | null = null;
  private tappedChip: number | null = null;
  // Called when this player finds something they did not have yet.
  // writing: the Worker started its program at the merge (4.2).
  onNewElement: (key: string, writing: boolean) => void = () => {};

  private filters = new FilterBar(
    "mm-craft-filters",
    { kind: "all", tier: "any", sort: "oldest", query: "" },
    { search: false, sorts: ["oldest", "newest", "name", "power"] },
    () => this.renderInventory(),
  );

  constructor(
    private store: Store,
    private board: HTMLElement,
    private inventory: HTMLElement,
    private list: HTMLElement,
    private search: HTMLInputElement,
    private count: HTMLElement,
    filterSlot: HTMLElement,
  ) {
    filterSlot.append(this.filters.el);
  }

  init(): void {
    for (const chip of this.store.board()) {
      if (this.store.get(chip.key)) this.mountChip(chip);
      else this.store.removeChip(chip.id);
    }
    this.renderInventory();
    this.search.addEventListener("input", () => this.renderInventory());
    window.addEventListener("resize", () => this.clampAll());
  }

  // Something was discovered elsewhere (a challenge's board, 3.7).
  refresh(): void {
    this.renderInventory();
  }

  clearBoard(): void {
    for (const [id, node] of this.nodes) {
      if (this.busy.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
      this.store.removeChip(id);
    }
  }

  // Inventory

  renderInventory(): void {
    const all = this.store.discoveries();
    const shown = applyFilters(
      all,
      { ...this.filters.state, query: this.search.value },
      () => 0,
      (d) => elementKey(d.element.name),
    );
    this.count.textContent = shown.length === all.length ? `${all.length} discovered` : `${shown.length} of ${all.length}`;

    const fragment = document.createDocumentFragment();
    for (const { element } of shown) {
      const item = chipElement(element, "button");
      item.classList.add("chip-inventory");
      item.title = `Add ${element.name} to the board`;
      this.wireInventoryItem(item, elementKey(element.name));
      fragment.append(item);
    }
    this.list.replaceChildren(fragment);
  }

  private wireInventoryItem(item: HTMLElement, key: string): void {
    let suppressClick = false;
    // A tap or click drops the item in the middle of the board. On touch that is
    // the only way, so the list keeps scrolling naturally.
    item.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      this.spawnNearCenter(key);
    });
    // With a mouse the item can also be dragged straight onto the board.
    item.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const start = { x: e.clientX, y: e.clientY };
      let spawned: { chip: BoardChip; node: HTMLElement; offset: Point } | null = null;
      this.track(
        e.pointerId,
        (ev) => {
          if (!spawned && distance(start, ev) > DRAG_THRESHOLD) {
            const chip = this.store.addChip(key, 0, 0);
            const node = this.mountChip(chip);
            const offset = { x: node.offsetWidth / 2, y: node.offsetHeight / 2 };
            spawned = { chip, node, offset };
            node.classList.add("dragging");
          }
          if (spawned) this.dragTo(spawned.chip, spawned.node, ev, spawned.offset);
        },
        (ev) => {
          if (!spawned) return;
          suppressClick = true;
          this.drop(spawned.chip, spawned.node, ev);
        },
      );
    });
  }

  // Board

  private mountChip(chip: BoardChip): HTMLElement {
    const discovery = this.store.get(chip.key)!;
    const node = chipElement(discovery.element);
    node.classList.add("chip-board");
    node.addEventListener("pointerdown", (e) => this.pressChip(chip, node, e));
    // The card opens on click, not on pointerup: opened earlier, the click that
    // follows a tap would land on the dialog backdrop and close it at once.
    node.addEventListener("click", () => {
      if (this.tappedChip !== chip.id) return;
      this.tappedChip = null;
      openCard(this.store, chip.key);
    });
    this.board.append(node);
    this.nodes.set(chip.id, node);
    this.place(node, chip.x, chip.y);
    return node;
  }

  private spawnNearCenter(key: string): void {
    const rect = this.board.getBoundingClientRect();
    const chip = this.store.addChip(key, 0, 0);
    const node = this.mountChip(chip);
    // The first free spot on a spiral from the center: two tapped items never
    // land on top of each other, so the one underneath can still be grabbed.
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const cx = rect.width / 2 - w / 2;
    const cy = rect.height / 2 - h / 2;
    const others = this.store
      .board()
      .filter((c) => c.id !== chip.id)
      .map((c) => ({ x: c.x, y: c.y, w: this.nodes.get(c.id)?.offsetWidth ?? w, h: this.nodes.get(c.id)?.offsetHeight ?? h }));
    const free = (x: number, y: number) => others.every((o) => x + w + 8 < o.x || o.x + o.w + 8 < x || y + h + 8 < o.y || o.y + o.h + 8 < y);
    let x = cx;
    let y = cy;
    for (let k = 0; k < 120; k++) {
      const a = k * 0.9;
      const r = 6 * k;
      const tx = cx + Math.cos(a) * r * 1.4;
      const ty = cy + Math.sin(a) * r * 0.8;
      if (tx < 0 || ty < 0 || tx + w > rect.width || ty + h > rect.height) continue;
      if (free(tx, ty)) {
        x = tx;
        y = ty;
        break;
      }
    }
    this.settle(chip, node, x, y);
    node.classList.add("pop");
  }

  private pressChip(chip: BoardChip, node: HTMLElement, e: PointerEvent): void {
    if (this.busy.has(chip.id) || e.button !== 0) return;
    e.preventDefault();
    const rect = node.getBoundingClientRect();
    const offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    this.track(
      e.pointerId,
      (ev) => {
        if (!dragging && distance(start, ev) > DRAG_THRESHOLD) {
          dragging = true;
          node.classList.add("dragging");
          this.board.append(node); // bring to front
        }
        if (dragging) this.dragTo(chip, node, ev, offset);
      },
      (ev) => {
        this.tappedChip = dragging ? null : chip.id;
        if (dragging) this.drop(chip, node, ev);
      },
    );
  }

  private dragTo(chip: BoardChip, node: HTMLElement, ev: PointerEvent, offset: Point): void {
    const rect = this.board.getBoundingClientRect();
    chip.x = ev.clientX - rect.left - offset.x;
    chip.y = ev.clientY - rect.top - offset.y;
    this.place(node, chip.x, chip.y);
    this.setHovered(this.chipAt(ev, chip.id)?.node ?? null);
  }

  private drop(chip: BoardChip, node: HTMLElement, ev: PointerEvent): void {
    node.classList.remove("dragging");
    this.setHovered(null);

    // Dropping back on the inventory, or off the board, throws the chip away.
    if (inside(this.inventory.getBoundingClientRect(), ev) || !inside(this.board.getBoundingClientRect(), ev)) {
      this.discard(chip.id);
      return;
    }
    const target = this.chipAt(ev, chip.id);
    if (target) {
      void this.merge(chip, target.chip);
      return;
    }
    this.settle(chip, node, chip.x, chip.y);
  }

  private async merge(dragged: BoardChip, target: BoardChip): Promise<void> {
    const a = this.store.get(dragged.key)!.element;
    const b = this.store.get(target.key)!.element;
    const draggedNode = this.nodes.get(dragged.id)!;
    const targetNode = this.nodes.get(target.id)!;

    this.busy.add(dragged.id).add(target.id);
    draggedNode.classList.add("merging");
    targetNode.classList.add("merging");
    this.place(draggedNode, target.x + 10, target.y + 10);

    try {
      const dropped = Date.now();
      const result = await api.merge(a.name, b.name);
      const newForMe = this.store.discover(result.element, [a.name, b.name]);
      if (newForMe) {
        const k = elementKey(result.element.name);
        timeline.start(k, result.element.name, dropped);
        timeline.describe(k, result.element.name, result.element.tier, result.element.kind);
        timeline.step(k, result.element.name, "merged");
        timeline.server(k, result.element.name, api.serverTiming(result));
      }
      this.discard(dragged.id, false);
      this.discard(target.id, false);
      const chip = this.store.addChip(elementKey(result.element.name), target.x, target.y);
      const node = this.mountChip(chip);
      this.settle(chip, node, target.x, target.y);
      node.classList.add("pop");

      const label = `${result.element.emoji} ${result.element.name}`;
      if (result.firstDiscovery) {
        toast(`First discovery: ${label}`, "special");
        // Let the chip pop first, then celebrate with its card.
        window.setTimeout(() => openCard(this.store, chip.key, true), 700);
      } else if (newForMe) toast(`New: ${label}`);
      if (newForMe) this.renderInventory();
      if (newForMe) this.onNewElement(chip.key, result.writing === true);
    } catch (err) {
      draggedNode.classList.remove("merging");
      targetNode.classList.remove("merging");
      this.settle(dragged, draggedNode, target.x + 40, target.y + 40);
      toast(err instanceof Error ? err.message : "The merge failed", "error");
    } finally {
      this.busy.delete(dragged.id);
      this.busy.delete(target.id);
    }
  }

  private discard(id: number, animate = true): void {
    const node = this.nodes.get(id);
    this.nodes.delete(id);
    this.store.removeChip(id);
    if (!node) return;
    if (!animate) {
      node.remove();
      return;
    }
    node.classList.add("vanish");
    node.addEventListener("animationend", () => node.remove(), { once: true });
  }

  private chipAt(p: PointerEvent, exceptId: number): { chip: BoardChip; node: HTMLElement } | null {
    // Last in the DOM is drawn on top, so search from the end.
    const chips = this.store.board();
    for (let i = chips.length - 1; i >= 0; i--) {
      const chip = chips[i];
      if (chip.id === exceptId || this.busy.has(chip.id)) continue;
      const node = this.nodes.get(chip.id);
      if (node && inside(node.getBoundingClientRect(), p)) return { chip, node };
    }
    return null;
  }

  private setHovered(node: HTMLElement | null): void {
    if (this.hovered === node) return;
    this.hovered?.classList.remove("target");
    node?.classList.add("target");
    this.hovered = node;
  }

  // Keeps the chip fully on the board and saves its position.
  private settle(chip: BoardChip, node: HTMLElement, x: number, y: number): void {
    const maxX = Math.max(0, this.board.clientWidth - node.offsetWidth);
    const maxY = Math.max(0, this.board.clientHeight - node.offsetHeight);
    const cx = Math.min(Math.max(0, x), maxX);
    const cy = Math.min(Math.max(0, y), maxY);
    this.place(node, cx, cy);
    this.store.moveChip(chip.id, cx, cy);
  }

  private clampAll(): void {
    for (const chip of this.store.board()) {
      const node = this.nodes.get(chip.id);
      if (node && !this.busy.has(chip.id)) this.settle(chip, node, chip.x, chip.y);
    }
  }

  private place(node: HTMLElement, x: number, y: number): void {
    node.style.transform = `translate(${x}px, ${y}px)`;
  }

  // Follows one pointer until it is released, wherever it goes on the page.
  private track(pointerId: number, onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void): void {
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointerId) onMove(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp(e);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
}

function distance(a: Point, e: PointerEvent): number {
  return Math.hypot(e.clientX - a.x, e.clientY - a.y);
}

function inside(rect: DOMRect, e: PointerEvent): boolean {
  return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
}
