import type { ProgressBoard, ProgressDiscovery, ProgressDoc, ProgressIsland } from "../shared/account";
import * as api from "./api";
import { owner } from "./device-save";
import { ago } from "./people";
import type { Store } from "./store";
import { toast } from "./toast";
import { WORLD_AT_KEY, hasIsland, readIslandGz, readIslandText, storeIslandGz } from "./island-store";

// 4.0: the account's progress on the server, kept in step with this device.
// Discoveries are a union by key (the earliest time wins), on the device and
// since 4.4.6 on the server too; the board follows; the island is last saved
// wins, and when another device saved a newer one the player is offered both.
// 4.4.6: only a save tagged with this account goes up (device-save.ts); what
// was last saved and when is said in the ? menu; "Sync now" does it at once;
// a light pull every minute brings what another device found.

const SEEN_KEY = "magic-merger.sync";
const ISLAND_EVERY_MS = 60_000;
const PULL_EVERY_MS = 60_000;

interface Seen {
  discoveries?: number;
  board?: number;
  island?: number;
  // 4.4.6: this device's island (its WORLD_AT_KEY) when it last matched the
  // account's, so a newer island from elsewhere over an unchanged one here
  // is taken with no question, and over a changed one the player chooses.
  islandLocal?: string;
  // When this device last saved to the account.
  savedAt?: number;
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

function localAt(): string {
  try {
    return localStorage.getItem(WORLD_AT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const m = /\((?:iPhone|iPad|Android|Windows|Macintosh|Linux|CrOS)[^)]*\)/.exec(ua);
  return (m ? m[0].slice(1, -1).split(";")[0] : "this device").slice(0, 60);
}

type Choice = "this" | "other" | "later";

// Two islands: this device's, and a newer one another device saved. The one
// not played is kept on the account as the previous island (worker/accounts.ts).
function chooseIsland(device: string | null, updatedAt: number): Promise<Choice> {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "card island-choice";
    d.innerHTML = `
      <div class="card-head">
        <span class="card-emoji">🏝️</span>
        <div><h2 class="card-name">Two islands</h2></div>
        <button class="card-close" aria-label="Later">×</button>
      </div>
      <p class="choice-text"></p>
      <button class="card-cast choice-other"></button>
      <button class="choice-this">Keep this device's island</button>
    `;
    const where = device ?? "another device";
    d.querySelector(".choice-text")!.textContent =
      `Your island was saved from ${where} ${ago(updatedAt)} (${new Date(updatedAt).toLocaleString()}), and this device's island changed since it last looked. Which one do you play? The other stays on your account as the previous island: the account page brings it back.`;
    d.querySelector(".choice-other")!.textContent = `Load the island from ${where}`;
    const done = (c: Choice) => {
      d.close();
      d.remove();
      resolve(c);
    };
    d.querySelector(".choice-other")!.addEventListener("click", () => done("other"));
    d.querySelector(".choice-this")!.addEventListener("click", () => done("this"));
    d.querySelector(".card-close")!.addEventListener("click", () => done("later"));
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      done("later");
    });
    document.body.append(d);
    d.showModal();
  });
}

export class Sync {
  private seen = readSeen();
  private discoveriesTimer = 0;
  private islandTimer = 0;
  private pullTimer = 0;
  private islandDirty = false;
  private busy = false;
  private offline = false;
  private refused = false;
  // The account this page's session belongs to; nothing goes up before it is known.
  private account: string | null = null;
  // A newer island another device saved, seen by the pull, not loaded yet.
  islandNews: { device: string | null; updatedAt: number } | null = null;
  // Told when discoveries came down from another device, and when the status changed.
  onPulled: (() => void) | null = null;
  onStatus: (() => void) | null = null;

  constructor(private store: Store) {
    window.addEventListener("online", () => {
      if (this.account) void this.now(false);
    });
  }

  // Only this account's own save goes up (4.4.6).
  private mine(): boolean {
    return api.hasSession() && !!this.account && owner() === this.account;
  }

