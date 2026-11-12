import { addDeed, countTrouble, setTroublesOn, troubleCounts, troublesOn } from "./troubles";
import type { ChronicleDigest } from "../shared/chronicle";
import { elementKey } from "../shared/elements";
import { castRequest } from "./cast-request";
import type { SpellProgram } from "../shared/spellcode";
import { TIERS, type Tier } from "../shared/tiers";
import type { CheckRequest, SpellResponse } from "../shared/types";
import { MAX_REASONS, reasonLabel, reasonsFor, type DownReason } from "../shared/votes";
import { formOf, type Form } from "../shared/forms";
import * as api from "./api";
import { timeline } from "./timeline";
import { Checker } from "./checker";
import { reportable } from "./checkresult";
import { chipElement } from "./craft";
import { FilterBar, applyFilters, lastUsed, markUsed } from "./filters";
import { HOT_SLOTS, MAX_SAVE_CHARS, keepOrder, readFromWorld, type HotSlot } from "./sim/protocol";
import { programToFetch } from "../shared/sync";
import type { ToWorld } from "./sim/protocol";
import { SCENARIO_LIST } from "./sim/scenario-list";
import type { CastRequest } from "./sim/runtime";
import type { SavedWorld } from "./sim/save";
import { WORLD_SIZES, type WorldSize } from "./sim/sizes";
import type { Store } from "./store";
import { setToastFloor, toast } from "./toast";
import { FirstCastGuide, FirstCastProbe } from "./firstcast";
import { isQuotaError, warnStorageFull } from "./quota";
import { WORLD_AT_KEY, WORLD_KEY, packIsland, readIslandText } from "./island-store";
import { isFrozen } from "./device-save";
import { BIG_SIZES, readHeadroom, sizesOffered, writeHeadroom } from "./headroom";
import { DEFAULT_LAND, MIXED_FROM, readChoice as readLandChoice, type LandChoice } from "./sim/land-options";
import { newerSave } from "./sim/save-guard";

export { WORLD_AT_KEY, WORLD_KEY } from "./island-store";
const MUTE_KEY = "magic-merger.muted";
const HUD_KEY = "magic-merger.hud";
// A World frame that has said nothing for this long while on screen is stuck
// in spell code (4.0 review M3): it is replaced by a fresh one from the save.
const WATCHDOG_MS = 20_000;
// A crashing spell is sent back to Claude at most this often per session.
const MAX_REPAIRS = 2;
// Programs up to this tier are written by the cheap model (see worker/index.ts),
// so this page asks for them ahead of time, in the background, to skip the
// wait. Since 4.2 the Worker writes every new item at the merge itself
// (worker/ahead.ts); this page then asks for any tier it was told is being
// written, and asks for the cheap ones it was not told about, as before.
const AHEAD_UP_TO: Tier = "grand";
// How many of the newest items get written ahead when the World opens.
const AHEAD_RECENT = 10;
// 4.2: programs asked for side by side (one at a time before: twelve new
// items took minutes to be ready, each waiting for the last one's test run).
const AHEAD_PARALLEL = 3;
// A program still being written by the Worker is asked for again after this
// long, for this long at most.
const WRITING_RETRY_MS = 4000;
const WRITING_GIVE_UP_MS = 45 * 60_000;

export interface WorldElements {
  stage: HTMLElement;
  banner: HTMLElement;
  challenges: HTMLButtonElement;
  chronicle: HTMLButtonElement;
  status: HTMLElement;
  list: HTMLElement;
  bar: HTMLElement;
  tools: HTMLElement;
  add: HTMLButtonElement;
  reset: HTMLButtonElement;
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
  // Seconds the challenge's hazard ran while the player merged (3.7): kept
  // for Retry and Restart, so losing on purpose does not buy a calm start.
  private headStart = 0;
  private filters = new FilterBar(
    "mm-world-filters",
    { kind: "all", tier: "any", sort: "used", query: "" },
    { search: true, sorts: ["used", "newest", "name", "power"] },
    () => this.renderSpells(),
  );
  private expanded = readFlag(EXPAND_KEY);
  private checker = new Checker();
  private firstCast = new FirstCastProbe();
  // What waits for the first cast to land: the hint, the week's news (2026-11-11).
  private guide = new FirstCastGuide();
  private testing = new Set<string>();
  // 4.2: programs the Worker said it is writing, since when.
  private writing = new Map<string, number>();
  // Items that went through writing or testing here: their being ready is news.
  private news = new Set<string>();
  private readyToast: string[] = [];
  private readyTimer = 0;
  private voteBar: HTMLElement | null = null;
  // The question waiting for its six seconds, and the bar's own clock: two
  // timers, so answering one item never cancels the next one's question.
  private voteTimer = 0;
  private voteClose = 0;
  // A question that came while the player was picking reasons: asked once
  // the bar closes, never over their picks.
  private voteWaiting: (() => void) | null = null;
  private voteKeys: ((e: KeyboardEvent) => void) | null = null;
  private asked = new Set<number>();
  private synced = false;
  // The World tab is on screen (show() until hide()).
  private shown = false;
  // 4.4.5 part C: wonders that came to the pool this week, and when the pool was last asked for.
  private week: api.PoolWonder[] = [];
  private poolAt = 0;
  // When the frame last said anything (M3).
  private heard = 0;
  // The island is written by one tab at a time (4.0 review M6): the tab that
  // last showed the World while visible owns it and tells the others.
  private island = islandChannel();
  private owner = true;
  // The save this tab last loaded or wrote (its WORLD_AT_KEY): another tab's
  // newer save is never overwritten by this one's older island.
  private islandAt: string | null = null;
  // The stored island was saved by newer code than this page (a Deploy
  // rollback, a tab left open since before an update): it is not loaded,
  // and this page writes nothing over it (save-guard.ts).
  private newerIsland: string | null = null;
  // Through its eyes (2026-11-12): the island shows a creature's view and the
  // page's header, spell drawer and tools are hidden (body.eyes); the hot bar
  // last sent, so it goes again only when it changes.
  private eyes = false;
  // The player is a creature on the island: a spell is cast from it, within its reach.
  private riding = false;
  // The hot bar's order, fixed when the player becomes a creature: last used
  // first then, and the same until Let go, so a cast never moves the slot
  // under the thumb (the playtest of 12 November). New items go at its end.
  private hotOrder: string[] | null = null;
  private hotSent = "";

  constructor(
    private store: Store,
    private el: WorldElements,
  ) {}

