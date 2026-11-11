// The World API that stored programs run against, read from the source: the
// public members of the API class and its handles, the keys each option bag
// reads, the fields read from what a program declares (materials, creatures,
// goals, abilities, artifacts) and the words the engine understands. Stored
// programs are never rewritten in bulk (shared/version.ts), so each entry is
// a promise: scripts/api-surface-test.ts compares it with the snapshot in
// scripts/api-surface.json. Read by the TypeScript parser, loaded at run time
// so `npm test`'s bundle does not carry it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type * as TS from "typescript";

export interface Surface {
  members: Record<string, string[]>;
  options: Record<string, string[]>;
  fields: Record<string, string[]>;
  vocab: Record<string, string[]>;
}

// The classes a program's code touches: `w`, and what w hands back.
export const API_CLASSES = ["SpellApi", "CreatureHandle", "BodyHandle", "CellHandle", "ArtifactHandle"] as const;
const RUNTIME = "src/sim/runtime.ts";

// Where a declared object's fields are read: file, function (or Class.method),
// and the variables that hold the object there.
const READERS: { group: string; file: string; fn: string; vars: string[] }[] = [
  { group: "spell", file: RUNTIME, fn: "Runtime.defineRules", vars: ["spell"] },
  { group: "spell", file: RUNTIME, fn: "Runtime.compile", vars: ["spell"] },
  { group: "material", file: RUNTIME, fn: "Runtime.defineRules", vars: ["m"] },
  { group: "material", file: RUNTIME, fn: "reactionOf", vars: ["m"] },
  { group: "material.reacts", file: RUNTIME, fn: "reactionOf", vars: ["raw"] },
  { group: "material.spreads", file: RUNTIME, fn: "reactionOf", vars: ["spread"] },
  { group: "goal", file: RUNTIME, fn: "Runtime.defineRules", vars: ["g"] },
  { group: "creature", file: RUNTIME, fn: "Runtime.defineRules", vars: ["k"] },
  { group: "creature", file: RUNTIME, fn: "behaviorOf", vars: ["k"] },
  { group: "creature", file: "src/sim/body.ts", fn: "bodyFrom", vars: ["raw"] },
  { group: "creature", file: "src/sim/body.ts", fn: "stillModelColor", vars: ["raw"] },
  { group: "ability", file: RUNTIME, fn: "Runtime.ownAbilities", vars: ["a"] },
  { group: "artifact", file: RUNTIME, fn: "Runtime.defineRules", vars: ["a"] },
  { group: "artifact", file: RUNTIME, fn: "Runtime.keepArtifactCode", vars: ["o"] },
  { group: "artifact", file: RUNTIME, fn: "SpellApi.artifact", vars: ["o"] },
  { group: "artifact", file: "src/sim/artifacts.ts", fn: "artifactState", vars: ["o"] },
  { group: "artifact.effect", file: "src/sim/artifacts.ts", fn: "artifactState", vars: ["r"] },
  { group: "artifact.effect", file: "src/sim/artifacts.ts", fn: "effectOf", vars: ["raw"] },
];

// Word lists that live only in the source (not exported): file and const name,
// or the string cases of a switch in a method.
const SOURCE_LISTS: { name: string; file: string; constName?: string; switchIn?: string }[] = [
  { name: "statuses", file: RUNTIME, switchIn: "CreatureHandle.status" },
  { name: "behaviors", file: RUNTIME, constName: "MODES" },
  { name: "auras", file: RUNTIME, constName: "AURAS" },
];

let tsCache: typeof TS | null = null;
function typescript(): typeof TS {
  // Not a static import: esbuild would bundle the whole compiler into npm test.
  tsCache ??= createRequire(import.meta.url)("typescript") as typeof TS;
  return tsCache;
}

const files = new Map<string, TS.SourceFile>();
function source(file: string): TS.SourceFile {
  const ts = typescript();
  let sf = files.get(file);
  if (!sf) {
    sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    files.set(file, sf);
  }
  return sf;
}

function className(sf: TS.SourceFile, name: string): TS.ClassDeclaration {
  const ts = typescript();
  const found = sf.statements.find((s): s is TS.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === name);
  if (!found) throw new Error(`class ${name} not found in ${sf.fileName}`);
  return found;
}

