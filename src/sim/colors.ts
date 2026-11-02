// Colors are 0xRRGGBB numbers everywhere in the game. One place to read them
// from spell code, mix them, shade them and print them for a canvas.

// Accepts "#ff8800", "#f80" or 0xff8800. Named colors are refused, by design:
// spell programs must say what they mean.
export function toColor(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v & 0xffffff;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return parseInt(s.slice(1), 16);
  if (/^#[0-9a-f]{3}$/i.test(s)) return parseInt([...s.slice(1)].map((c) => c + c).join(""), 16);
  return null;
}

// From a (k = 0) to b (k = 1), channel by channel.
export function mixColor(a: number, b: number, k: number): number {
  const r = ((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k;
  const g = ((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k;
  const bl = (a & 255) * (1 - k) + (b & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

// Darker below 1, lighter above, clamped to white.
export function scaleColor(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

// "#rrggbb", for canvas styles.
export function hexColor(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
}
