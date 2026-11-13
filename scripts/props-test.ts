// Thin parts of a model (2026-11-13): a box with every side above zero is drawn, a side under
// FINE_BOX raised to FINE_BOX; a box with a side of zero, below zero or not a number is dropped.
import { FINE_BOX, MAX_PROP_BOXES, readProp } from "../src/sim/props";

type Check = (name: string, ok: boolean, detail?: string) => void;

const prop = (boxes: unknown[]) => readProp({ key: "k", name: "book", x: 5, y: 5, turn: 0, boxes });

export function propChecks(check: Check): void {
  // A book: a cover, a spine and ten pages 0.02 thick.
  const book: unknown[] = [
    [0, 0, 0, 3, 4, 0.5, "#632"],
    [0, 0, 0, 0.3, 4, 0.5, "#421"],
  ];
  for (let i = 0; i < 10; i++) book.push([0.3, 0, 0.05 + i * 0.04, 2.6, 3.8, 0.02, "#eed"]);
  const p = prop(book);
  check("a book of 12 boxes with 0.02 thick pages keeps all 12", p?.boxes.length === 12, `${p?.boxes.length}`);
  check("a thin side is drawn at FINE_BOX, not thinner", !!p && p.boxes.slice(2).every((b) => b.h === FINE_BOX && b.w === 2.6), JSON.stringify(p?.boxes[2]));
  const t = prop([{ x: 0, y: 0, z: 0, w: 1, d: 0.001, h: 1, color: "#fff" }]);
  check("an object box 0.001 thick is drawn at FINE_BOX", t?.boxes[0]?.d === FINE_BOX, `${t?.boxes[0]?.d}`);
  const bad = prop([
    [0, 0, 0, 1, 1, 1, "#fff"],
    [0, 0, 0, 0, 1, 1, "#fff"],
    [0, 0, 0, 1, -1, 1, "#fff"],
    [0, 0, 0, 1, 1, NaN, "#fff"],
    [0, 0, 0, 1, 1, "x", "#fff"],
    [0, 0, 0, 1, 1, undefined, "#fff"],
  ]);
  check("boxes with a side of zero, negative or not a number are still dropped", bad?.boxes.length === 1, `${bad?.boxes.length}`);
  check("a prop of only zero-sided boxes is none", prop([[0, 0, 0, 0, 1, 1, "#fff"]]) === null);
  const many = prop(Array.from({ length: MAX_PROP_BOXES + 20 }, () => [0, 0, 0, 1, 1, 0.01, "#fff"]));
  check("a model still keeps MAX_PROP_BOXES at most", many?.boxes.length === MAX_PROP_BOXES, `${many?.boxes.length}`);
}
