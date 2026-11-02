import { elementKey } from "../shared/elements";
import { tierFromDepth, type Tier } from "../shared/tiers";
import * as api from "./api";
import { chipElement } from "./craft";
import type { FromWorld, ToWorld } from "./sim/protocol";
import { SCENARIO_LIST } from "./sim/scenario-list";
import type { CastRequest } from "./sim/runtime";
import type { SavedWorld } from "./sim/save";
import type { WorldSize } from "./sim/engine";
import type { Store } from "./store";
import { toast } from "./toast";

const WORLD_KEY = "magic-merger.world2";
const MUTE_KEY = "magic-merger.muted";
// A crashing spell is sent back to Claude at most this often per session.
const MAX_REPAIRS = 2;

export interface WorldElements {
  stage: HTMLElement;
  banner: HTMLElement;
  challenges: HTMLButtonElement;
  status: HTMLElement;
  list: HTMLElement;
  add: HTMLButtonElement;
  reset: HTMLButtonElement;
  size: HTMLSelectElement;
  sound: HTMLButtonElement;
}

// The World tab, seen from the game page. The world itself runs in a
// sandboxed iframe (world.html): this side keeps the spell bar, fetches spell
// programs from the Worker, repairs the ones that crash, and stores the save.
export class WorldHost {
  private frame: HTMLIFrameElement | null = null;
  private ready = false;
  private queue: ToWorld[] = [];
  private selected: string | null = null;
  private preparing = new Set<string>();
  private repairs = new Map<string, number>();
  private muted = readFlag(MUTE_KEY);
  // Mock programs are never saved, but are kept for the session.
  private sessionPrograms = new Map<string, CastRequest>();
  // The challenge being played, if any.
  private challenge: string | null = null;
  private challengeDialog: HTMLDialogElement | null = null;

  constructor(
    private store: Store,
    private el: WorldElements,
  ) {}

  init(): void {
    window.addEventListener("message", (e) => this.onMessage(e));
    this.el.add.addEventListener("click", () => {
      this.send({ type: "villager" });
      toast("A villager wanders in");
    });
    this.el.reset.addEventListener("click", () => {
      if (this.challenge) this.send({ type: "reset", size: this.el.size.value as WorldSize });
      else if (window.confirm("Reset the world? Everything in it will be lost.")) this.send({ type: "reset", size: this.el.size.value as WorldSize });
    });
    this.el.challenges.addEventListener("click", () => this.openChallenges());
    this.el.banner.querySelector(".world-banner-retry")!.addEventListener("click", () => {
      if (this.challenge) this.startChallenge(this.challenge);
    });
    this.el.banner.querySelector(".world-banner-leave")!.addEventListener("click", () => this.leaveChallenge());
    const showSound = () => {
      this.el.sound.textContent = this.muted ? "Sound off" : "Sound on";
      this.el.sound.setAttribute("aria-pressed", String(!this.muted));
    };
    this.el.sound.addEventListener("click", () => {
      this.muted = !this.muted;
      writeFlag(MUTE_KEY, this.muted);
      this.send({ type: "mute", muted: this.muted });
      showSound();
    });
    showSound();
  }

  show(): void {
    if (!this.frame) {
      this.frame = document.createElement("iframe");
      this.frame.className = "world-frame";
      this.frame.title = "The world";
      // Scripts only: no same origin (so no access to this page or its storage),
      // no forms, no popups. The page's CSP also blocks all network access.
      this.frame.setAttribute("sandbox", "allow-scripts");
      this.frame.src = import.meta.env.DEV ? "/world.html" : "/world";
      this.el.stage.prepend(this.frame);
    }
    this.send({ type: "visible", visible: true });
    this.renderSpells();
  }

  hide(): void {
    this.send({ type: "visible", visible: false });
  }

  selectSpell(key: string): void {
    this.selected = key;
    this.renderSpells();
    void this.prepare(key).then((req) => {
      if (req && this.selected === key) this.send({ type: "select", spell: req });
    });
  }

