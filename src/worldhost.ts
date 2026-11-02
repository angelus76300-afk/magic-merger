import { elementKey } from "../shared/elements";
import type { SpellProgram } from "../shared/spellcode";
import { TIERS, tierFromDepth, type Tier } from "../shared/tiers";
import type { SpellResponse } from "../shared/types";
import { DOWN_REASONS, REASON_LABEL, type DownReason } from "../shared/votes";
import * as api from "./api";
import { Checker } from "./checker";
import { chipElement } from "./craft";
import { FilterBar, applyFilters, lastUsed, markUsed } from "./filters";
import { MAX_SAVE_CHARS, readFromWorld } from "./sim/protocol";
import type { ToWorld } from "./sim/protocol";
import { SCENARIO_LIST } from "./sim/scenario-list";
import type { CastRequest } from "./sim/runtime";
import type { SavedWorld } from "./sim/save";
import type { WorldSize } from "./sim/engine";
import type { Store } from "./store";
import { toast } from "./toast";

const WORLD_KEY = "magic-merger.world2";
const MUTE_KEY = "magic-merger.muted";
const HUD_KEY = "magic-merger.hud";
// A crashing spell is sent back to Claude at most this often per session.
const MAX_REPAIRS = 2;
// Programs up to this tier are written by the cheap model (see worker/index.ts),
// so they are written ahead of time, in the background, to skip the wait.
const AHEAD_UP_TO: Tier = "grand";
// How many of the newest items get written ahead when the World opens.
const AHEAD_RECENT = 10;

export interface WorldElements {
  stage: HTMLElement;
  banner: HTMLElement;
  challenges: HTMLButtonElement;
  status: HTMLElement;
  list: HTMLElement;
  bar: HTMLElement;
  tools: HTMLElement;
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
  private hud = readFlag(HUD_KEY);
  private lastPerf = 0;
  // Mock programs are never saved, but are kept for the session.
  private sessionPrograms = new Map<string, CastRequest>();
  // The challenge being played, if any.
  private challenge: string | null = null;
  private challengeDialog: HTMLDialogElement | null = null;
  private filters = new FilterBar(
    "mm-world-filters",
    { kind: "all", tier: "any", sort: "used", query: "" },
    { search: true, sorts: ["used", "newest", "name", "power"] },
    () => this.renderSpells(),
  );
  private expanded = readFlag(EXPAND_KEY);
  private checker = new Checker();
  private testing = new Set<string>();
  private voteBar: HTMLElement | null = null;
  private voteTimer = 0;
  private asked = new Set<number>();
  private synced = false;

  constructor(
    private store: Store,
    private el: WorldElements,
  ) {}