function isPrivate(m: TS.ClassElement | TS.ParameterDeclaration): boolean {
  const ts = typescript();
  const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
  if (mods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword)) return true;
  return !!m.name && ts.isPrivateIdentifier(m.name);
}

function memberName(m: TS.ClassElement): string | null {
  const ts = typescript();
  if (!m.name) return null;
  if (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) return m.name.text;
  return null;
}

// Public members: methods, getters and setters, fields, and constructor
// parameters marked readonly or public (w.x, w.y, creature.raw).
export function publicMembers(file: string, cls: string): string[] {
  const ts = typescript();
  const out = new Set<string>();
  for (const m of className(source(file), cls).members) {
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) {
        const mods = ts.getModifiers(p) ?? [];
        const property = mods.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword || x.kind === ts.SyntaxKind.PublicKeyword);
        if (property && !isPrivate(p) && ts.isIdentifier(p.name)) out.add(p.name.text);
      }
      continue;
    }
    const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
    if (mods.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) || isPrivate(m)) continue;
    const name = memberName(m);
    if (name) out.add(name);
  }
  return [...out].sort();
}

function findFunction(file: string, fn: string): TS.FunctionLikeDeclaration {
  const ts = typescript();
  const sf = source(file);
  const [owner, method] = fn.includes(".") ? fn.split(".") : [null, fn];
  if (owner) {
    const m = className(sf, owner).members.find((x) => memberName(x) === method && ts.isMethodDeclaration(x));
    if (!m) throw new Error(`${fn} not found in ${file}`);
    return m as TS.MethodDeclaration;
  }
  const f = sf.statements.find((s): s is TS.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === method);
  if (!f) throw new Error(`${fn} not found in ${file}`);
  return f;
}

// An initializer that is the object itself, seen through casts, `??`, `?:`
// and spreads: `const all = { ...def, ...asked }` reads the same keys.
function holds(e: TS.Expression | undefined, names: Set<string>): boolean {
  const ts = typescript();
  if (!e) return false;
  if (ts.isIdentifier(e)) return names.has(e.text);
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return holds(e.expression, names);
  if (ts.isConditionalExpression(e)) return holds(e.whenTrue, names) || holds(e.whenFalse, names);
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken))
    return holds(e.left, names) || holds(e.right, names);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return holds(e.right, names);
  if (ts.isObjectLiteralExpression(e)) return e.properties.some((p) => ts.isSpreadAssignment(p) && holds(p.expression, names));
  return false;
}

// The property names read on any of `vars` (and what holds them) inside `node`.
export function keysRead(node: TS.Node, vars: string[]): string[] {
  const ts = typescript();
  const names = new Set(vars);
  // Aliases first, until no new one appears.
  for (let grew = true; grew; ) {
    grew = false;
    const visit = (n: TS.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && !names.has(n.name.text) && holds(n.initializer, names)) {
        names.add(n.name.text);
        grew = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  }
  const keys = new Set<string>();
  const visit = (n: TS.Node): void => {
    if (ts.isPropertyAccessExpression(n) && holds(n.expression, names) && ts.isIdentifier(n.name)) keys.add(n.name.text);
    if (ts.isElementAccessExpression(n) && holds(n.expression, names)) for (const k of literalKeys(n.argumentExpression)) keys.add(k);
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && holds(n.initializer, names))
      for (const el of n.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key)) keys.add(key.text);
      }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...keys].sort();
}

// A key written as a string, or as the variable of a loop over a list of
// strings (`for (const k of ["fire", "water"] as const) raw[k]`).
function literalKeys(e: TS.Expression): string[] {
  const ts = typescript();
  if (ts.isStringLiteral(e)) return [e.text];
  if (!ts.isIdentifier(e)) return [];
  for (let n: TS.Node | undefined = e.parent; n; n = n.parent) {
    if (!ts.isForOfStatement(n) || !ts.isVariableDeclarationList(n.initializer)) continue;
    const decl = n.initializer.declarations[0];
    if (!decl || !ts.isIdentifier(decl.name) || decl.name.text !== e.text) continue;
    let list: TS.Expression = n.expression;
    while (ts.isAsExpression(list) || ts.isParenthesizedExpression(list)) list = list.expression;
    return ts.isArrayLiteralExpression(list) ? list.elements.filter(ts.isStringLiteral).map((x) => x.text) : [];
  }
  return [];
}

