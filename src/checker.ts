import type { CheckRequest } from "../shared/types";

// What a test run found, and how long its parts took (4.2, measured only).
export type CheckOutcome = Omit<CheckRequest, "name" | "id"> & { phases?: Record<string, number> };
import type { CastRequest } from "./sim/runtime";

// The test run of new programs, seen from the game page: a hidden sandboxed
// iframe (check.html) that casts a program on a scratch island and reports
// whether it crashed, did nothing visible, or wiped the island. Kept apart
// from the World frame so a program under test never touches the player's
// island, and so it also runs while the World tab was never opened.
export class Checker {
  private frame: HTMLIFrameElement | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private waiting = new Map<number, (r: CheckOutcome) => void>();

  // A frame that never says it is ready (a broken deploy of check.html, a
  // phone that killed the hidden frame) is dropped after this long, and the
  // test counts as a pass like a slow one does; the next check makes a new frame.
  private static readonly OPEN_MS = 15_000;

  private open(): Promise<void> {
    if (this.ready) return this.ready;
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "Spell test run";
    frame.style.cssText = "position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none;left:-10px;top:-10px";
    frame.src = import.meta.env.DEV ? "/check.html" : "/check";
    this.frame = frame;
    this.ready = new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (this.frame === frame) {
          this.frame = null;
          this.ready = null;
          frame.remove();
        }
        resolve();
      }, Checker.OPEN_MS);
      window.addEventListener("message", (e: MessageEvent<unknown>) => {
        if (e.source !== frame.contentWindow || e.origin !== "null") return;
        const m = e.data as { type?: string; id?: number; result?: Record<string, unknown> };
        if (m?.type === "check-ready") {
          clearTimeout(timer);
          resolve();
        }
        if (m?.type === "checked" && typeof m.id === "number") {
          const done = this.waiting.get(m.id);
          this.waiting.delete(m.id);
          done?.(readResult(m.result));
        }
      });
    });
    document.body.append(frame);
    return this.ready;
  }

  // Never rejects: a frame that does not answer in a minute counts as a pass,
  // so a slow phone cannot get a good program rewritten.
  async check(spell: CastRequest): Promise<CheckOutcome> {
    await this.open();
    if (!this.frame) return { ok: true, problem: null, detail: "The test run could not start" };
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.waiting.delete(id);
        resolve({ ok: true, problem: null, detail: "The test run did not finish in time" });
      }, 60_000);
      this.waiting.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.frame!.contentWindow!.postMessage({ type: "check", id, spell }, "*");
    });
  }
}

// The frame runs spell code, so its answer is checked for shape.
// Every problem the test run knows (src/sim/check.ts). Until 4.2 only the
// first three were read here, so a program that broke its promise (3.4.2) or
// stood idle for five minutes (3.7) reached the Worker as "not ok, no
// problem" and was promoted like a pass.
const PROBLEMS = ["crash", "nothing", "wiped", "promise", "idle"] as const;

function numbers(raw: unknown, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, max)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function readResult(raw: Record<string, unknown> | undefined): CheckOutcome {
  const problem = (PROBLEMS as readonly unknown[]).includes(raw?.problem) ? (raw!.problem as CheckOutcome["problem"]) : null;
  const ok = raw?.ok === true && !problem;
  // A failure the frame could not name is a crash, never a pass.
  return {
    ok,
    problem: ok ? null : (problem ?? "crash"),
    detail: typeof raw?.detail === "string" ? raw.detail.slice(0, 400) : "",
    stats: numbers(raw?.stats, 20),
    phases: numbers(raw?.phases, 8),
  };
}
