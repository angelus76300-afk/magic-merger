// What the island's chronicle is written from (3.7, src/sim/chronicle.ts),
// as the page and the Worker read it: built in the sandbox, so bounded here.
export interface ChronicleDigest {
  // Days on the island so far (one day is six minutes).
  days: number;
  lines: string[];
  work: string[];
  memories: string[];
  now: string[];
}

// The digest as it may come back from the sandbox: bounded strings only.
export function readDigest(v: unknown): ChronicleDigest | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  const strs = (x: unknown, n: number) =>
    Array.isArray(x)
      ? x
          .filter((s): s is string => typeof s === "string")
          .slice(0, n)
          // One line each (4.0 review L10): no line break, no control
          // character, so a line cannot pose as a heading of the message.
          .map((s) =>
            s
              // eslint-disable-next-line no-control-regex -- control characters are what is removed
              .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 160),
          )
          .filter((s) => s.length > 0)
      : [];
  const days = typeof d.days === "number" && Number.isFinite(d.days) ? Math.max(1, Math.min(10000, Math.round(d.days))) : 1;
  return { days, lines: strs(d.lines, 40), work: strs(d.work, 8), memories: strs(d.memories, 16), now: strs(d.now, 12) };
}