  init(): void {
    window.addEventListener("message", (e) => this.onMessage(e));
    // Another tab shows the World now: this one stops saving its island.
    this.island?.addEventListener("message", (e: MessageEvent<unknown>) => {
      if (!e.data || (e.data as { claim?: unknown }).claim === undefined) return;
      const was = this.owner;
      this.owner = false;
      if (was && this.shown && !document.hidden) toast("Your island is open in another tab: this one stops saving until you come back to it.");
    });
    // Leaving the page saves the island once; coming back takes it again,
    // from where another tab left it if one saved since.
    // The island watches its stories by itself when left alone (frame.ts): not behind a dialog of the page.
    let away = false;
    window.setInterval(() => {
      const now = !this.shown || !!document.querySelector("dialog[open]");
      if (now === away) return;
      away = now;
      this.send({ type: "away", away });
    }, 500);
    document.addEventListener("visibilitychange", () => {
      if (!this.shown) return;
      if (document.hidden) this.send({ type: "visible", visible: false });
      else {
        this.takeIsland();
        this.send({ type: "visible", visible: true });
      }
    });
    window.addEventListener("focus", () => {
      if (this.shown) this.takeIsland();
    });
    window.setInterval(() => this.watchdog(), 5000);
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
    this.showExpand = showExpand;
    this.makeGrip();
    this.el.add.addEventListener("click", () => {
      this.send({ type: "villager" });
      toast("A villager wanders in");
    });
    this.el.reset.addEventListener("click", () => {
      // Restarting a live challenge plays its head start again (4.0 review L6).
      if (this.challenge) this.startChallenge(this.challenge, this.headStart);
      else this.openReset();
    });
    this.el.challenges.addEventListener("click", () => this.onChallenges());
    this.el.chronicle.addEventListener("click", () => void this.openChronicle());
    this.el.banner.querySelector(".world-banner-retry")!.addEventListener("click", () => {
      if (this.challenge) this.startChallenge(this.challenge, this.headStart);
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
    this.shown = true;
    this.heard = Date.now();
    void this.refreshPool();
    // A newer island from another tab: the frame was replaced, and shown.
    if (this.takeIsland()) return;
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
      if (programToFetch(now, this.store.spell(key)?.id)) await this.prepare(key, false, true, true);
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
        const result = reportable(
          await this.checker.check({
            key,
            name: d.element.name,
            tier,
            code: program.code,
            intents: now.recheck,
            kind: d.element.kind,
          }),
        );
        // A recheck that did not finish says nothing; the next visit tries again.
        if (!result) continue;
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

  // Asks for a program in the background: one the Worker is writing (any
  // tier, 4.2), or a cheap one not written yet, which this asks the Worker to
  // write (each program is written once for everyone, about $0.002, once).
  ahead(key: string, writing = false): void {
    const element = this.store.get(key)?.element;
    if (!element || this.request(key)) return;
    if (writing) {
      if (!this.writing.has(key)) this.writing.set(key, Date.now());
      this.news.add(key);
    }
    const cheap = !!element.tier && TIERS.indexOf(element.tier) <= TIERS.indexOf(AHEAD_UP_TO);
    if (!this.writing.has(key) && !cheap) return;
    if (this.aheadQueue.includes(key) || this.inflight.has(key)) return;
    this.aheadQueue.push(key);
    this.refreshChips();
    this.runAhead();
  }

  private aheadQueue: string[] = [];
  private aheadRunning = 0;

  private runAhead(): void {
    while (this.aheadRunning < AHEAD_PARALLEL && this.aheadQueue.length) {
      const key = this.aheadQueue.shift()!;
      if (this.request(key)) continue;
      this.aheadRunning++;
      void this.prepare(key, false, true).finally(() => {
        this.aheadRunning--;
        this.refreshChips();
        this.runAhead();
      });
    }
  }

  private replaceFrame(): void {
    this.setEyes(false);
    this.riding = false;
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
    this.show();
  }

  // This tab shows the World: it owns the island from now on. If another tab
  // saved since this one loaded it, the frame starts again from that save
  // first, so this tab continues the other's island instead of erasing it.
  private takeIsland(): boolean {
    if (this.frame && this.ready && !this.challenge && readAt() !== this.islandAt) {
      toast("Your island continues from where another tab left it");
      this.replaceFrame();
      return true;
    }
    this.owner = true;
    this.island?.postMessage({ claim: Date.now() });
    return false;
  }

  // A frame stuck in spell code says nothing: no heartbeat, no save. Only
  // checked while the World is on screen, where the heartbeat runs at full
  // speed; a hidden tab's timers are slowed, so coming back restarts the count.
  private watchdog(): void {
    if (!this.frame || !this.ready || !this.shown || document.hidden) return;
    if (Date.now() - this.heard < WATCHDOG_MS) return;
    console.warn("The World said nothing for 20 s: starting it again from its last save");
    toast("The island froze and was started again from its last save", "error");
    this.replaceFrame();
  }

  deselect(): void {
    this.selected = null;
    this.send({ type: "select", spell: null });
    this.renderSpells();
    toast("Tap a creature to see what it is doing");
  }

  hide(): void {
    this.shown = false;
    // The page comes back whole when the World tab is left (the island leaves its eyes too).
    this.setEyes(false);
    setToastFloor("inspect", 0);
    this.guide.hideHint();
    this.send({ type: "visible", visible: false });
  }

  selectSpell(key: string): void {
    this.selected = key;
    // A spell not written yet takes the previous one out of the World's
    // hand at once: a tap meanwhile says to wait, it never casts the old one.
    if (!this.request(key)) this.send({ type: "select", spell: null });
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
    const name = discovery.element.name;
    timeline.describe(key, name, discovery.element.tier, discovery.element.kind);
    timeline.step(key, name, "asked");
    try {
      let res = await api.spell(discovery.element.name, regenerate);
      timeline.server(key, name, api.serverTiming(res));
      if (res.writing) {
        // Still being written by the Worker: asked again shortly, quietly.
        const since = this.writing.get(key) ?? Date.now();
        this.writing.set(key, since);
        this.news.add(key);
        if (Date.now() - since < WRITING_GIVE_UP_MS) window.setTimeout(() => this.ahead(key, true), res.retry ?? WRITING_RETRY_MS);
        else this.writing.delete(key);
        return null;
      }
      this.writing.delete(key);
      timeline.step(key, name, "arrived");
      if (res.program.trial) this.news.add(key);
      if (res.mock) this.sessionPrograms.set(key, { key, name: res.name, tier: res.tier, code: res.program.code });
      else {
        res = await this.settle(key, res, quiet);
        this.store.setSpell(key, withoutTrial(res.program));
        if (discovery.element.tier !== res.tier) this.store.discover({ ...discovery.element, tier: res.tier }, discovery.recipe ?? ["", ""]);
      }
      timeline.step(key, name, "ready");
      const req = this.request(key);
      if (req && this.news.delete(key)) this.sayReady(name);
      // The World keeps the program it was handed: a rewrite, a rollback or a
      // refresh must reach it, or a cast would run old code under a new id.
      if (req) this.send({ type: "spell-updated", spell: req });
      // Picked while it was still being written (asked again later, by
      // ahead()): it goes into the World's hand as soon as it is ready.
      if (req && this.selected === key) this.send({ type: "select", spell: req });
      return req;
    } catch (err) {
      this.writing.delete(key);
      if (!quiet) toast(err instanceof Error ? err.message : "The spell could not be prepared", "error");
      return null;
    } finally {
      this.preparing.delete(key);
      this.updateStatus();
    }
  }

  // "Fireball is ready", once for items that became ready together.
  private sayReady(name: string): void {
    this.readyToast.push(name);
    clearTimeout(this.readyTimer);
    this.readyTimer = window.setTimeout(() => {
      const names = this.readyToast.splice(0);
      const text =
        names.length === 1
          ? `${names[0]} is ready to cast`
          : names.length <= 3
            ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are ready to cast`
            : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more are ready to cast`;
      toast(text, "special");
    }, 1200);
  }

  // A program fresh from Claude is a trial: it gets its test run here, in the
  // check frame, before anyone casts it. The Worker answers with the program
  // to use: this one, now live, or a rewrite (once) that is tested in turn.
  private async settle(key: string, res: SpellResponse, quiet = false): Promise<SpellResponse> {
    this.testing.add(key);
    this.updateStatus();
    try {
      for (let round = 0; round < 3 && res.program.trial && res.program.id; round++) {
        const t0 = performance.now();
        const result = await this.checker.check({
          key,
          name: res.name,
          tier: res.tier,
          code: res.program.code,
          intents: res.program.intents,
          kind: this.store.get(key)?.element.kind,
          form: res.program.form,
          giant: res.program.giant,
        });
        const id = res.program.id;
        timeline.add(key, res.name, "test", performance.now() - t0);
        timeline.step(key, res.name, "tested");
        timeline.phases(key, res.name, result.phases);
        const verdict = reportable(result);
        if (result.ok) {
          // 4.2: a program that passed here is castable now; the Worker is told
          // in the background, and if it answers with another program (a
          // newer one, a rollback), that one replaces it. 4.5.1: a run that
          // timed out is cast here but not reported, so it stays a trial for
          // the next browser to test.
          if (verdict) void this.sendVerdict(key, res, verdict);
          return { ...res, program: { ...res.program, trial: false } };
        }
        if (!verdict) break;
        res = await api.checkSpell({ name: res.name, id, ...verdict });
        timeline.step(key, res.name, "verdict");
        timeline.server(key, res.name, api.serverTiming(res), "check-");
        if (res.program.id !== id && round === 0 && !result.ok && !quiet)
          toast(`${res.name} failed its test run (${result.problem}); the grimoire wrote it again`);
        // The same trial back (4.5.1): kept for a later rewrite, testing it again here changes nothing.
        if (res.program.trial && res.program.id === id) break;
      }
    } catch {
      // The Worker could not be told: the program is cast as it is.
    } finally {
      this.testing.delete(key);
      this.updateStatus();
    }
    return res;
  }

  private async sendVerdict(key: string, tested: SpellResponse, verdict: Omit<CheckRequest, "name" | "id">): Promise<void> {
    try {
      const res = await api.checkSpell({ name: tested.name, id: tested.program.id!, ...verdict });
      timeline.step(key, tested.name, "verdict");
      timeline.server(key, tested.name, api.serverTiming(res), "check-");
      if (res.program.id === tested.program.id || res.mock) return;
      const settled = res.program.trial ? await this.settle(key, res, true) : res;
      this.store.setSpell(key, withoutTrial(settled.program));
      const req = this.request(key);
      if (req) this.send({ type: "spell-updated", spell: req });
    } catch {
      // Told again by the next browser that tests it; this one casts what passed here.
    }
  }

  private request(key: string): CastRequest | null {
    const mock = this.sessionPrograms.get(key);
    if (mock) return mock;
    const program = this.store.spell(key);
    const discovery = this.store.get(key);
    if (!program || !discovery) return null;
    return castRequest(key, discovery.element, program);
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
    this.heard = Date.now();
    switch (msg.type) {
      case "alive":
        break;
      case "ready":
        void this.initFrame(this.frame);
        break;
      case "headroom":
        // The frame runs spell code, which could send this too: the worst a
        // spell can do is offer this player a bigger island they may decline.
        writeHeadroom(msg.sample);
        break;
      case "save":
        this.writeIsland(msg.data);
        break;
      case "escape":
        this.voteKeys?.(new KeyboardEvent("keydown", { key: "Escape" }));
        break;
      case "tap-without-spell":
        if (this.selected) {
          const name = this.store.get(this.selected)?.element.name ?? "This spell";
          toast(`Wait for the incantation to be ready: ${name} is still being made`);
        } else toast("Pick a spell below, or tap a creature to see what it is doing");
        break;
      case "cast":
        if (!this.store.get(msg.key)) break;
        timeline.step(msg.key, this.store.get(msg.key)!.element.name, "cast");
        this.castInAttempt.push(msg.key);
        markUsed(msg.key);
        if (this.eyes) this.sendHotbar();
        // In the eye view the island has its own buttons: no hint over them.
        if (!this.challenge && !this.eyes) {
          this.guide.again(this.el.stage);
          this.guide.cast(this.el.stage);
        }
        void this.afterCast(msg.key);
        // In a grid the bar covers the island: fold it once a spell is used,
        // unless the player sized it by hand (the grip, below).
        if (this.expanded && window.innerWidth < 700 && !readHeight()) {
          this.expanded = false;
          this.showExpand();
        }
        break;
      case "cast-view":
        this.firstCast.view(this.frame, msg.n, msg.x, msg.y);
        break;
      case "inspect":
        // Toasts stack below the island's inspect card (review of 10 November, bug 4).
        setToastFloor("inspect", msg.bottom && this.frame ? this.frame.getBoundingClientRect().top + msg.bottom : 0);
        if (msg.bottom) this.guide.hideHint();
        break;
      case "error":
        if (this.store.get(msg.key)) void this.repair(msg.key, msg.name, msg.message);
        break;
      case "island":
        // A new island (4.4.5 part B): its wonder set joins the last ten, so
        // the next one is never the same; its name is said once.
        if (msg.signature) writeRecentSet(msg.signature);
        if (msg.name && this.shown && !this.challenge) toast(`Welcome to ${msg.name}`, "special");
        break;
      case "chronicle":
        this.digestWaiter?.(msg.digest);
        this.digestWaiter = null;
        break;
      case "need":
        // Library spells a creature or an artifact casts (3.7): stored
        // programs only, free; one that does not exist stays unknown.
        api
          .libraryPrograms(msg.names)
          .then((r) =>
            this.send({ type: "library", spells: r.spells.map((s) => ({ key: s.key, name: s.name, tier: s.tier, code: s.code, intents: s.intents })) }),
          )
          .catch(() => {});
        break;
      case "perf": {
        // Spell code runs in the frame too, so it could send these: only
        // forwarded while the HUD is on, and at most every 20 seconds.
        const now = Date.now();
        if (!this.hud || now - this.lastPerf < 20_000) break;
        this.lastPerf = now;
        api.sendPerf({
          ...msg.sample,
          ...troubleCounts(),
          screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
          cores: navigator.hardwareConcurrency ?? 0,
          // 4.2: the last items made castable here, step by step.
          creation: timeline.recent(4).map(compactCreation),
        });
        break;
      }
      case "trouble": {
        // The island needs you: the Craft tab says what is seen of a trouble while the island waits there.
        const line = document.getElementById("board-trouble");
        if (msg.running) {
          if (!this.troubleBegan) this.troubleBegan = Date.now();
          if (line) {
            line.textContent = msg.text;
            line.hidden = false;
          }
          break;
        }
        if (line) line.hidden = true;
        toast(msg.text);
        const saved = msg.outcome === "saved" && !!msg.key && !!this.store.get(msg.key);
        if (saved) addDeed(msg.key!, msg.text);
        countTrouble(!!msg.key, msg.key ? (this.store.get(msg.key)?.discoveredAt ?? null) : null, this.troubleBegan);
        this.troubleBegan = 0;
        break;
      }
      case "eyes":
        this.setEyes(msg.on && this.shown);
        break;
      case "riding":
        this.riding = msg.on;
        this.hotOrder = null;
        this.hotSent = "";
        if (this.eyes) this.sendHotbar();
        this.updateStatus();
        break;
      case "pick":
        // From the hot bar: the same as a chip of the drawer, without its words (the drawer is hidden).
        if (msg.key === null) {
          this.selected = null;
          this.send({ type: "select", spell: null });
          this.renderSpells();
        } else if (this.store.get(msg.key) && msg.key !== this.selected) this.selectSpell(msg.key);
        break;
      case "objective":
        // Only the challenge this page started can report on itself.
        if (msg.id === this.challenge) this.showObjective(msg.id, msg.text, msg.status);
        break;
    }
  }

  // The frame is ready: it gets the island (read back, unpacked if kept
  // gzipped), then whatever was waiting for it.
  private async initFrame(frame: HTMLIFrameElement): Promise<void> {
    this.islandAt = readAt();
    let save: SavedWorld | null = null;
    try {
      const text = await readIslandText();
      save = text ? (JSON.parse(text) as SavedWorld) : null;
    } catch {
      save = null;
    }
    const newer = newerSave(save);
    if (newer) {
      console.warn(`The saved island is kept aside: ${newer}`);
      if (!this.newerIsland)
        toast(
          "Your island was saved by a newer version of the game, so this page shows a new one and saves nothing. Your island is untouched: reload the page later to get it back.",
          "error",
        );
      this.newerIsland = newer;
      save = null;
    }
    if (frame !== this.frame || !frame.contentWindow) return;
    const choice = readChoice();
    frame.contentWindow.postMessage(
      {
        type: "init",
        save,
        size: choice.size,
        land: choice.land,
        rules: save ? this.rulesFor(save) : [],
        troubles: troublesOn(),
        muted: this.muted,
        recent: readRecentSets(),
        wonders: readPool(),
      } satisfies ToWorld,
      "*",
    );
    this.ready = true;
    for (const queued of this.queue.splice(0)) this.send(queued);
    if (this.hud) this.send({ type: "hud", on: true });
    if (this.selected) {
      const req = this.request(this.selected);
      if (req) this.send({ type: "select", spell: req });
    }
  }

  // The island's save, by the tab that owns it, and never over a newer save
  // where tabs cannot tell each other (no BroadcastChannel). Big saves are
  // kept gzipped (4.4, island-store.ts); saves are written one at a time.
  private showExpand: () => void = () => undefined;

  // The spell bar's grip: dragged up it shows more spells, down to one row.
  // The height is a setting of this device (docs/DESIGN.md, "What syncs").
  private makeGrip(): void {
    const bar = this.el.bar;
    const list = this.el.list;
    const grip = document.createElement("div");
    grip.className = "spellbar-grip";
    grip.tabIndex = 0;
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-orientation", "horizontal");
    grip.setAttribute("aria-label", "Drag to show more or fewer spells");
    grip.title = "Drag to show more or fewer spells";
    bar.prepend(grip);
    const ROW = 56;
    const most = () => Math.round(window.innerHeight * 0.7);
    const apply = (h: number, save: boolean) => {
      const height = Math.max(0, Math.min(most(), Math.round(h)));
      const open = height >= ROW;
      if (open) bar.style.setProperty("--spells-h", `${height}px`);
      else bar.style.removeProperty("--spells-h");
      if (this.expanded !== open) {
        this.expanded = open;
        this.showExpand();
      }
      grip.setAttribute("aria-valuenow", String(open ? height : 0));
      if (save) {
        writeFlag(EXPAND_KEY, open);
        writeHeight(open ? height : 0);
      }
    };
    const saved = readHeight();
    if (saved && this.expanded) apply(saved, false);
    let startY = 0;
    let startH = 0;
    let dragging = false;
    grip.addEventListener("pointerdown", (e) => {
      dragging = true;
      startY = e.clientY;
      startH = this.expanded ? list.getBoundingClientRect().height : 0;
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("dragging");
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (dragging) apply(startH + (startY - e.clientY), false);
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      grip.classList.remove("dragging");
      apply(startH + (startY - e.clientY), true);
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    grip.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const now = this.expanded ? list.getBoundingClientRect().height : 0;
      apply(now + (e.key === "ArrowUp" ? 60 : -60), true);
    });
  }

  private saving: Promise<void> = Promise.resolve();
  private writeIsland(data: SavedWorld): void {
    this.saving = this.saving.then(() => this.writeIslandNow(data));
  }
  private async writeIslandNow(data: SavedWorld): Promise<void> {
    if (!this.owner || isFrozen() || this.newerIsland) return;
    if (!this.island && readAt() !== this.islandAt) return;
    let value: string;
    try {
      value = await packIsland(JSON.stringify(data));
    } catch {
      return;
    }
    // A save that would crowd out the player's discoveries is not written,
    // and the player is told (M13).
    if (value.length > MAX_SAVE_CHARS) {
      warnStorageFull();
      return;
    }
    const at = String(Date.now());
    if (isFrozen()) return;
    try {
      localStorage.setItem(WORLD_KEY, value);
      localStorage.setItem(WORLD_AT_KEY, at);
      this.islandAt = at;
      this.onSaved?.();
    } catch (err) {
      // The world lives on until the page closes; a full storage is said once.
      if (isQuotaError(err)) warnStorageFull();
    }
  }

  // A new island (4.4): its size, four sliders and a seed, which picks the
  // shape and, from the sliders, the land (4.4.1: not chosen from a list;
  // large islands and bigger mix several lands). The
  // sizes past Large are offered only where this device's own frame numbers
  // show the headroom (headroom.ts); none is ever chosen by default.
  // When the trouble running on the island began, for "answered by an item made since" (troubles.ts).
  private troubleBegan = 0;
  private resetDialog: HTMLDialogElement | null = null;
  private openReset(): void {
    const d = (this.resetDialog ??= document.createElement("dialog"));
    if (!d.isConnected) {
      d.className = "chronicle reset-island";
      d.addEventListener("click", (e) => {
        if (e.target === d) d.close();
      });
      document.body.append(d);
    }
    const choice = readChoice();
    const offered = sizesOffered(readHeadroom());
    const field = (label: string, input: HTMLElement) => {
      const l = document.createElement("label");
      const t = document.createElement("span");
      t.textContent = label;
      l.append(t, input);
      return l;
    };
    const select = (options: readonly string[], labels: (o: string) => string, value: string, disabled: (o: string) => boolean = () => false) => {
      const s = document.createElement("select");
      for (const o of options) {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = labels(o);
        opt.disabled = disabled(o);
        s.append(opt);
      }
      s.value = value;
      return s;
    };
    const slider = (value: number) => {
      const r = document.createElement("input");
      r.type = "range";
      r.min = "0";
      r.max = "100";
      r.value = String(Math.round(value * 100));
      return r;
    };
    const sizeLabel = (o: string) => {
      const n = WORLD_SIZES[o as WorldSize];
      const name = o[0].toUpperCase() + o.slice(1);
      // A recommendation, never a lock (the owner's ask: a Fold 5 and a desktop
      // with a big GPU could not open Huge or Giant at all).
      return BIG_SIZES.includes(o as WorldSize) && !offered.includes(o as WorldSize) ? `${name} (${n} by ${n}), may run slowly here` : `${name} (${n} by ${n})`;
    };
    const size = select(Object.keys(WORLD_SIZES), sizeLabel, choice.size in WORLD_SIZES ? choice.size : defaultSize());
    const warmth = slider(choice.land.warmth);
    const water = slider(choice.land.water);
    const relief = slider(choice.land.relief);
    const forest = slider(choice.land.forest);
    const seed = document.createElement("input");
    seed.type = "text";
    seed.inputMode = "numeric";
    seed.placeholder = "a new one";
    seed.maxLength = 10;
    const title = document.createElement("h2");
    title.textContent = "A new island";
    const hint = document.createElement("p");
    hint.className = "chronicle-note";
    hint.textContent =
      `The seed picks the island's shape and, from warmth and water, its land. Islands from ${MIXED_FROM} cells across mix several lands. ` +
      (BIG_SIZES.every((s) => offered.includes(s))
        ? "This device has room for every size."
        : "Huge and Giant are for fast devices: this one has not shown yet it runs them smoothly (a few minutes on a Large island tells). They are yours to try.");
    const warn = document.createElement("p");
    warn.className = "chronicle-note";
    warn.textContent = "Everything on your current island will be lost.";
    // 4.4.5 part C: what is new on islands this week, a reason to make one.
    const fresh = document.createElement("p");
    fresh.className = "chronicle-note";
    fresh.hidden = !this.week.length;
    fresh.textContent = this.week.length ? `New on islands this week: ${listOf(this.week.map(wonderLabel))}.` : "";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => d.close());
    const create = document.createElement("button");
    create.type = "button";
    create.className = "primary";
    create.textContent = "Create the island";
    create.addEventListener("click", () => {
      const land = readLandChoice({
        warmth: Number(warmth.value) / 100,
        water: Number(water.value) / 100,
        relief: Number(relief.value) / 100,
        forest: Number(forest.value) / 100,
      });
      const typed = seed.value.trim();
      const n = /^\d{1,10}$/.test(typed) ? Number(typed) % 2 ** 31 : null;
      const chosen = size.value as WorldSize;
      writeChoice({ size: chosen, land });
      d.close();
      this.send({ type: "reset", size: chosen, land, seed: n, recent: readRecentSets() });
    });
    const actions = document.createElement("div");
    actions.className = "reset-actions";
    actions.append(cancel, create);
    const grid = document.createElement("div");
    grid.className = "reset-fields";
    grid.append(field("Size", size), field("Warmth", warmth), field("Water", water), field("Mountains", relief), field("Forest", forest), field("Seed", seed));
    // The island needs you: troubles start on the player's island unless they say no. It
    // holds for the island they have now too, at once.
    const troubles = document.createElement("label");
    troubles.className = "reset-troubles";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = troublesOn();
    box.addEventListener("change", () => {
      setTroublesOn(box.checked);
      this.send({ type: "troubles", on: box.checked });
    });
    const words = document.createElement("span");
    words.textContent = "Troubles come to my villages (a fire in the woods, a river rising). Off: no trouble comes by itself.";
    troubles.append(box, words);
    d.replaceChildren(title, grid, hint, fresh, troubles, warn, actions);
    d.showModal();
  }

  // The pool of wonders written as programs (4.4.5 part C): asked for when
  // the World opens, at most every ten minutes, kept for offline, handed to
  // the frame for the next new island. What came this week is said once.
  private async refreshPool(): Promise<void> {
    if (Date.now() - this.poolAt < 600_000) return;
    this.poolAt = Date.now();
    const pool = await api.wonderPool();
    if (!pool) return;
    writePool(pool.wonders);
    this.week = pool.week;
    this.send({ type: "wonders", list: pool.wonders });
    const seen = readSeenWonders();
    const fresh = pool.week.filter((w) => !seen.includes(w.id));
    // Said once, after the first cast has landed and been seen, never over
    // it (2026-11-11), in one or two lines: the New island dialog lists them all.
    if (fresh.length)
      this.guide.afterFirstCast(() => {
        if (!this.shown) return;
        writeSeenWonders([...readSeenWonders(), ...fresh.map((w) => w.id)]);
        const names = [...new Set(fresh.map((w) => w.kind))];
        const said = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
        toast(`New on islands this week: ${listOf(said)}. A new island may have them.`, "special");
      });
  }

  // The frame HUD, toggled by a long press on the title. Remembered per browser.
  toggleHud(): boolean {
    this.hud = !this.hud;
    writeFlag(HUD_KEY, this.hud);
    this.send({ type: "hud", on: this.hud });
    return this.hud;
  }

  private startChallenge(id: string, ahead = 0): void {
    const info = SCENARIO_LIST.find((s) => s.id === id);
    if (!info) return;
    this.challenge = id;
    this.headStart = ahead;
    this.send({ type: "scenario", id, ahead });
    this.showObjective(id, this.attempt?.brief ?? info.brief, "playing");
    this.el.reset.textContent = "Restart";
  }

  // A challenge from nothing (3.7, challenges.ts): its hazard island with the
  // spell made on its board in hand. A win is reported with the merges.
  // Only what the player made on the challenge's board counts: a win after
  // casting anything else from the spell bar is not recorded.
  attempt: {
    id: string;
    title: string;
    brief: string;
    scenario: string;
    items: Set<string>;
    onEnd: (status: "won" | "lost", spell: string | null) => void;
  } | null = null;
  private castInAttempt: string[] = [];
  playAttempt(a: NonNullable<WorldHost["attempt"]>, key: string, ahead: number): void {
    this.attempt = a;
    this.castInAttempt = [];
    this.startChallenge(a.scenario, ahead);
    this.selectSpell(key);
  }

  // The island's chronicle (3.7): written by Haiku from what the World
  // recorded, once a session; the last ten chapters are kept by this browser.
  private digestWaiter: ((d: ChronicleDigest) => void) | null = null;
  private chronicleDialog: HTMLDialogElement | null = null;
  private async openChronicle(): Promise<void> {
    if (this.challenge) {
      toast("The chronicle tells your own island: leave the challenge first");
      return;
    }
    const kept = readChronicles();
    let fresh = "";
    if (!sessionChapter()) {
      const digest = await new Promise<ChronicleDigest | null>((resolve) => {
        this.digestWaiter = resolve;
        this.send({ type: "chronicle" });
        window.setTimeout(() => resolve(null), 4000);
      });
      if (!digest || (!digest.lines.length && !digest.memories.length)) {
        toast("Nothing has happened on your island yet: cast something, or wait a little");
        return;
      }
      toast("The village elder is thinking…");
      try {
        fresh = (await api.chronicle(digest)).text;
        kept.unshift({ at: Date.now(), text: fresh });
        writeChronicles(kept.slice(0, 10));
        markSessionChapter();
      } catch (err) {
        toast(err instanceof Error ? err.message : "The chronicle could not be written", "error");
        if (!kept.length) return;
      }
    }
    if (!this.chronicleDialog) {
      const d = document.createElement("dialog");
      d.className = "chronicle";
      d.addEventListener("click", (e) => {
        if (e.target === d) d.close();
      });
      document.body.append(d);
      this.chronicleDialog = d;
    }
    const d = this.chronicleDialog;
    const title = document.createElement("h2");
    title.textContent = "The island's chronicle";
    const list = document.createElement("div");
    for (const c of readChronicles()) {
      const when = document.createElement("h3");
      when.textContent = new Date(c.at).toLocaleString();
      const p = document.createElement("p");
      p.textContent = c.text;
      list.append(when, p);
    }
    const note = document.createElement("p");
    note.className = "chronicle-note";
    note.textContent = "A new chapter is written once a session.";
    const close = document.createElement("button");
    close.textContent = "Close";
    close.addEventListener("click", () => d.close());
    d.replaceChildren(title, list, note, close);
    d.showModal();
  }

  // The World's Challenges button opens the Challenges tab (main.ts sets it).
  onChallenges: () => void = () => {};
  // Told after each world save (4.0: the account's island follows).
  onSaved: (() => void) | null = null;

  private leaveChallenge(): void {
    this.challenge = null;
    this.attempt = null;
    this.el.banner.hidden = true;
    this.el.reset.textContent = "Reset";
    this.send({ type: "sandbox" });
  }

  private showObjective(id: string, text: string, status: "playing" | "won" | "lost"): void {
    if (this.challenge !== id) return;
    if (status === "playing" && text === this.attempt?.brief) this.castInAttempt = [];
    const info = SCENARIO_LIST.find((s) => s.id === id);
    const b = this.el.banner;
    b.hidden = false;
    b.dataset.status = status;
    b.querySelector(".world-banner-title")!.textContent = this.attempt?.title ?? info?.title ?? "";
    b.querySelector(".world-banner-text")!.textContent = text;
    // No hints (3.7): finding the spell is the game.
    b.querySelector(".world-banner-hint")!.textContent = "";
    (b.querySelector(".world-banner-retry") as HTMLElement).hidden = status === "playing";
    if (this.attempt && status !== "playing") {
      const a = this.attempt;
      const cast = this.castInAttempt;
      const fair = cast.length > 0 && cast.every((k) => a.items.has(k));
      if (status === "won") this.attempt = null;
      a.onEnd(status, fair ? cast[cast.length - 1] : null);
      this.castInAttempt = [];
      return;
    }
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
    if (done >= MAX_REPAIRS || this.sessionPrograms.has(key) || mendedTooOften(key)) {
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
      // The Worker mends a program three times in its life (4.0 review L5):
      // past that, this session stops asking and the spell just fizzles.
      if (err instanceof api.ApiRequestError && err.detail?.mended === true) markMended(key);
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
    const form = formOf(this.store.get(key)!.element);
    this.voteTimer = window.setTimeout(() => this.askVote(name, program.id!, form), 6000);
  }

  private askVote(name: string, id: number, form: Form): void {
    const open = this.voteBar?.isConnected ? this.voteBar : null;
    if (open?.dataset.step === "reasons") {
      this.voteWaiting = () => this.askVote(name, id, form);
      return;
    }
    const bar = (this.voteBar ??= document.createElement("div"));
    bar.className = "vote";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", `Vote on ${name}`);
    delete bar.dataset.step;
    // Focus goes back to the spells, never lost on the page, when it closes.
    const close = () => {
      const had = bar.contains(document.activeElement);
      bar.remove();
      clearTimeout(this.voteClose);
      if (this.voteKeys) document.removeEventListener("keydown", this.voteKeys);
      this.voteKeys = null;
      const next = this.voteWaiting;
      this.voteWaiting = null;
      if (next) this.voteTimer = window.setTimeout(next, 1500);
      if (had) (this.el.list.querySelector<HTMLElement>('.chip-castable[aria-pressed="true"]') ?? this.el.list).focus({ preventScroll: true });
    };
    // Escape closes it wherever focus is (after a cast it is on the island).
    if (this.voteKeys) document.removeEventListener("keydown", this.voteKeys);
    this.voteKeys = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", this.voteKeys);
    const send = async (up: boolean, reasons?: DownReason[]) => {
      close();
      try {
        await api.vote({ name, id, up, reasons });
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
    text.id = "vote-q";
    text.tabIndex = -1;
    const dismiss = button("×", "vote-close", close);
    dismiss.setAttribute("aria-label", "Not now");
    // Reasons by the item's form (a creature that barely moved, a building
    // floating): one to three, then Send. Picks are kept if the player goes
    // Back and taps Not good again.
    const picked: DownReason[] = [];
    let warned = 0;
    const showReasons = () => {
      // Choosing takes longer than a tap: no clock while the player picks.
      clearTimeout(this.voteClose);
      bar.dataset.step = "reasons";
      text.textContent = `What was wrong with ${name}?`;
      const head = document.createElement("div");
      head.className = "vote-head";
      const hint = document.createElement("span");
      hint.className = "vote-hint";
      hint.setAttribute("aria-live", "polite");
      const say = (line: string, warn = false) => {
        hint.textContent = line;
        hint.toggleAttribute("data-warn", warn);
        clearTimeout(warned);
        if (warn) warned = window.setTimeout(refresh, 3000);
      };
      head.append(text, hint);
      const grid = document.createElement("div");
      grid.className = "vote-reasons";
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", "Reasons");
      const sendButton = button("Send", "vote-send", () => {
        if (picked.length) void send(false, [...picked]);
        else say("Pick at least one reason", true);
      });
      const choices = reasonsFor(form).map((r) => {
        const b = button(reasonLabel(r, form), "vote-reason", () => {
          const at = picked.indexOf(r);
          if (at >= 0) picked.splice(at, 1);
          else if (picked.length < MAX_REASONS) picked.push(r);
          else {
            // On its side the picked ones may have scrolled out of view.
            choices.find((c) => c.getAttribute("aria-pressed") === "true")?.scrollIntoView({ block: "nearest", inline: "nearest" });
            return say(`${MAX_REASONS} is the most. Tap one to unpick it.`, true);
          }
          refresh();
        });
        b.dataset.reason = r;
        return b;
      });
      function refresh() {
        for (const b of choices) b.setAttribute("aria-pressed", String(picked.includes(b.dataset.reason as DownReason)));
        sendButton.setAttribute("aria-disabled", String(picked.length === 0));
        say(picked.length >= MAX_REASONS ? `${MAX_REASONS} picked, the most` : `Pick 1 to ${MAX_REASONS}`);
      }
      grid.replaceChildren(...choices);
      const actions = document.createElement("div");
      actions.className = "vote-actions";
      actions.append(
        button("Back", "vote-back", () => {
          clearTimeout(warned);
          showAsk();
          bar.querySelector<HTMLElement>(".vote-down")?.focus({ preventScroll: true });
        }),
        sendButton,
      );
      refresh();
      bar.replaceChildren(head, grid, actions, dismiss);
      text.focus({ preventScroll: true });
    };
    const showAsk = () => {
      delete bar.dataset.step;
      text.textContent = `How was ${name}?`;
      bar.replaceChildren(
        text,
        button("Good", "vote-up", () => void send(true)),
        button("Not good", "vote-down", showReasons),
        dismiss,
      );
    };
    showAsk();
    // On the drawer, in place of its hint line (2026-11-07): over the island
    // it covered the island's own panels and the ground where spells land.
    if (!bar.isConnected) this.el.status.before(bar);
    // Unanswered, it goes away; the next cast asks again.
    clearTimeout(this.voteClose);
    this.voteClose = window.setTimeout(close, 30_000);
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
      // Dimmed until its program is written; 4.2: says why (writing, testing).
      chip.dataset.key = key;
      this.chipState(chip, key);
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

  // writing (the Worker writes it, or this page is asking for it), testing
  // (its test run, here), ready; nothing for a spell nobody asked for yet.
  private stateOf(key: string): "ready" | "testing" | "writing" | "" {
    if (this.request(key)) return "ready";
    if (this.testing.has(key)) return "testing";
    if (this.writing.has(key) || this.preparing.has(key) || this.aheadQueue.includes(key)) return "writing";
    return "";
  }

  private chipState(chip: HTMLElement, key: string): void {
    const state = this.stateOf(key);
    const was = chip.dataset.state ?? "";
    chip.dataset.ready = state === "ready" ? "1" : "0";
    chip.dataset.state = state;
    let label = chip.querySelector<HTMLElement>(".chip-state");
    const text =
      state === "writing" ? "writing" : state === "testing" ? "testing" : state === "ready" && (was === "writing" || was === "testing") ? "ready" : "";
    if (!text) {
      // "ready" stays a few seconds after the change, then goes.
      if (label && state !== "ready") label.remove();
      return;
    }
    if (!label) {
      label = document.createElement("span");
      label.className = "chip-state";
      chip.append(label);
    }
    label.textContent = text;
    if (state === "ready") window.setTimeout(() => label?.remove(), 4000);
  }

  // The spell bar's chips, updated in place as programs are written and tested.
  private refreshChips(): void {
    for (const chip of this.el.list.querySelectorAll<HTMLElement>(".chip-castable")) {
      const key = chip.dataset.key;
      if (key) this.chipState(chip, key);
    }
  }

  private updateStatus(): void {
    this.refreshChips();
    if (this.eyes) this.sendHotbar();
    const key = this.selected;
    const name = key ? this.store.get(key)?.element.name : null;
    let text = "Pick a spell, then tap the island to cast it, or tap a creature to see what it wants. Drag to turn, pinch to zoom, two fingers to pan.";
    if (key && name) {
      if (this.testing.has(key)) text = `Testing ${name} on a practice island…`;
      else if (this.writing.has(key)) text = `The grimoire is writing ${name}… it will be ready in a moment.`;
      else if (this.preparing.has(key)) text = `Preparing ${name}… the first cast of a spell takes a moment.`;
      else if (this.request(key) && this.riding)
        text = `Tap the island to ${this.store.get(key)?.element.kind === "artifact" ? "place" : "cast"} ${name} from where you stand, up to 14 steps away.`;
      else if (this.request(key))
        text = `Tap the island to ${this.store.get(key)?.element.kind === "artifact" ? "place" : "cast"} ${name}. Tap it again to put it away and look at creatures.`;
      else text = `${name} is not ready yet.`;
    }
    this.el.status.textContent = text;
    this.showCreation(key);
  }

  private setEyes(on: boolean): void {
    if (on === this.eyes) return;
    this.eyes = on;
    document.body.classList.toggle("eyes", on);
    this.hotSent = "";
    if (on) {
      this.guide.hideHint();
      this.sendHotbar();
    }
  }

  // Every spell and item, last used first then the newest, in the order of the moment the player became a creature.
  private sendHotbar(): void {
    const keyOf = (d: { element: { name: string } }) => elementKey(d.element.name);
    const now = applyFilters(this.store.discoveries(), { kind: "all", tier: "any", sort: "used", query: "" }, lastUsed, keyOf);
    this.hotOrder ??= now.map(keyOf);
    const byKey = new Map(now.map((d) => [keyOf(d), d]));
    const slots: HotSlot[] = keepOrder([...byKey.keys()], this.hotOrder)
      .slice(0, HOT_SLOTS)
      .map((key) => {
        const d = byKey.get(key)!;
        return { key, name: d.element.name, emoji: d.element.emoji, ready: !!this.request(key) };
      });
    const text = JSON.stringify(slots);
    if (text === this.hotSent) return;
    this.hotSent = text;
    this.send({ type: "hotbar", slots });
  }

  // The creation bar under the status line, while the spell in hand is not
  // ready: asked, written, tested. Each stage fills its share of the bar as
  // its usual time goes by (4.2's measures: about 15 s of writing, a few
  // seconds of test run) and never claims to be done before it is.
  private creationBar: HTMLElement | null = null;
  private creationStage: { key: string; stage: string; since: number; from: number } | null = null;
  private creationTimer = 0;
  private showCreation(key: string | null): void {
    const state = key ? this.stateOf(key) : "ready";
    // Only while it is on its way: a spell that failed or was given up on says so in the status line.
    const waiting = key !== null && (state === "writing" || state === "testing");
    if (!this.creationBar) {
      if (!waiting) return;
      const bar = document.createElement("div");
      bar.className = "creation-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", "Making the spell");
      bar.append(document.createElement("i"));
      this.el.status.after(bar);
      this.creationBar = bar;
    }
    const bar = this.creationBar;
    bar.hidden = !waiting;
    if (!waiting) {
      this.creationStage = null;
      clearInterval(this.creationTimer);
      this.creationTimer = 0;
      return;
    }
    // Shares of the bar: asked 0 to 0.1, writing to 0.75, testing to 0.97.
    const stage = state === "testing" ? "testing" : this.writing.has(key) || this.preparing.has(key) ? "writing" : "asked";
    const span = { asked: [0, 0.1, 2], writing: [0.1, 0.75, 16], testing: [0.75, 0.97, 4] }[stage] as [number, number, number];
    const now = Date.now();
    const shown = this.creationStage?.key === key ? this.fill(this.creationStage, now) : 0;
    if (this.creationStage?.key !== key || this.creationStage.stage !== stage) this.creationStage = { key, stage, since: now, from: Math.max(span[0], shown) };
    const paint = () => {
      const s = this.creationStage;
      if (!s) return;
      const v = this.fill(s, Date.now());
      (bar.firstChild as HTMLElement).style.width = `${Math.round(v * 100)}%`;
      bar.setAttribute("aria-valuenow", String(Math.round(v * 100)));
    };
    paint();
    if (!this.creationTimer) this.creationTimer = window.setInterval(paint, 250);
  }

  private fill(s: { stage: string; since: number; from: number }, now: number): number {
    const [, to, seconds] = ({ asked: [0, 0.1, 2], writing: [0.1, 0.75, 16], testing: [0.75, 0.97, 4] } as Record<string, number[]>)[s.stage];
    const t = (now - s.since) / 1000;
    return s.from + (to - s.from) * (1 - Math.exp(-t / seconds));
  }
}

const EXPAND_KEY = "mm-spellbar-expanded";
// The spell bar's height in pixels when opened by its grip, 0 for none.
const HEIGHT_KEY = "mm-spellbar-height";
function readHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY) ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}
function writeHeight(h: number): void {
  try {
    if (h) localStorage.setItem(HEIGHT_KEY, String(h));
    else localStorage.removeItem(HEIGHT_KEY);
  } catch {
    // kept for this page
  }
}

// One creation in a few dozen characters, for the 4 KB perf sample.
function compactCreation(c: ReturnType<typeof timeline.recent>[number]) {
  return { t: c.tier, k: c.kind?.[0], s: c.steps, w: c.server, p: c.phases };
}

// What the browser keeps: the trial flag is only for the test run.
function withoutTrial(program: SpellProgram): SpellProgram {
  const { trial: _trial, ...rest } = program;
  return rest;
}

function readAt(): string | null {
  try {
    return localStorage.getItem(WORLD_AT_KEY);
  } catch {
    return null;
  }
}

function islandChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "function" ? new BroadcastChannel("magic-merger.island") : null;
  } catch {
    return null;
  }
}

// The size and land the player last chose for a new island (4.4).
const CHOICE_KEY = "magic-merger.new-island";

// The wonder sets of the last ten islands (4.4.5 part B): a new island never
// repeats one. Only kinds, never anything about the player.
const RECENT_KEY = "magic-merger.wonder-sets";
function readRecentSets(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length <= 300).slice(-10) : [];
  } catch {
    return [];
  }
}
function writeRecentSet(signature: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([...readRecentSets().filter((s) => s !== signature), signature].slice(-10)));
  } catch {
    // Full or blocked storage: the next island may repeat a set, nothing more.
  }
}

