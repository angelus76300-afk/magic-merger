// The looks revamp's runner (scripts/looks-runner.ts) asks the island's own reader before it pays
// for a judgment; checked in scripts/looks-refs-test.ts.
import { readBox } from "../src/sim/props";
import { modelCalls, readLiteral } from "../shared/looks/splice";

// The new looks' parts as the island reads them (src/sim/props.ts readBox): the parts lists the
// splice put in (those not in the old code), and how many of their parts can be drawn. A look the
// island would draw half of, or none of, is not tested further and not judged (nothing is paid).
export function drawableShare(oldCode: string, code: string): { parts: number; drawn: number } {
  const lists = (c: string) => (modelCalls(c) ?? []).map((m) => (m.args[2] ? c.slice(m.args[2].start, m.args[2].end).trim() : ""));
  const before = new Set(lists(oldCode));
  let parts = 0;
  let drawn = 0;
  for (const text of lists(code)) {
    if (before.has(text)) continue;
    const r = readLiteral(text);
    if ("why" in r || !Array.isArray(r.value)) continue;
    parts += r.value.length;
    drawn += r.value.filter((p) => readBox(p) !== null).length;
  }
  return { parts, drawn };
}
