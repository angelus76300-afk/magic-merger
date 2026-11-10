// 2026-11-08, no shared hot files: a pull request adds its ideas as its own file, docs/ideas.d/<name>.md,
// never by editing docs/IDEAS.md, so two pull requests never touch the same lines. The planner's night
// run folds them in: `node scripts/fold-ideas.mjs` (then commits IDEAS.md and the removed parts).
//
// A part: its first line names the section, exactly as its heading in IDEAS.md ("section: Quality of
// life", "section: Built"); the rest is added there as it is. Into "Built" at its top (newest first),
// anywhere else at the end of the section. "Declined" is the owner's (R12): a part never writes there.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HEADING = /^(#{2,3})\s+(.+?)\s*$/;

/** IDEAS.md with the parts folded in. parts: [{ name, text }] in the order to add them. Throws on a bad part. */
export function fold(ideas, parts) {
  let lines = ideas.split("\n");
  for (const p of parts) {
    const [first, ...rest] = p.text.replace(/\r\n/g, "\n").split("\n");
    const m = /^section:\s*(.+?)\s*$/i.exec(first ?? "");
    if (!m) throw new Error(`${p.name}: the first line must be "section: <a heading of IDEAS.md>"`);
    const section = m[1];
    if (/^declined$/i.test(section)) throw new Error(`${p.name}: "Declined" holds the owner's decisions; a part never writes there`);
    const body = rest.join("\n").replace(/^\n+|\n+$/g, "");
    if (!body) throw new Error(`${p.name}: nothing to add`);
    if (body.split("\n").some((l) => HEADING.test(l))) throw new Error(`${p.name}: a part adds lines, never a heading`);
    const at = lines.findIndex((l) => HEADING.exec(l)?.[2] === section);
    if (at < 0) throw new Error(`${p.name}: no heading "${section}" in IDEAS.md`);
    const level = HEADING.exec(lines[at])[1].length;
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i++) {
      const h = HEADING.exec(lines[i]);
      if (h && h[1].length <= level) {
        end = i;
        break;
      }
    }
    const add = body.split("\n");
    let where;
    if (/^built$/i.test(section)) {
      // After the heading's own lead paragraph: before the first list line.
      where = lines.findIndex((l, i) => i > at && i < end && /^\s*[-*] /.test(l));
      if (where < 0) where = end;
    } else {
      where = end;
      while (where > at + 1 && lines[where - 1].trim() === "") where--;
    }
    lines = [...lines.slice(0, where), ...add, ...lines.slice(where)];
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = "docs/ideas.d";
  const names = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .sort()
    : [];
  if (!names.length) {
    console.log("No ideas to fold.");
    process.exit(0);
  }
  const parts = names.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
  writeFileSync("docs/IDEAS.md", fold(readFileSync("docs/IDEAS.md", "utf8"), parts));
  for (const n of names) rmSync(join(dir, n));
  console.log(`Folded ${names.length} part(s) into docs/IDEAS.md: ${names.join(", ")}`);
}
