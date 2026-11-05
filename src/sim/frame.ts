import { chronicleDigest } from "./chronicle";
import { Engine, type WorldSize } from "./engine";
import { DEFAULT_LAND, readChoice, resolveLand, type LandChoice } from "./land";
import { WORLD_SIZES } from "./sizes";
import { kindOf, makeCreature, maxHp, type Creature } from "./creatures";
import { artifactAt, creatureAt, inspect, inspectArtifact } from "./inspect";
import type { Artifact } from "./artifacts";
import type { FromWorld, ToWorld } from "./protocol";
import type { CastRequest, Runtime } from "./runtime";
import type { SavedWorld } from "./save";
import { Hud } from "./hud";
import { SCENARIOS } from "./scenarios";
import { firstLook } from "./firstlook";
import { readDef, setFinders, signatureOf, wonderInfo, type WonderDef } from "./wonders";

// The pool of wonders written as programs (4.4.5 part C), checked: the page
// relays what the server said, and a definition is code like any spell.
let pool: WonderDef[] = [];
function readPool(v: unknown): WonderDef[] {
  return (Array.isArray(v) ? v : [])
    .map(readDef)
    .filter((d): d is WonderDef => d !== null)
    .slice(0, 200);
}

function readRecent(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length <= 300).slice(-10) : [];
}

// Entry point of the World iframe (world.html). It owns the simulation and
// runs spell programs; the parent page owns the player's data and the API.

const canvas = document.getElementById("world") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLCanvasElement;
let engine: Engine | null = null;
let selected: CastRequest | null = null;
let muted = false;
let saveTimer = 0;
let unbind: (() => void) | null = null;
// The sandbox world while a challenge is played, to come back to it untouched.
let sandbox: { save: SavedWorld | null; size: WorldSize; land: LandChoice; rules: CastRequest[] } = {
  save: null,
  size: "medium",
  land: { ...DEFAULT_LAND },
  rules: [],
};
let scenario: string | null = null;
let hud: Hud | null = null;
let hudOn = false;
let perfTimer = 0;

function send(msg: FromWorld): void {
  window.parent.postMessage(msg, "*");
}

const hooks = {
  onError: (key: string, name: string, message: string) => send({ type: "error", key, name, message }),
  onTap: (x: number, y: number) => {
    if (!engine) return;
    if (!selected) {
      // No spell in hand: a tap on a creature shows what it is doing (3.6).
      const c = creatureAt(engine.world, x, y);
      const a = c ? null : artifactAt(engine.world, x, y);
      const wonder = c || a ? null : engine.world.wonders.find((w) => Math.hypot(w.x - x, w.y - y) <= Math.max(3, w.r * 0.8));
      if (c) showInspect(c);
      else if (a) showInspect(null, a);
      else if (wonder) showWonder(wonderInfo(wonder));
      else {
        closeInspect();
        send({ type: "tap-without-spell" });
      }
      return;
    }
    if (engine.cast(selected, x, y)) send({ type: "cast", key: selected.key });
  },
};

// The inspect card: built from text nodes only (kind names come from spells),
// refreshed twice a second while it is open.
const card = document.getElementById("inspect") as HTMLElement;
let inspected: Creature | null = null;
let inspectedArtifact: Artifact | null = null;
let inspectTimer = 0;

function showInspect(c: Creature | null, a: Artifact | null = null): void {
  if (inspected) delete inspected.data.inspected;
  inspected = c;
  inspectedArtifact = a;
  if (c) c.data.inspected = true;
  drawInspect();
  card.hidden = false;
  clearInterval(inspectTimer);
  inspectTimer = window.setInterval(drawInspect, 500);
}

// A wonder's card (4.4.5 part B): what it is and what it does.
function showWonder(info: ReturnType<typeof wonderInfo>): void {
  closeInspect();
  const close = el("button", "close", "×");
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeInspect);
  const head = el("div", "head");
  head.append(el("strong", "title", info.name[0].toUpperCase() + info.name.slice(1)), el("span", "sub", info.label), close);
  const rows = el("dl", "rows");
  rows.append(el("dt", "", "Rarity"), el("dd", "", info.rarity), el("dt", "", "Does"), el("dd", "", info.does));
  if (info.by) rows.append(el("dt", "", "Found by"), el("dd", "", info.by));
  card.replaceChildren(head, rows);
  card.hidden = false;
}

function closeInspect(): void {
  if (inspected) delete inspected.data.inspected;
  inspected = null;
  inspectedArtifact = null;
  card.hidden = true;
  clearInterval(inspectTimer);
}

