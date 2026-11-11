// A first cast the newcomer sees (2026-11-11, review of 10 November, section 7).
// The frame says where each cast is on screen for three seconds after it
// lands (castview.ts); this side checks nothing of the page covers it (a
// toast, a dialog) and records when a cast was first in sight for two
// seconds in a row: seconds from page load, on the page's root as
// data-first-cast-seen, which scripts/first-cast.mjs reads.

import { setToastFloor } from "./toast";
import "./firstcast.css";

const SEEN_MS = 2000;

export class FirstCastProbe {
  private runs = new Map<number, number>();
  seenAt: number | null = null;

  view(frame: HTMLIFrameElement, n: number, x: number | null, y: number | null): void {
    if (this.seenAt !== null) return;
    const now = performance.now();
    if (x === null || y === null || !inSight(frame, x, y)) {
      this.runs.delete(n);
      return;
    }
    const start = this.runs.get(n) ?? now;
    this.runs.set(n, start);
    if (now - start >= SEEN_MS) {
      this.seenAt = now;
      document.documentElement.dataset.firstCastSeen = (now / 1000).toFixed(1);
    }
  }
}

// A point of the frame, in its CSS pixels, is on screen and under no part of
// the page: not a toast (they let taps through, so elementFromPoint misses
// them), not a dialog, not the bars over the island.
function inSight(frame: HTMLIFrameElement, x: number, y: number): boolean {
  const r = frame.getBoundingClientRect();
  const px = r.left + x;
  const py = r.top + y;
  if (px < 0 || py < 0 || px >= window.innerWidth || py >= window.innerHeight) return false;
  if (document.elementFromPoint(px, py) !== frame) return false;
  for (const t of document.querySelectorAll(".toast")) {
    const b = t.getBoundingClientRect();
    if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) return false;
  }
  return true;
}

const HINT_KEY = "magic-merger.hint.move";
const HINT_AFTER_MS = 3000;
const NEWS_AFTER_MS = 4500;

// What waits for the first cast of this visit to land and be held for three
// seconds: one line on how to move the island (shown once per browser), then
// what the World had to say (the week's new wonders).
export class FirstCastGuide {
  private landed = false;
  private waiting: (() => void)[] = [];
  private hint: HTMLElement | null = null;

  afterFirstCast(say: () => void): void {
    if (this.landed) say();
    else this.waiting.push(say);
  }

  cast(stage: HTMLElement): void {
    if (this.landed) return;
    this.landed = true;
    window.setTimeout(() => this.showHint(stage), HINT_AFTER_MS);
    window.setTimeout(() => {
      for (const say of this.waiting.splice(0)) say();
    }, NEWS_AFTER_MS);
  }

  private showHint(stage: HTMLElement): void {
    if (readSeen() || !stage.isConnected || !stage.getClientRects().length) return;
    writeSeen();
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const box = document.createElement("div");
    box.className = "move-hint";
    box.setAttribute("role", "status");
    const text = document.createElement("p");
    text.textContent = touch
      ? "One finger turns the island. Two fingers move it; pinch to zoom."
      : "Drag to turn the island. Shift drag moves it; the wheel zooms.";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "Got it";
    ok.addEventListener("click", () => this.hideHint());
    box.append(text, ok);
    stage.append(box);
    this.hint = box;
    setToastFloor("hint", box.getBoundingClientRect().bottom);
  }

  hideHint(): void {
    this.hint?.remove();
    this.hint = null;
    setToastFloor("hint", 0);
  }
}

function readSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Storage full or off: the hint may show once more, no harm.
  }
}
