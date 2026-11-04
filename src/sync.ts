import type { ProgressBoard, ProgressDiscovery, ProgressIsland } from "../shared/account";
import * as api from "./api";
import type { Store } from "./store";
import { toast } from "./toast";
import { WORLD_AT_KEY, hasIsland, readIslandGz, readIslandText, storeIslandGz } from "./island-store";

// 4.0: the account's progress on the server, kept in step with this device.
// Discoveries are a union by key (the earliest time wins); the board follows;
// the island is last saved wins, with a warning before an older device
// replaces a newer save from another one.

const SEEN_KEY = "magic-merger.sync";
const ISLAND_EVERY_MS = 60_000;

interface Seen {
  discoveries?: number;
  board?: number;
  island?: number;
}

function readSeen(): Seen {
  try {
    return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Seen) ?? {};
  } catch {
    return {};
  }
}

function writeSeen(seen: Seen): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // kept for this page
  }
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const m = /\((?:iPhone|iPad|Android|Windows|Macintosh|Linux|CrOS)[^)]*\)/.exec(ua);
  return (m ? m[0].slice(1, -1).split(";")[0] : "this device").slice(0, 60);
}

export class Sync {
  private seen = readSeen();
  private discoveriesTimer = 0;
  private islandTimer = 0;
  private islandDirty = false;
  private busy = false;

  constructor(private store: Store) {}

  // Signed in: the server's progress joins this device's, then this device
  // keeps the server up to date. Returns what came down, for the toast.
  async start(): Promise<{ discoveries: number; island: "kept" | "replaced" | "none" }> {
    const out = { discoveries: 0, island: "none" as "kept" | "replaced" | "none" };
    let docs;
    try {
      docs = (await api.account.progress()).progress;
    } catch {
      return out;
    }
    const disc = docs.find((d) => d.kind === "discoveries");
    if (disc && Array.isArray(disc.data)) {
      out.discoveries = this.store.importDiscoveries(disc.data as ProgressDiscovery[]);
      this.seen.discoveries = disc.updatedAt;
    }
    const board = docs.find((d) => d.kind === "board");
    if (board && board.data && !this.store.board().length) {
      this.store.importBoard(board.data as ProgressBoard);
      this.seen.board = board.updatedAt;
    }
    const island = docs.find((d) => d.kind === "island");
    if (island && island.data) {
      const remote = island.data as ProgressIsland;
      const localAt = Number(localStorage.getItem(WORLD_AT_KEY) ?? 0);
      if (!hasIsland() || remote.at > localAt) {
        try {
          // Kept as it came, gzipped (4.4): a giant island fits.
          storeIslandGz(remote.gz, remote.at);
          out.island = "replaced";
        } catch {
          // An island this device cannot unpack: its own stays.
        }
      } else out.island = "kept";
      this.seen.island = island.updatedAt;
    }
    writeSeen(this.seen);
    // Whatever this device had and the server did not.
    await this.pushDiscoveries();
    if (out.island !== "replaced") await this.pushIsland();
    this.store.onChange = () => this.discoveriesSoon();
    return out;
  }

  // Called after every world save on this device; the island goes up every
  // two minutes at most, and when the page is hidden.
  islandSaved(): void {
    this.islandDirty = true;
    if (!this.islandTimer) this.islandTimer = window.setTimeout(() => void this.pushIsland(), ISLAND_EVERY_MS);
  }

  flush(): void {
    if (this.islandDirty) void this.pushIsland();
    void this.pushDiscoveries();
  }

  private discoveriesSoon(): void {
    clearTimeout(this.discoveriesTimer);
    this.discoveriesTimer = window.setTimeout(() => void this.pushDiscoveries(), 5000);
  }

  // What the server holds was last seen by this tab or another tab of this
  // browser (4.0 review M6): the newest of both, so an upload from one tab
  // never reads as an older device to the other.
  private refreshSeen(): void {
    const stored = readSeen();
    for (const k of ["discoveries", "board", "island"] as const) {
      const v = Math.max(this.seen[k] ?? 0, stored[k] ?? 0);
      if (v) this.seen[k] = v;
    }
  }

  async pushDiscoveries(): Promise<void> {
    if (!api.hasSession()) return;
    this.refreshSeen();
    const device = deviceName();
    try {
      const r = await api.account.putProgress({ kind: "discoveries", data: this.store.exportDiscoveries(), since: this.seen.discoveries, force: true, device });
      this.seen.discoveries = r.updatedAt;
      const b = await api.account.putProgress({ kind: "board", data: this.store.exportBoard(), since: this.seen.board, force: true, device });
      this.seen.board = b.updatedAt;
      writeSeen(this.seen);
    } catch {
      // Tried again on the next change.
    }
  }

  // The island: refused when another device saved a newer one since this
  // device last looked; the player decides.
  async pushIsland(force = false): Promise<void> {
    clearTimeout(this.islandTimer);
    this.islandTimer = 0;
    if (!api.hasSession() || this.busy) return;
    this.refreshSeen();
    if (!hasIsland()) return;
    this.busy = true;
    try {
      const at = Number(localStorage.getItem(WORLD_AT_KEY) ?? Date.now());
      const text = await readIslandText();
      const gz = await readIslandGz();
      if (!text || !gz) return;
      const w = (JSON.parse(text) as { w?: number }).w ?? 0;
      const size = w >= 380 ? "giant" : w >= 280 ? "huge" : w >= 200 ? "large" : w >= 140 ? "medium" : "small";
      const data: ProgressIsland = { gz, size, at };
      const r = await api.account.putProgress({ kind: "island", data, since: this.seen.island, force, device: deviceName() });
      this.seen.island = r.updatedAt;
      this.islandDirty = false;
      writeSeen(this.seen);
    } catch (err) {
      if (err instanceof api.ApiRequestError && err.status === 409) {
        const d = err.detail as { updatedAt?: number; device?: string } | undefined;
        const when = d?.updatedAt ? new Date(d.updatedAt).toLocaleString() : "lately";
        if (
          window.confirm(
            `Your island was saved from ${d?.device ?? "another device"} on ${when}, after this device last looked. Replace it with this device's island? Cancel keeps the other one and loads it here.`,
          )
        ) {
          this.busy = false;
          await this.pushIsland(true);
          return;
        }
        try {
          const docs = (await api.account.progress()).progress;
          const island = docs.find((x) => x.kind === "island");
          if (island) {
            const remote = island.data as ProgressIsland;
            storeIslandGz(remote.gz, remote.at);
            this.seen.island = island.updatedAt;
            writeSeen(this.seen);
            toast("The other island is loading…");
            window.setTimeout(() => location.reload(), 800);
          }
        } catch {
          toast("The other island could not be loaded", "error");
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