  // Asks the Worker for the spell program, once. Admins can force a new one.
  // A quiet prepare runs in the background and keeps its errors to itself.
  async prepare(key: string, regenerate = false, quiet = false): Promise<CastRequest | null> {
    if (!regenerate) {
      const known = this.request(key);
      if (known) return known;
    }
    const discovery = this.store.get(key);
    if (!discovery || this.preparing.has(key)) return null;
    this.preparing.add(key);
    this.updateStatus();
    try {
      const res = await api.spell(discovery.element.name, regenerate);
      if (res.mock) this.sessionPrograms.set(key, { key, name: res.name, tier: res.tier, code: res.program.code });
      else {
        this.store.setSpell(key, res.program);
        if (discovery.element.tier !== res.tier) this.store.discover({ ...discovery.element, tier: res.tier }, discovery.recipe ?? ["", ""]);
      }
      const req = this.request(key);
      if (req && regenerate) this.send({ type: "spell-updated", spell: req });
      return req;
    } catch (err) {
      if (!quiet) toast(err instanceof Error ? err.message : "The spell could not be prepared", "error");
      return null;
    } finally {
      this.preparing.delete(key);
      this.updateStatus();
    }
  }

  private request(key: string): CastRequest | null {
    const mock = this.sessionPrograms.get(key);
    if (mock) return mock;
    const program = this.store.spell(key);
    const discovery = this.store.get(key);
    if (!program || !discovery) return null;
    return { key, name: discovery.element.name, tier: tierOf(discovery.element.tier, discovery.element.depth), code: program.code };
  }

  private send(msg: ToWorld): void {
    if (!this.frame?.contentWindow || !this.ready) {
      if (msg.type !== "visible") this.queue.push(msg);
      return;
    }
    // The iframe has no origin, so "*" is the only target that reaches it. Only
    // public data goes this way: spell code, the world save, button presses.
    this.frame.contentWindow.postMessage(msg, "*");
  }

  private onMessage(e: MessageEvent<FromWorld>): void {
    if (!this.frame || e.source !== this.frame.contentWindow || !e.data || typeof e.data !== "object") return;
    const msg = e.data;
    switch (msg.type) {
      case "ready": {
        this.ready = true;
        const save = readSave();
        this.frame.contentWindow!.postMessage(
          {
            type: "init",
            save,
            size: window.innerWidth < 600 ? "small" : "medium",
            rules: save ? this.rulesFor(save) : [],
            muted: this.muted,
          } satisfies ToWorld,
          "*",
        );
        for (const queued of this.queue.splice(0)) this.send(queued);
        if (this.selected) {
          const req = this.request(this.selected);
          if (req) this.send({ type: "select", spell: req });
        }
        break;
      }
      case "save":
        try {
          localStorage.setItem(WORLD_KEY, JSON.stringify(msg.data));
        } catch {
          // Storage full: the world lives on until the page closes.
        }
        break;
      case "tap-without-spell":
        toast(this.selected ? "Still preparing this spell…" : "Pick a spell below first");
        break;
      case "cast":
        break;
      case "error":
        void this.repair(msg.key, msg.name, msg.message);
        break;
      case "objective":
        this.showObjective(msg.id, msg.text, msg.status);
        break;
    }
  }

