import { tell } from "./kin";
import type { CastRequest, Runtime } from "./runtime";
import { noteCast } from "./troubles";
import type { World } from "./world";

// The player's cast, the same from a tap on the island and from the eyes of a
// creature (eyes.ts): the spell runs, the island's story hears of it (3.7),
// and cast at a trouble it may be its answer (troubles.ts). Engine.cast adds
// what only a screen has (the sound's place, the redraw).
export function playerCast(world: World, runtime: Runtime, req: CastRequest, x: number, y: number): boolean {
  const ok = runtime.cast(req, x, y);
  if (!ok) return false;
  tell(world, `a mage ${req.kind === "artifact" ? "placed" : "cast"} ${req.name}`, { x, y, weight: 0 });
  noteCast(world, req.key, req.name, "", x, y);
  return true;
}