function el(tag: string, cls: string, text = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

function drawInspect(): void {
  if (!engine) return closeInspect();
  const a = inspectedArtifact;
  if (a ? !engine.world.landmarks.includes(a) : !inspected || !engine.world.creatures.includes(inspected)) return closeInspect();
  const info = a ? inspectArtifact(engine.world, a) : inspect(engine.world, inspected!, kindOf, maxHp);
  const close = el("button", "close", "×");
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeInspect);
  const head = el("div", "head");
  head.append(el("strong", "title", info.title), el("span", "sub", info.dead ? "dead" : info.subtitle), close);
  const bars = el("div", "bars");
  for (const b of info.bars) {
    const row = el("div", "bar");
    const fill = el("i", "");
    fill.style.width = `${Math.round(b.value * 100)}%`;
    fill.style.background = b.value > 0.6 ? "#7ed492" : b.value > 0.3 ? "#f2c94c" : "#ef6b5b";
    const track = el("span", "track");
    track.append(fill);
    row.append(el("span", "label", b.label), track);
    bars.append(row);
  }
  const rows = el("dl", "rows");
  for (const [k, v] of info.rows) rows.append(el("dt", "", k), el("dd", "", v));
  card.replaceChildren(head, bars, rows);
}

// Library spells creatures and artifacts cast (3.7): asked of the page by
// name, kept for every world this frame runs.
const library: CastRequest[] = [];
const asked = new Set<string>();
window.setInterval(() => {
  if (!engine || !engine.runtime.wanted.size) return;
  const names = [...engine.runtime.wanted].filter((n) => !asked.has(n.toLowerCase())).slice(0, 20);
  engine.runtime.wanted.clear();
  for (const n of names) asked.add(n.toLowerCase());
  if (names.length) send({ type: "need", names });
}, 2000);

function mount(next: Engine): void {
  closeInspect();
  stopLook?.();
  stopLook = null;
  lookCard.hidden = true;
  engine?.dispose();
  unbind?.();
  engine = next;
  engine.runtime.setLibrary(library);
  engine.sound.muted = muted;
  unbind = engine.bindInput();
  showHud(hudOn);
  if (selected) {
    try {
      engine.runtime.compile(selected);
    } catch {
      // Reported when cast.
    }
  }
  engine.start();
}

// A new island (4.4.1): the seed, new or the player's, picks its shape and
// land from the sliders (land-options.ts, resolveLand).
function freshIsland(size: WorldSize, choice: LandChoice, seed: number | null): Engine {
  const s = seed ?? (Math.random() * 2 ** 31) | 0;
  return Engine.create(canvas, overlay, size, hooks, s, {}, resolveLand(choice, s, WORLD_SIZES[size] ?? WORLD_SIZES.medium), recent, pool);
}

