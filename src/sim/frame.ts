import { Engine, type WorldSize } from "./engine";
import { makeCreature } from "./creatures";
import type { FromWorld, ToWorld } from "./protocol";
import type { CastRequest } from "./runtime";

// Entry point of the World iframe (world.html). It owns the simulation and
// runs spell programs; the parent page owns the player's data and the API.

const canvas = document.getElementById("world") as HTMLCanvasElement;
let engine: Engine | null = null;
let selected: CastRequest | null = null;
let muted = false;
let saveTimer = 0;
let unbind: (() => void) | null = null;

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
  engine?.stop();
  unbind?.();
  engine = next;
  engine.sound.muted = muted;
  unbind = engine.bindInput();
  engine.start();
}

function save(): void {
  if (engine) send({ type: "save", data: engine.save() });
}

window.addEventListener("message", (e: MessageEvent<ToWorld>) => {
  if (e.source !== window.parent || !e.data || typeof e.data !== "object") return;
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      muted = msg.muted;
      let restored: Engine | null = null;
      if (msg.save) {
        restored = Engine.restore(canvas, msg.save, hooks, (rt) => {
          for (const spell of msg.rules) {
            try {
              rt.compile(spell);
            } catch {
              // A broken spell loses its custom materials; the cells fall back.
            }
          }
        });
      }
      mount(restored ?? Engine.create(canvas, msg.size, hooks));
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
        const c = makeCreature("villager", engine.camera.x, engine.camera.y);
        engine.world.creatures.push(c);
      }
      break;
    case "reset":
      if (engine) engine.stop();
      mount(Engine.create(canvas, msg.size, hooks));
      save();
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
