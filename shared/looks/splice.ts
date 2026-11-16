// The looks revamp, phase 2 (roadmap 5.2.5): a look-only rewrite changes what an item looks like
// and nothing it does. The writer is shown the program with its w.model calls numbered and sends
// back, for each call, a new parts expression; the Worker splices each one in place of the call's
// third argument. Every character outside those arguments stays as it was, so every line that is
// not a look stays byte for byte the same (scripts/looks-refs-test.ts proves it). A wonder with no
// model at all may gain one, as new lines at the start of its cast, its other lines untouched.

export interface Span {
  start: number;
  end: number;
}

export interface ModelCall {
  // 1-based, in the order the calls appear in the code.
  index: number;
  // The whole call, from "w" to its closing parenthesis.
  call: Span;
  // Its arguments, split at the top level commas.
  args: Span[];
  // The receiver's name: w in cast(w), or what an artifact's act(self, w, target) calls it.
  receiver: string;
}

// A new look for one call: `call` is the call's index, or 0 for a model added to a wonder that
// has none; `parts` is a JavaScript expression that evaluates to the parts array.
export interface LookPatch {
  call: number;
  parts: string;
  name?: string;
}

// The longest parts expression taken: 160 parts written out are about 9,000 characters.
export const MAX_PARTS_TEXT = 24_000;
// A wonder with no model gains at most this many.
export const MAX_ADDED_MODELS = 2;

// Characters after which a "/" starts a regular expression rather than a division.
const REGEX_AFTER = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", ""]);
const REGEX_WORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield"]);

// Walks the code and calls `at` for every character that is code: not in a string, a template's
// text, a comment or a regular expression. Returns false when a string or comment never ends.
function scan(code: string, at: (i: number) => void): boolean {
  let i = 0;
  let last = "";
  let lastWord = "";
  // Template literals nest through ${ ... }: the depth of braces at each open ${.
  const templates: number[] = [];
  let braces = 0;
  const n = code.length;
  const readString = (q: string): boolean => {
    i++;
    while (i < n) {
      const c = code[i];
      if (c === "\\") i += 2;
      else if (c === q) {
        i++;
        return true;
      } else if (c === "\n" && q !== "`") return false;
      else i++;
    }
    return false;
  };
  // Template text up to its end or to the next ${, from i (after the opening ` or the closing }).
  const readTemplate = (): boolean => {
    while (i < n) {
      const c = code[i];
      if (c === "\\") i += 2;
      else if (c === "`") {
        i++;
        return true;
      } else if (c === "$" && code[i + 1] === "{") {
        i += 2;
        templates.push(braces);
        braces++;
        return true;
      } else i++;
    }
    return false;
  };
  while (i < n) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/") {
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const e = code.indexOf("*/", i + 2);
      if (e < 0) return false;
      i = e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      if (!readString(c)) return false;
      last = "a";
      lastWord = "";
      continue;
    }
    if (c === "`") {
      i++;
      if (!readTemplate()) return false;
      last = "a";
      lastWord = "";
      continue;
    }
    if (c === "/" && (REGEX_AFTER.has(last) || REGEX_WORDS.has(lastWord))) {
      // A regular expression literal, its classes included.
      i++;
      let inClass = false;
      while (i < n) {
        const r = code[i];
        if (r === "\\") i += 2;
        else if (r === "\n") return false;
        else {
          i++;
          if (r === "[") inClass = true;
          else if (r === "]") inClass = false;
          else if (r === "/" && !inClass) break;
        }
      }
      while (i < n && /[a-z]/i.test(code[i])) i++;
      last = "a";
      lastWord = "";
      continue;
    }
    if (c === "{") braces++;
    if (c === "}") {
      braces--;
      if (templates.length && templates[templates.length - 1] === braces) {
        templates.pop();
        at(i);
        i++;
        if (!readTemplate()) return false;
        last = "a";
        lastWord = "";
        continue;
      }
    }
    at(i);
    if (!/\s/.test(c)) {
      if (/[\w$]/.test(c)) {
        let j = i;
        while (j < n && /[\w$]/.test(code[j])) j++;
        lastWord = code.slice(i, j);
        for (let k = i + 1; k < j; k++) at(k);
        i = j;
        last = "a";
        continue;
      }
      last = c;
      lastWord = "";
    }
    i++;
  }
  return true;
}

