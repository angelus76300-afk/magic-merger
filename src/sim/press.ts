// One press, one action, for buttons that answer the finger as it comes down.
//
// A button of the eye view acts on pointerdown, so that it works while another
// finger holds the stick, and must then ignore the click that the same touch
// sends after it. The click can land on another element than the one pressed:
// picking a spell redraws the bar, so the click arrives on a new slot button
// (the review of 12 November: a tap on a slot picked the spell and put it away
// at once, and nothing could be cast from the bar). So the memory of the last
// press is shared by all such buttons, not kept by each.
const SWALLOW_MS = 700;
let pressedAt = -Infinity;

/** A pointer came down on a pressable button: act, and remember when. */
export function pressDown(now: number): void {
  pressedAt = now;
}

/** A click arrived: true if it should act (no press came just before it: a key, a screen reader). */
export function clickActs(now: number): boolean {
  return now - pressedAt >= SWALLOW_MS;
}
