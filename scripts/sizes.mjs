// The five sizes every check uses (CLAUDE.md, "Prove what you built"). The owner plays on a Z Fold
// (10 November, "folds: yes"), so its two screens are checked next to the phone, the foldable open
// and the desktop. scripts/ui-frames.mjs takes frames at all of them, scripts/smoke.mjs looks at the
// first screen at each one after the newcomer's path at the phone, and scripts/nightly-play.mjs folds
// and unfolds the phone during the night's long session. Red with the checks (R11): taking a size out
// weakens all three.
export const SIZES = [
  { name: "phone", width: 390, height: 844, touch: false },
  { name: "folded", width: 344, height: 882, touch: true },
  { name: "unfolded", width: 700, height: 830, touch: true },
  { name: "fold", width: 832, height: 1000, touch: false },
  { name: "desktop", width: 1440, height: 900, touch: false },
];

/** ui-frames' "WxH" or "WxHt" (a touch screen) for each size, then a foldable and a phone on their side. */
export const FRAME_SIZES = [...SIZES.map((s) => `${s.width}x${s.height}${s.touch ? "t" : ""}`), "1104x884t", "844x390"];

/** The Z Fold's two screens, which the night's long session moves between. */
export const FOLD = SIZES.filter((s) => s.name === "folded" || s.name === "unfolded");
