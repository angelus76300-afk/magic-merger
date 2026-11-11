// A first cast the newcomer sees (2026-11-11, review of 10 November, section 7).
// The frame says where each cast is on screen for three seconds after it
// lands (castview.ts); this side checks nothing of the page covers it (a
// toast, a dialog) and records when a cast was first in sight for two
// seconds in a row: seconds from page load, on the page's root as
// data-first-cast-seen, which scripts/first-cast.mjs reads.

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