// The wonder sets of the player's last islands (the page keeps them), and
// the first look at a new one (4.4.5 part B).
let recent: string[] = [];
let stopLook: (() => void) | null = null;
const lookCard = document.getElementById("first-look") as HTMLElement;
function showFirstLook(): void {
  if (!engine) return;
  const world = engine.world;
  send({ type: "island", name: world.islandName ?? "", signature: signatureOf(world.wonders.map((w) => w.kind)) });
  if (!world.wonders.length && !world.islandName) return;
  stopLook = firstLook(engine, lookCard, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

// Challenge worlds are never saved: only the sandbox is the player's.
function save(): void {
  if (!engine || scenario) return;
  const data = engine.save();
  sandbox.save = data;
  send({ type: "save", data });
}

function loadRules(rules: CastRequest[]) {
  return (rt: Runtime) => {
    for (const spell of rules) {
      try {
        rt.compile(spell);
      } catch {
        // A broken spell loses its custom materials; the cells fall back.
      }
    }
  };
}

function openSandbox(): void {
  scenario = null;
  let restored: Engine | null = null;
  try {
    restored = sandbox.save ? Engine.restore(canvas, overlay, sandbox.save, hooks, loadRules(sandbox.rules)) : null;
  } catch (err) {
    // A save the game can no longer read starts a fresh island instead of a blank page.
    console.error("The saved world could not be restored", err);
    sandbox.save = null;
  }
  mount(restored ?? freshIsland(sandbox.size, sandbox.land, null));
  if (!restored) showFirstLook();
}

// The head start of the challenge being played, for a reset (L6).
let scenarioAhead = 0;

function openScenario(id: string, ahead = 0): void {
  const def = SCENARIOS.find((s) => s.id === id);
  if (!def) return;
  save();
  scenario = id;
  scenarioAhead = ahead;
  const { world, run, focus } = def.build();
  const next = new Engine(canvas, overlay, world, hooks);
  next.view.orbit.tx = focus.x;
  next.view.orbit.ty = focus.y;
  next.view.orbit.dist = focus.dist;
  let over = false;
  let last = "";
  next.onTick = () => {
    run.tick(world);
    if (over || world.tick % 15 !== 0) return;
    const { text, status } = run.check(world);
    if (status !== "playing") over = true;
    if (text !== last || over) {
      last = text;
      send({ type: "objective", id, text, status });
    }
  };
  // A live challenge (3.7): the hazard ran while the player merged. Played
  // here before the island is shown, at most LIVE_MAX (8) seconds of it.
  const ticks = Math.round(Math.max(0, Math.min(8, ahead)) * 30);
  for (let k = 0; k < ticks && !over; k++) next.step();
  world.events.length = 0;
  mount(next);
}

// The HUD follows the engine across resets and challenges; while it is on, a
// summary leaves every 30 seconds for the page to send to /api/perf.
function showHud(on: boolean): void {
  hudOn = on;
  if (!engine) return;
  hud ??= new Hud(engine.stats);
  hud.stats = engine.stats;
  hud.show(on);
  clearInterval(perfTimer);
  if (on) perfTimer = window.setInterval(() => engine && send({ type: "perf", sample: { ...engine.stats.summary(), challenge: scenario ? 1 : 0 } }), 30_000);
}

window.addEventListener("message", (e: MessageEvent<ToWorld>) => {
  if (e.source !== window.parent || !e.data || typeof e.data !== "object") return;
  const msg = e.data;
  switch (msg.type) {
    case "chronicle":
      // The sandbox's story, never a challenge's.
      if (engine && !scenario) send({ type: "chronicle", digest: chronicleDigest(engine.world) });
      break;
    case "library":
      library.push(...msg.spells);
      engine?.runtime.setLibrary(msg.spells);
      break;
    case "init": {
      muted = msg.muted;
      sandbox = { save: msg.save, size: msg.size, land: readChoice(msg.land), rules: msg.rules };
      recent = readRecent(msg.recent);
      pool = readPool(msg.wonders);
      setFinders(pool);
      openSandbox();
      clearInterval(saveTimer);
      saveTimer = window.setInterval(save, 10_000);
      break;
    }
    case "select":
      selected = msg.spell;
      if (selected) closeInspect();
      if (selected && engine) {
        try {
          engine.runtime.compile(selected);
        } catch (err) {
          hooks.onError(selected.key, selected.name, err instanceof Error ? err.message : String(err));
        }
      }
      break;
    case "spell-updated":
      if (selected?.key === msg.spell.key) selected = msg.spell;
      break;
    case "villager":
      if (engine) {
        const c = makeCreature("villager", engine.view.orbit.tx, engine.view.orbit.ty);
        engine.world.creatures.push(c);
      }
      break;
    case "reset":
      if (scenario) {
        openScenario(scenario, scenarioAhead);
        break;
      }
      sandbox.size = msg.size;
      sandbox.land = readChoice(msg.land);
      recent = readRecent(msg.recent);
      mount(freshIsland(msg.size, sandbox.land, msg.seed));
      showFirstLook();
      save();
      break;
    case "wonders":
      pool = readPool(msg.list);
      setFinders(pool);
      break;
    case "scenario":
      openScenario(msg.id, msg.ahead ?? 0);
      break;
    case "sandbox":
      if (scenario) openSandbox();
      break;
    case "hud":
      showHud(msg.on);
      break;
    case "mute":
      muted = msg.muted;
      if (engine) engine.sound.muted = muted;
      break;
    case "visible":
      if (!engine) break;
      if (msg.visible) {
        engine.resize();
        engine.start();
      } else {
        engine.stop();
        save();
      }
      break;
  }
});

// What this device can run (4.4): the frame numbers of the island being
// played, every 30 seconds once enough frames were drawn. Challenges are
// smaller islands with their own hazards: not counted.
window.setInterval(() => {
  if (!engine || scenario) return;
  const s = engine.stats.summary();
  if (s.frames < 300) return;
  send({ type: "headroom", sample: { w: engine.world.w, simP95: s.simP95, frameP95: s.frameP95, frames: s.frames } });
}, 30_000);

// A heartbeat for the page's watchdog (4.0 review M3): spell code that never
// returns stops it, and the page replaces this frame.
window.setInterval(() => send({ type: "alive" }), 2000);

send({ type: "ready" });
