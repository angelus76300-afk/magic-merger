import { parse } from "acorn";

// Spell programs are JavaScript written by Claude. Before running one, every
// loop gets a counter so a loop that never ends throws instead of freezing the
// page. The Worker uses the same parser to reject code that does not parse.

import { FIRST_PROGRAM_VERSION, PROGRAM_VERSION } from "./version";

export { FIRST_PROGRAM_VERSION, PROGRAM_VERSION };

export interface SpellProgram {
  // The World API version the program was written for. Older programs stay
  // castable: the API only grows, so a new version never rewrites old spells.
  version: number;
  summary: string;
  code: string;
  // Which model wrote it, for the admin card. Not stored in the spec itself.
  model?: string;
  // Which version of the element's program this is (its row in `programs`),
  // for casts and votes. Not stored in the spec itself.
  id?: number;
  // Written but not through its test run yet: the browser runs it first.
  trial?: boolean;
}

type Node = { type: string; start: number; end: number; body?: Node | Node[] } & Record<string, unknown>;

const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

function parseProgram(code: string): Node {
  return parse(code, { ecmaVersion: 2022, sourceType: "script", allowReturnOutsideFunction: true }) as unknown as Node;
}

// Returns null when the code parses, or the parser's message.
export function syntaxError(code: string): string | null {
  try {
    parseProgram(code);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// Inserts `__g()` at the top of every loop body. __g counts and throws past a limit.
export function guardLoops(code: string): string {
  const ast = parseProgram(code);
  const inserts: { at: number; text: string }[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const n = node as Node;
    if (typeof n.type !== "string") return;
    if (LOOPS.has(n.type) && n.body && !Array.isArray(n.body)) {
      const body = n.body;
      if (body.type === "BlockStatement") inserts.push({ at: body.start + 1, text: "__g();" });
      else {
        inserts.push({ at: body.start, text: "{__g();" });
        inserts.push({ at: body.end, text: "}" });
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end") continue;
      visit(n[key]);
    }
  };
  visit(ast);
  inserts.sort((a, b) => b.at - a.at);
  let out = code;
  for (const { at, text } of inserts) out = out.slice(0, at) + text + out.slice(at);
  return out;
}
