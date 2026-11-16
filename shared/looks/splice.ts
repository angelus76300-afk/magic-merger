import { syntaxError } from "../spellcode";

// The looks revamp, phase 2 (roadmap 5.2.5): a look-only rewrite changes what an item looks like
// and nothing it does. The writer is shown the program with its w.model calls numbered and sends
// back, for each call, a new parts list as plain data (readLiteral: lists, objects, numbers,
// strings, true, false, null; no name, call or operator, so it can only draw); the Worker splices
// each one in place of the call's third argument, and only when the whole program still parses. Every character outside those arguments stays as it was, so every line that is
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
// has none; `parts` is the parts list written out as plain data.
export interface LookPatch {
  call: number;
  parts: string;
  name?: string;
}

// The longest parts list taken: 160 parts written out are about 9,000 characters.
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

// A parts list is accepted only as plain data, read by a whitelist (the review of #172: a guard
// that lists what is forbidden was bypassed by passing w as a value, (o => o.spawn("x"))(w)). Allowed:
// arrays, objects whose keys are plain names or strings, numbers (a leading minus, decimals,
// exponents), strings in single or double quotes, true, false and null. Nothing else: no name, call,
// operator, comment, template or spread. Returns the value, or why it is refused.
export function readLiteral(text: string): { value: unknown } | { why: string } {
  let i = 0;
  const n = text.length;
  let depth = 0;
  const fail = (why: string) => {
    throw new Error(why);
  };
  const space = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  const str = (): string => {
    const q = text[i++];
    let out = "";
    while (i < n && text[i] !== q) {
      const c = text[i];
      if (c === "\n" || c === "\r") fail("a string runs past its line");
      if (c === "\\") {
        const e = text[i + 1];
        if (e === undefined) fail("a string never ends");
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "'": "'", '"': '"', "\\": "\\", "/": "/", "0": "\0" };
        if (e === "u") {
          const hex = /^[0-9a-fA-F]{4}$/.exec(text.slice(i + 2, i + 6));
          if (!hex) fail("a string has a bad escape");
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        if (!(e in map)) fail("a string has a bad escape");
        out += map[e];
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    if (i >= n) fail("a string never ends");
    i++;
    return out;
  };
  const value = (): unknown => {
    space();
    if (i >= n) fail("it ends too soon");
    const c = text[i];
    if (c === "[" || c === "{") {
      if (++depth > 6) fail("it nests too deep");
      i++;
      const close = c === "[" ? "]" : "}";
      const arr: unknown[] = [];
      const obj: Record<string, unknown> = {};
      space();
      while (text[i] !== close) {
        if (c === "[") arr.push(value());
        else {
          space();
          let key: string;
          if (text[i] === '"' || text[i] === "'") key = str();
          else {
            const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, i + 40));
            if (!m) fail("an object key is not a plain name");
            key = m![0];
            i += key.length;
          }
          if (key === "__proto__" || key === "constructor" || key === "prototype") fail("an object key is not allowed");
          space();
          if (text[i] !== ":") fail("an object key has no value");
          i++;
          obj[key] = value();
        }
        space();
        if (text[i] === ",") {
          i++;
          space();
          continue;
        }
        if (text[i] !== close) fail("its brackets do not match, or a comma is missing");
      }
      i++;
      depth--;
      return c === "[" ? arr : obj;
    }
    if (c === '"' || c === "'") return str();
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 40));
    if (num) {
      // 011 is not a number JSON or a reader agrees on (an old octal): refused.
      if (/^-?0\d/.test(num[0])) fail("a number has a leading zero");
      i += num[0].length;
      if (i < n && /[\w$.]/.test(text[i])) fail("a number runs into a name");
      const v = Number(num[0]);
      // 1e999 reads as Infinity: not a size the island can draw.
      if (!Number.isFinite(v)) fail("a number is too large");
      return v;
    }
    for (const [word, v] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(word, i) && !/[\w$]/.test(text[i + word.length] ?? "")) {
        i += word.length;
        return v;
      }
    }
    return fail("it holds something that is not plain data (a name, a call, an operator or a comment)");
  };
  try {
    const v = value();
    space();
    if (i < n) fail("something follows the list");
    return { value: v };
  } catch (err) {
    return { why: err instanceof Error ? err.message : String(err) };
  }
}

