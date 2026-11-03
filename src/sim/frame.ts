import { chronicleDigest } from "./chronicle";
import { Engine, type WorldSize } from "./engine";
import { kindOf, makeCreature, maxHp, type Creature } from "./creatures";
import { artifactAt, creatureAt, inspect, inspectArtifact } from "./inspect";
import type { Artifact } from "./artifacts";
import type { FromWorld, ToWorld } from "./protocol";
import type { CastRequest, Runtime } from "./runtime";
import type { SavedWorld } from "./save";
import { Hud } from "./hud";
import { SCENARIOS } from "./scenarios";

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
let sandbox: { save: SavedWorld | null; size: WorldSize; rules: CastRequest[] } = { save: null, size: "medium", rules: [] };
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
      if (c) showInspect(c);
      else if (a) showInspect(null, a);
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
  mount(restored ?? Engine.create(canvas, overlay, sandbox.size, hooks));
}

function openScenario(id: string, ahead = 0): void {
  const def = SCENARIOS.find((s) => s.id === id);
  if (!def) return;
  save();
  scenario = id;
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
      sandbox = { save: msg.save, size: msg.size, rules: msg.rules };
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
        openScenario(scenario);
        break;
      }
      sandbox.size = msg.size;
      mount(Engine.create(canvas, overlay, msg.size, hooks));
      save();
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

send({ type: "ready" });