// Every w.model( call in the code (the receiver may be any name: a program's act(self, w, target)
// may call it world). Null when the code cannot be read (a string or a comment that never ends).
export function modelCalls(code: string): ModelCall[] | null {
  const isCode = new Uint8Array(code.length);
  if (!scan(code, (i) => (isCode[i] = 1))) return null;
  const calls: ModelCall[] = [];
  const re = /([A-Za-z_$][\w$]*)\s*\.\s*model\s*\(/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const start = m.index;
    if (!isCode[start] || (start > 0 && /[\w$.]/.test(code[start - 1]))) continue;
    // The parenthesis of the call, then its arguments to the matching close.
    let i = start + m[0].length;
    const args: Span[] = [];
    let argStart = i;
    let depth = 0;
    let end = -1;
    for (; i < code.length; i++) {
      if (!isCode[i]) continue;
      const c = code[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0 && c === ")") {
          args.push({ start: argStart, end: i });
          end = i + 1;
          break;
        }
        depth--;
      } else if (c === "," && depth === 0) {
        args.push({ start: argStart, end: i });
        argStart = i + 1;
      }
    }
    if (end < 0) return null;
    // A trailing comma leaves an empty last argument.
    const kept = args.filter((a, k) => k < args.length - 1 || code.slice(a.start, a.end).trim() !== "");
    calls.push({ index: calls.length + 1, call: { start, end }, args: kept, receiver: m[1] });
    re.lastIndex = end;
  }
  return calls;
}

// The program with its model calls marked for the writer: each call's parts argument is shown as
// it is, under a comment naming the call's number.
export function numberedProgram(code: string, calls: ModelCall[]): string {
  let out = "";
  let at = 0;
  for (const c of calls) {
    const lineStart = code.lastIndexOf("\n", c.call.start - 1) + 1;
    if (lineStart < at) continue;
    const indent = /^[ \t]*/.exec(code.slice(lineStart))![0];
    out += code.slice(at, lineStart) + `${indent}/* MODEL CALL ${c.index} */\n`;
    at = lineStart;
  }
  return out + code.slice(at);
}

// Words a parts expression may not hold: it draws, it never acts, waits or reaches outside.
const FORBIDDEN =
  /\b(?:yield|await|async|import|export|eval|Function|globalThis|window|self|this|fetch|XMLHttpRequest|constructor|__proto__|prototype|spell|while|class|delete)\b|\bnew\b(?!\s+Array\b)/;

