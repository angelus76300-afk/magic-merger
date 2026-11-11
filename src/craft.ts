import { FilterBar, applyFilters } from "./filters";
import { CRAFT_VOICES, CraftSound } from "./craftsound";
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

// 4.8: the Craft view's own small sounds (craftsound.ts).
const sound = new CraftSound();

// Below this many items the Craft list folds its search and filters away on
// a narrow screen (2026-11-11).
const FEW_ITEMS = 20;

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
  // 4.5: told when a merge found a daily challenge first.
  onDaily: () => void = () => undefined;
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
    // Under 20 items, nothing to search: on a narrow screen the search and
    // the filters fold away (firstcast.css), unless one is in use.
    const plain = !this.search.value && this.filters.state.kind === "all" && this.filters.state.tier === "any";
    this.inventory.classList.toggle("inventory-few", all.length < FEW_ITEMS && plain);

    const fragment = document.createDocumentFragment();
    for (const { element } of shown) {
      const item = chipElement(element, "button");
      item.classList.add("chip-inventory");
      item.title = `Add ${element.name} to the board`;
      item.dataset.key = elementKey(element.name);
      this.wireInventoryItem(item, elementKey(element.name));
      fragment.append(item);
    }
    this.list.replaceChildren(fragment);
  }

  // A new item is scrolled into sight in the list (at 344 wide the list
  // shows three rows once there are 59 items, 2026-11-10).
  private showInList(key: string): void {
    const item = [...this.list.querySelectorAll<HTMLElement>(".chip-inventory")].find((el) => el.dataset.key === key);
    item?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
    const chip = this.store.addChip(key, 0, 0);
    const node = this.mountChip(chip);
    const spot = this.freeSpot(chip.id, node, this.board.clientWidth / 2 - node.offsetWidth / 2, this.board.clientHeight / 2 - node.offsetHeight / 2);
    this.settle(chip, node, spot.x, spot.y);
    node.classList.add("pop");
    sound.play("place", CRAFT_VOICES.place());
  }

  // The nearest free spot to (cx, cy), on rings growing 10 px at a time: two
  // items never land on top of each other, so the one underneath can still be
  // grabbed. Also for a merge's result, which is often wider than the two it
  // replaces (2026-11-07: after six merges, four pairs overlapped near the
  // centre). (cx, cy) itself when the board has no room left.
  private freeSpot(id: number, node: HTMLElement, cx: number, cy: number): Point {
    const width = this.board.clientWidth;
    const height = this.board.clientHeight;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const others = this.store
      .board()
      .filter((c) => c.id !== id)
      .map((c) => ({ x: c.x, y: c.y, w: this.nodes.get(c.id)?.offsetWidth ?? w, h: this.nodes.get(c.id)?.offsetHeight ?? h }));
    const fits = (x: number, y: number) =>
      x >= 0 &&
      y >= 0 &&
      x + w <= width &&
      y + h <= height &&
      others.every((o) => x + w + 8 < o.x || o.x + o.w + 8 < x || y + h + 8 < o.y || o.y + o.h + 8 < y);
    if (fits(cx, cy)) return { x: cx, y: cy };
    for (let r = 10; r < Math.max(width, height); r += 10) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / 20));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * Math.PI;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (fits(x, y)) return { x, y };
      }
    }
    return { x: cx, y: cy };
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
          sound.play("pickUp", CRAFT_VOICES.pickUp());
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
      sound.play("puff", CRAFT_VOICES.puff());
      this.discard(chip.id);
      return;
    }
    const target = this.chipAt(ev, chip.id);
    if (target) {
      void this.merge(chip, target.chip);
      return;
    }
    sound.play("place", CRAFT_VOICES.place());
    this.settle(chip, node, chip.x, chip.y);
  }

  private async merge(dragged: BoardChip, target: BoardChip): Promise<void> {
    const a = this.store.get(dragged.key)!.element;
    const b = this.store.get(target.key)!.element;
    const draggedNode = this.nodes.get(dragged.id)!;
    const targetNode = this.nodes.get(target.id)!;

    this.busy.add(dragged.id).add(target.id);
    // The drop answers at once; a slow answer gets a quiet swell (4.8).
    sound.play("clink", CRAFT_VOICES.clink());
    sound.startWait();
    draggedNode.classList.add("merging");
    targetNode.classList.add("merging");
    this.place(draggedNode, target.x + 10, target.y + 10);

    try {
      const dropped = Date.now();
      const result = await api.merge(a.name, b.name);
      const newForMe = this.store.discover(result.element, [a.name, b.name]);
      sound.stopWait();
      // What came back, heard: a First Discovery, something new by its tier,
      // a loop (one of the two again), or a known thing's own motif.
      const got = result.element.name.trim().toLowerCase();
      if (result.daily || result.firstDiscovery) sound.play("first", CRAFT_VOICES.first(result.element.tier ?? "minor"));
      else if (newForMe) sound.play("fresh", CRAFT_VOICES.fresh(result.element.tier ?? "minor"));
      else if (got === a.name.trim().toLowerCase() || got === b.name.trim().toLowerCase()) sound.play("loop", CRAFT_VOICES.loop());
      else sound.play("known", CRAFT_VOICES.known(result.element.name));
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
      const spot = this.freeSpot(chip.id, node, target.x, target.y);
      this.settle(chip, node, spot.x, spot.y);
      node.classList.add("pop");

      const label = `${result.element.emoji} ${result.element.name}`;
      if (result.daily) {
        // 4.5: a daily challenge, found first: the name goes on it in the Daily tab.
        toast(`You found the daily challenge first: ${label}`, "special");
        this.onDaily();
        window.setTimeout(() => openCard(this.store, chip.key, true), 700);
      } else if (result.firstDiscovery) {
        toast(`First discovery: ${label}`, "special");
        // Let the chip pop first, then celebrate with its card.
        window.setTimeout(() => openCard(this.store, chip.key, true), 700);
      } else if (newForMe) toast(`New: ${label}`);
      if (newForMe) {
        this.renderInventory();
        this.showInList(chip.key);
      }
      if (newForMe) this.onNewElement(chip.key, result.writing === true);
    } catch (err) {
      sound.stopWait();
      sound.play("refuse", CRAFT_VOICES.refuse());
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
