import { Engine, type WorldSize } from "./engine";
import { makeCreature } from "./creatures";
import type { FromWorld, ToWorld } from "./protocol";
import type { CastRequest, Runtime } from "./runtime";
import type { SavedWorld } from "./save";
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

function send(msg: FromWorld): void {
  window.parent.postMessage(msg, "*");
}

const hooks = {
  onError: (key: string, name: string, message: string) => send({ type: "error", key, name, message }),
  onTap: (x: number, y: number) => {
    if (!engine) return;
    if (!selected) {
      send({ type: "tap-without-spell" });
      return;
    }
    if (engine.cast(selected, x, y)) send({ type: "cast", key: selected.key });
  },
};

function mount(next: Engine): void {
  engine?.dispose();
  unbind?.();
  engine = next;
  engine.sound.muted = muted;
  unbind = engine.bindInput();
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
  const restored = sandbox.save ? Engine.restore(canvas, overlay, sandbox.save, hooks, loadRules(sandbox.rules)) : null;
  mount(restored ?? Engine.create(canvas, overlay, sandbox.size, hooks));
}

function openScenario(id: string): void {
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
  mount(next);
}

window.addEventListener("message", (e: MessageEvent<ToWorld>) => {
  if (e.source !== window.parent || !e.data || typeof e.data !== "object") return;
  const msg = e.data;
  switch (msg.type) {
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
      openScenario(msg.id);
      break;
    case "sandbox":
      if (scenario) openSandbox();
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
