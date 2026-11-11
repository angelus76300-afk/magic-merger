import { BUILTIN, LAYERS, type Layer } from "./materials";

// The save format this code writes and reads (save.ts, SavedWorld.version).
export const SAVE_VERSION = 2;

// Why a save cannot be read by this code without losing part of it, or null
// when it can. A save written by newer code (after a Deploy rollback, or in a
// tab left open since before an update) may have a larger version, or more
// built-in materials than this code knows: cover ids past this code's list
// used to load as nothing (198 of 198 cells in the review of 10 November).
// Such a save is not loaded and never written over (worldhost.ts).
export function newerSave(data: unknown, builtin: Record<Layer, readonly unknown[]> = BUILTIN): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { version?: unknown; builtins?: unknown };
  if (typeof d.version === "number" && d.version > SAVE_VERSION) return `save version ${d.version}, this code reads ${SAVE_VERSION}`;
  const counts = d.builtins && typeof d.builtins === "object" ? (d.builtins as Partial<Record<Layer, unknown>>) : {};
  for (const layer of LAYERS) {
    const n = counts[layer];
    if (typeof n === "number" && n > builtin[layer].length) return `${n} built-in ${layer} materials, this code knows ${builtin[layer].length}`;
  }
  return null;
}
