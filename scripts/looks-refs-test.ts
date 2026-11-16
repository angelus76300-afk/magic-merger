// The looks revamp, phase 2 (roadmap 5.2.5): the ten reference looks the writer copies
// (shared/looks/), and the splice that puts a look-only rewrite into a program without touching
// anything else it does (shared/looks/splice.ts). Called from scripts/looks-test.ts.
import { syntaxError } from "../shared/spellcode";
import { REFERENCES, partTarget, referencesFor } from "../shared/looks";
import { shapesOf, silhouette, toneGroups } from "../shared/looks/measure";
import { changedLines, modelCalls, numberedProgram, partsProblem, spliceLooks } from "../shared/looks/splice";
import { MAX_PROP_BOXES, readBox, type PropBox } from "../src/sim/props";

type Check = (name: string, ok: boolean, detail?: string) => void;

// Runs a piece of a cast with a stand-in world that records what it draws.
export function drawnBy(code: string): { calls: { x: number; y: number; parts: unknown[]; options: unknown }[]; error: string | null } {
  const calls: { x: number; y: number; parts: unknown[]; options: unknown }[] = [];
  const w = { x: 0, y: 0, model: (x: number, y: number, parts: unknown[], options: unknown) => calls.push({ x, y, parts, options }) };
  try {
    new Function("w", code)(w);
    return { calls, error: null };
  } catch (err) {
    return { calls, error: err instanceof Error ? err.message : String(err) };
  }
}

// The richest outline among the 368 items measured on 2026-11-13 (docs/measurements/looks-2026-11-13.md):
// the references are to be read from far, so each must beat the library's median at least.
const LIBRARY_SILHOUETTE_P50 = 0.06;

