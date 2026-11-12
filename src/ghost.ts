// The click a touch sends after it was pressed in the island's frame, landing on the page.
//
// The eye view hides the page's header; its Let go and Behind buttons act as the finger comes
// down (press.ts). The header comes back at once, under that finger, and the click the touch
// sends when it lifts lands on the header's Sign in: the account dialog opened (the playtest of
// 12 November). So, once the eye view ends, a click on the page is swallowed when no finger came
// down on the page since: it began in the frame. A click from a new press acts as always.
// Long enough for a click held back behind slow frames (800 ms each, drawn in software).
const GHOST_MS = 5000;
let armedAt = -Infinity;
let downAt = -Infinity;

/** The eye view just ended: the next click without a press on the page is a ghost. */
export function armGhostGuard(now: number): void {
  armedAt = now;
}

/** A finger or a mouse came down on the page itself. */
export function pageDown(now: number): void {
  downAt = now;
}

/** A click reached the page: true when it is the ghost of a press in the frame (swallow it). */
export function isGhostClick(now: number): boolean {
  if (now - armedAt > GHOST_MS || downAt >= armedAt) return false;
  armedAt = -Infinity;
  return true;
}

/** Listens on the page, before anything else sees the click. */
export function installGhostGuard(doc: Document): void {
  doc.addEventListener("pointerdown", () => pageDown(performance.now()), true);
  doc.addEventListener(
    "click",
    (e) => {
      // A click from a key or a screen reader (detail 0) never is one.
      if (e.detail === 0 || !isGhostClick(performance.now())) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}
