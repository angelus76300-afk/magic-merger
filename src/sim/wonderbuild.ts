import type { Runtime } from "./runtime";
import { TICK, type World } from "./world";
import { defRequest, type Wonder } from "./wonders";

// Wonders written as programs (4.4.5 part C): placed with the island by
// placeWonders, built here once the island has a runtime, before the view
// sees it. Their program is cast at the spot the generator found, as an
// artifact with its own reach, and runs to its end at once: a wonder has
// always been there. What it placed (an artifact, a landmark, materials,
// creatures) then lives with the island like anything a spell left.

// At most this many frames of a wonder's cast (its prompt asks for no wait).
const BUILD_TICKS = 300;

export function raiseWonders(world: World, rt: Runtime): void {
  const fresh = world.wonders.filter((w) => w.def && w.state === 0);
  if (!fresh.length) return;
  for (const w of fresh) {
    const req = defRequest(w.def!);
    // As a library cast: the camera is not pulled to it.
    if (!rt.cast(req, Math.round(w.x), Math.round(w.y), true)) {
      w.state = -1;
      continue;
    }
    w.state = 1;
  }
  for (let k = 0; k < BUILD_TICKS && rt.pending(); k++) rt.step(TICK);
  ownCreatures(world, rt);
  // Its flashes and sounds were for nobody.
  world.events.length = 0;
}

// After a reload: the programs of the island's wonders are compiled again,
// so the materials, creatures and artifacts they brought have their rules.
export function reloadWonders(wonders: readonly Wonder[], rt: Runtime): void {
  for (const w of wonders) {
    if (!w.def) continue;
    try {
      rt.compile(defRequest(w.def));
    } catch {
      // A program that no longer compiles keeps its land; its rules fall back.
    }
  }
}

// The creature kinds each program wonder brought, for the cap in stepWonders.
export function ownCreatures(world: World, rt: Runtime): void {
  for (const w of world.wonders) {
    if (!w.def) continue;
    const key = defRequest(w.def).key;
    w.own = [...rt.owners].filter(([rule, owner]) => owner === key && rule.startsWith("creature:")).map(([rule]) => rule.slice("creature:".length));
  }
}