  private ok(): void {
    this.offline = false;
    this.refused = false;
    this.seen.savedAt = Date.now();
    writeSeen(this.seen);
    this.onStatus?.();
  }

  private failed(err: unknown): void {
    if (err instanceof api.ApiRequestError && err.status === 0) this.offline = true;
    if (err instanceof api.ApiRequestError && err.status === 409 && (err.detail as { owner?: string } | undefined)?.owner) this.refused = true;
    this.onStatus?.();
  }

  // What the ? menu says.
  status(): string {
    if (!api.hasSession()) return "Not signed in: your progress stays on this device only.";
    if (this.refused || (this.account && owner() !== this.account)) return "Not saved: the save on this device belongs to another account.";
    if (this.offline) return "Not saved: offline. It goes up when the connection is back.";
    const pending = this.islandDirty || !!this.discoveriesTimer;
    if (this.seen.savedAt) return `Saved to your account ${ago(this.seen.savedAt)}${pending ? ", newer changes go up within a minute" : ""}.`;
    return pending ? "Saving to your account…" : "Nothing saved to your account yet.";
  }

  // Signed in: the server's progress joins this device's, then this device
  // keeps the server up to date. Returns what came down, for the toast.
  async start(account: string): Promise<{ discoveries: number; island: "kept" | "replaced" | "none" }> {
    this.account = account;
    const out = { discoveries: 0, island: "none" as "kept" | "replaced" | "none" };
    if (!this.mine()) return out;
    let docs: ProgressDoc[];
    try {
      docs = (await api.account.progress()).progress;
    } catch (err) {
      this.failed(err);
      return out;
    }
    out.discoveries = this.takeDiscoveries(docs);
    const board = docs.find((d) => d.kind === "board");
    if (board && board.data && !this.store.board().length) {
      this.store.importBoard(board.data as ProgressBoard);
      this.seen.board = board.updatedAt;
    }
    const island = docs.find((d) => d.kind === "island");
    if (island && island.data) out.island = await this.takeIsland(island, true);
    writeSeen(this.seen);
    // Whatever this device had and the server did not.
    await this.pushDiscoveries();
    if (out.island !== "replaced") await this.pushIsland();
    this.store.onChange = () => this.discoveriesSoon();
    this.schedulePull();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void this.pull();
    });
    return out;
  }

  private takeDiscoveries(docs: ProgressDoc[]): number {
    const disc = docs.find((d) => d.kind === "discoveries");
    if (!disc || !Array.isArray(disc.data)) return 0;
    const added = this.store.importDiscoveries(disc.data as ProgressDiscovery[]);
    this.seen.discoveries = disc.updatedAt;
    return added;
  }

  // The account's island against this device's: taken when this device has
  // none, or has not changed since it last matched the account's; otherwise
  // the player chooses (asked = false only defers the question).
  private async takeIsland(island: ProgressDoc, ask: boolean): Promise<"kept" | "replaced" | "none"> {
    const remote = island.data as ProgressIsland;
    const news = island.updatedAt > (this.seen.island ?? 0);
    if (hasIsland() && !news) return "kept";
    const unchanged = !!this.seen.islandLocal && this.seen.islandLocal === localAt();
    if (!hasIsland() || unchanged) return this.storeRemote(island, remote) ? "replaced" : "kept";
    if (!ask) {
      this.islandNews = { device: island.device, updatedAt: island.updatedAt };
      this.onStatus?.();
      return "kept";
    }
    const choice = await chooseIsland(island.device, island.updatedAt);
    if (choice === "later") {
      this.islandNews = { device: island.device, updatedAt: island.updatedAt };
      return "kept";
    }
    if (choice === "this") {
      // Played here: forced over the newer one, which the Worker keeps as the
      // account's previous island (it sees this device's older "since").
      this.islandDirty = true;
      await this.pushIsland(true);
      return "kept";
    }
    // The other one: this device's goes to the account as the previous island first.
    await this.keepLocalAsPrevious();
    return this.storeRemote(island, remote) ? "replaced" : "kept";
  }

  private storeRemote(island: ProgressDoc, remote: ProgressIsland): boolean {
    try {
      // Kept as it came, gzipped (4.4): a giant island fits.
      storeIslandGz(remote.gz, remote.at);
    } catch {
      // An island this device cannot keep: its own stays.
      return false;
    }
    this.seen.island = island.updatedAt;
    this.seen.islandLocal = localAt();
    this.islandNews = null;
    writeSeen(this.seen);
    return true;
  }

  private async keepLocalAsPrevious(): Promise<void> {
    const data = await this.packedIsland();
    if (!data) return;
    try {
      await api.account.putProgress({ kind: "island", data, previous: true, device: deviceName(), owner: this.account });
    } catch (err) {
      this.failed(err);
    }
  }

  // Called after every world save on this device; the island goes up a
  // minute later at most, and when the page is hidden.
  islandSaved(): void {
    this.islandDirty = true;
    if (!this.islandTimer) this.islandTimer = window.setTimeout(() => void this.pushIsland(), ISLAND_EVERY_MS);
  }

  flush(): void {
    if (this.islandDirty) void this.pushIsland();
    void this.pushDiscoveries();
  }

  // "Sync now": what other devices saved comes down, everything of this
  // device goes up, and a newer island from elsewhere is offered at once.
  // True when the account holds this device's progress afterwards.
  async now(ask = true): Promise<boolean> {
    if (!this.mine()) return false;
    await this.pull(ask);
    await this.pushDiscoveries();
    await this.pushIsland();
    return !this.offline && !this.refused;
  }

  // The previous island (the one a choice left out), back in play; this
  // device's island takes its place as the previous one.
  async restorePrevious(): Promise<void> {
    if (!this.mine()) return;
    try {
      const prev = (await api.account.progress(["island_previous"])).progress.find((p) => p.kind === "island_previous");
      if (!prev) return;
      await this.keepLocalAsPrevious();
      const remote = prev.data as ProgressIsland;
      storeIslandGz(remote.gz, remote.at);
      this.islandDirty = true;
      toast("The previous island is loading…");
      window.setTimeout(() => location.reload(), 800);
    } catch (err) {
      this.failed(err);
      toast("The previous island could not be loaded", "error");
    }
  }

  // The newer island the pull saw, loaded now (from the ? menu).
  async loadNews(): Promise<void> {
    if (!this.mine()) return;
    try {
      const island = (await api.account.progress(["island"])).progress.find((p) => p.kind === "island");
      if (!island) return;
      await this.keepLocalAsPrevious();
      if (this.storeRemote(island, island.data as ProgressIsland)) {
        toast("The other island is loading…");
        window.setTimeout(() => location.reload(), 800);
      }
    } catch (err) {
      this.failed(err);
      toast("The other island could not be loaded", "error");
    }
  }

  private schedulePull(): void {
    clearTimeout(this.pullTimer);
    this.pullTimer = window.setTimeout(() => {
      void this.pull().finally(() => this.schedulePull());
    }, PULL_EVERY_MS);
  }

  // Discoveries from other devices (small), and whether the island changed elsewhere.
  private async pull(ask = false): Promise<void> {
    if (!this.mine() || document.hidden) return;
    try {
      const docs = (await api.account.progress(["discoveries"])).progress;
      if (this.takeDiscoveries(docs)) this.onPulled?.();
      writeSeen(this.seen);
      const info = await api.account.info();
      const meta = info.progress.find((p) => p.kind === "island");
      if (meta && meta.updatedAt > (this.seen.island ?? 0) && (ask || !this.islandNews || this.islandNews.updatedAt !== meta.updatedAt)) {
        const island = (await api.account.progress(["island"])).progress.find((p) => p.kind === "island");
        if (island) {
          const r = await this.takeIsland(island, ask);
          if (r === "replaced") {
            toast(`Your island from ${island.device ?? "another device"} is loading…`);
            window.setTimeout(() => location.reload(), 900);
          } else if (this.islandNews) toast(`A newer island was saved from ${island.device ?? "another device"}: the ? menu loads it.`);
        }
      }
      this.offline = false;
      this.onStatus?.();
    } catch (err) {
      this.failed(err);
    }
  }

  private discoveriesSoon(): void {
    clearTimeout(this.discoveriesTimer);
    this.discoveriesTimer = window.setTimeout(() => {
      this.discoveriesTimer = 0;
      void this.pushDiscoveries();
    }, 5000);
    this.onStatus?.();
  }

  // What the server holds was last seen by this tab or another tab of this
  // browser (4.0 review M6): the newest of both, so an upload from one tab
  // never reads as an older device to the other.
  private refreshSeen(): void {
    const stored = readSeen();
    for (const k of ["discoveries", "board", "island", "savedAt"] as const) {
      const v = Math.max(this.seen[k] ?? 0, stored[k] ?? 0);
      if (v) this.seen[k] = v;
    }
    if (stored.islandLocal && (stored.island ?? 0) >= (this.seen.island ?? 0)) this.seen.islandLocal = stored.islandLocal;
  }

  async pushDiscoveries(): Promise<void> {
    if (!this.mine()) return;
    this.refreshSeen();
    const device = deviceName();
    try {
      const r = await api.account.putProgress({
        kind: "discoveries",
        data: this.store.exportDiscoveries(),
        since: this.seen.discoveries,
        force: true,
        device,
        owner: this.account,
      });
      this.seen.discoveries = r.updatedAt;
      const b = await api.account.putProgress({
        kind: "board",
        data: this.store.exportBoard(),
        since: this.seen.board,
        force: true,
        device,
        owner: this.account,
      });
      this.seen.board = b.updatedAt;
      this.ok();
    } catch (err) {
      // Tried again on the next change.
      this.failed(err);
    }
  }

  private async packedIsland(): Promise<ProgressIsland | null> {
    const at = Number(localAt() || Date.now());
    const text = await readIslandText();
    const gz = await readIslandGz();
    if (!text || !gz) return null;
    const w = (JSON.parse(text) as { w?: number }).w ?? 0;
    const size = w >= 380 ? "giant" : w >= 280 ? "huge" : w >= 200 ? "large" : w >= 140 ? "medium" : "small";
    return { gz, size, at };
  }

  // The island: refused when another device saved a newer one since this
  // device last looked; the player is offered both.
  async pushIsland(force = false): Promise<void> {
    clearTimeout(this.islandTimer);
    this.islandTimer = 0;
    if (!this.mine() || this.busy) return;
    this.refreshSeen();
    if (!hasIsland()) return;
    if (!force && !this.islandDirty && this.seen.islandLocal === localAt()) return;
    this.busy = true;
    let conflict: { updatedAt: number; device: string | null } | null = null;
    try {
      const data = await this.packedIsland();
      if (!data) return;
      const sentAt = localAt();
      const r = await api.account.putProgress({ kind: "island", data, since: this.seen.island, force, device: deviceName(), owner: this.account });
      this.seen.island = r.updatedAt;
      this.seen.islandLocal = sentAt;
      this.islandDirty = false;
      this.islandNews = null;
      this.ok();
    } catch (err) {
      this.failed(err);
      if (err instanceof api.ApiRequestError && err.status === 409 && !(err.detail as { owner?: string } | undefined)?.owner) {
        const d = err.detail as { updatedAt?: number; device?: string } | undefined;
        conflict = { updatedAt: d?.updatedAt ?? Date.now(), device: d?.device ?? null };
      }
    } finally {
      this.busy = false;
    }
    if (!conflict) return;
    try {
      const island = (await api.account.progress(["island"])).progress.find((x) => x.kind === "island");
      if (!island) return;
      const r = await this.takeIsland(island, true);
      if (r === "replaced") {
        toast("The other island is loading…");
        window.setTimeout(() => location.reload(), 800);
      }
    } catch (err) {
      this.failed(err);
      toast("The other island could not be read", "error");
    }
  }
}