  init(): void {
    window.addEventListener("message", (e) => this.onMessage(e));
    // The spell bar: filters, and a button that opens it into a grid.
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "spellbar-expand";
    const showExpand = () => {
      this.el.bar.classList.toggle("expanded", this.expanded);
      expand.textContent = this.expanded ? "Row" : "Grid";
      expand.setAttribute("aria-expanded", String(this.expanded));
      expand.title = this.expanded ? "Show one row" : "Show every spell";
    };
    expand.addEventListener("click", () => {
      this.expanded = !this.expanded;
      writeFlag(EXPAND_KEY, this.expanded);
      showExpand();
    });
    this.el.tools.append(this.filters.el, expand);
    showExpand();
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
      // Spell code could send the frame to another page; any second load
      // replaces the frame with a fresh one.
      let loads = 0;
      const frame = this.frame;
      frame.addEventListener("load", () => {
        if (++loads > 1 && this.frame === frame) this.replaceFrame();
      });
      this.el.stage.prepend(this.frame);
    }
    this.send({ type: "visible", visible: true });
    this.renderSpells();
    // Newest first, one at a time: the bar fills with ready spells.
    const recent = this.store
      .discoveries()
      .sort((a, b) => b.discoveredAt - a.discoveredAt)
      .slice(0, AHEAD_RECENT);
    for (const d of recent) this.ahead(elementKey(d.element.name));
    if (!this.synced) {
      this.synced = true;
      void this.syncPrograms();
    }
  }

  // Programs change on the server (votes, rewrites, rollbacks, the Batch
  // API): once per page load, the ones this browser holds are compared with
  // the ones it should have, and the others are fetched again in the background.
  private async syncPrograms(): Promise<void> {
    const held = this.store.discoveries().filter((d) => this.store.spell(elementKey(d.element.name)));
    if (!held.length) return;
    let live;
    try {
      live = await api.livePrograms(held.map((d) => d.element.name));
    } catch {
      return;
    }
    for (const d of held) {
      const key = elementKey(d.element.name);
      const now = live.programs[d.element.name];
      if (now && now.id !== this.store.spell(key)?.id) await this.prepare(key, false, true, true);
    }
    this.renderSpells();
    // Live programs written before their element had a promise, tested on it
    // now (3.6): one that breaks it is written again, and goes through its
    // own test run here before it replaces the old one.
    for (const d of held) {
      const key = elementKey(d.element.name);
      const now = live.programs[d.element.name];
      const program = this.store.spell(key);
      const tier = d.element.tier;
      if (!now?.recheck?.length || !program || program.id !== now.id || !tier) continue;
      try {
        const result = await this.checker.check({ key, name: d.element.name, tier, code: program.code, intents: now.recheck });
        let res = await api.checkSpell({ name: d.element.name, id: now.id, ...result, recheck: true });
        if (res.program.trial) {
          res = await this.settle(key, res, true);
          this.store.setSpell(key, withoutTrial(res.program));
          const req = this.request(key);
          if (req) this.send({ type: "spell-updated", spell: req });
        }
      } catch {
        // Tried again on the next visit.
      }
    }
    this.renderSpells();
  }

  // Writes a program in the background if it is cheap and not written yet.
  // Each program is written once for everyone, so this costs about $0.002
  // per item, once.
  ahead(key: string): void {
    const element = this.store.get(key)?.element;
    if (!element || !element.tier || this.request(key)) return;
    if (TIERS.indexOf(element.tier) > TIERS.indexOf(AHEAD_UP_TO)) return;
    if (this.aheadQueue.includes(key)) return;
    this.aheadQueue.push(key);
    if (!this.aheadRunning) void this.runAhead();
  }

  private aheadQueue: string[] = [];
  private aheadRunning = false;

  private async runAhead(): Promise<void> {
    this.aheadRunning = true;
    while (this.aheadQueue.length) {
      const key = this.aheadQueue.shift()!;
      if (!this.request(key)) await this.prepare(key, false, true);
      this.renderSpells();
    }
    this.aheadRunning = false;
  }

  private replaceFrame(): void {
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
    this.show();
  }

  deselect(): void {
    this.selected = null;
    this.send({ type: "select", spell: null });
    this.renderSpells();
    toast("Tap a creature to see what it is doing");
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
  prepare(key: string, regenerate = false, quiet = false, refresh = false): Promise<CastRequest | null> {
    if (!regenerate && !refresh) {
      const known = this.request(key);
      if (known) return Promise.resolve(known);
    }
    // A request already on its way (often the background one) is shared, so
    // picking a spell while it is being written still selects it when ready.
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.fetchProgram(key, regenerate, quiet).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private inflight = new Map<string, Promise<CastRequest | null>>();

  private async fetchProgram(key: string, regenerate: boolean, quiet: boolean): Promise<CastRequest | null> {
    const discovery = this.store.get(key);
    if (!discovery) return null;
    this.preparing.add(key);
    this.updateStatus();
    try {
      let res = await api.spell(discovery.element.name, regenerate);
      if (res.mock) this.sessionPrograms.set(key, { key, name: res.name, tier: res.tier, code: res.program.code });
      else {
        res = await this.settle(key, res, quiet);
        this.store.setSpell(key, withoutTrial(res.program));
        if (discovery.element.tier !== res.tier) this.store.discover({ ...discovery.element, tier: res.tier }, discovery.recipe ?? ["", ""]);
      }
      const req = this.request(key);
      // The World keeps the program it was handed: a rewrite, a rollback or a
      // refresh must reach it, or a cast would run old code under a new id.
      if (req) this.send({ type: "spell-updated", spell: req });
      return req;
    } catch (err) {
      if (!quiet) toast(err instanceof Error ? err.message : "The spell could not be prepared", "error");
      return null;
    } finally {
      this.preparing.delete(key);
      this.updateStatus();
    }
  }

  // A program fresh from Claude is a trial: it gets its test run here, in the
  // check frame, before anyone casts it. The Worker answers with the program
  // to use: this one, now live, or a rewrite (once) that is tested in turn.
  private async settle(key: string, res: SpellResponse, quiet = false): Promise<SpellResponse> {
    this.testing.add(key);
    this.updateStatus();
    try {
      for (let round = 0; round < 3 && res.program.trial && res.program.id; round++) {
        const result = await this.checker.check({ key, name: res.name, tier: res.tier, code: res.program.code, intents: res.program.intents });
        const id = res.program.id;
        res = await api.checkSpell({ name: res.name, id, ...result });
        if (res.program.id !== id && round === 0 && !result.ok && !quiet)
          toast(`${res.name} failed its test run (${result.problem}); the grimoire wrote it again`);
      }
    } catch {
      // The Worker could not be told: the program is cast as it is.
    } finally {
      this.testing.delete(key);
      this.updateStatus();
    }
    return res;
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

  private onMessage(e: MessageEvent<unknown>): void {
    // The sandboxed frame has an opaque origin, which reads as "null".
    if (!this.frame || e.source !== this.frame.contentWindow || e.origin !== "null") return;
    const msg = readFromWorld(e.data);
    if (!msg) return;
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
        if (this.hud) this.send({ type: "hud", on: true });
        if (this.selected) {
          const req = this.request(this.selected);
          if (req) this.send({ type: "select", spell: req });
        }
        break;
      }
      case "save":
        try {
          const json = JSON.stringify(msg.data);
          // A save that would crowd out the player's discoveries is dropped.
          if (json.length > MAX_SAVE_CHARS) break;
          localStorage.setItem(WORLD_KEY, json);
        } catch {
          // Storage full: the world lives on until the page closes.
        }
        break;
      case "tap-without-spell":
        toast(this.selected ? "Still preparing this spell…" : "Pick a spell below, or tap a creature to see what it is doing");
        break;
      case "cast":
        if (!this.store.get(msg.key)) break;
        markUsed(msg.key);
        void this.afterCast(msg.key);
        // In a grid the bar covers the island: fold it once a spell is used.
        if (this.expanded && window.innerWidth < 700) {
          this.expanded = false;
          this.el.bar.classList.remove("expanded");
          (this.el.tools.querySelector(".spellbar-expand") as HTMLButtonElement).textContent = "Grid";
        }
        break;
      case "error":
        if (this.store.get(msg.key)) void this.repair(msg.key, msg.name, msg.message);
        break;
      case "perf": {
        // Spell code runs in the frame too, so it could send these: only
        // forwarded while the HUD is on, and at most every 20 seconds.
        const now = Date.now();
        if (!this.hud || now - this.lastPerf < 20_000) break;
        this.lastPerf = now;
        api.sendPerf({ ...msg.sample, screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`, cores: navigator.hardwareConcurrency ?? 0 });
        break;
      }
      case "objective":
        // Only the challenge this page started can report on itself.
        if (msg.id === this.challenge) this.showObjective(msg.id, msg.text, msg.status);
        break;
    }
  }

  // The frame HUD, toggled by a long press on the title. Remembered per browser.
  toggleHud(): boolean {
    this.hud = !this.hud;
    writeFlag(HUD_KEY, this.hud);
    this.send({ type: "hud", on: this.hud });
    return this.hud;
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
      const res = await this.settle(key, await api.repairSpell(name, error));
      this.store.setSpell(key, withoutTrial(res.program));
      const req = this.request(key);
      if (req) this.send({ type: "spell-updated", spell: req });
      toast(`${name} was mended, cast it again`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "The spell could not be mended", "error");
    }
  }

  // The cast is recorded with the version that was cast; if this player may
  // vote on it, the question comes once the spell has had time to play out.
  private async afterCast(key: string): Promise<void> {
    const program = this.store.spell(key);
    const name = this.store.get(key)?.element.name;
    if (!program?.id || !name || this.sessionPrograms.has(key)) return;
    let canVote = false;
    try {
      canVote = (await api.recordCast(name, program.id)).canVote;
    } catch {
      return;
    }
    // Asked once per version per visit: a spell cast ten times is not voted ten times.
    if (!canVote || this.asked.has(program.id)) return;
    this.asked.add(program.id);
    clearTimeout(this.voteTimer);
    this.voteTimer = window.setTimeout(() => this.askVote(name, program.id!), 6000);
  }

  private askVote(name: string, id: number): void {
    const bar = (this.voteBar ??= document.createElement("div"));
    bar.className = "vote";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", `Vote on ${name}`);
    const close = () => {
      bar.remove();
      clearTimeout(this.voteTimer);
    };
    const send = async (up: boolean, reason?: DownReason) => {
      close();
      try {
        await api.vote({ name, id, up, reason });
        toast(up ? `Noted: ${name} works` : `Noted: ${name} will get better`);
      } catch (err) {
        toast(err instanceof Error ? err.message : "The vote did not go through", "error");
      }
    };
    const button = (label: string, cls: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    };
    const text = document.createElement("span");
    text.className = "vote-text";
    text.textContent = `How was ${name}?`;
    const dismiss = button("×", "vote-close", close);
    dismiss.setAttribute("aria-label", "Not now");
    const showReasons = () => {
      text.textContent = "What was wrong?";
      bar.replaceChildren(text, ...DOWN_REASONS.map((r) => button(REASON_LABEL[r], "vote-reason", () => void send(false, r))), dismiss);
    };
    bar.replaceChildren(
      text,
      button("Good", "vote-up", () => void send(true)),
      button("Not good", "vote-down", showReasons),
      dismiss,
    );
    if (!bar.isConnected) this.el.stage.append(bar);
    // Unanswered, it goes away; the next cast asks again.
    this.voteTimer = window.setTimeout(close, 30_000);
  }

  renderSpells(): void {
    const all = this.store.discoveries();
    const shown = applyFilters(all, this.filters.state, lastUsed, (d) => elementKey(d.element.name));
    const fragment = document.createDocumentFragment();
    for (const { element } of shown) {
      const key = elementKey(element.name);
      const chip = chipElement(element, "button");
      chip.classList.add("chip-castable");
      chip.setAttribute("aria-pressed", String(key === this.selected));
      // Dimmed until its program is written.
      chip.dataset.ready = this.request(key) ? "1" : "0";
      // A second tap puts the spell away, so a tap on the island inspects a creature (3.6).
      chip.addEventListener("click", () => (key === this.selected ? this.deselect() : this.selectSpell(key)));
      fragment.append(chip);
    }
    if (!shown.length) {
      const empty = document.createElement("button");
      empty.type = "button";
      empty.className = "spell-empty";
      empty.textContent = all.length ? "Nothing matches. Clear the filters" : "Discover spells in Craft first";
      if (all.length) empty.addEventListener("click", () => this.filters.reset());
      fragment.append(empty);
    }
    this.el.list.replaceChildren(fragment);
    this.updateStatus();
  }

  private updateStatus(): void {
    const key = this.selected;
    const name = key ? this.store.get(key)?.element.name : null;
    let text = "Pick a spell, then tap the island to cast it, or tap a creature to see what it wants. Drag to turn, pinch to zoom, two fingers to pan.";
    if (key && name) {
      if (this.testing.has(key)) text = `Testing ${name} on a practice island…`;
      else if (this.preparing.has(key)) text = `Preparing ${name}… the first cast of a spell takes a moment.`;
      else if (this.request(key))
        text = `Tap the island to ${this.store.get(key)?.element.kind === "artifact" ? "place" : "cast"} ${name}. Tap it again to put it away and look at creatures.`;
      else text = `${name} is not ready yet.`;
    }
    this.el.status.textContent = text;
  }
}

const EXPAND_KEY = "mm-spellbar-expanded";

// What the browser keeps: the trial flag is only for the test run.
function withoutTrial(program: SpellProgram): SpellProgram {
  const { trial: _trial, ...rest } = program;
  return rest;
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