// Option bags that may also be a plain string (w.building(x, y, "smithy")):
// a string's own methods are not keys.
const STRING_METHODS = new Set(Object.getOwnPropertyNames(String.prototype));

// Option bags: each public method's parameter typed Record<string, unknown>.
export function optionBags(file: string, cls: string): Record<string, string[]> {
  const ts = typescript();
  const out: Record<string, string[]> = {};
  for (const m of className(source(file), cls).members) {
    if (!ts.isMethodDeclaration(m) || isPrivate(m)) continue;
    const name = memberName(m);
    if (!name) continue;
    for (const p of m.parameters) {
      if (!ts.isIdentifier(p.name) || !p.type || !p.type.getText().includes("Record<string, unknown>")) continue;
      out[`${cls}.${name}(${p.name.text})`] = keysRead(m, [p.name.text]).filter((k) => !STRING_METHODS.has(k));
    }
  }
  return out;
}

function sourceList(file: string, constName?: string, switchIn?: string): string[] {
  const ts = typescript();
  const out: string[] = [];
  const strings = (n: TS.Node): void => {
    if (ts.isStringLiteral(n)) out.push(n.text);
    ts.forEachChild(n, strings);
  };
  if (constName) {
    const visit = (n: TS.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === constName && n.initializer) strings(n.initializer);
      else ts.forEachChild(n, visit);
    };
    visit(source(file));
  }
  if (switchIn) {
    const visit = (n: TS.Node): void => {
      if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) out.push(n.expression.text);
      ts.forEachChild(n, visit);
    };
    visit(findFunction(file, switchIn));
  }
  if (!out.length) throw new Error(`no words found for ${constName ?? switchIn} in ${file}`);
  return [...new Set(out)].sort();
}

// The whole surface. `vocab` holds the lists the engine exports, passed in by
// the test (they are values, read at run time); the lists that live only in
// the source are added here.
export function readSurface(vocab: Record<string, readonly string[]>): Surface {
  const members: Record<string, string[]> = {};
  const options: Record<string, string[]> = {};
  for (const cls of API_CLASSES) {
    members[cls] = publicMembers(RUNTIME, cls);
    Object.assign(options, optionBags(RUNTIME, cls));
  }
  const fields: Record<string, Set<string>> = {};
  for (const r of READERS) {
    const set = (fields[r.group] ??= new Set());
    for (const k of keysRead(findFunction(r.file, r.fn), r.vars)) set.add(k);
  }
  const words: Record<string, string[]> = {};
  for (const [name, list] of Object.entries(vocab)) words[name] = [...new Set(list.map(String))].sort();
  for (const l of SOURCE_LISTS) words[l.name] = sourceList(l.file, l.constName, l.switchIn);
  return {
    members,
    options: sortKeys(options),
    fields: sortKeys(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, [...v].sort()]))),
    vocab: sortKeys(words),
  };
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// What the snapshot has that the source lost, and what the source added.
export function compareSurface(snapshot: Surface, now: Surface): { removed: string[]; added: string[] } {
  const removed: string[] = [];
  const added: string[] = [];
  for (const section of ["members", "options", "fields", "vocab"] as const) {
    const was = snapshot[section] ?? {};
    const is = now[section];
    for (const [group, list] of Object.entries(was)) {
      const here = new Set(is[group] ?? []);
      if (!(group in is)) removed.push(`${section} ${group} (the whole list)`);
      else for (const entry of list) if (!here.has(entry)) removed.push(`${section} ${group}: ${entry}`);
    }
    for (const [group, list] of Object.entries(is)) {
      const there = new Set(was[group] ?? []);
      for (const entry of list) if (!there.has(entry)) added.push(`${section} ${group}: ${entry}`);
    }
  }
  return { removed, added };
}
