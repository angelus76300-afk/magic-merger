import { readDigest, type ChronicleDigest } from "../../shared/chronicle";
import type { CastRequest } from "./runtime";
import type { SavedWorld } from "./save";
import type { WorldSize } from "./engine";
import type { LandChoice } from "./land-options";

// Messages between the game page and the sandboxed World iframe. The iframe
// runs Claude's spell code, so it has no origin of its own and no network:
// everything it needs comes in here, everything it says goes out here.

export type ToWorld =
  // recent (4.4.5 part B): the wonder sets of the player's last ten islands.
  // wonders (4.4.5 part C): the live pool of wonders written as programs.
  | { type: "init"; save: SavedWorld | null; size: WorldSize; land: LandChoice; rules: CastRequest[]; muted: boolean; recent?: string[]; wonders?: unknown[] }
  | { type: "select"; spell: CastRequest | null }
  | { type: "spell-updated"; spell: CastRequest }
  | { type: "villager" }
  // 4.4.1: the sliders and the seed (null for a new one); the seed picks
  // the shape and the land.
  | { type: "reset"; size: WorldSize; land: LandChoice; seed: number | null; recent?: string[] }
  // The pool of wonders written as programs, when it arrives or changes (4.4.5 part C).
  | { type: "wonders"; list: unknown[] }
  | { type: "mute"; muted: boolean }
  | { type: "visible"; visible: boolean }
  // ahead: seconds of the hazard already played while the player merged (3.7).
  | { type: "scenario"; id: string; ahead?: number }
  | { type: "sandbox" }
  | { type: "hud"; on: boolean }
  // Spells from the shared library the world asked for by name (3.7).
  | { type: "library"; spells: CastRequest[] }
  // What the island's chronicle is written from (3.7).
  | { type: "chronicle" };

// The iframe runs code nobody reviewed, so whatever it sends is checked for
// shape and size before the page acts on it. Returns null for anything else.
export function readFromWorld(data: unknown): FromWorld | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  switch (m.type) {
    case "ready":
    case "alive":
    case "tap-without-spell":
    case "escape":
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
    case "headroom": {
      const h = m.sample as Record<string, unknown> | null;
      const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e6;
      return h && typeof h === "object" && num(h.w) && num(h.simP95) && num(h.frameP95) && num(h.frames)
        ? { type: "headroom", sample: { w: h.w as number, simP95: h.simP95 as number, frameP95: h.frameP95 as number, frames: h.frames as number } }
        : null;
    }
    case "chronicle": {
      const digest = readDigest(m.digest);
      return digest ? { type: "chronicle", digest } : null;
    }
    case "island":
      return str(m.name, 40) && typeof m.signature === "string" && m.signature.length <= 300
        ? { type: "island", name: m.name as string, signature: m.signature }
        : null;
    case "need":
      return Array.isArray(m.names) && m.names.length <= 20 && m.names.every((n) => str(n, 120)) ? { type: "need", names: m.names as string[] } : null;
    case "objective":
      return str(m.id, 40) && typeof m.text === "string" && (m.status === "playing" || m.status === "won" || m.status === "lost")
        ? { type: "objective", id: m.id as string, text: m.text.slice(0, 200), status: m.status }
        : null;
  }
  return null;
}

// Largest world save the page will store, in characters of JSON. Browsers
// keep about 5 MB per site as UTF-16, so 1.5M characters (3 MB) leaves room
// for the discoveries (4.0 review M13; a large island is about 0.75M).
export const MAX_SAVE_CHARS = 1_500_000;

export type FromWorld =
  | { type: "ready" }
  // A heartbeat every two seconds: a frame stuck in spell code stops it (M3).
  | { type: "alive" }
  | { type: "save"; data: SavedWorld }
  | { type: "cast"; key: string }
  | { type: "tap-without-spell" }
  // Escape pressed on the island: the page closes what it shows (the vote).
  | { type: "escape" }
  | { type: "error"; key: string; name: string; message: string }
  | { type: "objective"; id: string; text: string; status: "playing" | "won" | "lost" }
  | { type: "perf"; sample: Record<string, number> }
  // 4.4: the frame numbers of the island being played, every 30 seconds,
  // whether the HUD is shown or not: what bigger islands are offered from.
  | { type: "headroom"; sample: { w: number; simP95: number; frameP95: number; frames: number } }
  // Names of library spells creatures or artifacts want to cast (3.7).
  | { type: "need"; names: string[] }
  | { type: "chronicle"; digest: ChronicleDigest }
  // A new island was made (4.4.5 part B): its name and its wonders' set, for
  // the page to keep with the last ten.
  | { type: "island"; name: string; signature: string };