// Why a parts expression cannot be spliced in, or null when it can. It may use loops inside a
// function it calls at once ((() => { ... })()), Math and the variables in scope at the call,
// never the world (w), nor anything that waits or reaches outside.
export function partsProblem(parts: string, receiver = "w"): string | null {
  const t = parts.trim();
  if (!t) return "it is empty";
  if (t.length > MAX_PARTS_TEXT) return `it is longer than ${MAX_PARTS_TEXT} characters`;
  // A string or comment that never ends would swallow the rest of the program.
  if (!scan(t, () => {})) return "a string or a comment in it never ends";
  let depth = 0;
  let broken = false;
  scan(t, (i) => {
    const c = t[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (depth < 0) broken = true;
  });
  if (broken || depth !== 0) return "its brackets do not match";
  if (FORBIDDEN.test(t)) return "it acts, waits or reaches outside the look";
  const world = new RegExp(`(^|[^\\w$.])${receiver.replace(/\$/g, "\\$")}\\s*[.[(]`);
  if (world.test(t) || /(^|[^\w$.])w\s*[.[(]/.test(t)) return "it calls the world";
  // A top level comma would add arguments to the call.
  let top = 0;
  let comma = false;
  scan(t, (i) => {
    const c = t[i];
    if (c === "(" || c === "[" || c === "{") top++;
    else if (c === ")" || c === "]" || c === "}") top--;
    else if (c === "," && top === 0) comma = true;
    else if (c === ";" && top === 0) comma = true;
  });
  if (comma) return "it is more than one expression";
  return null;
}

export interface SpliceResult {
  code: string;
  // Which calls were replaced, and which patches were refused and why.
  replaced: number[];
  added: number;
  refused: { call: number; why: string }[];
}

// The cast's opening brace, for a model added to a wonder: `*cast(w) {`.
const CAST_OPEN = /\*\s*cast\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/;

// Splices each patch in: the parts argument of an existing call is replaced in place; a patch for
// call 0 (only when `mayAdd`, a wonder with no model) is added as a new line after the line that
// opens cast. Nothing else in the code changes.
export function spliceLooks(code: string, patches: LookPatch[], mayAdd = false): SpliceResult | null {
  const calls = modelCalls(code);
  if (!calls) return null;
  const refused: { call: number; why: string }[] = [];
  const edits: { span: Span; text: string }[] = [];
  const replaced: number[] = [];
  const added: string[] = [];
  const seen = new Set<number>();
  for (const p of patches) {
    if (!Number.isInteger(p.call) || typeof p.parts !== "string") continue;
    if (p.call === 0) {
      if (!mayAdd || calls.length) refused.push({ call: 0, why: "only a wonder with no model may gain one" });
      else if (added.length >= MAX_ADDED_MODELS) refused.push({ call: 0, why: `at most ${MAX_ADDED_MODELS} models are added` });
      else {
        const why = partsProblem(p.parts);
        if (why) refused.push({ call: 0, why });
        else added.push(p.parts.trim());
      }
      continue;
    }
    const c = calls.find((x) => x.index === p.call);
    if (!c) {
      refused.push({ call: p.call, why: "there is no such call" });
      continue;
    }
    if (seen.has(p.call)) {
      refused.push({ call: p.call, why: "a second look for the same call" });
      continue;
    }
    if (c.args.length < 3) {
      refused.push({ call: p.call, why: "the call has no parts argument" });
      continue;
    }
    const why = partsProblem(p.parts, c.receiver);
    if (why) {
      refused.push({ call: p.call, why });
      continue;
    }
    seen.add(p.call);
    const arg = c.args[2];
    // Keep the argument's own leading and trailing spaces, so the call reads as it did.
    const raw = code.slice(arg.start, arg.end);
    const lead = /^\s*/.exec(raw)![0];
    const trail = /\s*$/.exec(raw)![0];
    edits.push({ span: arg, text: lead + p.parts.trim() + trail });
    replaced.push(p.call);
  }
  let out = code;
  for (const e of edits.sort((a, b) => b.span.start - a.span.start)) out = out.slice(0, e.span.start) + e.text + out.slice(e.span.end);
  if (added.length) {
    const m = CAST_OPEN.exec(out);
    if (!m) {
      for (let k = 0; k < added.length; k++) refused.push({ call: 0, why: "the program has no cast(w) to add a model to" });
      added.length = 0;
    } else {
      const w = m[1];
      const open = m.index + m[0].length;
      const nl = out.indexOf("\n", open);
      const lines = added.map((parts, k) => `${w}.model(${w}.x, ${w}.y, ${parts}, { name: "look ${k + 1}" });`);
      // As whole new lines after the line that opens cast; in a one line program, right after the brace.
      out =
        nl < 0
          ? out.slice(0, open) + " " + lines.join(" ") + out.slice(open)
          : out.slice(0, nl + 1) + lines.map((l) => `    ${l}\n`).join("") + out.slice(nl + 1);
    }
  }
  return { code: out, replaced, added: added.length, refused };
}

// The lines of `after` that are not lines of `before`, in order, with the lines of `before` it
// dropped: what a reviewer reads to see that only looks changed (a plain longest common subsequence
// of lines, programs are a few hundred lines).
export function changedLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) removed.push(a[i++]);
    else added.push(b[j++]);
  }
  while (i < n) removed.push(a[i++]);
  while (j < m) added.push(b[j++]);
  return { removed, added };
}