export function looksRefChecks(check: Check): void {
  // --- The ten references -----------------------------------------------------------------
  check("ten reference looks", REFERENCES.length === 10, String(REFERENCES.length));
  for (const r of REFERENCES) {
    const { calls, error } = drawnBy(r.code);
    const parts = (calls[0]?.parts ?? []).map(readBox).filter((b): b is PropBox => b !== null);
    const given = calls[0]?.parts.length ?? 0;
    const [lo, hi] = partTarget(r.kind);
    check(`reference ${r.name}: runs and draws one model`, !error && calls.length === 1, error ?? `${calls.length} calls`);
    check(`reference ${r.name}: every part is a part the island reads`, given > 0 && parts.length === given, `${parts.length} of ${given}`);
    check(
      `reference ${r.name}: ${lo} to ${hi} parts for a ${r.kind}`,
      parts.length >= lo && parts.length <= Math.min(hi, MAX_PROP_BOXES),
      String(parts.length),
    );
    const tones = toneGroups(parts);
    check(`reference ${r.name}: three or more tones of one hue`, tones[0] >= 3, JSON.stringify(tones));
    const glow = parts.filter((b) => b.glow).length;
    check(`reference ${r.name}: an accent that shines, a small share of it`, glow > 0 && glow / parts.length <= 0.35, `${glow} of ${parts.length}`);
    const used = shapesOf(parts);
    const kinds = Object.keys(used.shapes).length;
    check(`reference ${r.name}: uses three shapes or more`, kinds >= 3, JSON.stringify(used.shapes));
    const sil = silhouette(parts);
    // A thin thing (a sword, a bird on a perch) or an animal has a short outline but fills less of its box; a brick fills all of it.
    check(
      `reference ${r.name}: an outline richer than the library's median, or a shape that is not a block`,
      sil.score > LIBRARY_SILHOUETTE_P50 || sil.fill < 0.65,
      `score ${sil.score.toFixed(3)}, fill ${sil.fill.toFixed(2)}`,
    );
    check(
      `reference ${r.name}: inside a prop's reach`,
      parts.every((b) => Math.abs(b.x) <= 12 && Math.abs(b.y) <= 12 && b.z >= 0 && b.z + b.h <= 60),
    );
  }
  check(
    "three references are picked for every kind, the same three each time",
    ["spell", "object", "creature", "building", "settlement", "place", "land", "wonder", "unknown"].every(
      (k) => referencesFor(k).length === 3 && referencesFor(k) === referencesFor(k) && new Set(referencesFor(k)).size === 3,
    ),
  );
  check(
    "a building is shown the tower first, a creature the wolf",
    referencesFor("building")[0].name === "Mage Tower" && referencesFor("creature")[0].name === "Grey Wolf",
  );

  // --- Finding the model calls -------------------------------------------------------------
  const program = [
    "const spell = {",
    "  creatures: [{ name: 'Moth', look: 'w.model(not a call)' }],",
    "  *cast(w) {",
    "    // w.model(0, 0, [], {}) in a comment is not a call",
    "    const note = `drawn with w.model(${1 + 2}) later`;",
    "    const re = /w\\.model\\(/g;",
    "    const c = w.building(w.x, w.y, { job: 'smithy' }).beside, parts = [];",
    "    for (let k = 0; k < 4; k++) parts.push([-0.4, -0.4, k * 0.45, 0.8, 0.8, 0.45, k % 2 ? '#6a5a52' : '#7a685e']);",
    "    w.model(c.x, c.y, parts, { name: 'Forge' });",
    "    w.flash(w.x, w.y, '#ff8a2a');",
    "    yield 0.5;",
    "    w.model(w.x + 2, w.y, [",
    "      [0, 0, 0, 1, 1, 1, '#888'],",
    "      [0, 0, 1, 0.5, 0.5, 0.5, '#ff0', 'glow'],",
    "    ], { name: 'Anvil', turn: 0.3 });",
    "    w.sound('chime', 1);",
    "  },",
    "};",
  ].join("\n");
  const calls = modelCalls(program);
  check(
    "the two model calls are found, not those in a string, a template, a comment or a pattern",
    calls?.length === 2,
    JSON.stringify(calls?.map((c) => c.index)),
  );
  check(
    "each call's parts argument is found",
    !!calls &&
      program.slice(calls[0].args[2].start, calls[0].args[2].end).trim() === "parts" &&
      program.slice(calls[1].args[2].start, calls[1].args[2].end).trim().startsWith("["),
  );
  const numbered = numberedProgram(program, calls ?? []);
  check("the writer sees each call numbered", numbered.includes("/* MODEL CALL 1 */") && numbered.includes("/* MODEL CALL 2 */"));

  // --- Splicing a new look in -----------------------------------------------------------------
  const forge =
    "(() => { const p = []; for (let k = 0; k < 6; k++) p.push([-0.5, -0.5, k * 0.5, 1, 1, 0.5, k % 2 ? '#6a5a52' : '#7a685e', 'cyl', 'grain']); return p; })()";
  const anvil = "[[-0.5, -0.25, 0, 1, 0.5, 0.25, '#3a3a40'], [-0.375, -0.125, 0.25, 0.75, 0.25, 0.25, '#55555c', 'wedge']]";
  const spliced = spliceLooks(program, [
    { call: 1, parts: forge },
    { call: 2, parts: anvil },
  ]);
  check("both looks are spliced in", spliced?.replaced.join() === "1,2" && spliced.refused.length === 0, JSON.stringify(spliced?.refused));
  const diff = changedLines(program, spliced?.code ?? "");
  const modelLines = new Set(program.split("\n").filter((l) => /w\.model\(|^\s*\[.*\],?$|^\s*\], \{ name/.test(l)));
  check(
    "every line that is not a look is byte for byte the same",
    !!spliced && diff.removed.every((l) => modelLines.has(l)) && diff.added.every((l) => l.includes("w.model(")),
    JSON.stringify(diff),
  );
  check(
    "the call keeps where it stands and what it is called",
    !!spliced && spliced.code.includes(`w.model(c.x, c.y, ${forge}, { name: 'Forge' });`) && spliced.code.includes("{ name: 'Anvil', turn: 0.3 });"),
  );
  check("the spliced program still parses", !!spliced && syntaxError(spliced.code) === null, syntaxError(spliced?.code ?? "") ?? "");
  // It draws the new parts.
  const runs = drawnBy(
    (spliced?.code ?? "").concat(
      "\nconst it = spell.cast({ ...w, building: () => ({ beside: { x: 1, y: 1 } }), flash() {}, sound() {} }); while (!it.next().done);",
    ),
  );
  check(
    "the spliced program draws the new parts",
    !runs.error && runs.calls.length === 2 && runs.calls[0].parts.length === 6 && runs.calls[1].parts.length === 2,
    runs.error ?? "",
  );

  // --- What is refused --------------------------------------------------------------------
  const refused = (parts: string) => spliceLooks(program, [{ call: 1, parts }])?.refused[0]?.why ?? null;
  check("a look that calls the world is refused", refused("(() => { w.explode(0, 0, 3); return []; })()") === "it calls the world");
  check("a look that waits is refused", refused("(function* () { yield 1; })()") !== null);
  check("a look of two expressions is refused", refused("[], { name: 'x' }") === "it is more than one expression");
  check("a look whose brackets do not match is refused", refused("[[0, 0, 0, 1, 1, 1]") === "its brackets do not match");
  check("a look that reaches outside is refused", refused("globalThis.fetch") !== null && refused("this.x") !== null);
  check("an unfinished string is refused", refused("['#fff]") !== null);
  check("a patch for a call that is not there is refused", spliceLooks(program, [{ call: 3, parts: "[]" }])?.refused[0]?.why === "there is no such call");
  check("partsProblem passes a plain list", partsProblem(anvil) === null && partsProblem(forge) === null);

  // --- A wonder with no model gains one ---------------------------------------------------------
  const wonder = ["const spell = {", "  *cast(w) {", "    w.terraform(w.x, w.y, 4, 2);", "    w.build('spire', w.x, w.y, { height: 8 });", "  },", "};"].join(
    "\n",
  );
  const grown = spliceLooks(wonder, [{ call: 0, parts: anvil }], true);
  const grownDiff = changedLines(wonder, grown?.code ?? "");
  check(
    "a wonder with no model gains one as a new line, every old line kept",
    grown?.added === 1 && grownDiff.removed.length === 0 && grownDiff.added.length === 1 && grownDiff.added[0].includes("w.model(w.x, w.y, "),
    JSON.stringify(grownDiff),
  );
  check("the grown wonder still parses", syntaxError(grown?.code ?? "") === null);
  check("an item that is not a wonder gains none", spliceLooks(wonder, [{ call: 0, parts: anvil }], false)?.added === 0);
  check("a program with models gains none", spliceLooks(program, [{ call: 0, parts: anvil }], true)?.added === 0);
}