  private openChallenges(): void {
    if (!this.challengeDialog) {
      const d = document.createElement("dialog");
      d.className = "challenges";
      d.addEventListener("click", (e) => {
        if (e.target === d) d.close();
      });
      document.body.append(d);
      this.challengeDialog = d;
    }
    const d = this.challengeDialog;
    d.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Challenges";
    const intro = document.createElement("p");
    intro.textContent = "Each challenge is an island with a problem. Find the spells that solve it. Your own island waits for you.";
    const list = document.createElement("div");
    list.className = "challenge-list";
    for (const info of SCENARIO_LIST) {
      const item = document.createElement("div");
      item.className = "challenge";
      const h = document.createElement("h3");
      h.textContent = info.title;
      if (this.store.isSolved(info.id)) {
        const badge = document.createElement("span");
        badge.className = "solved";
        badge.textContent = "solved";
        h.append(badge);
      }
      const p = document.createElement("p");
      p.textContent = info.brief;
      const go = document.createElement("button");
      go.textContent = this.store.isSolved(info.id) ? "Play again" : "Play";
      go.addEventListener("click", () => {
        d.close();
        this.startChallenge(info.id);
      });
      item.append(h, p, go);
      list.append(item);
    }
    d.append(title, intro, list);
    d.showModal();
  }

  private startChallenge(id: string): void {
    const info = SCENARIO_LIST.find((s) => s.id === id);
    if (!info) return;
    this.challenge = id;
    this.send({ type: "scenario", id });
    this.showObjective(id, info.brief, "playing");
    this.el.reset.textContent = "Restart";
  }

  private leaveChallenge(): void {
    this.challenge = null;
    this.el.banner.hidden = true;
    this.el.reset.textContent = "Reset";
    this.send({ type: "sandbox" });
  }

  private showObjective(id: string, text: string, status: "playing" | "won" | "lost"): void {
    if (this.challenge !== id) return;
    const info = SCENARIO_LIST.find((s) => s.id === id);
    const b = this.el.banner;
    b.hidden = false;
    b.dataset.status = status;
    b.querySelector(".world-banner-title")!.textContent = info?.title ?? "";
    b.querySelector(".world-banner-text")!.textContent = text;
    b.querySelector(".world-banner-hint")!.textContent = status === "lost" && info ? `Ideas: ${info.hint}` : "";
    (b.querySelector(".world-banner-retry") as HTMLElement).hidden = status === "playing";
    if (status === "won") {
      const first = !this.store.isSolved(id);
      this.store.markSolved(id);
      toast(first ? `Challenge solved: ${info?.title}` : "Solved again!", "special");
    }
  }

  // The spells whose materials or creatures live in a saved world.
  private rulesFor(save: SavedWorld): CastRequest[] {
    const keys = new Set(Object.values(save.owners ?? {}));
    return [...keys].map((k) => this.request(k)).filter((r): r is CastRequest => r !== null);
  }

  // A spell crashed in the World: Claude gets the error and fixes the program.
  private async repair(key: string, name: string, error: string): Promise<void> {
    const done = this.repairs.get(key) ?? 0;
    if (done >= MAX_REPAIRS || this.sessionPrograms.has(key)) {
      toast(`${name} fizzled: ${error}`, "error");
      return;
    }
    this.repairs.set(key, done + 1);
    toast(`${name} fizzled. The grimoire is rewriting it…`);
    try {
      const res = await api.repairSpell(name, error);
      this.store.setSpell(key, res.program);
      const req = this.request(key);
      if (req) this.send({ type: "spell-updated", spell: req });
      toast(`${name} was mended, cast it again`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "The spell could not be mended", "error");
    }
  }

  renderSpells(): void {
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
    let text = "Pick a spell, then tap the island to cast it. Drag to turn, pinch to zoom, two fingers to pan.";
    if (key && name) {
      if (this.preparing.has(key)) text = `Preparing ${name}… the first cast of a spell takes a moment.`;
      else if (this.request(key)) text = `Tap the island to cast ${name}.`;
      else text = `${name} is not ready yet.`;
    }
    this.el.status.textContent = text;
  }
}

function tierOf(tier: Tier | undefined, depth: number): Tier {
  return tier ?? tierFromDepth(depth);
}

function readSave(): SavedWorld | null {
  try {
    const raw = localStorage.getItem(WORLD_KEY);
    return raw ? (JSON.parse(raw) as SavedWorld) : null;
  } catch {
    return null;
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
}
