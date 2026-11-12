// Hold and release to cast (the eye view, second pass, 2026-11-12). The owner
// on a Z Fold: "cast: aim and reach": the mark alone, in the middle of the
// view, was hard to put on a spot with a thumb. Pure, so Node can test it
// (scripts/become-test.ts).
//
// A finger comes down on Cast (or holds still on the island for a moment): the
// ring shows where the spell will land, and a drag moves the aim finely, about
// a third as fast as a drag turns the look. Lifting the finger casts, once.
// Lifting it over the Cancel chip, or the browser taking the touch away
// (pointercancel), casts nothing. A quick tap casts at the mark at once, as
// before. One press, one cast: the click the touch sends after it is swallowed
// by press.ts, as for every button of the eye view.

// Radians of aim per pixel of drag: a third of the look's (orbit.ts, 0.0065 and 0.0055).
export const AIM_YAW_PER_PX = 0.0022;
export const AIM_PITCH_PER_PX = 0.0019;
// A finger held still on the island this long begins an aim (shorter is a tap,
// moving first is a turn of the look).
export const HOLD_MS = 250;
// Moved further than this, a finger on the island turns the look instead.
export const SLOP_PX = 8;

export type AimEnd = "cast" | "cancel" | null;

export class AimHold {
  // The finger aiming, where it came down and is now, and the aim's turn from the look.
  private id = -1;
  private x = 0;
  private y = 0;
  private t0 = 0;
  dyaw = 0;
  dpitch = 0;
  // From the Cast button the aim is on at once; from the island after HOLD_MS still.
  armed = false;

  get active(): boolean {
    return this.id !== -1;
  }

  // A finger came down: on the Cast button (armed now) or on the island (armed once held still).
  down(id: number, x: number, y: number, now: number, armed: boolean): void {
    this.id = id;
    this.x = x;
    this.y = y;
    this.t0 = now;
    this.dyaw = 0;
    this.dpitch = 0;
    this.armed = armed;
  }

  // Held still long enough on the island: the aim begins. True when it just did.
  tick(now: number): boolean {
    if (this.id === -1 || this.armed || now - this.t0 < HOLD_MS) return false;
    this.armed = true;
    return true;
  }

  // The finger moved: the aim follows, finely. On the island before it is
  // armed, a move past the slop is a turn of the look: the aim lets go (false).
  move(id: number, x: number, y: number): boolean {
    if (id !== this.id) return false;
    const dx = x - this.x;
    const dy = y - this.y;
    if (!this.armed) {
      if (Math.hypot(dx, dy) > SLOP_PX) this.id = -1;
      return false;
    }
    this.x = x;
    this.y = y;
    this.dyaw += dx * AIM_YAW_PER_PX;
    this.dpitch -= dy * AIM_PITCH_PER_PX;
    return true;
  }

  // The finger lifted: cast once, or nothing when cancelled or never armed
  // (a tap on the island is the engine's own tap, which casts at the mark).
  up(id: number, cancel: boolean): AimEnd {
    if (id !== this.id) return null;
    const armed = this.armed;
    this.id = -1;
    this.armed = false;
    if (!armed) return null;
    return cancel ? "cancel" : "cast";
  }

  // Dropped at once (the creature let go, the spell put away).
  reset(): void {
    this.id = -1;
    this.armed = false;
    this.dyaw = 0;
    this.dpitch = 0;
  }
}
