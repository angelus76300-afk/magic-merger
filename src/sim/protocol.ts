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
  | { type: "sandbox" }
  | { type: "hud"; on: boolean };

// The iframe runs code nobody reviewed, so whatever it sends is checked for
// shape and size before the page acts on it. Returns null for anything else.
export function readFromWorld(data: unknown): FromWorld | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  switch (m.type) {
    case "ready":
    case "tap-without-spell":
      return { type: m.type };
    case "save":
      return m.data && typeof m.data === "object" ? { type: "save", data: m.data as SavedWorld } : null;
    case "cast":
      return str(m.key, 120) ? { type: "cast", key: m.key as string } : null;
    case "error":
      return str(m.key, 120) && str(m.name, 120) && typeof m.message === "string"
        ? { type: "error", key: m.key as string, name: m.name as string, message: m.message.slice(0, 400) }
        : null;
    case "perf":
      return m.sample && typeof m.sample === "object" && JSON.stringify(m.sample).length < 2000
        ? { type: "perf", sample: m.sample as Record<string, number> }
        : null;
    case "objective":
      return str(m.id, 40) && typeof m.text === "string" && (m.status === "playing" || m.status === "won" || m.status === "lost")
        ? { type: "objective", id: m.id as string, text: m.text.slice(0, 200), status: m.status }
        : null;
  }
  return null;
}

// Largest world save the page will store, in characters of JSON.
export const MAX_SAVE_CHARS = 3_000_000;

export type FromWorld =
  | { type: "ready" }
  | { type: "save"; data: SavedWorld }
  | { type: "cast"; key: string }
  | { type: "tap-without-spell" }
  | { type: "error"; key: string; name: string; message: string }
  | { type: "objective"; id: string; text: string; status: "playing" | "won" | "lost" }
  | { type: "perf"; sample: Record<string, number> };