// The pool of wonders (4.4.5 part C), kept for offline: the newest sixty,
// so the island's save keeps the room it needs.
const POOL_KEY = "magic-merger.wonder-pool";
const SEEN_KEY = "magic-merger.wonders-seen";
function readPool(): unknown[] {
  try {
    const v = JSON.parse(localStorage.getItem(POOL_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.slice(0, 60) : [];
  } catch {
    return [];
  }
}
function writePool(list: api.PoolWonder[]): void {
  try {
    localStorage.setItem(POOL_KEY, JSON.stringify(list.slice(0, 60)));
  } catch {
    // Full storage: new islands draw from the pool only while online.
  }
}
function readSeenWonders(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number").slice(-200) : [];
  } catch {
    return [];
  }
}
function writeSeenWonders(ids: number[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // Said again next time, nothing more.
  }
}
function wonderLabel(w: api.PoolWonder): string {
  return w.by ? `${w.kind} (${w.rarity}, found by ${w.by})` : `${w.kind} (${w.rarity})`;
}
function listOf(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Never a big island by default: small on a narrow screen, medium elsewhere.
function defaultSize(): WorldSize {
  return window.innerWidth < 600 ? "small" : "medium";
}

function readChoice(): { size: WorldSize; land: LandChoice } {
  try {
    const v = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "null") as { size?: string; land?: unknown } | null;
    const size = v?.size && v.size in WORLD_SIZES ? (v.size as WorldSize) : defaultSize();
    // A big size stays chosen (4.4.5 part B: a recommendation, not a lock).
    return { size, land: readLandChoice(v?.land) };
  } catch {
    return { size: defaultSize(), land: { ...DEFAULT_LAND } };
  }
}

function writeChoice(choice: { size: WorldSize; land: LandChoice }): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // This choice lasts for this page.
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

// Spells the Worker would not mend again, for this tab's session (L5).
const MENDED = "mm-mended";
const mendedHere = new Set<string>();
function mendedTooOften(key: string): boolean {
  if (mendedHere.has(key)) return true;
  try {
    return (JSON.parse(sessionStorage.getItem(MENDED) ?? "[]") as string[]).includes(key);
  } catch {
    return false;
  }
}
function markMended(key: string): void {
  mendedHere.add(key);
  try {
    sessionStorage.setItem(MENDED, JSON.stringify([...mendedHere]));
  } catch {
    // this page only
  }
}

// The chronicle's chapters, kept by this browser (3.7).
const CHRONICLES = "mm-chronicles";
function readChronicles(): { at: number; text: string }[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHRONICLES) ?? "[]") as { at: number; text: string }[];
    return Array.isArray(v) ? v.filter((c) => typeof c.text === "string" && typeof c.at === "number") : [];
  } catch {
    return [];
  }
}
function writeChronicles(list: { at: number; text: string }[]): void {
  try {
    localStorage.setItem(CHRONICLES, JSON.stringify(list));
  } catch {
    // kept for this page only
  }
}
let chapterThisSession = false;
function sessionChapter(): boolean {
  try {
    return chapterThisSession || sessionStorage.getItem("mm-chronicle-session") === "1";
  } catch {
    return chapterThisSession;
  }
}
function markSessionChapter(): void {
  chapterThisSession = true;
  try {
    sessionStorage.setItem("mm-chronicle-session", "1");
  } catch {
    // this page only
  }
}
