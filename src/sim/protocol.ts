import type { CastRequest } from "./runtime";
import type { SavedWorld } from "./save";
import type { WorldSize } from "./engine";

// Messages between the game page and the sandboxed World iframe. The iframe
// runs Claude's spell code, so it has no origin of its own and no network:
// everything it needs comes in here, everything it says goes out here.

export type ToWorld =
  | { type: "init"; save: SavedWorld | null; size: WorldSize; rules: CastRequest[]; muted: boolean }
  | { type: "select"; spell: CastRequest | null }
  | { type: "spell-updated"; spell: CastRequest }
  | { type: "villager" }
  | { type: "reset"; size: WorldSize }
  | { type: "mute"; muted: boolean }
  | { type: "visible"; visible: boolean }
  | { type: "scenario"; id: string }
  | { type: "sandbox" };

export type FromWorld =
  | { type: "ready" }
  | { type: "save"; data: SavedWorld }
  | { type: "cast"; key: string }
  | { type: "tap-without-spell" }
  | { type: "error"; key: string; name: string; message: string }
  | { type: "objective"; id: string; text: string; status: "playing" | "won" | "lost" };