// Why a parts list cannot be spliced in, or null when it can: it must be a plain data list of parts.
export function partsProblem(parts: string): string | null {
  const t = parts.trim();
  if (!t) return "it is empty";
  if (t.length > MAX_PARTS_TEXT) return `it is longer than ${MAX_PARTS_TEXT} characters`;
  const r = readLiteral(t);
  if ("why" in r) return r.why;
  if (!Array.isArray(r.value)) return "it is not a list of parts";
  if (!r.value.length) return "it has no part";
  if (r.value.length > 200) return "it has more than 200 parts";
  if (!r.value.every((p) => Array.isArray(p) || (p !== null && typeof p === "object"))) return "a part is not a list or an object";
  // At least one part the island can draw, or the look would vanish (the review of #173: [[ ]]).
  if (!r.value.some(drawablePart)) return "no part of it can be drawn";
  return null;
}

// Whether the island draws a part (src/sim/props.ts readBox): width, depth and height are finite
// numbers above zero, in a list at 3, 4, 5 or an object as w, d, h. readBox itself lives with the
// game's code, which the Worker does not load; scripts/looks-refs-test.ts checks the two agree.
export function drawablePart(p: unknown): boolean {
  let w: unknown;
  let d: unknown;
  let h: unknown;
  if (Array.isArray(p)) [w, d, h] = [p[3], p[4], p[5]];
  else if (p && typeof p === "object") ({ w, d, h } = p as Record<string, unknown>);
  else return false;
  return [w, d, h].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
}

// Why the parts argument a call has now may not be overwritten, or null when it may (the review of
// #173: w.model(x, y, (w.spawn("wolf", x, y), [...])) lost its spawn). It may be replaced when it is
// plain data, or a closed expression that does nothing: names, member access, indexes, literals and
// operators, with no call, no assignment, no function, no update, nothing that waits or makes.
// An "=" at i that assigns (or makes an arrow): anything but ==, ===, !=, !==, <= and >=. A shift
// assignment (<<=, >>=, >>>=) has a second < or > before it (review of #172, round 2).
function isAssignment(t: string, i: number): boolean {
  const prev = t[i - 1] ?? "";
  const next = t[i + 1] ?? "";
  if (next === "=" || prev === "=" || prev === "!") return false;
  if (prev === "<" || prev === ">") return t[i - 2] === prev;
  return true;
}

export function oldPartsProblem(arg: string): string | null {
  const t = arg.trim();
  if (!t) return "the call has no parts";
  if (!("why" in readLiteral(t))) return null;
  // A backtick anywhere: scan treats a template as a string and never reports it, so a tagged
  // template call (w.spawn`wolf`) would pass (review of #172, round 2).
  if (t.includes("`")) return "it holds a template";
  let found: string | null = null;
  const ok = scan(t, (i) => {
    if (found) return;
    const c = t[i];
    const next = t[i + 1] ?? "";
    const prev = t[i - 1] ?? "";
    if (c === "(") found = "it calls something or groups an expression";
    else if (c === "`") found = "it holds a template";
    else if (c === "=" && isAssignment(t, i)) found = "it assigns or makes a function";
    else if ((c === "+" && next === "+") || (c === "-" && next === "-")) found = "it changes a value";
    else if (c === "." && next === "." && t[i + 2] === ".") found = "it spreads a value";
  });
  if (!ok) return "a string or a comment in it never ends";
  if (found) return found;
  if (/\b(?:yield|await|new|delete|function|class|import|this)\b/.test(t.replace(/'[^'\n]*'|"[^"\n]*"/g, "''"))) return "it acts, waits or makes something";
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
    const why = partsProblem(p.parts);
    if (why) {
      refused.push({ call: p.call, why });
      continue;
    }
    // What it draws now may do something too: then its look stays, and with it what it does.
    const kept = oldPartsProblem(code.slice(c.args[2].start, c.args[2].end));
    if (kept) {
      refused.push({ call: p.call, why: `its parts are not only a look (${kept})` });
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
  // The whole program must still parse; if it does not, nothing is spliced.
  const broken = syntaxError(out);
  if (broken) return { code, replaced: [], added: 0, refused: [...refused, { call: -1, why: `the spliced program does not parse: ${broken}` }] };
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
