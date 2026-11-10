// Checks for scripts/fold-ideas.mjs: docs/ideas.d/ parts folded into docs/IDEAS.md.
import { readFileSync } from "node:fs";
import { fold } from "./fold-ideas.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ": " + detail : ""}`);
  if (!ok) failed++;
};
const ideas = [
  "# Ideas",
  "",
  "## Backlog",
  "",
  "### Gameplay",
  "",
  "- one",
  "- two",
  "",
  "### Visual",
  "",
  "- three",
  "",
  "## Built",
  "",
  "Newest first.",
  "",
  "- 2026-11-01 old",
  "",
  "## Declined",
  "",
  "- no",
  "",
].join("\n");
const throws = (parts) => {
  try {
    fold(ideas, parts);
    return false;
  } catch {
    return true;
  }
};

const g = fold(ideas, [{ name: "a.md", text: "section: Gameplay\n- new idea\n" }]);
check("an idea goes at the end of its section", g.includes("- two\n- new idea\n\n### Visual"), g);
const b = fold(ideas, [{ name: "a.md", text: "section: Built\n- 2026-11-08 built today\n" }]);
check("a built line goes at the top of Built, after its lead", b.includes("Newest first.\n\n- 2026-11-08 built today\n- 2026-11-01 old"), b);
const two = fold(ideas, [
  { name: "a.md", text: "section: Visual\n- four" },
  { name: "b.md", text: "section: Visual\n- five" },
]);
check("two parts for one section both land, in order", two.includes("- three\n- four\n- five\n\n## Built"), two);
check("the last section works too", fold(ideas, [{ name: "a.md", text: "section: Visual\n- x" }]).includes("- x"));
check("refused: Declined is the owner's", throws([{ name: "a.md", text: "section: Declined\n- sneaky" }]));
check("refused: a section that does not exist", throws([{ name: "a.md", text: "section: Nowhere\n- x" }]));
check("refused: no section line", throws([{ name: "a.md", text: "- x" }]));
check("refused: a part that adds a heading", throws([{ name: "a.md", text: "section: Visual\n## Declined\n- x" }]));
check("refused: an empty part", throws([{ name: "a.md", text: "section: Visual\n\n" }]));
check("nothing else changes", fold(ideas, [{ name: "a.md", text: "section: Gameplay\n- n" }]).replace("- n\n", "") === ideas);
// The real file: every heading a part may name is found.
const real = readFileSync("docs/IDEAS.md", "utf8");
check(
  "the real IDEAS.md takes a part for Built and for Quality of life",
  fold(real, [
    { name: "t.md", text: "section: Built\n- t1" },
    { name: "u.md", text: "section: Quality of life\n- t2" },
  ]).includes("- t2"),
);

console.log(failed ? `${failed} failed` : "all fold-ideas checks passed");
process.exit(failed ? 1 : 0);
