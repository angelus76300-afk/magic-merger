// One press, one action, for buttons that answer the finger as it comes down.
//
// A button of the eye view acts on pointerdown, so that it works while another
// finger holds the stick, and must then ignore the click that the same touch
// sends after it. The click can land on another element than the one pressed:
// picking a spell redraws the bar, so the click arrives on a new slot button
// (the review of 12 November: a tap on a slot picked the spell and put it away
// at once, and nothing could be cast from the bar).
// So the memory of the last press is shared by all such buttons, not kept by each.
//
// The click is matched to its press, not to a clock: the first click after a press is its own,
// however late it comes. Played on a slow frame (a large screen drawn in software, 200 to 800 ms a
// frame), the click came more than 700 ms after the press and cast a second time (the playtest of
// 12 November); a held aim of a second or more ends with a click as late. A press that sends no
// click (dragged off the button) is forgotten after FORGET_MS, so a key still acts.
const FORGET_MS = 20_000;
let pressedAt = -Infinity;
let pending = false;

/** A pointer came down on a pressable button: act, and remember when. */
export function pressDown(now: number): void {
  pressedAt = now;
  pending = true;
}

/** A click arrived: true if it should act (no press is waiting for its click: a key, a screen reader). */
export function clickActs(now: number): boolean {
  if (pending && now - pressedAt < FORGET_MS) {
    pending = false;
    return false;
  }
  pending = false;
  return true;
}
